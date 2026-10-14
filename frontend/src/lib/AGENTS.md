# API 与通用函数指南

继承[源码指南](../AGENTS.md)。这里是前端请求和可复用格式化行为的共同入口。

## api.ts

- `API_BASE` 固定 `/api`；`request<T>` 合并 JSON header 和 token、解析响应、处理 HTTP 错误。
- token 键为 `email_agent_token`；401 清 token 并发 `auth:unauthorized`。403 表示可能没有使用或管理员权限，不应统一改成成功返回。
- 对象分组：`auth`、`accounts`、`emails`、`chat`、`dingtalk`、`admin`。新增或变更字段同时核对后端路由、列表/详情差异和组件调用者。
- 保留的 `auth.login/register` 没有当前后端对应路由；`chat.sendMessage(0, ...)` 也不是通用 AI 接口。不要通过方法签名推断服务能力。
- SSE 不经过 `request`，由 App 的 EventSource 建连；改鉴权/基址时要同时检查它。
- `getDetail` 对应后端有已读及条件重分析副作用；`loadMore` 会拉远端并写库；`compose/sendReply` 会真实发信。

## utils.ts

- `cn` 合并 clsx 和 Tailwind 类名。
- `copyToClipboard` 包含现代剪贴板和旧环境降级，调用方用返回值判断成功。
- `parseDateSafe`、邮件列表/详情/同步时间格式化与后端 UTC 序列化配套；改动时检查带 Z、带 offset、旧无时区值和无效值。
- `formatLanguageLabel` 负责显示语言名，模型语言代码与显示文本不要混写。

验证请求参数编码、空值、401/403/429、错误 detail，以及每个改变的格式化边界；不要复制一套 fetch 或日期实现到业务组件中。

## 收件名单契约

mailRecipients.ts 与后端 core/mail_recipients.py 规则一致，支持中英文逗号/分号和简单显示名，去重后输出 to_email/cc_email/bcc_email。api.compose/sendReply 支持这两个可选新增字段及 delivery_warning；详情增加 bcc_recipients。用 `node scripts/test_mail_recipients.mjs`（根目录）验证纯函数，不启动浏览器或服务。
