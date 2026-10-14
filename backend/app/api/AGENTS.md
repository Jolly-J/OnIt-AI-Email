# API 路由指南

继承[上级指南](../AGENTS.md)。所有 router 在 `backend/main.py` 挂载，默认前缀 `/api`。前端契约集中在 `frontend/src/lib/api.ts`。

## 入口表

| 文件 | 路由范围 | 关键行为 |
| --- | --- | --- |
| `auth.py` | `/auth/me`；鉴权依赖 | JWT `sub` → 用户 → `is_active` 校验 |
| `dingtalk.py` | `/auth/dingtalk/config`、`/auth/dingtalk/login`、`/admin/*` | 免登/扫码、首次管理员、组织同步、使用权限与管理员权限 |
| `accounts.py` | `/accounts`、`/presets`、`/test`、`/{id}/sync`、`/{id}/name` | 绑定前连通性校验、凭据加密、首次/手动同步 |
| `emails.py` | `/emails`、`/counts`、`/events`、详情、翻译、归档、写信、同步、历史拉取 | 查询过滤、数据库写入、SSE 与邮件操作 |
| `ai_chat.py` | `/chat/{email_id}`、`/chat/{email_id}/send_reply` | 对话持久化、确认回复、发件箱落库 |

`auth.py` 中保留了注册/登录请求类型和 OAuth2 token URL，但没有实现 `/auth/register` 或 `/auth/login` 路由。不要把类型声明或前端旧方法当作已开放的接口。

## 容易误判的行为

- `GET /emails/{id}` 会标记已读；满足旧 AI 配置提示条件时，还会重新调用 AI 并写库。它不是纯只读诊断入口。
- `POST /emails/load_more` 会访问 IMAP 并插入历史邮件。列表分页 `GET /emails` 只查询本地记录，二者不能混为一谈。
- 归档修改 `status`；普通文件夹列表和计数通常排除已归档记录。排查筛选时同时检查 `folder`、`status`、账号和已读条件。
- 网页发信成功后创建本地 `folder=sent` 记录，并异步追加远端发件箱；不要把 SMTP 失败时的流程写成已发送。
- SSE 通过 query token 或 Authorization 鉴权；普通 API 用 `get_current_user`。不要为了 EventSource 全局放宽鉴权。
- 组织同步会批量更新 `users`；未开通用户仍是有效员工档案，不能按 `is_active=False` 批量清理。

## 修改检查

- 当前用户范围必须贯穿查询与后续关联实体操作；管理员接口使用 `require_admin`，保持防止管理员误关自身权限等现有检查。
- 静态路径与 `/{email_id}` 参数路由有顺序关系；增加路径时检查同一 HTTP 方法是否被动态路由先匹配。
- 响应字段、可空值、时间格式同步核对前端类型和调用者；邮件列表与详情的字段集并不相同。
- AI 成功后再持久化本轮用户/助手消息；异常路径也需验证日志变量、事务和错误响应，不能只读成功分支。
- 增删接口或修改过滤条件，用隔离数据验证跨用户访问、空数据、业务失败和返回格式，不在真实邮箱点击发信试错。

## 抄送与密送接口

compose/send_reply 接收可选 cc_email、bcc_email，统一校验及去重。部分拒收通过 delivery_warning 返回，仍保存已提交记录；不是可整封自动重试的失败。详情 bcc_recipients 仅在属主的已发送邮件中返回，列表与 SSE 不扩散密送名单。
