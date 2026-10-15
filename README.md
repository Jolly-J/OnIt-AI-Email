<div align="center">

<img src="frontend/public/zhiliao_logo_full.webp" alt="知了 OnIt Logo" width="260" />

# 知了 OnIt · AI 智能邮件协同工作台
### 工作的事情，就该交给工作的软件来干

<p>
  直接“长”在日常办公软件里的邮件协同中枢（已支持钉钉，规划飞书、企微）<br />
  让 AI 带着你的企业身份和岗位画像，深度研读意图、拟写地道公文、一键排期开会
</p>

<p align="center">
  <a href="https://github.com/Jolly-J/OnIt-AI-Email"><img src="https://img.shields.io/badge/Version-v1.0.0-blue.svg" alt="Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-purple.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/Python-3.10%2B-blue.svg?logo=python" alt="Python 3.10+" />
  <img src="https://img.shields.io/badge/FastAPI-0.110%2B-009688.svg?logo=fastapi" alt="FastAPI" />
  <img src="https://img.shields.io/badge/React-19-blue.svg?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TailwindCSS-3.4-38bdf8.svg?logo=tailwindcss" alt="Tailwind CSS 3.4" />
  <img src="https://img.shields.io/badge/Mock_Mode-纯内存即开即玩-emerald.svg" alt="In-Memory Mock" />
</p>

**带着身份画像深度研读意图 · 双语对称拟公文 · 编辑器实时同步 · 钉钉排期开会一键闭环**

</div>

<p align="center">
  <img src="docs/images/showcase-overview.jpg" alt="知了 OnIt · 深度嵌入企业工作软件运行全貌" width="880" style="border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.12);" />
  <br />
  <sub>🖥️ <strong>全景工作台</strong>：深度融入日常工作环境 —— 读信抓意图、AI 伴随起草、一键在钉钉安排视频会议与日程</sub>
</p>

---

## ⚡️ 5 秒极速试玩（无需配任何环境）

平时精力有限，**我就不单独搭在线演示站了**。为了方便大家开箱就能感受效果，直接在项目里内置了纯内存 Mock 演示：  
**不用配钉钉凭证、不用绑真实邮箱、不用掏钱充 AI Key，克隆下来一行命令直接跑！**

```bash
# 1. 克隆本项目
git clone https://github.com/Jolly-J/OnIt-AI-Email.git
cd OnIt-AI-Email

# 2. 安装依赖并启动纯内存演示
npm ci && npm --prefix frontend ci
python3 -m venv backend/.venv
backend/.venv/bin/python3 -m pip install -r backend/requirements.txt

# 3. 一键启动 Mock 模式
npm run dev:mock
```

浏览器打开 `http://127.0.0.1:4667`，点 **【一键体验（Mock 演示模式）】** 即可直接体验：
- **纯内存运行**：基于 `sqlite:///:memory:`，关掉终端不留任何垃圾文件；
- **预装 10 封高保真真实邮件**：涵盖大单采购询盘、突发交期违约、跨国技术联合评审等全场景；
- **离线秒返翻译**：预置高保真原位译文，点击秒开，0 接口消耗。

---

## 💡 为什么自己做这个？聊聊实际用下来的真实痛点

日常处理跨国商务邮件很多，市面上的邮箱 AI 和各种助手我基本深度用了一圈，但实际体验总觉得差强人意：

- **网易邮箱 AI、阿里邮箱 AI 这些原生工具**：本质只是个文本润色器。它不知道你的公司背景、你的业务模式，更不知道你在这个岗位上要守住哪些谈判底线。生成出来的信件全是万能假大空套话，根本不敢直接发给客户。
- **豆包、ChatGPT 邮箱插件等独立 AI**：用起来太割裂。处理封信还得专门跳到一个外部网页聊天框，更难受的是它们没有一个**始终存在的邮件正文编辑器** —— 每次你提个微调要求，它就重新吐出一整篇全新的长文，你只能一段段手动挑着复制，非常折腾。

所以我按照自己每天实际干活的习惯，搓了知了 OnIt：

1. **让 AI 真正知道“我是谁”**：可以注入你的公司业务背景、你的岗位角色画像与标准公文规范。AI 带着你的真实身份去思考和落款，写出来的邮件专业、得体，没有生搬硬套的塑料感；
2. **新信一来就深度剖析意图**：邮件刚同步，系统就会结合你的业务画像自动拆解三件事 —— **内容说了什么、字面背后的真实意图是什么、建议如何应对**；
3. **编辑器始终在眼前，实时双向同步**：右边是 AI 伴随起草，左边是真正的邮件高级编辑器。你可以随时在左边手动改两句，也可以口语化让 AI 调细节，两者实时双向联动，告别来回复制粘贴；
4. **直接在工作软件里把事办完**：首发直接长在钉钉里（后续接入飞书、企业微信）。信里约好下周开会，点一下按钮，直接在钉钉建好视频会议、把同事拉进日程、连公司的物理会议室都顺手订好，原地闭环。

---

## ✨ 核心做了什么？

### 1. 🏢 工作软件原地办事（首发钉钉）
- **钉钉免密秒登**：基于企业 OAuth 2.0 一键登录，告别繁琐的邮箱授权码；
- **新信卡片直推**：后台探针抓取新信，在钉钉工作流里弹出一张结构化卡片，摘要、核心诉求与应对建议一眼看清，点卡片直切邮件；
- **一键排期闭环**：识别到会议意向，一键调用钉钉接口创建视频会议、推送到参会同事日程，并自动生成国际通用的 `.ics` 日历附件；
- **OA 会议室联动**：自动排查企业物理会议室冲突，一键静默锁房。

### 2. 🤖 带着身份画像的 AI 伴随与双语公文
- **牢固锁定身份与业务事实**：严格依据原信事实拟稿，不画大饼，绝不把客户名字误当落款；
- **双语 1:1 镜像公文**：纯正外文回信 + 1:1 对称的中文公文翻译 + 商务沟通策略说明；
- **编辑器与 AI 实时双向联动**：随时口语化微调（“语气更客气点”、“推迟到周五”），右侧草拟与左侧正文编辑器实时双向同步。

<div align="center">
  <img src="docs/images/showcase-editor.jpg" width="49%" alt="AI 伴随起草与高级编辑器双向实时同步" style="border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.08);" />
  <img src="docs/images/showcase-bilingual-draft.jpg" width="49%" alt="双语公文 1:1 镜像对照与多轮交互微调" style="border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.08);" />
  <br />
  <sub>✍️ <strong>左：自然语言驱动起草与编辑器双向实时同步</strong> ｜ <strong>右：双语公文 1:1 镜像对照与多轮交互微调定稿</strong></sub>
</div>

### 3. 🌍 原位高保真长邮件翻译
- **不破坏原排版**：原位 HTML 解耦翻译，原信的表格、排版和字体配色完整保留；
- **智能宽度自适应**：自动根据内容固有宽度等比缩放，彻底消除横向滚动条；
- **双语瞬切**：一键秒切中文与原文，自带本地缓存。

### 4. 📱 多端适配（电脑 / 手机 / 折叠屏）
- **桌面端**：高效三栏联动、抄送/密送自由展开、大附件本地中转；
- **手机端**：触屏专属单栏推栈阅读与专属写信抽屉；
- **折叠屏**：展开自动切为 45%:55% 黄金阅读比例。

---

## 🛠️ 接入企业真实环境

准备在企业真实运行？只需三步：

```bash
# 1. 复制配置文件并填写你的参数（公司名、API Key、钉钉 AppKey 等）
cp backend/.env.example backend/.env

# 2. 一键启动服务（绑定 4667 端口）
npm run dev

# 3. 数据库迁移升级
npm run migrate
```

> 📖 **服务器生产部署**：支持宝塔面板或 Supervisor 单进程常驻，搭配 Nginx 反向代理。详见 **[宝塔生产环境部署手册 (README_BAOTA.md)](README_BAOTA.md)**。

---

## 🗺️ 后续打算

- [x] **钉钉深度集成**：免密登录、互动卡片、视频会议、钉钉日历、OA 会议室联动
- [ ] **飞书深度适配**：飞书免登、消息卡片、飞书会议与日历联动、多维表格（Bitable）待办同步
- [ ] **企业微信适配**：企微扫码登录、图文卡片、日程与微盘大附件集成
- [ ] **通用办公基础设施**：企业标准 LDAP/SAML 单点登录、通用 Webhook 事件通知

---

## 🤝 写在前面 & 欢迎一起搞！

这套小工具最开始只是为了拯救我们自己在跨国沟通里的各种繁琐折腾。把公司内部敏感信息全部脱敏后开源出来，希望能帮到有类似痛点的外贸和出海朋友。

代码整体结构很干净，如果你对接入飞书、企业微信或优化外贸公文提示词感兴趣，非常欢迎提 [Issues](https://github.com/Jolly-J/OnIt-AI-Email/issues) 或 PR！  
如果它碰巧帮你在工作中省下了一点时间，也欢迎在右上角随手点个 ⭐️ **Star**，支持一下！

---

## 📄 许可证

本项目采用 **[MIT License](LICENSE)** 开源许可证。
