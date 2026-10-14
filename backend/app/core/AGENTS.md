# 基础设施指南

继承[上级指南](../AGENTS.md)。本目录改动会影响整个后端，先追踪所有调用者。

| 文件 | 职责与注意点 |
| --- | --- |
| `config.py` | Pydantic Settings；`.env` 相对进程 cwd；进程环境可覆盖配置。默认值不等于本机有效值 |
| `database.py` | 单一 engine、`Base`、`SessionLocal`、`get_db`；SQLite 连接设置 WAL 与 synchronous=NORMAL |
| `security.py` | bcrypt 密码、JWT、Fernet 邮箱凭据加解密；解密失败返回空字符串 |
| `datetime_util.py` | 数据库存储时间补 UTC 标记，邮件 Date 归一化；前端有对应解析/显示函数 |
| `language_util.py` | `detect_language_fast` 根据标题/正文字符特征做本地语言初判，供新邮件和历史拉取使用；空样本回退 zh，其余未匹配样本回退 en |
| `logger.py` | 项目根 `logs/`，app 日志保留 14 天、warning 及以上日志保留 30 天，正则脱敏 |
| `limiter.py` | 进程内滑动窗口限流，优先按 JWT 用户，其次按客户端 IP |

## 数据库约束

- `DATABASE_URL=sqlite:///./email_assistant.db` 基于 cwd，标准启动目录为 `backend/`。Knex 不读取这个变量，改连接必须同时检查两端。
- 不为了读取元数据导入 `main`；诊断 SQLite 用已存在文件的 URI `mode=ro`。WAL 模式下只读连接也可能建立配套共享内存文件，不能据此判断出现了新的业务库。
- 不对活动 WAL 数据库使用 `immutable=1` 跳过 WAL 来做数据结论；它只适合已经确认不再变化且无有效 WAL 的静态文件。
- Python 连接当前没有设置 `PRAGMA foreign_keys=ON`，Knex 连接有设置。不要只见表定义有外键，就声称应用连接已强制执行外键。
- 避免运行 checkpoint、修复、建表或迁移来“验证连接”，这些属于写入操作。

## 配置、安全和验证

- 配置代码含历史默认凭据；文档只写键名、用途和占位值，不复制真实值。不要用默认凭据部署新环境。
- 保持现有 `ENCRYPTION_KEY` 可解密已有账号；密钥更换需要明确的数据迁移方案。
- `LOG_DIR` 由 `logger.py` 直接从进程环境读取，单独写进 Pydantic 的 `.env` 不会自动导出到进程环境。
- 正则日志脱敏不是邮件正文/用户隐私的完整过滤器；输出原始错误时仍需检查内容。
- 修改时间处理时验证 UTC、无时区旧值、RFC 邮件日期和无法解析值；不得给原本 UTC 的时间再次加八小时。
- 本地语言初判是启发式结果，后续 AI 分析可能覆盖；修改时同时核对调度器、历史拉取、ORM 默认值和前端翻译按钮条件，不承诺对所有混合语种准确识别。
- 修改限流时核对用户共用出口 IP、SSE query token 与 429 的 `Retry-After`；不要把进程内限流描述为分布式限流。

## 收件名单校验

mail_recipients.py 是无配置、数据库或网络依赖的地址规范化函数，由发送接口和 SMTP 服务共用。拒绝换行与无效地址，按 To > Cc > Bcc 去重。前端 lib/mailRecipients.ts 保持同一输入规则。域名转小写，local-part 保留大小写。
