# 启动脚本指南

继承[根级指南](../AGENTS.md)。`dev.js` 通过根目录 `npm run dev` 调用；隔离检查脚本见文末。

## 执行顺序与影响

1. 释放 4667 和 4666 端口：Unix 使用 lsof 查 PID 后 SIGKILL，Windows 使用 netstat/taskkill。可能终止当前服务或别的端口占用者。
2. 在项目根目录执行 `npx knex migrate:latest`，目标为业务库；错误被捕获后仍继续。
3. 若 `frontend/dist/index.html` 不存在，先构建前端。
4. 在 frontend 启动 `npm run build -- --watch`，输出被忽略；从具体子进程和产物判断实际构建状态。
5. 优先用 `backend/.venv` 的 Python，缺失时回退 PATH；在 backend 启动 Uvicorn，绑定 127.0.0.1:4667，启用 reload，并设置代理绕过环境。
6. 退出时终止子进程并清理 4667。

## 修改和验证

- 修改端口时同步核对根输出、后端入口、前端代理和部署文档；不要只改日志中的 URL。
- 保持 backend cwd，避免相对 `.env` 和 SQLite 路径漂移。
- 此脚本有强制结束进程和数据库写入，不可作为“确认项目能否编译”的默认操作；构建验证单独跑根 `npm run build`。
- 启动成功横幅不代表子进程、迁移或前端监听成功；核对真实端口、健康接口与日志。
- 跨平台改动核对 npm/npx 命令名、Python 路径、带空格/中文路径和退出清理。不要为一次端口冲突扩大到杀死所有 Node/Python 进程。
- 生产使用单 worker Uvicorn/Supervisor，见 [部署说明](../README_BAOTA.md)，不依赖此开发脚本守护生产。

## 无业务副作用的收件名单测试

- `node scripts/test_mail_recipients.mjs`：加载并检查前端地址校验纯函数，无浏览器或网络调用。
- `node scripts/test_bcc_migration.mjs`：仅在本次创建的临时目录内操作合成 SQLite 数据库，验证新装、升级、重复执行、异常停止和拒绝回滚。不导入根 knexfile.js、不连接主库；仅按创建时保存的精确目录路径清理测试产物。
