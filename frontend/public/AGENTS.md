# 公共静态资源指南

继承[前端指南](../AGENTS.md)。本目录文件按原文件名复制到 dist，通过站点根路径访问，不需要 import。

| 资源 | 用途与维护入口 |
| --- | --- |
| `ddlogin.js` | 本地扫码登录脚本，提供 `window.DTFrameLogin`；由 `AuthModal.tsx` 动态加载 |
| `favicon.svg` | 页面图标，引用入口 `frontend/index.html` |
| `zhiliao_logo.webp`、`zhiliao_logo_full.webp`、`bandu_logo.png` | 品牌图片；修改前搜索实际组件引用，设计原稿在根 `品牌资源/` |
| `providers/` | 服务商 SVG，见[图标指南](providers/AGENTS.md) |
| `icons.svg` | 保留静态图标资源，是否仍使用以当前引用搜索为准 |

- 不直接手改压缩的 `ddlogin.js` 来修复业务登录；先查 AuthModal、公开配置、回调参数和脚本来源。替换脚本属于需要说明影响的代码变更。
- 资源改名需同步绝对 URL 引用；同名覆盖后验证浏览器缓存和构建产物。
- 公共文件可被浏览器获取，本目录指南也会随公共文件复制；只保存可公开的技术说明，不放凭据、内部数据或个人信息。
- 不编辑 `frontend/dist/` 中的复制品来修复源文件。
