import json
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import Base, engine, SessionLocal
from app.core.security import get_password_hash
from app.models.user import User
from app.models.account import MailAccount
from app.models.email import EmailRecord
from app.models.message import ChatMessage

# ==============================================================================
# 离线预置高保真译文库 (彻底避免 Mock 模式消耗或调用真实 AI API，零等待秒返)
# ==============================================================================
MOCK_TRANSLATIONS = {
    "mock_001": {
        "translated_subject": f"关于工商业储能采购咨询与阶梯报价申请 - 荷兰 Solarmatrix 能源公司",
        "translated_body_text": f"""尊敬的销售与方案团队：

您好！

我是荷兰 Solarmatrix 能源解决方案公司的采购总监 David Sterling。我们在欧洲专注工商业（C&I）分布式光伏与储能微电网项目集成。

近期我们审阅了贵司 {settings.COMPANY_NAME_EN} 在工商业储能（C&I BESS）领域的全套产品方案，技术指标与我们的项目需求高度契合。针对即将于 2026 年第三季度在鹿特丹及安特卫普港口落地的 3 个微电网项目，我们计划采购约 50 台 215kWh / 100kW 户外一体化液冷储能柜。

为推进双方商务与供应链评审，请贵司在 4 月 18 日前协助提供以下信息：
1. 215kWh 储能柜针对欧洲市场的全套合规认证副本（重点为 IEC 62619, IEC 62477, VDE-AR-N 4105 及 CE 认证）；
2. 50 台订单的阶梯批量价格表（FOB 上海港或 CIF 鹿特丹港）；
3. 首批 10 台样机交付周期的最短排产周期；
4. 商务付款条件：我司通常采用 30% TT 预付款 + 70% 提单（B/L）见票即付的支付方式，请确认贵司是否接受。

我们非常期待与贵司建立长期的战略供应链合作关系。

顺祝商祺！

David Sterling
采购总监
Solarmatrix B.V.
Keizersgracht 421, Amsterdam, Netherlands
d.sterling@solarmatrix-europe.com""",
        "translated_body_html": f"""<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; padding: 4px;">
  <p>尊敬的销售与方案团队：</p>
  <p>您好！</p>
  <p>我是荷兰 Solarmatrix 能源解决方案公司的采购总监 <strong>David Sterling</strong>。我们在欧洲专注工商业（C&amp;I）分布式光伏与储能微电网项目集成。</p>
  <p>近期我们审阅了贵司 <strong>{settings.COMPANY_NAME_EN}</strong> 在工商业储能领域的全套产品方案，技术指标与我们的项目需求高度契合。针对即将于 2026 年第三季度在鹿特丹及安特卫普港口落地的 3 个微电网项目，我们计划采购约 <strong>50 台 215kWh / 100kW 户外一体化液冷储能柜</strong>。</p>
  <div style="background: #f8fafc; border-left: 4px solid #3b82f6; padding: 12px 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
    <p style="margin: 0 0 8px 0; font-weight: 600; color: #0f172a;">为推进双方商务与供应链评审，请贵司在 4 月 18 日前协助提供以下信息：</p>
    <ol style="margin: 0; padding-left: 20px;">
      <li style="margin-bottom: 6px;">215kWh 储能柜针对欧洲市场的全套合规认证副本（重点为 <strong>IEC 62619, IEC 62477, VDE-AR-N 4105 及 CE 认证</strong>）；</li>
      <li style="margin-bottom: 6px;">50 台订单的阶梯批量价格表（FOB 上海港或 CIF 鹿特丹港）；</li>
      <li style="margin-bottom: 6px;">首批 10 台样机交付周期的最短排产周期；</li>
      <li>商务付款条件：我司通常采用 <strong>30% TT 预付款 + 70% 提单（B/L）见票即付</strong> 的支付方式，请确认贵司是否接受。</li>
    </ol>
  </div>
  <p>我们非常期待与贵司建立长期的战略供应链合作关系。</p>
  <p style="margin-top: 24px;">顺祝商祺！</p>
  <p style="color: #64748b; font-size: 13px; line-height: 1.4;">
    <strong>David Sterling</strong> | 采购总监<br>
    Solarmatrix B.V.<br>
    Keizersgracht 421, Amsterdam, Netherlands<br>
    <a href="mailto:d.sterling@solarmatrix-europe.com" style="color: #3b82f6;">d.sterling@solarmatrix-europe.com</a>
  </p>
</div>"""
    },
    "mock_002": {
        "translated_subject": "【紧急】采购订单 PO-20260408 交付延期预警与应急缓冲保障方案",
        "translated_body_text": """供应链与生产负责人：

您好！

我们非常抱歉地通报：关于贵司采购订单 PO-20260408 项下的高压工业连接器总成（共 1,200 套），原定于 4 月 16 日在汉堡港装船离港。

但由于汉堡港劳工工会突发联合罢工，港口集装箱装卸作业严重滞缓，导致船期被迫推迟 7 至 10 天。

我们深知贵司总装产线对交期有严苛的节点要求。为确保贵司下周生产线不发生断料停工，我们技术与运营团队紧急制定了如下应急缓冲方案：

1. 拆批自费空运：我们将从法兰克福仓库紧急调配首批 200 套成品连接器，经由汉莎航空自费直飞上海浦东机场（运费全部由我方承担）；
2. 抵达时效：预计 4 月 18 日下午完成清关并派送至贵司生产园区，完全满足下周一（4 月 21 日）总装产线的备料节点；
3. 剩余 1,000 套：我们将密切关注港口动态，一旦港区解封将安排第一班快速海运船期，并同步派专人现场跟进追踪。

请在收到本邮件后 24 小时内向我司确认贵方口岸清关对接人信息，以便我们即刻锁定空运舱位。

对于此次海运港口不可抗力带来的不便，我们深表歉意！

Marcus Vance
供应链与全球交付总监
Precision Parts GmbH
Stuttgart, Germany""",
        "translated_body_html": """<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; padding: 4px;">
  <p>供应链与生产负责人：</p>
  <p>您好！</p>
  <p>我们非常抱歉地通报：关于贵司采购订单 <strong>PO-20260408</strong> 项下的高压工业连接器总成（共 1,200 套），原定于 4 月 16 日在汉堡港装船离港。</p>
  <p style="color: #dc2626;">但由于汉堡港劳工工会突发联合罢工，港口集装箱装卸作业严重滞缓，导致船期被迫推迟 7 至 10 天。</p>
  <p>我们深知贵司总装产线对交期有严苛的节点要求。为确保贵司下周生产线不发生断料停工，我们技术与运营团队紧急制定了如下应急缓冲方案：</p>
  <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
    <ol style="margin: 0; padding-left: 20px;">
      <li style="margin-bottom: 8px;"><strong>拆批自费空运：</strong>我们将从法兰克福仓库紧急调配首批 <strong>200 套</strong>成品连接器，经由汉莎航空自费直飞上海浦东机场（运费全部由我方承担）；</li>
      <li style="margin-bottom: 8px;"><strong>抵达时效：</strong>预计 <strong>4 月 18 日下午</strong>完成清关并派送至贵司生产园区，完全满足下周一（4 月 21 日）总装产线的备料节点；</li>
      <li><strong>剩余 1,000 套：</strong>我们将密切关注港口动态，一旦港区解封将安排第一班快速海运船期，并同步派专人现场跟进追踪。</li>
    </ol>
  </div>
  <p>请在收到本邮件后 <strong>24 小时内</strong>向我司确认贵方口岸清关对接人信息，以便我们即刻锁定空运舱位。</p>
  <p style="margin-top: 20px;">对于此次海运港口不可抗力带来的不便，我们深表歉意！</p>
  <p style="color: #64748b; font-size: 13px; line-height: 1.4;">
    <strong>Marcus Vance</strong> | 供应链与全球交付总监<br>
    Precision Parts GmbH, Stuttgart, Germany
  </p>
</div>"""
    },
    "mock_003": {
        "translated_subject": "关于推进智能工作台技术联合评审与会议时间敲定",
        "translated_body_text": "原文即为中文，保留原格式。",
        "translated_body_html": "<p>（原文即为中文，无需多语言转换）</p>"
    },
    "mock_004": {
        "translated_subject": "官方邀请函：2026 Intersolar 全球峰会 VIP 接待会与主题演讲通票",
        "translated_body_text": f"""尊敬的管理团队：

您好！

我们谨代表欧洲国际太阳能暨储能展览会（Intersolar Europe 2026）组委会，非常荣幸地正式邀请贵司 {settings.COMPANY_NAME_EN} 出席将于 2026 年 6 月 17 日至 19 日在德国慕尼黑展览中心举行的全球新能源领袖峰会。

鉴于贵司在分布式智能协同与新能源数字化领域的突出创新，组委会特别为贵司管理层与技术团队预留了以下专属礼遇：
1. 3 张 VIP Executive All-Access 全通通票（包含主会场论坛、行业领袖晚宴及闭门研讨会）；
2. 展会官方媒体专访预约时段（将于 6 月 18 日下午在媒体专区录制）；
3. 2 号馆国际商务展区 VIP 商务洽谈室全天预约使用特权。

请于 2026 年 5 月 15 日前通过专属注册链接完成代表团登记，以便我们提前为您制作专属 VIP 证件及迎宾接待安排。

期待在美丽的慕尼黑与各位相聚！

Sophie Martin
国际事务与会务总监
Intersolar Europe Organizing Committee
Messe München, Germany""",
        "translated_body_html": f"""<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; padding: 4px;">
  <p>尊敬的管理团队：</p>
  <p>您好！</p>
  <p>我们谨代表欧洲国际太阳能暨储能展览会（<strong>Intersolar Europe 2026</strong>）组委会，非常荣幸地正式邀请贵司 <strong>{settings.COMPANY_NAME_EN}</strong> 出席将于 2026 年 6 月 17 日至 19 日在德国慕尼黑展览中心举行的全球新能源领袖峰会。</p>
  <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 12px 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
    <p style="margin: 0 0 6px 0; font-weight: 600; color: #15803d;">组委会特别为贵司管理层与技术团队预留了以下专属礼遇：</p>
    <ul style="margin: 0; padding-left: 20px;">
      <li style="margin-bottom: 6px;"><strong>3 张 VIP Executive All-Access 全通通票</strong>（包含主会场论坛、行业领袖晚宴及闭门研讨会）；</li>
      <li style="margin-bottom: 6px;"><strong>展会官方媒体专访预约时段</strong>（将于 6 月 18 日下午在媒体专区录制）；</li>
      <li><strong>2 号馆国际商务展区 VIP 商务洽谈室全天预约使用特权</strong>。</li>
    </ul>
  </div>
  <p>请于 <strong>2026 年 5 月 15 日前</strong>通过专属注册链接完成代表团登记，以便我们提前制作专属 VIP 证件及迎宾接待安排。</p>
  <p style="margin-top: 20px;">期待在美丽的慕尼黑与各位相聚！</p>
  <p style="color: #64748b; font-size: 13px; line-height: 1.4;">
    <strong>Sophie Martin</strong> | 国际事务与会务总监<br>
    Intersolar Europe Organizing Committee, Messe München, Germany
  </p>
</div>"""
    },
    "mock_005": {
        "translated_subject": "工单 #9821：现场技术支持申请 - Modbus RTU 通信超时问题排查",
        "translated_body_text": """技术支持工程师：

您好！

我是新加坡 Apex Systems 现场集成工程师 Robert Chen。我们目前正在新加坡裕廊工业园区进行微网网关系统调试。

在与贵司的 EMS 能源管理通信单元对接时，发现采用 RS-485 接口、波特率设置为 115200 bps 时，平均每运行 30~45 分钟会出现一次偶发性 Modbus RTU 读寄存器响应超时（错误码 0x0B - Gateway Target Device Failed to Respond）。

我们已排查了以下物理链路：
- 采用双绞屏蔽线，长度约为 45 米；
- 两端已接入 120 欧姆终端匹配电阻；
- 降低波特率至 19200 bps 时通信恢复稳定，但无法满足现场秒级刷新数据要求。

附件中已上传现场串口抓包日志（pcap 格式）与寄存器轮询记录。请技术支持团队协助分析是否与内部串口接收中断缓冲区或校验机制有关，并提供固件排错建议。

期待您的指导与解答！

Robert Chen
现场资深系统工程师
Apex Systems Pte Ltd (Singapore)""",
        "translated_body_html": """<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; padding: 4px;">
  <p>技术支持工程师：</p>
  <p>您好！</p>
  <p>我是新加坡 Apex Systems 现场集成工程师 Robert Chen。我们目前正在新加坡裕廊工业园区进行微网网关系统调试。</p>
  <p>在与贵司的 EMS 能源管理通信单元对接时，发现采用 RS-485 接口、波特率设置为 115200 bps 时，平均每运行 30~45 分钟会出现一次偶发性 <strong>Modbus RTU 读寄存器响应超时</strong>（错误码 <code>0x0B - Gateway Target Device Failed to Respond</code>）。</p>
  <div style="background: #f8fafc; border-left: 4px solid #6366f1; padding: 12px 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
    <p style="margin: 0 0 6px 0; font-weight: 600;">已排查的物理链路情况：</p>
    <ul style="margin: 0; padding-left: 20px;">
      <li>采用双绞屏蔽线，长度约为 45 米；</li>
      <li>两端已接入 120 欧姆终端匹配电阻；</li>
      <li>降低波特率至 19200 bps 时通信恢复稳定，但无法满足现场秒级刷新数据要求。</li>
    </ul>
  </div>
  <p>附件中已上传现场串口抓包日志（pcap 格式）与寄存器轮询记录。请技术支持团队协助分析是否与内部串口接收中断缓冲区或校验机制有关，并提供固件排错建议。</p>
  <p style="margin-top: 20px;">期待您的指导与解答！</p>
  <p style="color: #64748b; font-size: 13px; line-height: 1.4;">
    <strong>Robert Chen</strong> | 现场资深系统工程师<br>
    Apex Systems Pte Ltd (Singapore)
  </p>
</div>"""
    },
    "mock_006": {
        "translated_subject": "战略合作备忘录（MoU）与双语保密协议（NDA）- 对方合规法务反馈",
        "translated_body_text": """商务法务与战略拓展团队：

您好！

北欧创新创投（Nordic Ventures）法律合规部已完成对贵我双方联合战略合作备忘录（MoU）及中英文双语保密协议（NDA）的全文合规审阅。

总体上，我们高度赞同协议所确立的长期战略互信原则。法务团队仅就以下 2 处细节提出了常规修订建议：
1. 第 6.2 条【知识产权归属】：明确双方在联合研发项目开展前已各自拥有的背景知识产权（Background IP）仍归各自所有，本次合作新产生的衍生技术成果归属将另签补充协议明确；
2. 第 11.4 条【争议管辖】：若出现不可调和争议，建议仲裁机构约定为瑞典斯德哥尔摩商会仲裁院（SCC），并适用中立国际商事仲裁准则。

我们已将修改标记版文档附后。若贵方核对无异议，我们将生成最终正式文本并发起 DocuSign 电子签署流程。

顺祝商祺！

Elena Rostova
合伙人兼法务总顾问
Nordic Ventures (Helsinki, Finland)""",
        "translated_body_html": """<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; padding: 4px;">
  <p>商务法务与战略拓展团队：</p>
  <p>您好！</p>
  <p>北欧创新创投（Nordic Ventures）法律合规部已完成对贵我双方联合战略合作备忘录（MoU）及中英文双语保密协议（NDA）的全文合规审阅。</p>
  <div style="background: #f8fafc; border-left: 4px solid #0284c7; padding: 12px 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
    <p style="margin: 0 0 6px 0; font-weight: 600;">法务团队提出的 2 处常规修订建议：</p>
    <ol style="margin: 0; padding-left: 20px;">
      <li style="margin-bottom: 6px;"><strong>第 6.2 条【知识产权归属】：</strong>明确双方在联合研发项目开展前已各自拥有的背景知识产权（Background IP）仍归各自所有；</li>
      <li><strong>第 11.4 条【争议管辖】：</strong>若出现不可调和争议，建议仲裁机构约定为瑞典斯德哥尔摩商会仲裁院（SCC），并适用中立国际商事仲裁准则。</li>
    </ol>
  </div>
  <p>我们已将修改标记版文档附后。若贵方核对无异议，我们将生成最终正式文本并发起 DocuSign 电子签署流程。</p>
  <p style="margin-top: 20px;">顺祝商祺！</p>
  <p style="color: #64748b; font-size: 13px; line-height: 1.4;">
    <strong>Elena Rostova</strong> | 合伙人兼法务总顾问<br>
    Nordic Ventures (Helsinki, Finland)
  </p>
</div>"""
    },
    "mock_008": {
        "translated_subject": "关于英国 Helios Power 2.5MWh 储能电站技术规范书与商业报价单",
        "translated_body_text": f"""尊敬的 Oliver：

感谢您上周与我司技术团队进行的线上深入交流。针对英国 Helios Power 在约克郡开展的 Project Alpha 2.5MWh 储能电站项目，我方现正式提供全套商业报价与技术规范书。

主要商务与交付要点：
1. 系统配置：采用 1 套 2.5MWh 集装箱式液冷储能电池系统，配备 1.25MW 集中式升压变流一体机；
2. 商务报价：总计 482,000 美元（FOB 上海港），含 5 年标准系统质保与远程诊断网关支持；
3. 循环寿命：承诺 25℃ 充放电倍率 0.5C 条件下循环寿命不少于 6,000 次，容量保持率高于 70%；
4. 预期交付：合同生效并收到预付款后 45 天内完成工厂验收（FAT）并具备装船发运条件。

详细的 CAD 总装图纸与技术参数白皮书已打包发送。期待您的进一步审阅与反馈！

此致，
{settings.COMPANY_NAME} 国际业务部""",
        "translated_body_html": f"""<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; padding: 4px;">
  <p>尊敬的 Oliver：</p>
  <p>感谢您上周与我司技术团队进行的线上深入交流。针对英国 Helios Power 在约克郡开展的 <strong>Project Alpha 2.5MWh 储能电站项目</strong>，我方现正式提供全套商业报价与技术规范书。</p>
  <div style="background: #f8fafc; border-left: 4px solid #10b981; padding: 12px 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
    <ul style="margin: 0; padding-left: 20px;">
      <li><strong>系统配置：</strong>采用 1 套 2.5MWh 集装箱式液冷储能电池系统，配备 1.25MW 升压变流一体机；</li>
      <li><strong>商务报价：</strong>总计 <strong>482,000 美元</strong>（FOB 上海港），含 5 年质保；</li>
      <li><strong>循环寿命：</strong>0.5C 条件下循环寿命不少于 6,000 次（容量保持率 &gt; 70%）；</li>
      <li><strong>预期交付：</strong>合同生效并收到预付款后 45 天内具备装船条件。</li>
    </ul>
  </div>
  <p>期待您的进一步审阅与反馈！</p>
  <p style="margin-top: 20px;">此致，<br><strong>{settings.COMPANY_NAME} 国际业务部</strong></p>
</div>"""
    }
}

def get_mock_translation(uid: str) -> dict | None:
    """获取预置的 Mock 邮件翻译，完全不需要调用任何 AI API"""
    return MOCK_TRANSLATIONS.get(uid)

# ==============================================================================
# 纯内存数据库初始化与丰富演示数据预装（零磁盘文件写入，完全隔离真实主库）
# ==============================================================================
def init_mock_database(db: Session = None):
    """在纯内存 SQLite 中创建架构并注入丰富演示数据"""
    Base.metadata.create_all(bind=engine)

    own_session = False
    if db is None:
        db = SessionLocal()
        own_session = True

    try:
        # 1. 注入演示管理员
        user = db.query(User).filter(User.username == "demo_admin").first()
        if not user:
            user = User(
                username="demo_admin",
                hashed_password=get_password_hash("demo_password_2026"),
                display_name="演示管理员",
                dingtalk_userid="mock_admin_001",
                avatar="",
                job_number="DEMO-001",
                department_name="国际业务拓展部",
                is_admin=True,
                is_active=True
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        # 2. 注入演示邮箱账号
        account = db.query(MailAccount).filter(MailAccount.email_address == "demo@company.example").first()
        if not account:
            account = MailAccount(
                user_id=user.id,
                provider="aliyun_enterprise",
                name="企业演示邮箱 (Demo)",
                email_address="demo@company.example",
                encrypted_password="mock_encrypted_token",
                imap_host="imap.demo.local",
                imap_port=993,
                imap_ssl=True,
                smtp_host="smtp.demo.local",
                smtp_port=465,
                smtp_ssl=True,
                is_active=True,
                last_uid="1000",
                folder_uids_json=json.dumps({"inbox": 1000, "sent": 500, "drafts": 200, "trash": 100})
            )
            db.add(account)
            db.commit()
            db.refresh(account)

        # 3. 注入 10 封全场景演示业务邮件
        existing_count = db.query(EmailRecord).filter(EmailRecord.user_id == user.id).count()
        if existing_count > 0:
            return

        now = datetime.now(timezone.utc)
        def _date(hours_ago: int = 0, minutes_ago: int = 0) -> str:
            t = now - timedelta(hours=hours_ago, minutes=minutes_ago)
            return t.strftime("%Y-%m-%d %H:%M:%S")

        mock_emails = [
            # 1. 重点商业询盘 (未读)
            EmailRecord(
                user_id=user.id,
                account_id=account.id,
                uid="mock_001",
                message_id="<inq-2026-8891@solarmatrix-europe.com>",
                subject="Inquiry on Commercial Energy Storage & Tier-Pricing Request - Solarmatrix B.V.",
                sender="David Sterling <d.sterling@solarmatrix-europe.com>",
                to_recipients="demo@company.example",
                sent_date=_date(hours_ago=1, minutes_ago=25),
                body_text="Dear Sales and Solutions Team,\n\nI hope this email finds you well.\n\nI am David Sterling, Chief Procurement Officer at Solarmatrix B.V., based in the Netherlands. We specialize in EPC and integration of commercial and industrial (C&I) solar-plus-storage microgrid projects across Benelux.\n\nWe have reviewed your latest product portfolio and are impressed with your C&I liquid-cooling battery storage cabinets. For our upcoming microgrid projects in Rotterdam and Antwerp ports scheduled for Q3 2026, we are looking to procure approximately 50 units of 215kWh / 100kW outdoor liquid-cooled BESS cabinets.\n\nCould you please provide us with:\n1. Compliance certificates for European markets (specifically IEC 62619, IEC 62477, VDE-AR-N 4105, and CE declaration of conformity);\n2. Tiered volume pricing for 50 units (FOB Shanghai or CIF Rotterdam port);\n3. Current lead time for a pilot order of 10 sample units;\n4. Commercial payment terms: We typically operate on 30% TT advance deposit and 70% against Bill of Lading (B/L) copy.\n\nWe would appreciate receiving your feedback before April 18th.\n\nBest regards,\n\nDavid Sterling\nCPO | Solarmatrix B.V.\nAmsterdam, Netherlands\nd.sterling@solarmatrix-europe.com",
                body_html="""<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
<p>Dear Sales and Solutions Team,</p>
<p>I hope this email finds you well.</p>
<p>I am <strong>David Sterling</strong>, Chief Procurement Officer at <strong>Solarmatrix B.V.</strong>, based in the Netherlands. We specialize in EPC and integration of commercial and industrial (C&I) solar-plus-storage microgrid projects across Benelux.</p>
<p>We have reviewed your latest product portfolio and are impressed with your C&I liquid-cooling battery storage cabinets. For our upcoming microgrid projects in Rotterdam and Antwerp ports scheduled for Q3 2026, we are looking to procure approximately <strong>50 units of 215kWh / 100kW outdoor liquid-cooled BESS cabinets</strong>.</p>
<div style="background-color: #f5f8fa; border-left: 4px solid #0066cc; padding: 12px 16px; margin: 16px 0;">
<p style="margin: 0 0 8px 0; font-weight: bold;">Could you please provide us with:</p>
<ol style="margin: 0; padding-left: 20px;">
  <li style="margin-bottom: 6px;">Compliance certificates for European markets (specifically <strong>IEC 62619, IEC 62477, VDE-AR-N 4105, and CE</strong> declaration of conformity);</li>
  <li style="margin-bottom: 6px;">Tiered volume pricing for 50 units (FOB Shanghai or CIF Rotterdam port);</li>
  <li style="margin-bottom: 6px;">Current lead time for a pilot order of 10 sample units;</li>
  <li>Commercial payment terms: We typically operate on <strong>30% TT advance deposit and 70% against B/L copy</strong>.</li>
</ol>
</div>
<p>We would appreciate receiving your feedback before April 18th.</p>
<p>Best regards,</p>
<p><strong>David Sterling</strong><br>CPO | Solarmatrix B.V.<br>Amsterdam, Netherlands</p>
</div>""",
                language_detected="en",
                summary_zh="【重要商业询盘】荷兰新能源集成商 Solarmatrix 拟采购 50 台 215kWh 工商业储能一体柜，索取 CE/IEC 认证、批量阶梯报价及账期方案。",
                key_points_json=json.dumps([
                    "客户计划采购 50 台 215kWh/100kW 户外液冷储能柜，用于鹿特丹/安特卫普微网项目",
                    "索取 IEC 62619, IEC 62477, VDE 4105 及 CE 认证文件",
                    "索取 50 台阶梯报价（FOB/CIF）及首批 10 台样机排产交期",
                    "客户提出 30% TT 预付款 + 70% 见提单副本（B/L）付款账期"
                ], ensure_ascii=False),
                action_items_json=json.dumps([
                    "整理 215kWh 储能柜认证资质白皮书与 CE 证书扫描件",
                    "协同财务与商务部门核定 50 台批量梯次报价表与欧洲 CIF 运费",
                    "向生产制造部核实首批 10 台样机排产交期（目标控制在 3-4 周）"
                ], ensure_ascii=False),
                ai_guided_question="是否接受客户提出的 30% TT 预付 + 70% 见提单支付条款？是否需要为客户配套安排欧洲当地技术团队线上沟通？",
                initial_reply_draft=f"""Dear Mr. Sterling,

Thank you for reaching out to {settings.COMPANY_NAME_EN}. We are delighted to learn about your upcoming microgrid projects in Rotterdam and Antwerp.

Regarding your inquiry:
1. Compliance & Certification: Our 215kWh liquid-cooled C&I BESS is fully certified under IEC 62619, IEC 62477, and VDE-AR-N 4105 with CE declarations. I have attached the official certificates to this email for your review.
2. Pricing: We are preparing a competitive tiered price schedule for 50 units, offering options for both FOB Shanghai and CIF Rotterdam.
3. Lead Time: For a pilot batch of 10 units, our typical production lead time is 25-30 calendar days upon order confirmation.
4. Payment Terms: Your proposed 30% TT advance deposit + 70% against B/L copy is acceptable for this project volume subject to standard credit insurance clearance.

We will provide you with the formal quotation and technical data pack by tomorrow afternoon. Would you be open to a 30-minute video conference this Thursday at 14:00 CET to walk through the technical specifications?

Sincerely,

Business Specialist
{settings.COMPANY_NAME_EN}""",
                folder="inbox",
                status="inbox",
                is_read=False
            ),

            # 2. 供应链紧急预警 (未读)
            EmailRecord(
                user_id=user.id,
                account_id=account.id,
                uid="mock_002",
                message_id="<urg-2026-4401@precision-parts.de>",
                subject="[URGENT] Delivery Delay Notification & Risk Mitigation for PO-20260408",
                sender="Marcus Vance <m.vance@precision-parts.de>",
                to_recipients="demo@company.example",
                sent_date=_date(hours_ago=3, minutes_ago=10),
                body_text="Dear Operations and Procurement Team,\n\nWe regret to inform you that our scheduled shipment of 1,200 sets of High-Voltage Industrial Connectors under PO-20260408 has encountered an unexpected logistics delay at Hamburg Port due to ongoing strike action.\n\nTo prevent any production downtime at your assembly plant, we have prepared an immediate emergency buffer plan:\n1. Air Freight at Our Expense: We will dispatch 200 units immediately via Lufthansa Cargo to Shanghai PVG, covering all freight costs.\n2. Delivery Timeline: Estimated arrival on April 18th, ensuring your assembly schedule next week remains uninterrupted.\n3. Balance 1,000 units: Scheduled on the first available express ocean vessel once the port resumes normal operations.\n\nPlease confirm your airport customs clearance contact within 24 hours so we can lock in the air waybill.\n\nWe sincerely apologize for this unavoidable disruption.\n\nBest regards,\nMarcus Vance\nPrecision Parts GmbH",
                body_html="""<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
<p>Dear Operations and Procurement Team,</p>
<p>We regret to inform you that our scheduled shipment of 1,200 sets of High-Voltage Industrial Connectors under <strong>PO-20260408</strong> has encountered an unexpected logistics delay at Hamburg Port due to ongoing strike action.</p>
<p style="color: #c0392b;"><strong>Emergency Buffer Plan:</strong></p>
<ol>
  <li><strong>Air Freight at Our Expense:</strong> Dispatch 200 units immediately via Lufthansa Cargo to Shanghai PVG (freight paid by us).</li>
  <li><strong>Delivery Timeline:</strong> Estimated arrival on April 18th, preventing your production line disruption.</li>
  <li><strong>Balance 1,000 units:</strong> Scheduled on the first express ocean freight once port operations resume.</li>
</ol>
<p>Please confirm your airport customs clearance contact within 24 hours.</p>
<p>Best regards,<br><strong>Marcus Vance</strong><br>Precision Parts GmbH</p>
</div>""",
                language_detected="en",
                summary_zh="【紧急交期预警】德方供应商因港口拥堵导致 PO-20260408 预计延期 7-10 天，提出自费空运 200 套关键件应急保供。",
                key_points_json=json.dumps([
                    "汉堡港罢工导致 1,200 套高压工业连接器海运延期 7-10 天",
                    "德方供应商提议自费空运 200 套应急件至上海浦东机场",
                    "预计 4 月 18 日抵沪，满足下周一产线备料",
                    "要求 24 小时内回复确认机场报关对接人"
                ], ensure_ascii=False),
                action_items_json=json.dumps([
                    "核对总装产线库存，确认 200 套能否覆盖安全生产周期",
                    "提供上海口岸清关提单对接人及收货仓储信息"
                ], ensure_ascii=False),
                ai_guided_question="是否立即批准德方的空运拆批应急方案？是否需要协调报关行提前准备快速清关单证？",
                initial_reply_draft="Marcus, thank you for the proactive communication. We accept your proposal to air-freight 200 units to Shanghai PVG. Our customs agent contact details are attached below...",
                folder="inbox",
                status="inbox",
                is_read=False
            ),

            # 3. 技术联调会议邀约 (已读)
            EmailRecord(
                user_id=user.id,
                account_id=account.id,
                uid="mock_003",
                message_id="<meet-tech-001@partner-tech.com>",
                subject="关于推进智能工作台技术联合评审与会议时间敲定",
                sender="李工 <li.jian@partner-tech.com>",
                to_recipients="demo@company.example",
                sent_date=_date(hours_ago=5, minutes_ago=40),
                body_text="您好！\n\n针对双方前期对接的邮件助手与企业协同模块，我方技术团队已完成第一阶段接口适配。建议我们下周二下午 15:00 安排一次线上视频评审会议，共同过一下接口联调方案和权限集成细节，预计用时 1 小时。\n\n如时间合适请确认，我们将锁定会议日程。\n\n此致\n技术部 李工",
                body_html="<p>您好！</p><p>针对双方前期对接的邮件助手与企业协同模块，我方技术团队已完成第一阶段接口适配。建议我们下周二下午 15:00 安排一次线上视频评审会议，共同过一下接口联调方案和权限集成细节，预计用时 1 小时。</p><p>如时间合适请确认，我们将锁定会议日程。</p><p>此致<br>技术部 李工</p>",
                language_detected="zh",
                summary_zh="【会议邀约】技术团队第一阶段接口适配已完成，提议下周二 15:00 召开线上视频评审会，用时 1 小时。",
                key_points_json=json.dumps([
                    "第一阶段接口适配工作已顺利完成",
                    "提议会议时间：下周二下午 15:00 - 16:00",
                    "议题：接口联调方案与权限集成细节"
                ], ensure_ascii=False),
                action_items_json=json.dumps([
                    "确认参会人员与时段是否冲突",
                    "通过工作台日程助手自动敲定会议与视频会议房间"
                ], ensure_ascii=False),
                ai_guided_question="下周二下午 15:00 是否方便参会？是否需要拉取其他技术人员一同入会？",
                initial_reply_draft=f"李工，您好：\n\n感谢您的来信。下周二下午 15:00 时间合适，我方将准时参会，稍后我将为您同步正式视频会议日程。\n\n此致\n敬礼！\n\n业务专员\n{settings.COMPANY_NAME}",
                folder="inbox",
                status="inbox",
                is_read=True
            ),

            # 4. 国际展会 VIP 邀请函 (已读)
            EmailRecord(
                user_id=user.id,
                account_id=account.id,
                uid="mock_004",
                message_id="<conf-2026-vip@intersolar-conference.org>",
                subject="Official Invitation: Intersolar Global 2026 VIP Reception & Keynote Pass",
                sender="Sophie Martin <events@intersolar-conference.org>",
                to_recipients="demo@company.example",
                sent_date=_date(hours_ago=22, minutes_ago=15),
                body_text="Dear Executive Team,\n\nOn behalf of the Intersolar Europe 2026 organizing committee, we are pleased to cordially invite your executive delegation to attend the Global Renewable Energy Summit in Munich from June 17-19, 2026.\n\nWe have reserved 3 VIP Executive Passes and a private booth meeting room for your team. Please confirm registration before May 15th.\n\nWarm regards,\nSophie Martin\nIntersolar Organizing Committee",
                body_html="""<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
<p>Dear Executive Team,</p>
<p>On behalf of the <strong>Intersolar Europe 2026</strong> organizing committee, we are pleased to cordially invite your executive delegation to attend the Global Renewable Energy Summit in Munich from June 17-19, 2026.</p>
<p>We have reserved <strong>3 VIP Executive Passes</strong> and an exclusive meeting room for your strategic discussions.</p>
<p>Warm regards,<br><strong>Sophie Martin</strong><br>Intersolar Organizing Committee</p>
</div>""",
                language_detected="en",
                summary_zh="【展会邀约】Intersolar 2026 组委会诚邀我司出席慕尼黑新能源峰会，提供 3 张 VIP 通行证与专属洽谈室。",
                key_points_json=json.dumps([
                    "时间地点：2026年6月17-19日，德国慕尼黑",
                    "特约礼遇：提供 3 张 VIP Executive 通票及商务洽谈室",
                    "截止时间：5月15日前完成实名参会登记"
                ], ensure_ascii=False),
                action_items_json=json.dumps([
                    "确认公司赴德参展人员名单",
                    "于 5 月 15 日前完成线上 VIP 证件注册"
                ], ensure_ascii=False),
                ai_guided_question="公司计划由哪位高管带队赴德参会？是否需要协助办理商务邀请函与申根签？",
                initial_reply_draft="Dear Sophie, thank you for the kind VIP invitation. We are confirming our delegation and will submit our attendee details well before the May 15th deadline...",
                folder="inbox",
                status="inbox",
                is_read=True
            ),

            # 5. 客户技术工单排查 (已读)
            EmailRecord(
                user_id=user.id,
                account_id=account.id,
                uid="mock_005",
                message_id="<tkt-9821@apex-systems.sg>",
                subject="Ticket #9821: Technical Support Request - Modbus RTU Communication Timeout",
                sender="Robert Chen <r.chen@apex-systems.sg>",
                to_recipients="demo@company.example",
                sent_date=_date(hours_ago=28, minutes_ago=45),
                body_text="Hi Support Team,\n\nThis is Robert Chen from Apex Systems Singapore. During site commissioning at Jurong Industrial Park, we observed sporadic Modbus RTU timeout errors (code 0x0B) every 30-45 minutes when polling your EMS module at 115200 baud rate.\n\nWe have verified 120 ohm termination resistors and shielded twisted pair cabling (45m length). Please review the attached pcap logs and suggest troubleshooting steps.\n\nRegards,\nRobert Chen",
                body_html="""<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
<p>Hi Support Team,</p>
<p>This is Robert Chen from Apex Systems Singapore. During site commissioning at Jurong Industrial Park, we observed sporadic Modbus RTU timeout errors (code 0x0B) every 30-45 minutes when polling your EMS module at 115200 baud rate.</p>
<p>Please review the attached pcap logs and suggest troubleshooting steps.</p>
<p>Regards,<br><strong>Robert Chen</strong></p>
</div>""",
                language_detected="en",
                summary_zh="【客户技术工单】新加坡客户现场遇到 Modbus RTU 115200 波特率偶发通信超时，附带日志请求排错支持。",
                key_points_json=json.dumps([
                    "现场设备与 EMS 模块在 115200 波特率下偶发超时（错误码 0x0B）",
                    "已完成终端电阻与屏蔽线排查，低波特率可正常工作",
                    "请求技术支持分析抓包日志并提供排错补丁"
                ], ensure_ascii=False),
                action_items_json=json.dumps([
                    "转交嵌入式软件工程师分析串口中断缓冲设置",
                    "向客户提供建议寄存器读取间隔排查指南"
                ], ensure_ascii=False),
                ai_guided_question="是否需要指导客户在网关侧配置 50ms 的轮询延时保护？",
                initial_reply_draft="Hi Robert, thank you for providing the detailed site logs. Our firmware engineers are analyzing the packet traces and we will share a firmware patch and recommendation within 24 hours...",
                folder="inbox",
                status="inbox",
                is_read=True
            ),

            # 6. 战略合作法务审阅 (已读)
            EmailRecord(
                user_id=user.id,
                account_id=account.id,
                uid="mock_006",
                message_id="<legal-mou-001@nordic-ventures.fi>",
                subject="Strategic Partnership MoU & Dual-Language NDA - Legal Feedback",
                sender="Elena Rostova <elena.rostova@nordic-ventures.fi>",
                to_recipients="demo@company.example",
                sent_date=_date(hours_ago=46, minutes_ago=20),
                body_text="Dear Legal and Business Team,\n\nOur legal counsel has finalized the review of the Strategic Cooperation MoU and bilingual NDA. We have accepted the terms with two minor revisions concerning background IP protection (Clause 6.2) and SCC arbitration in Stockholm (Clause 11.4).\n\nPlease let us know if the redline is agreeable so we can proceed to DocuSign.\n\nBest regards,\nElena Rostova",
                body_html="<p>Dear Legal and Business Team,</p><p>Our legal counsel has finalized the review of the Strategic Cooperation MoU and bilingual NDA with minor adjustments to Clause 6.2 and 11.4.</p><p>Best regards,<br>Elena Rostova</p>",
                language_detected="en",
                summary_zh="【法务审阅】北欧创投完成战略意向书及双语 NDA 审阅，针对背景知识产权及仲裁地提出常规微调建议。",
                key_points_json=json.dumps([
                    "MoU 与双语 NDA 总体条款审阅通过",
                    "微调第 6.2 条背景知识产权各自所有权保护",
                    "建议将争议仲裁地选定为斯德哥尔摩商会仲裁院（SCC）"
                ], ensure_ascii=False),
                action_items_json=json.dumps([
                    "提交公司法务部快速确认条款微调",
                    "发起 DocuSign 双方在线电子签署"
                ], ensure_ascii=False),
                ai_guided_question="公司法务是否认可斯德哥尔摩（SCC）作为中立国际仲裁地？",
                initial_reply_draft="Dear Elena, thank you for the prompt review. Our legal counsel has reviewed your redline adjustments and we are fully aligned. Please initiate the DocuSign envelope...",
                folder="inbox",
                status="inbox",
                is_read=True
            ),

            # 7. 已发送：保密协议签署确认 (sent)
            EmailRecord(
                user_id=user.id,
                account_id=account.id,
                uid="mock_007",
                message_id="<sent-conf-001@company.example>",
                subject="Re: 业务合作意向书及保密协议签署确认",
                sender="demo@company.example",
                to_recipients="张经理 <zhang@innovate-solutions.com>",
                sent_date=_date(hours_ago=4, minutes_ago=10),
                body_text="张经理您好：\n\n保密协议我方已完成内部盖章并存档，期待下阶段双方在智能协同与系统集成领域的深度合作。\n\n顺祝商祺！\n业务专员",
                body_html="<p>张经理您好：</p><p>保密协议我方已完成内部盖章并存档，期待下阶段双方在智能协同与系统集成领域的深度合作。</p><p>顺祝商祺！<br>业务专员</p>",
                language_detected="zh",
                summary_zh="【已发送】我方已完成保密协议盖章并归档回执，推进下一阶段业务合作。",
                key_points_json=json.dumps(["协议盖章归档完成", "确认推进下阶段合作"], ensure_ascii=False),
                action_items_json=json.dumps(["持续跟进对接进展"], ensure_ascii=False),
                folder="sent",
                status="replied",
                is_read=True
            ),

            # 8. 已发送：英国项目正式报价 (sent)
            EmailRecord(
                user_id=user.id,
                account_id=account.id,
                uid="mock_008",
                message_id="<sent-quot-002@company.example>",
                subject="Quotation & Technical Specifications for BESS 2.5MWh Project Alpha",
                sender="demo@company.example",
                to_recipients="Oliver Queen <procurement@helios-power.co.uk>",
                sent_date=_date(hours_ago=26, minutes_ago=30),
                body_text=f"Dear Oliver,\n\nFollowing up on our technical review, please find attached our formal quotation and technical data sheet for the 2.5MWh BESS Project Alpha in Yorkshire. The offer includes 1 set of 2.5MWh liquid-cooled container, 1.25MW PCS, 5-year warranty, and standard FAT inspection for $482,000 FOB Shanghai.\n\nWe look forward to your review.\n\nSincerely,\n{settings.COMPANY_NAME_EN}",
                body_html=f"<p>Dear Oliver,</p><p>Please find attached our formal quotation and technical data sheet for the 2.5MWh BESS Project Alpha. The total offer is $482,000 FOB Shanghai.</p><p>Sincerely,<br>{settings.COMPANY_NAME_EN}</p>",
                language_detected="en",
                summary_zh="【已发送】已向英国客户发送 2.5MWh 储能项目技术方案与 48.2 万美元商业报价单。",
                key_points_json=json.dumps(["2.5MWh 项目正式报价 48.2 万美元 FOB", "包含 5 年质保与工厂验收"], ensure_ascii=False),
                action_items_json=json.dumps(["下周跟进客户技术审阅结果"], ensure_ascii=False),
                folder="sent",
                status="replied",
                is_read=True
            ),

            # 9. 草稿箱：季度销售复盘 (drafts)
            EmailRecord(
                user_id=user.id,
                account_id=account.id,
                uid="mock_009",
                message_id="<draft-rev-001@company.example>",
                subject="[草稿] 2026 年 Q2 核心业务线开拓复盘与 Q3 战略预算草案",
                sender="demo@company.example",
                to_recipients="management-board@company.example",
                sent_date=_date(hours_ago=8, minutes_ago=0),
                body_text="各位领导：\n\n草拟的 Q2 季度海外与华东区域大客户拓展复盘数据已初步汇总，Q3 重点开拓欧洲工商业储能渠道与政企邮件智能化升级。以下为初步预算结构，待进一步细化。\n\n1. 海外渠道铺设预估费用...\n2. 展会参展预算...",
                body_html="<p>各位领导：</p><p>草拟的 Q2 季度海外与华东区域大客户拓展复盘数据已初步汇总，Q3 重点开拓欧洲工商业储能渠道与政企邮件智能化升级。</p>",
                language_detected="zh",
                summary_zh="【内部草稿】Q2 业务拓展复盘与 Q3 战略预算草案。",
                key_points_json=json.dumps(["Q2 销售数据初步汇总", "规划 Q3 欧洲展会与渠道拓展预算"], ensure_ascii=False),
                action_items_json=json.dumps(["补充完数据后提交管理层审阅"], ensure_ascii=False),
                folder="drafts",
                status="draft",
                is_read=True
            ),

            # 10. 垃圾箱/归档：节前行政通知 (trash)
            EmailRecord(
                user_id=user.id,
                account_id=account.id,
                uid="mock_010",
                message_id="<admin-notice-001@company.example>",
                subject="关于 2026 年劳动节园区安全排查与值班巡更通知",
                sender="综合行政部 <admin@company.example>",
                to_recipients="all-employees@company.example",
                sent_date=_date(hours_ago=72, minutes_ago=0),
                body_text="各部门同事：\n\n五一假期将至，请各办公区下班前关闭电源门窗，安保部将进行节日安全巡查。祝大家节日愉快！\n\n综合行政部",
                body_html="<p>各部门同事：</p><p>五一假期将至，请各办公区下班前关闭电源门窗，安保部将进行节日安全巡查。祝大家节日愉快！</p><p>综合行政部</p>",
                language_detected="zh",
                summary_zh="【行政归档】2026 年劳动节园区安全排查与放假值班安排。",
                key_points_json=json.dumps(["假期离司安全关电", "行政安保排班巡检"], ensure_ascii=False),
                action_items_json=json.dumps([]),
                folder="trash",
                status="trash",
                is_read=True
            )
        ]

        db.add_all(mock_emails)
        db.commit()

        # 为第 1 封邮件预设一条 AI 助手历史对话，便于演示 Copilot 拟稿互动
        first_mail = db.query(EmailRecord).filter(EmailRecord.uid == "mock_001").first()
        if first_mail:
            demo_msg = ChatMessage(
                email_id=first_mail.id,
                user_id=user.id,
                role="assistant",
                content="已为您分析这封来自荷兰 Solarmatrix 的重点商务询盘。客户采购意向明确，建议优先确认合规认证与样机交期，已为您拟定标准商务回复草稿。",
                draft_reply=first_mail.initial_reply_draft,
                draft_reply_zh="尊敬的 Sterling 先生：\n\n感谢您联系我们。关于贵司询价：\n1. 认证：全套 IEC 62619 及 CE 证书已附上；\n2. 报价：正在核算 50 台批量报价表；\n3. 交期：10 台样机排产周期约为 25-30 天；\n4. 付款：同意 30% TT 预付款 + 70% 见提单副本条款。\n\n期待与贵司共推微网项目落地！",
                explanation="采用国际商务经典响应结构，逐项回复客户关切的认证、报价、交期与账期，展现专业度与合作诚意。"
            )
            db.add(demo_msg)
            db.commit()

    finally:
        if own_session:
            db.close()
