# 数据库审查与清理记录

审查日期：2026-09-05（Asia/Shanghai）。范围为当前本地项目 `/Users/Python/邮箱助手agent`、其配置/源码/启动脚本和本机运行实例；未检查远端生产服务器。计数与进程信息是审查时快照，不是实时监控。

## 结论与执行结果

当前标准业务库是 `backend/email_assistant.db`。项目内其余三个数据库文件没有业务数据，也不是现有测试代码配置的独立测试库。

用户在审查后明确授权“可以，空的数据库删掉”。执行前再次检查大小、schema 和进程占用，随后删除以下文件：

| 文件 | 删除前大小 | 判断证据 | 处理 |
| --- | --- | --- | --- |
| 根目录 `email_assistant.db` | 4096 字节 | SQLite 格式，sqlite_master 无任何对象；无进程占用；标准启动与 Knex 均使用 backend 下的库 | 已删除 |
| `backend/email_agent.db` | 0 字节 | 空文件，代码/配置/测试没有对应文件名引用，无进程占用 | 已删除 |
| `backend/mail_agent.db` | 0 字节 | 空文件，代码/配置/测试没有对应文件名引用，无进程占用 | 已删除 |

复核期间根目录空库还出现了 `email_assistant.db-wal`（0 字节）和 `email_assistant.db-shm`（32768 字节）。确认该 WAL 没有内容、主库无 schema、整组无进程占用后，一并删除了这两个根目录配套文件。SQLite 只读 WAL 连接也可能建立共享内存配套文件，不能把“出现配套文件”等同于应用正在使用该库。

本次清理保留 `backend/email_assistant.db` 及其正在使用的 `-wal`、`-shm`。本次文档与清理操作没有删除业务表或记录，没有修改数据库配置、迁移或业务代码，也没有运行测试或主动重启服务。被删除的文件原本被 Git 忽略，因此不会表现为 Git 跟踪文件的删除。

## 主库使用证据

| 来源 | 审查发现 |
| --- | --- |
| 本机进程 | Python PID 24250 持有主库与配套文件，监听 127.0.0.1:4667，cwd 为 backend |
| `backend/.env` | DATABASE_URL 为 sqlite:///./email_assistant.db；不在记录中输出其他配置值 |
| [config.py](backend/app/core/config.py) | 后端默认使用相对 URL，.env 也相对 cwd |
| [database.py](backend/app/core/database.py) | 共享 engine/SessionLocal，URL 来自 Settings |
| [scripts/dev.js](scripts/dev.js) | Uvicorn 子进程 cwd 明确设为 backend |
| [knexfile.js](knexfile.js) | 迁移固定指向 backend/email_assistant.db |
| [main.py](backend/main.py) | 挂载业务 API、迁移/补列、收信任务及 Stream |

主库审查时大小为 3,592,192 字节，使用 WAL 模式。查询采用只读 URI、query_only 和读事务，不通过 ORM/应用启动来探测结构。

## 表级用途与快照

| 表 | 记录数 | 系统使用位置/用途 | 结论 |
| --- | ---: | --- | --- |
| users | 317 | auth 用户校验、钉钉登录/组织同步/管理、邮箱与邮件归属 | 保留 |
| mail_accounts | 4 | accounts API、调度器启用状态/同步进度、发信连接配置 | 保留 |
| email_records | 156 | 邮件 API、同步/历史拉取、AI 分析、网页与卡片回复 | 保留 |
| chat_messages | 17 | ai_chat 历史与拟稿、Stream 对话上下文 | 保留 |
| knex_migrations | 3 | 三份已应用迁移记录 | 保留 |
| knex_migrations_lock | 1 | 迁移互斥；检查时 is_locked=0 | 保留 |
| sqlite_sequence | 2 | SQLite 自增序号管理 | 保留 |

未发现可直接删除的多余表。主库 `PRAGMA quick_check` 返回 ok，`PRAGMA foreign_key_check` 没有违规记录；这不是完整业务正确性或性能审计。

补充快照：4 个邮箱均启用；邮件分布为收件箱 117、已发送 33、草稿箱 5、垃圾箱 1。317 条用户中 3 条启用、314 条未启用。组织同步会保存待授权员工，不能将未启用档案按垃圾删除。

有 1 条用户记录与现有测试脚本命名规则吻合。这只是潜在测试残留线索，未逐条审查全部业务数据，也未删除该记录；未检出指定卡片测试账号/主题的残留。

## 路径漂移与结构维护

后端相对 URL 在 backend cwd 下指向正确主库，在项目根 cwd 下会指向根目录同名文件。Knex 始终指向 backend 下的库。因此“从错误目录执行后端/测试导致空库”是代码支持的形成机制，但没有历史日志证明本次空库具体由哪个命令创建。

删除空库没有改变这个机制。以后仍需从 backend 启动，或在获授权的代码修复中统一路径；本次没有根治重复建库的可能性。

结构演进同时依赖：

1. `20260904000001_init_email_schema.js`：创建缺失的四张业务表，已有表跳过。
2. `20260904000002_add_dingtalk_fields_to_users.js`：员工资料及管理员字段。
3. `20260904000003_add_folders_support.js`：folder 与 folder_uids_json。
4. `backend/main.py`：启动补 chat_messages.draft_reply_zh/explanation，以及 email_records.dingtalk_card_out_track_id/dingtalk_card_status。

实际主库存在四个补列字段。旧库的 SQL 定义、默认值和索引不一定与新建库或 ORM 一致；例如检查时卡片状态列的长度声明与当前启动补列声明不同。此次未执行写入来统一结构。

Knex 连接会启用 foreign_keys，Python 连接事件当前仅设置 WAL/NORMAL。没有查到违规数据不等于应用每次写入都受到强制外键检查。

## 测试和后续维护

- 未发现专用测试库切换或统一 dependency override；test_dingtalk_flow.py、test_card_flow.py 使用应用 SessionLocal 直接增删记录。
- test_integration.py 仍调用当前不存在的普通登录/注册路由；test_ai_flow.py 有 key 时会调用真实 AI 服务。
- 不在主库执行这些脚本。仅修改后端 DATABASE_URL 不能隔离应用启动时 Knex 的固定目标。
- 活动主库及有效 WAL 需要一致性备份，恢复还需对应 ENCRYPTION_KEY。迁移、锁和自增表虽不直接显示在界面，仍是系统必要数据。
- 下次清理候选文件必须重新核对连接路径、引用、schema、WAL 内容和进程占用，不能复用本次快照作为删除依据。

结构整理或测试隔离属于后续代码任务，先审查并说明方案，再按用户选择实施。相关入口见 [根级指南](AGENTS.md)、[后端指南](backend/AGENTS.md)、[模型指南](backend/app/models/AGENTS.md)、[迁移指南](migrations/AGENTS.md)。

## 交付复核与并行变更边界

文档编写期间，对比开始前的文件指纹发现以下四个业务文件有外部变更：`backend/app/models/email.py`、`backend/app/api/emails.py`、`backend/app/services/scheduler.py`、`frontend/src/components/MailDetail.tsx`，并新增未跟踪文件 `backend/app/core/language_util.py`。这些代码变化不由本次文档和空库清理操作写入，也未被覆盖；相关指南已经补充本地语言初判和翻译按钮的新行为。

再次检查时服务 PID 已变为 32494，仍从 backend 运行并监听 127.0.0.1:4667、持有同一路径主库与配套文件。主库文件已增长，七张表的上述记录数保持一致，quick_check 仍为 ok，外键检查仍无违规记录。运行库大小和进程变化不能归为本次删除空库造成的数据迁移。

本机 `/api/health` 复核返回 `status=ok`、`service=AI Email Assistant`。22 份交付文档覆盖 18 个项目源码/资源目录，完成本地链接、标题/代码块、目录覆盖和配置秘密值检查。该验证不包括真实发信、钉钉投放、应用测试脚本或前端重新构建。
