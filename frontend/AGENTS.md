# 前端接手指南

继承[根级指南](../AGENTS.md)，运行说明见 [README.md](README.md)。技术栈为 React 19、TypeScript 6、Vite 8、Tailwind CSS 3.4、Lucide、Sonner 与 DingTalk JSAPI。

## 构建与目录

- `src/main.tsx` 加载 `src/index.css` 和 `App.tsx`，使用 React StrictMode。
- `src/` 负责状态、界面、API 和通用函数；见 [源码指南](src/AGENTS.md)。
- `public/` 按原路径提供静态文件，包括扫码登录脚本和品牌/服务商图标。
- `vite.config.ts` 配置 `@` → `src`、Vite 4666 端口、`/api` → 4667 代理，以及 `emptyOutDir: false`。
- `tailwind.config.js` 和 `src/index.css` 定义 HSL 主题变量；不要局部引入另一套主题或无关 UI 框架。
- `tsconfig.app.json` 的 `@/*` 与 Vite 别名要一致；lint 配置在 `.oxlintrc.json`，使用 Oxlint。

从项目根目录执行的检查：

```bash
npm --prefix frontend run lint
npm run build
```

构建执行 `tsc -b && vite build`。`frontend/dist/` 不自动清空，旧 hash 文件可能残留，不把目录中所有产物当作当前页面实际引用。

## 运行与副作用

- 根 `npm run dev` 是后端托管 dist 的一体化开发，访问 4667；它会释放端口、迁移库、启动后台收信。
- 本目录 `npm run dev` 是 Vite 开发，访问 4666，需要另启后端。它与根同名命令行为不同。
- API 基址固定 `/api`；生产预览 `npm run preview` 没有配置 API 代理，不能作为完整业务环境。
- `VITE_*` 会进入浏览器产物，只放公开 client/corp ID，不能放后端密钥。修改后需要重启 Vite 或重新构建。

## 界面验收

界面修改按实际影响核对桌面宽屏、窄屏、钉钉 PC/移动端；构建成功不是目标客户端验收。至少覆盖登录/权限拒绝、账号与文件夹切换、列表与详情、长正文、对话草稿、弹窗滚动和关闭。

不要在未授权的真实账号上用发送、删除邮箱、组织同步或授权切换做 UI 验证。缩放、翻译、SSE 和筛选的问题先检查共享状态及接口，不只给当前组件加补丁。
