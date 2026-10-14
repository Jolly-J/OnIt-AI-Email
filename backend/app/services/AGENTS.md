# 业务服务指南

继承[上级指南](../AGENTS.md)。本目录包含外部调用与后台持久化；阅读函数与调用者后再运行，不以“测试”名称推断无副作用。

## 文件职责

| 文件 | 入口与职责 |
| --- | --- |
| `mail_service.py` | 服务商预设、MIME/HTML/日期解析、IMAP 文件夹解析、增量/历史拉取、SMTP 构造发送、追加远端已发送文件夹 |
| `scheduler.py` | `sync_single_account`、`heal_unanalyzed_emails`、`background_mail_poller`；收信落库、UID 进度、AI、SSE、卡片投放 |
| `ai_service.py` | `_call_llm`、分析、拟稿、翻译及结构化响应容错 |
| `dingtalk_service.py` | access token 内存缓存、免登/扫码身份交换、组织部门和员工查询 |
| `dingtalk_card_service.py` | 新邮件卡片参数、AppLink、创建投放、状态更新方法 |
| `dingtalk_stream_listener.py` | Stream 生命周期、回调解析、历史两阶段拟稿/确认发送处理 |
| `event_bus.py` | 按用户维护进程内 asyncio.Queue 订阅与广播 |

## 收信与通知契约

1. 读取启用的邮箱，解密授权码；按文件夹调用 IMAP。
2. 以 `account_id + folder + uid` 判断是否已入库，用 `core/language_util.py` 初判语言，先保存邮件并广播 `new_email`；历史拉取入口也会做语言初判。
3. 每次同步每个收件箱最多对五封新记录执行 AI 分析；其余记录生成正文预览。补分析任务只查询摘要空缺的收件箱邮件，不会自动把所有预览都升级成 AI 摘要。
4. 卡片触发需满足 `trigger_source == background_poll`、`folder == inbox`、同步前该文件夹已有 UID 基线且本轮新入库；绑定首次同步和手动同步不投放。
5. 更新各文件夹 UID 和 `last_sync_at`，有新记录时广播计数更新。

`POLL_INTERVAL_SECONDS` 是一轮处理完成后的 sleep 秒数，并非固定收信延迟保证。启动时还会尝试补分析，可能产生 AI 外部请求。

## AI 与发送契约

- `_call_llm` 使用当前配置的 `/chat/completions`，单次超时 60 秒，默认最多重试一次。分析与翻译关闭 thinking，拟稿开启 thinking 并传 `reasoning_effort=low`；这些是本项目当前请求参数，不等于所有兼容接口都支持。
- 分析返回语言、中文摘要、要点、诉求和建议，`initial_reply_draft` 留空。员工发出指令后才拟稿。
- 外语稿的 `draft_reply`、完整中文对照 `draft_reply_zh`、策略说明 `explanation` 分开保存和展示；中文稿允许对照为空。
- 提示词含公司名及员工/部门回退值。调整通用性时同时核对网页 API 和 Stream 传参，避免署名取成原信发件人。
- 翻译当前提示词固定为简体中文；大于 2000 字符的 HTML 走文本翻译和重新包装，不保证原始排版逐像素复现。接口中的 `target_lang` 参数不代表已经支持任意目标语言。
- `build_and_send_smtp_email` 返回成功状态、消息、Message-ID、私有发件箱字节、拒收地址列表五项。调用者负责本地发件箱记录和远端 IMAP 追加，不要漏查任一阶段。
- AI key 缺失时会返回降级内容；分析/翻译的错误也有降级路径，不能仅凭 HTTP 200 判断 AI 成功。

## 钉钉当前接通范围

- 新卡片字段为 `youjianzhengwen`、`hexinyaodian`、`duifangsuqiu`、`yingduijianyi`、`anniuzu` 等；嵌套值经 `_convert_param_map` 转字符串，模板变量与代码需成对核对。
- 当前投放 `stage=view_email`，只有“查看邮件”按钮，指向 `APP_BASE_URL/?emailId=...` 的 AppLink。
- Stream 保留 `generate_draft`、`confirm_send`、`quick_reply`，其中涉及真实 AI、SMTP 与数据库写入。函数存在并不意味着当前卡片模板或按钮会触发。
- 回调根据 outTrackId 或 emailId 找到记录，再检查属主。排查权限时覆盖身份缺失、身份不匹配、禁用用户和停用邮箱，不只验证理想路径。
- `update_card_status` 当前未发现业务调用点；不能声称网页回复必然更新已投放卡片。

## SSE 与验证

调度器发送 `new_email`、`email_analyzed`、`counts_updated`；Stream 发送 `email_replied`。前端 `App.tsx` 当前没有 `email_replied` 分支，修改联动需同时核对两端。

网络调用、DB 会话和同步库操作跨 asyncio/to_thread 边界。使用隔离数据库，mock AI、IMAP、SMTP、钉钉和追加发件箱全链路；验证同 UID 跨文件夹、新旧 UID、手动/首次/后台触发差异、重复发送和异常后的本地状态。不要导入服务后直接对真实账号跑一轮作为单元检查。

## 密送隐私与投递结果

SMTP 对外字节绝不含 Bcc；函数返回的私有字节可含 Bcc，只能追加属主的 IMAP 发件箱。部分拒收仍返回成功提交，调用者展示警告并保存记录，禁止整封自动重试；send_smtp_email 兼容包装器仍返回两项。新同步与历史拉取仅在 folder=sent 保存解析到的 Bcc，其余文件夹留空。既有 UID 去重不变，不批量猜测或回填旧邮件密送。
