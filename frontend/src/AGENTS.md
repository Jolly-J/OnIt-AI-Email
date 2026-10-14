# 前端源码指南

继承[前端指南](../AGENTS.md)。当前没有 React Router 或独立全局状态库，主要交互与状态集中在 `App.tsx`。

## 入口和状态

- `main.tsx`：挂载 App、全局样式与 StrictMode。
- `App.tsx`：登录检查、员工与邮箱、账号/文件夹/已读/搜索筛选、邮件列表/详情、历史拉取、弹窗、SSE、退出清理。
- `index.css`：全局设计变量和通用样式。`App.css` 当前未从入口引用，不能直接在其中修改后假定页面会生效。
- `components/`：界面与业务交互，见[组件指南](components/AGENTS.md)。
- `lib/`：API 契约和通用函数，见[工具指南](lib/AGENTS.md)。
- `assets/`：打包导入资源，见[资源指南](assets/AGENTS.md)。

## 修改必须追踪的联动

- token 存在 `localStorage.email_agent_token`，启动用 `/auth/me` 验证；401 通过 `auth:unauthorized` 触发全局清理。切换用户不能保留上一个用户的邮件和草稿状态。
- `?emailId=` 为钉钉卡片深链入口；核对初始 ID、登录后的选择、列表刷新、目标不在当前列表及权限错误。URL 参数本身不提供访问权限。
- 列表与计数来自独立请求。改变筛选同时检查账号、folder、status、read_filter、q 及翻页，不用排序修改掩盖筛选错误。
- `load_more` 拉远端历史后重新查询列表；前端显示容量与后端 `limit <= 100` 的限制需共同核对。
- SSE 当前处理 `new_email`、`email_analyzed`、`counts_updated`；服务端 `email_replied` 尚未在这里处理。新事件需同时更新生产者和消费者。
- 异步详情/翻译/对话必须关注切换邮件后的旧响应；事件监听、计时器和 EventSource 要清理，兼容 StrictMode 重复挂载。

## 验证

从根目录运行 `npm --prefix frontend run lint` 与 `npm run build`；针对变化核对“初次进入 → 登录 → 切账号/文件夹 → 选邮件 → 刷新 → 退出”的状态变化。只读审查不要调用会标记已读或重分析的详情 API 来代替阅读源码。
