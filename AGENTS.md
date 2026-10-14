# 项目协作与接手指南

本文件适用于整个项目。进入子目录工作时，同时遵循沿途的 `AGENTS.md`；子级补充本目录职责，不重复覆盖根级流程。使用说明见 [README.md](README.md)，数据库盘点见 [DATABASE_AUDIT.md](DATABASE_AUDIT.md)，Prompt 与上下文工程规范见 [PROMPT_ENGINEERING.md](PROMPT_ENGINEERING.md)。

## 与用户协作的规则

1. 接到任务先复述目标、审查范围与执行边界，在运行命令、修改代码或配置前确认理解。用户已经明确说“开始”“确认”或选定方案后，在该授权范围内连续完成工作，无需每条命令重复询问。
2. 代码修改前先汇报实际发现、拟修改位置和预期行为，等待用户明确同意。只读审查的授权不等于代码修改授权。
3. 收到代码报错，先通过原始报错和实际调用链解释根因；提供至少 A 快速修复、B 标准修复、C 深度修复三个方案，说明推荐项及理由，等用户选择后实施。未证实的原因标为假设。
4. 新需求先说明实现思路；复杂业务需要比较方案、范围和代价，由用户决策。
5. 每次回复和形成代码方案前，自检是否满足“先理解和审查、解释及方案、获得授权、执行验证”的流程。范围扩大或需要删除其他数据时另行确认。
6. 不擅自发真实邮件、推钉钉消息、同步组织、修改员工权限、重启服务或运行数据库测试。需要这些操作时先说明实际副作用，并核对本轮是否已获授权。

## 最短阅读路径

1. 读本文件与根 README，执行已授权的 `git status --short`，识别已有修改和未跟踪文件。
2. 根据下表定位任务，读取目标目录的 `AGENTS.md` 和实际文件。
3. 跨前后端问题沿“界面 → API 封装 → 路由 → 服务 → 模型/数据库”追踪；钉钉回调还需核对卡片投放参数与 Stream 处理器。
4. 搜索入口和引用后再扩大范围。用 `rg`，默认跳过依赖、构建产物、日志与虚拟环境；不要导入应用来代替静态阅读。

## 项目结构与任务定位

| 任务 | 先读入口 | 需要一起核对 |
| --- | --- | --- |
| 启动、端口、部署 | `scripts/dev.js`、`backend/main.py` | `knexfile.js`、`frontend/vite.config.ts`、环境文件的键名 |
| 钉钉登录、员工权限 | `frontend/src/components/AuthModal.tsx`、`backend/app/api/dingtalk.py` | `api/auth.py`、`services/dingtalk_service.py`、`models/user.py` |
| 邮箱绑定、同步进度 | `components/AccountDialog.tsx`、`api/accounts.py` | `services/scheduler.py`、`services/mail_service.py`、`models/account.py` |
| 列表、筛选、计数、历史邮件 | `frontend/src/App.tsx`、`backend/app/api/emails.py` | `MailSidebar.tsx`、`MailList.tsx`、`models/email.py` |
| 邮件正文、翻译、缩放 | `components/MailDetail.tsx` | `api/emails.py`、`services/ai_service.py` |
| AI 摘要、对话与回信 | `components/AICopilot.tsx`、`api/ai_chat.py` | `services/ai_service.py`、`models/message.py`、`PROMPT_ENGINEERING.md` |
| 钉钉新邮件卡片 | `services/scheduler.py`、`services/dingtalk_card_service.py` | `dingtalk_stream_listener.py`、`App.tsx` 的 `emailId` 定位 |
| 数据结构 | `backend/app/models/`、`migrations/` | `backend/main.py` 启动补列、`core/database.py`、实际库结构 |
| 公共界面反馈 | `frontend/src/components/ui/` | 所有调用该组件的弹窗、页面 |

表内 `api/`、`services/`、`models/` 简写相对 `backend/app/`；`components/` 简写相对 `frontend/src/`。

## 必须保持的业务语义

- 数据归属以 `user_id` 为主线，邮箱归属还需核对 `account_id`；不能只按邮件 ID 查询后直接操作。
- `folder` 表示远端/本地文件夹，`status` 表示处理状态；“已回复”“已归档”不能当成 IMAP 文件夹。
- IMAP 去重使用 `account_id + folder + uid`，不同账号、文件夹的 UID 不可混用；保留每个文件夹的最大/最小 UID。
- AI 分析只做摘要、要点、诉求和建议；拟稿由员工指令触发，发送另需用户确认。正文草稿、中文对照、策略说明是不同字段。
- 初次绑定和手动同步不发钉钉新邮件卡片；当前调度器仅在后台轮询、收件箱、非首次 UID 基线且新入库时触发卡片。
- 当前新卡片只有“查看邮件”按钮。Stream 中保留拟稿/确认发送分支不代表新卡片已开放这些操作。
- 当前事件总线、限流记录和钉钉 token 缓存都在进程内。每个后端进程都会启动轮询和 Stream；不要直接改成多 worker 部署。

## 数据库和运行边界

- 当前标准业务库为 `backend/email_assistant.db`。后端默认 URL 为相对路径，必须从 `backend/` 启动；Knex 固定指向该文件，不读取 `DATABASE_URL`。
- 结构演进实际由 Knex 迁移和 `main.py` 的启动补列共同完成。不要以修改 ORM 或 `create_all()` 代替迁移，也不要仅凭旧注释判断迁移行为。
- `*.db-wal`、`*.db-shm` 是运行数据配套文件；禁止按扩展名批量清理。备份需使用 SQLite 一致性备份，或完整停机后备份。
- 禁止在主库执行测试用的增删、重置、回滚、`drop`、`VACUUM` 或无依据的修复操作。先准备隔离副本并确认代码的连接目标。
- `.env`、邮箱授权码、token、邮件正文和员工资料不写进文档、示例或提交；日志输出仍需人工核对脱敏。
- `ENCRYPTION_KEY` 关联已有邮箱凭据解密，不可随意重新生成后替换。

## 修改与验证

- 保留开始前的未提交修改和未跟踪业务文件；“未跟踪”不等于“未使用”。不顺手格式化整个项目，不提交 `.env`、数据库、日志或 `frontend/dist/`。
- 前端构建：在根目录运行 `npm run build`；前端 lint：`npm --prefix frontend run lint`。两者通过不能替代桌面、窄屏和真实钉钉端界面验收。
- 后端没有可直接视为隔离测试套件的统一命令。先阅读 `backend/AGENTS.md` 中的测试清单，不直接运行 `pytest` 或所有 `test_*.py`。
- `npm run dev` 会强制释放 4667/4666、执行迁移、启动构建监听和后端；它不是只读检查命令。
- 文档任务核对路径、链接、命令来源、环境变量与源码事实；无需为文档检查重启服务或运行有业务副作用的测试。
- 交付说明改了什么、为什么、验证结果和未验证边界；区分静态确认、实际运行和人工验收。

## 文档维护与目录覆盖

改变入口、配置、表结构、事件或业务流程时，在已批准范围内同步维护最近的 `AGENTS.md` 与相关 README；若超出授权，先报告。

源码、脚本和资源目录各有本地指南。`node_modules/`、`.venv/`、`__pycache__/`、`frontend/dist/`、`logs/` 和 `.git/` 由本文件覆盖，不逐级添加指南，不在其中直接实现功能。

本指南记录的是当前实现及协作约束，不是完整缺陷审计。遇到与代码不一致之处，先核实再更新，不把现有缺陷写成必须长期保留的设计。

## 抄送与密送约束

抄送复用 cc_recipients，密送由独立增量迁移增加 bcc_recipients。SMTP 对外内容禁止含 Bcc，只有私有发件箱副本保留；详情仅向属主返回已发送邮件的密送。普通回复不自动继承名单，部分拒收不能整封自动重试。迁移异常必须停止排查，禁止删库、重建业务表或批量匹配清理。
