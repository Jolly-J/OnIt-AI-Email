# 数据模型指南

继承[上级指南](../AGENTS.md)。本目录定义 ORM 映射，不能直接代表数据库已拥有这些列或索引。实际结构同时参考 [迁移指南](../../../migrations/AGENTS.md)、`backend/main.py` 与只读查库结果。

| 模型 / 表 | 所属文件 | 主要关系与业务字段 |
| --- | --- | --- |
| `User` / `users` | `user.py` | 钉钉身份、部门资料、`is_active`、`is_admin`；关联邮箱和邮件 |
| `MailAccount` / `mail_accounts` | `account.py` | `user_id`、加密授权码、IMAP/SMTP、账号启用状态、UID 同步进度 |
| `EmailRecord` / `email_records` | `email.py` | `user_id`、`account_id`、`folder`、`uid`、正文、AI 分析、处理与卡片状态 |
| `ChatMessage` / `chat_messages` | `message.py` | 按用户和邮件保存 role、content、草稿、中文对照与解释 |

`__init__.py` 导出四个模型；新增模型时核对导出和加载位置。

## 字段语义

- `User.is_active` 是系统准入权限，`MailAccount.is_active` 是邮箱启用/轮询状态，不能混用。
- `folder` 是 `inbox/sent/drafts/trash` 等文件夹；`status` 还可能是 `replied/archived`。卡片的 `stage` 是另一份交互协议，不直接等于数据库状态。
- `key_points_json`、`action_items_json` 和 `folder_uids_json` 使用文本存 JSON。API 会把分析数组转换成列表，不要让前端重复解析已转换数组。
- `account.py` 的 UID 方法兼容旧的单值映射与新的 `{max,min}`；收件箱还保留 `last_uid` 兼容字段。最大 UID 用于增量，最小 UID 用于向前拉取历史。
- 本地发送记录使用非数字 UID，历史拉取计算最小 UID 时只纳入数字值。
- `initial_reply_draft` 仍被卡片回调使用，即使普通 AI 摘要阶段返回空值，也不能按“当前为空”判废弃。
- 当前 ORM 的 `language_detected` 默认值为 zh，但旧初始迁移仍声明 en。新收信和历史拉取会调用本地语言初判，AI 分析还可能覆盖；修改默认值不会自动回填已有邮件。
- `draft_reply` 是发送正文；`draft_reply_zh` 是外语草稿的完整中文对照；`explanation` 是策略说明。

## 结构变更验证

修改字段时检查：现有数据库列、ORM、迁移、启动补列、写入者、API 序列化、前端类型、旧数据默认值。声明 `index=True` 或修改列长度不会自动更新旧数据库。

SQLAlchemy relationship 不等于已设计好删除级联。迁移使用限制删除的外键，但旧表来源和连接 foreign_keys 设置有差异；删除关联对象前核对真实约束和所有子记录。

## 收件名单字段

cc_recipients 沿用已有列；bcc_recipients 由 20260918000001 增量迁移增加。旧邮件密送为空，只有本地发送记录及远端已发送副本实际提供的 Bcc 才写入；收件名单不等于逐人送达回执。
