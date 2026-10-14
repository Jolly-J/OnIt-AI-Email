# 后端业务代码地图

继承[后端指南](../AGENTS.md)。本目录按请求入口、基础设施、持久化映射与业务服务划分。

| 目录 | 职责 | 本地指南 |
| --- | --- | --- |
| `api/` | 参数校验、用户/管理员鉴权、HTTP 返回、业务编排 | [API](api/AGENTS.md) |
| `core/` | 配置、数据库会话、安全、时间、日志、限流 | [基础设施](core/AGENTS.md) |
| `models/` | 四张业务表的 SQLAlchemy 映射与邮箱 UID 辅助方法 | [模型](models/AGENTS.md) |
| `services/` | IMAP/SMTP、AI、钉钉、后台轮询、内存事件 | [服务](services/AGENTS.md) |

## 主调用链

- 登录：`api/dingtalk.py` → `services/dingtalk_service.py` → `models/user.py` → JWT；后续请求由 `api/auth.py` 校验用户与使用权限。
- 收信：`api/accounts.py` 或后台 poller → `services/scheduler.py` → `mail_service.py` → `EmailRecord` → AI 分析 → SSE/符合条件的钉钉卡片。
- 回信：`api/ai_chat.py` → AI 起草 → `ChatMessage`；另一次发送请求 → SMTP → 本地发件箱 → 远端 IMAP 追加。
- 卡片回调：`dingtalk_stream_listener.py` → 查询关联邮件及属主 → 生成草稿或确认发送。

## 跨层修改规则

- 先找到现有链路，不为同一功能新增第二套客户端、数据库 engine 或状态缓存。
- HTTP 请求用依赖注入会话；后台任务自行建立、关闭 `SessionLocal`，不能把即将关闭的请求会话传给后台任务。
- 外部成功与本地提交是两个阶段；检查失败路径是否可能重发、漏记或留下半完成状态。
- 用户隔离不仅在列表查询生效，详情、历史对话、发送、SSE 和钉钉回调也要核对。
- `services` 内存在直接持久化代码，当前项目并没有 repository 层；不要只为文档或局部改动虚构/引入新的分层。
