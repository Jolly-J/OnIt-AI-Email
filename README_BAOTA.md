# 宝塔 / Supervisor 部署指南

本文对应当前“FastAPI 托管前端 dist + SQLite + Knex”实现。通用配置见 [README.md](README.md)。

当前后端启动会调用 `npx knex migrate:latest`，服务器需要 Node.js/npm 和根目录 Node 依赖。已有 dist 可省去现场前端编译，不能省去数据库迁移依赖。

## 1. 准备环境

- 准备 Nginx、Supervisor、Python 3.10 或以上，以及满足当前依赖要求的 Node/npm。
- 若服务器构建前端，Node 要求为 `^20.19.0 || >=22.12.0`，也满足当前根 sqlite3 包的要求。
- 示例根目录为 `/www/wwwroot/mail_assistant`，请替换为实际位置。
- 应用用户需能读取代码/依赖，写 backend 数据库及 WAL/SHM、写日志目录；不使用全目录 777。
- 使用单 worker。多个进程会各自启动收信/Stream，进程内 SSE、限流和缓存不会共享。

上传源码、根 package.json/lock、knexfile、migrations、backend、前端源码或完整 dist。不要把开发机虚拟环境、.env 和业务库作为普通源码覆盖服务器。

## 2. 安装和构建

新环境在服务器根目录执行：

```bash
cd /www/wwwroot/mail_assistant
npm ci
python3 -m venv backend/.venv
backend/.venv/bin/python3 -m pip install -r backend/requirements.txt
```

在服务器构建前端时继续：

```bash
npm --prefix frontend ci
npm run build
```

也可以上传其他环境生成的完整 frontend/dist，省略服务器前端安装/构建，但保留根 Node 依赖。dist 需包含 index、其引用的 assets、扫码脚本、logo 和 providers。

`emptyOutDir: false` 会保留旧产物；发布前核对 index 实际引用和文件完整性。已有环境沿用现有虚拟环境、数据库和密钥，升级按第 6 节执行。

## 3. 配置和迁移

首次创建 backend/.env，按[根 README 变量表](README.md#后端配置)填写本企业的钉钉、管理员、AI、JWT 与凭据加密配置。至少核对：

```dotenv
DATABASE_URL=sqlite:///./email_assistant.db
APP_BASE_URL=https://mail.example.com
POLL_INTERVAL_SECONDS=10
```

域名是占位示例。已有数据库必须沿用原 ENCRYPTION_KEY。扫码回调使用站点 origin 的 /auth/callback；钉钉工作台地址、公开登录配置和卡片 APP_BASE_URL 应对应员工实际访问地址。前端 VITE_* 只存公开 ID，不放 secret。

当前代码在没有管理员时，会将首位通过钉钉核验的登录者设为管理员。首次初始化由指定人员完成，随后检查员工授权。

完成备份和变更确认后，从根目录执行：

```bash
npm run migrate
```

确认正常退出。后端启动还会补四个历史字段，见[迁移指南](migrations/AGENTS.md)。不要删除迁移记录来强制重跑；不能只见迁移表存在就断言所有 ORM 字段齐全。

## 4. Supervisor

在宝塔 Supervisor 管理器添加：

| 项目 | 值 |
| --- | --- |
| 名称 | email_assistant |
| 运行目录 | /www/wwwroot/mail_assistant/backend |
| 命令 | /www/wwwroot/mail_assistant/backend/.venv/bin/python3 -m uvicorn main:app --host 127.0.0.1 --port 4667 --workers 1 |
| 用户 | 有必要文件权限的应用用户 |
| 进程数 | 1 |
| 自动重启 | 开启 |

守护进程 PATH 必须能找到实际安装的 node/npm/npx；交互终端能执行不代表 Supervisor 环境可执行。通过版本管理器安装 Node 时，把实际可执行目录加入守护环境。

不要用根 npm run dev 或 --reload 守护生产；开发脚本会强制释放占用端口并运行构建监听。后端 cwd 必须保持 backend，否则相对数据库及 .env 路径会变化。

## 5. Nginx 和启动检查

为实际域名配置 HTTPS，反向代理到 127.0.0.1:4667。主要 location 设置可参考：

```nginx
location / {
    proxy_pass http://127.0.0.1:4667;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

合并到现有站点，不叠加冲突的 location。关闭代理缓冲以支持 SSE，应用事件流约 15 秒发送一次保活。钉钉 Stream 是后端主动建立的连接，与浏览器 SSE 不同。

启动后检查：

```bash
curl --fail http://127.0.0.1:4667/api/health
```

健康接口只确认 FastAPI 响应。还需分别核对迁移退出结果、启动补列日志、静态产物、批准的测试账号登录及邮箱连接。卡片需模板/机器人/员工身份匹配，当前新卡片只提供查看入口。

外部业务验证使用批准的测试账号和收件人，不通过生产批量发信或修改组织权限试错。

## 6. 升级、备份和恢复

1. 记录当前代码/依赖版本和业务库实际路径，保留线上 .env。
2. 升级前使用 SQLite backup API 等一致性方式备份活动库，安全保存对应 ENCRYPTION_KEY。普通文件复制仅适用于写入者已全部停止且数据库状态一致的情况。
3. 安排停机，更新代码与依赖、准备完整 dist，显式执行迁移并检查退出结果。
4. 启动单 worker，核对补列、日志、健康接口及批准的业务流程。
5. 回退使用匹配的代码、数据库备份和配置。现有 down() 为空，knex migrate:rollback 不是有效的数据结构恢复方案。

有效 WAL 可能含已提交数据，SHM 是配套共享内存，禁止作为多余库删除。恢复前停止所有数据库使用者，不用旧主库覆盖一个仍在写入的新 WAL 环境。

## 7. 排错入口

| 现象 | 先核对 |
| --- | --- |
| 健康正常但业务查库失败 | cwd、Python/Knex 库路径、表列、脱敏原始错误 |
| 找不到 npx | Supervisor PATH 和根 Node 依赖 |
| 授权码解密失败 | 原 ENCRYPTION_KEY 是否变化，不先删库或账号 |
| 页面空白/资源 404 | index 当前引用、assets 和 public 复制文件 |
| 列表不及时刷新 | SSE、代理缓冲、筛选状态、后台同步日志 |
| 卡片没投放 | 首次/手动/后台来源、UID 基线、配置和原始投放响应 |
| AI 返回配置或失败提示 | 实际 key/请求结果与降级内容，200 不等于 AI 成功 |

默认日志为根 logs/app.log（14 天）和 logs/error.log（WARNING 及以上，30 天）。LOG_DIR 要设置在守护进程环境，不能只依赖 Pydantic .env。分享日志前去除凭据、员工与邮件敏感内容。
