# 邮件工作台前端

这是知了邮件工作台的 React 客户端。完整安装与配置见[项目 README](../README.md)，AI 协作规则见[前端 AGENTS.md](AGENTS.md)。

## 技术与入口

- React 19、TypeScript 6、Vite 8、Tailwind CSS 3.4，Lucide 图标，Sonner 提示，DingTalk JSAPI。
- `src/main.tsx` → `src/App.tsx`，入口样式为 `src/index.css`。
- 当前没有 React Router 或独立全局状态库，账号、文件夹、列表、详情、弹窗和 SSE 主要由 App 管理。
- HTTP 封装及类型在 `src/lib/api.ts`，API 基址固定 `/api`。

## 运行与检查

以下命令在 frontend 目录执行；首次安装还需按根 README 配好后端及根 Node 依赖。

```bash
npm ci
npm run dev
```

Vite 默认使用 4666，把 `/api` 代理到已启动的 127.0.0.1:4667，后端另从 backend 启动。根目录的同名 `npm run dev` 则会释放端口、迁移库、启动后端并监听 dist 构建，访问 4667。

| 命令 | 作用 |
| --- | --- |
| `npm run lint` | Oxlint，配置为 .oxlintrc.json |
| `npm run build` | tsc -b && vite build，生成 dist |
| `npm run preview` | 构建预览；当前没有 preview API 代理，不是完整业务联调环境 |

当前 Vite 的 Node 要求为 `^20.19.0 || >=22.12.0`。`vite.config.ts` 设置 `emptyOutDir: false`，会保留旧 hash 文件；只根据 index 当前引用判断发布版本，不编辑 dist 代替源码修改。

## 公开环境变量

`frontend/.env` 可配置 `VITE_DINGTALK_CLIENT_ID` 和 `VITE_DINGTALK_CORP_ID`。登录组件优先请求后端 `/api/auth/dingtalk/config`，失败才使用前端回退值。

`VITE_*` 会进入浏览器产物，不得存放 secret、AI key 或数据库凭据。变更后重启 Vite 或重新构建；前后端环境文件不能混用。

## 界面定位

| 功能 | 文件 |
| --- | --- |
| 登录、扫码、权限拒绝 | src/components/AuthModal.tsx、public/ddlogin.js |
| 账号/文件夹与统计 | src/components/MailSidebar.tsx |
| 搜索、列表、历史加载 | src/components/MailList.tsx、src/App.tsx |
| 原文、译文和缩放 | src/components/MailDetail.tsx |
| 分析、对话、草稿与确认回复 | src/components/AICopilot.tsx |
| 邮箱绑定、测试、重命名 | src/components/AccountDialog.tsx |
| 新邮件发送 | src/components/ComposeDialog.tsx |
| 组织同步和员工授权 | src/components/AdminDialog.tsx |
| 共享确认框和提示 | src/components/ui/ |
| 日期、语言和剪贴板降级 | src/lib/utils.ts |

## 交互约定与现有边界

- 钉钉内免登、普通浏览器扫码；回调地址为当前 origin 的 `/auth/callback`。token 键为 `email_agent_token`。
- `?emailId=` 用于从卡片定位邮件，实际权限仍由后端检查；验证登录后定位、列表刷新和目标不在当前筛选中的行为。
- 列表与计数分别请求；folder 与 status 不同，已回复和已归档是状态视图。
- App 当前处理 SSE 的 new_email、email_analyzed、counts_updated；Stream 发出的 email_replied 尚无消费者分支。
- 正文放在不允许脚本的 iframe；复杂译文由后端重新排版。AI 正文、中文对照和策略解释分开展示，发送确认使用用户实际选择/编辑的正文。
- api.auth.login/register 是保留方法，后端无对应路由。写信弹窗 AI 润色调用要求真实邮件 ID 的 /chat/0，后端没有通用写信上下文分支。
- App.css 和 src/assets 中部分脚手架资源当前未引用，不能假定在其中修改即可生效，也不能未经确认清理。

## 验证范围

代码修改先做 lint/build，再按变化核对桌面、窄屏和真实钉钉客户端。覆盖登录及权限拒绝、切换邮件的异步旧响应、空列表、长信/宽表格、翻译切换、草稿编辑、弹窗滚动和关闭。

发信、解绑、组织同步和授权切换有真实业务副作用；详情 GET 还会标记已读并可能重新分析。无授权时使用隔离环境，不在真实账号上以点击代替测试设计。

## 抄送与密送

桌面 ComposeDialog 和移动 MobileComposeSheet 共用 RecipientFields，可在写新信和回复时添加多个抄送/密送地址。发送请求通过 lib/mailRecipients.ts 统一校验；详情页显示抄送，密送仅在自己的已发送邮件中显示。部分拒收会持续提示，不能整封重复发送。需要先升级后端及新增的密送字段迁移，详见根 README 的升级说明。
