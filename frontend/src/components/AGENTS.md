# 业务组件指南

继承[源码指南](../AGENTS.md)。先确认状态由 App 传入还是组件自身维护，再决定修改位置。

| 文件 | 负责内容 |
| --- | --- |
| `AuthModal.tsx` | 钉钉内免登、外部扫码、授权拒绝、登录过渡；加载 `/ddlogin.js` |
| `MailSidebar.tsx` | 用户、账号、文件夹、统计与工具入口；导出 FolderType/FolderCounts |
| `MailList.tsx` | 列表展示、搜索、选中、同步和历史加载入口 |
| `MailDetail.tsx` | 原信/中文翻译、正文 iframe、宽度适配、缩放、复制 |
| `AICopilot.tsx` | 摘要与诉求、重新分析、多轮指令、外文稿/中文对照、编辑、确认发信 |
| `AccountDialog.tsx` | 绑定/测试/解绑邮箱、重命名、手动同步 |
| `ComposeDialog.tsx` | 新邮件发信表单、附件上传与正文编辑 |
| `ComposeCopilot.tsx` | 写信专属 AI 伴随、商务场景卡片、双语草稿起草、一键采纳填入正文 |
| `AdminDialog.tsx` | 员工筛选、组织同步、系统权限与管理员授权 |
| `MailProviderLogo.tsx` | 根据 provider、邮箱和 IMAP host 映射服务商图标 |
| `ui/` | 共享 AlertDialog 和 Sonner Toast；见[公共组件指南](ui/AGENTS.md) |

## 正文与拟稿

- `MailDetail` 使用 `srcDoc` iframe，当前 sandbox 不允许脚本。不要通过加入 `allow-scripts` 或直接注入应用 DOM 解决排版问题。
- 原文和译文切换会改变 iframe 内容；缩放通过内部样式应用。验证宽表格、图片、纯文本、长信、切换邮件、窗口变化与缩放复位。
- 译文缓存在组件状态中，不应说明为已写入数据库。修改翻译链路还需核对后端长 HTML 走文本重排的行为。
- 当前翻译按钮仅在 `language_detected` 有值且不以 zh 开头时展示。按钮可见性问题要追踪本地语种探测、AI 覆盖及旧记录，不直接把缺按钮归因为样式。
- `AICopilot` 的正文、中文对照和策略解释独立展示；确认按钮发送用户实际选中/编辑的正文，必须保留发送前核对步骤。
- `ComposeCopilot` 专用于写新邮件场景，调用 `POST /chat/compose` 进行无状态商务公文拟稿与润色，与左侧 `ComposeDialog` 保持实时感知，并通过 `08-page-side-by-side` 实现读信/写信平滑过渡动效。

## 登录与弹窗

- 登录优先获取后端公开配置，失败才回退前端 `VITE_*`/历史默认值；扫码回调路径是当前 origin 的 `/auth/callback`。
- 不把“未开通权限”当作网络故障或自动放行；管理员操作与邮箱解绑有真实数据副作用。
- 公共提示复用 `ui/Toast`，确认框复用 `ui/AlertDialog`。多处弹窗问题先检查共享遮罩、层级、滚动、焦点和过渡。
- 服务商 UI 映射与后端 `PROVIDER_PRESETS` 对齐；只新增图标文件不会增加可用的连接预设。

验证组件变化时包含 loading、空值、失败、长内容、重复点击、关闭再打开和窄屏布局，并检查 App 中相应的刷新回调。

## 抄送与密送

RecipientFields.tsx 是桌面 ComposeDialog 与移动 MobileComposeSheet 共用的可展开输入。发送前通过 lib/mailRecipients.ts 校验三个名单，重新打开表单清空抄送/密送。普通回复默认仅原发件人，不自动继承名单。delivery_warning 用持续警告展示，部分拒收后关闭编辑器以防整封重发。MailDetail 和 MobileMailDetail 展示抄送；密送仅在 folder=sent 展示，引用原文不包含密送。

桌面写信的抄送/密送入口放在收件人标题右侧，两个输入栏并排，空栏可收起，有地址时禁止隐藏。正文 textarea 的高度由自身控制（resize-y、初始 clamp 高度、最小 120px），表单采用普通文档流加滚动；不要重新给正文或其包裹层加 flex-1，否则手动高度可能被布局重新分配。
