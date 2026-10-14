# 后端接手指南

继承[根级指南](../AGENTS.md)。本目录包含 FastAPI 入口、Python 依赖、环境配置、业务库和测试脚本。

## 入口与运行方式

- `main.py`：证书/代理环境初始化、应用 lifespan、五组 API、HTTP 日志、前端静态托管。
- `app/`：业务代码，见 [app/AGENTS.md](app/AGENTS.md)。
- `requirements.txt`：Python 依赖下限，未锁定完整解析版本；本地环境不等于新装环境。
- `.env`：后端配置，包含敏感信息。读取时只取相关键、必要路径或脱敏状态。
- `email_assistant.db`：业务库；同名 WAL/SHM 配套文件一并保护。

需要启动且已经获授权时，从本目录运行：

```bash
.venv/bin/python3 -m uvicorn main:app --host 127.0.0.1 --port 4667
```

从根目录使用 `npm run dev` 可自动选择本目录 `.venv`。禁止从错误 cwd 运行数据库相关脚本；`PYTHONPATH`/`--app-dir` 只解决导入，不会修正相对数据库 URL 或 `.env` 路径。

## 启动副作用

lifespan 会调用根目录的 Knex 迁移、补齐四个历史字段，然后启动后台收信、AI 补分析和钉钉 Stream。`subprocess.run(..., check=False)` 不会因迁移非零退出自动中断后端；看到“校验完成”日志不能作为迁移成功证据。

`/api/health` 仅返回服务状态，不检查数据库、AI、IMAP、SMTP 或钉钉连通性。不要用健康检查成功代替业务验收。

## 测试脚本逐项判断

| 文件 | 当前行为 | 运行前提 |
| --- | --- | --- |
| `test_spa_paths.py` | AST 提取实际静态路由和附件下载函数，用临时文件验证目录边界、SPA 回退及附件 GET/HEAD/Range | 可在根目录运行 `backend/.venv/bin/python3 backend/test_spa_paths.py`；不导入应用/配置/数据库，不执行 lifespan，不访问外部服务 |
| `test_integration.py` | TestClient 调用旧 `/auth/register`、`/auth/login`；当前后端未提供这两个路由 | 先处理脚本与登录契约不一致，并隔离数据库 |
| `test_dingtalk_flow.py` | 直接使用 `SessionLocal` 新增、授权、删除测试用户 | 隔离库；不能直接指向现用 `.env` 对应库 |
| `test_card_flow.py` | 直接增删用户、邮箱、邮件与对话；mock AI/SMTP 部分调用 | 隔离库；IMAP 追加等外部调用也需完整隔离，部分 mock 不代表无外部请求 |
| `test_ai_flow.py` | 使用当前 AI 配置进行分析与拟稿 | 有 key 时会真实请求 AI；先确认允许外部调用与额度消耗 |

测试隔离不能只改 `DATABASE_URL`：应用启动中的 Knex 仍固定操作根配置指定的库。需要结合启动生命周期、迁移目标和服务调用一起处理。失败时清理逻辑也不一定执行，不能在真实库“运行完再清理”。

## 验证与交接

- SPA 兜底返回文件前须对静态根目录与目标做 `realpath`，通过 `commonpath` 校验目录归属；越界返回 404，兜底首页同样校验。附件下载使用独立 API，不受 dist 目录限制。
- 纯语法检查可静态解析 Python 源码，避免为读配置导入 `main` 或数据库模块。
- 接口改动同时核对前端 `src/lib/api.ts`；字段改动同时核对模型、Knex、启动补列和旧数据。
- 测试记录注明使用哪个隔离环境、是否运行 lifespan、是否 mock 外部依赖；没有做端到端验证就直接说明。

## 收件名单隔离测试

根目录运行 `PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python3 backend/test_mail_recipients.py`。测试 AST 加载实际发送和详情函数，模拟 SMTP/IMAP，使用内存 SQLite；不导入应用配置/数据库、不执行 lifespan、不连接主库。覆盖抄送/密送、部分拒收、用户隔离及落库。旧 `test_card_flow.py` 仅同步五项返回值的 mock，仍不可直接在业务库运行。
