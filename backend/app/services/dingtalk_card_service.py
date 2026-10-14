import json
import uuid
import httpx
from typing import Dict, Any, Optional
from datetime import datetime
from urllib.parse import quote

from app.core.config import settings
from app.core.logger import logger
from app.models.user import User
from app.models.account import MailAccount
from app.models.email import EmailRecord
from app.services.dingtalk_service import dingtalk_service

class DingTalkCardService:
    """钉钉互动卡片收发与更新管理服务"""

    def _convert_param_map(self, param_map: Dict[str, Any]) -> Dict[str, str]:
        """确保 cardParamMap 中所有 value 均为字符串格式（钉钉开放平台规范）"""
        result = {}
        for k, v in param_map.items():
            if v is None:
                result[k] = ""
            elif isinstance(v, str):
                result[k] = v
            else:
                result[k] = json.dumps(v, ensure_ascii=False)
        return result

    def _format_display_date(self, raw_date: Optional[str]) -> str:
        """将邮件原始时间（如 UTC ISO 字符串）转换为友好的本地化时间显示"""
        if not raw_date:
            return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            # 兼容 UTC ISO 格式，如 2026-09-04T21:01:15+00:00 或 2026-09-04T21:01:15Z
            cleaned = str(raw_date).replace("Z", "+00:00")
            dt = datetime.fromisoformat(cleaned)
            # 转为本地时区（系统时区，如 UTC+8）
            local_dt = dt.astimezone()
            return local_dt.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            return str(raw_date)[:19].replace("T", " ")

    def build_email_applink(self, email_id: int) -> str:
        """
        生成指向具体邮件的钉钉 AppLink 协议跳转地址
        在移动端全屏打开 (target=fullScreen)，在 PC 桌面端以标准安全尺寸独立大窗口打开 (targetDesktop=popupWindow&width=1280&height=800)，规整居中且绝不溢出屏幕
        """
        base_url = (settings.APP_BASE_URL or "http://127.0.0.1:4667").strip().rstrip("/")
        raw_url = f"{base_url}/?emailId={email_id}"
        encoded_url = quote(raw_url, safe="")
        return f"https://applink.dingtalk.com/page/link?url={encoded_url}&target=fullScreen&targetDesktop=popupWindow&width=1280&height=800"

    async def send_new_email_card(
        self,
        user: User,
        account: MailAccount,
        email_record: EmailRecord
    ) -> Optional[str]:
        """
        向员工个人单聊投放新邮件互动 AI 卡片
        返回 outTrackId；若未配置模板 ID 或用户未绑定钉钉则安全跳过
        """
        template_id = settings.DINGTALK_CARD_TEMPLATE_ID.strip()
        if not template_id:
            logger.info(f"[DingTalkCard] 未配置 DINGTALK_CARD_TEMPLATE_ID，跳过互动卡片发送 (Email ID: {email_record.id})")
            return None

        ding_userid = (user.dingtalk_userid or "").strip()
        if not ding_userid:
            logger.info(f"[DingTalkCard] 用户 {user.display_name}(ID: {user.id}) 未绑定 dingtalk_userid，跳过卡片发送")
            return None

        # 1. 获取调用凭证
        try:
            access_token = await dingtalk_service.get_access_token()
        except Exception as e:
            logger.error(f"[DingTalkCard] 获取 access_token 失败，取消卡片投放: {e}")
            return None

        # 2. 构造卡片唯一业务识别码 outTrackId
        out_track_id = f"em_{email_record.id}_{uuid.uuid4().hex[:8]}"

        # 3. 解析并排版各模块内容
        original_body_show = (email_record.body_text or "").strip() or "(邮件无正文文本)"
        # 限制折叠面板文字长度在 3000 字以内，防止超出钉钉卡片 100KB 大小限制
        if len(original_body_show) > 3000:
            original_body_show = original_body_show[:3000] + "\n...(正文过长已截断，请在网页端查看全文)"

        key_points_str = ""
        if email_record.key_points_json:
            try:
                kp_list = json.loads(email_record.key_points_json)
                if isinstance(kp_list, list) and kp_list:
                    # 使用标准 Markdown 列表语法 (- item)，确保钉钉原生列表自动换行排版
                    key_points_str = "\n".join([f"- {str(p).strip()}" for p in kp_list if str(p).strip()])
            except Exception:
                pass

        action_items_str = ""
        if email_record.action_items_json:
            try:
                ai_list = json.loads(email_record.action_items_json)
                if isinstance(ai_list, list) and ai_list:
                    # 使用标准 Markdown 列表语法 (- item)
                    action_items_str = "\n".join([f"- {str(a).strip()}" for a in ai_list if str(a).strip()])
            except Exception:
                pass

        # 格式化时间与主题（将 UTC 时间转化为易读的本地化时间）
        subject_show = email_record.subject or "(无主题)"
        sender_show = email_record.sender or "(未知发件人)"
        date_show = self._format_display_date(email_record.sent_date)
        summary_show = email_record.summary_zh or "正在生成中文要点..."
        guided_advice = email_record.ai_guided_question or "建议先核实发件人诉求，根据业务实际情况决定答复策略。"

        # 生成指向当前邮件的钉钉 AppLink（从工作台全屏打开）
        email_applink_url = self.build_email_applink(email_record.id)

        # 单操作按钮：【查看邮件】全屏在工作台直接打开系统并定位到此邮件
        action_buttons = [
            {
                "text": "查看邮件",
                "color": "blue",
                "status": "normal",
                "event": {
                    "type": "openLink",
                    "params": {
                        "url": email_applink_url
                    }
                }
            }
        ]

        # 邮件正文展示（包含发件人与时间头信息）
        # 行末添加双空格强制 CommonMark 硬换行，与正文之间使用分割线与清晰空行隔开
        zhengwen_content = (
            f"**发件人**：{sender_show}  \n"
            f"**主题**：{subject_show}  \n"
            f"**接收时间**：{date_show}  \n\n"
            f"---\n\n"
            f"{original_body_show}"
        )

        # 核心要点 Markdown（包含中文摘要与标准列表清单）
        yaodian_content = (
            f"> **中文摘要**：{summary_show}\n\n"
            f"{key_points_str or '- 暂无提炼要点'}"
        )

        card_param_map = {
            # 新普通标准互动卡片核心变量映射
            "youjianzhengwen": zhengwen_content,
            "hexinyaodian": yaodian_content,
            "duifangsuqiu": action_items_str or "- 暂无明确行动待办事项",
            "yingduijianyi": guided_advice,
            "anniuzu": action_buttons,
            # 元数据保留（兼容回调查询与审计）
            "emailId": str(email_record.id),
            "accountId": str(account.id),
            "subject": subject_show,
            "sender": sender_show,
            "sentDate": date_show,
            "stage": "view_email"
        }

        # 4. 组装 IM_ROBOT 单聊投放协议（严格遵循钉钉官方 OpenAPI 规范）
        robot_deliver_model: Dict[str, Any] = {"spaceType": "IM_ROBOT"}
        robot_code = settings.DINGTALK_ROBOT_CODE.strip() or settings.DINGTALK_CLIENT_ID.strip()
        if robot_code:
            robot_deliver_model["robotCode"] = robot_code

        body = {
            "userId": ding_userid,
            "userIdType": 1,
            "callbackType": "STREAM",
            "cardTemplateId": template_id,
            "outTrackId": out_track_id,
            "cardData": {
                "cardParamMap": self._convert_param_map(card_param_map)
            },
            "openSpaceId": f"dtv1.card//im_robot.{ding_userid}",
            "imRobotOpenSpaceModel": {
                "supportForward": False,
                "lastMessageI18n": {
                    "ZH_CN": f"新邮件待处理: {subject_show[:25]}"
                }
            },
            "imRobotOpenDeliverModel": robot_deliver_model
        }

        url = "https://api.dingtalk.com/v1.0/card/instances/createAndDeliver"
        headers = {
            "Content-Type": "application/json",
            "x-acs-dingtalk-access-token": access_token
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(url, json=body, headers=headers)
                resp_data = resp.json()

            if resp.status_code == 200 and resp_data.get("success") is not False:
                logger.info(f"[DingTalkCard] 互动卡片成功投递至员工 {user.display_name}({ding_userid}), outTrackId={out_track_id}")
                return out_track_id
            else:
                logger.error(f"[DingTalkCard] 投放卡片失败 (Status {resp.status_code}): {resp_data}")
                return None
        except Exception as e:
            logger.error(f"[DingTalkCard] 调用创建并投放卡片异常 (Email ID: {email_record.id}): {e}", exc_info=True)
            return None

    async def update_card_status(
        self,
        out_track_id: str,
        status: str = "replied",
        status_text: str = ""
    ) -> bool:
        """调用接口更新卡片公有状态（例如用户在网页端回复后同步刷新钉钉端卡片）"""
        if not out_track_id:
            return False

        try:
            access_token = await dingtalk_service.get_access_token()
        except Exception as e:
            logger.error(f"[DingTalkCard] 获取 access_token 失败，无法更新卡片: {e}")
            return False

        url = "https://api.dingtalk.com/v1.0/card/instances"
        headers = {
            "Content-Type": "application/json",
            "x-acs-dingtalk-access-token": access_token
        }
        body = {
            "outTrackId": out_track_id,
            "userIdType": 1,
            "cardData": {
                "cardParamMap": self._convert_param_map({
                    "status": status,
                    "statusText": status_text
                })
            },
            "cardUpdateOptions": {
                "updateCardDataByKey": True
            }
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.put(url, json=body, headers=headers)
                resp_data = resp.json()
            return resp.status_code == 200 and resp_data.get("success") is not False
        except Exception as e:
            logger.error(f"[DingTalkCard] 更新卡片状态异常 (outTrackId={out_track_id}): {e}")
            return False

dingtalk_card_service = DingTalkCardService()
