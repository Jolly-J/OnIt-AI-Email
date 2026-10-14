import os
import certifi

# 设置默认 SSL 证书与国内域名直连，避免本地科学上网代理(如 Clash)导致证书报错或连接抖动
os.environ.setdefault('SSL_CERT_FILE', certifi.where())
_dingtalk_domains = "localhost,127.0.0.1,dingtalk.com,alicdn.com,.dingtalk.com,.alicdn.com"
_curr_np = os.environ.get("NO_PROXY", os.environ.get("no_proxy", ""))
if "dingtalk.com" not in _curr_np:
    os.environ["NO_PROXY"] = f"{_curr_np},{_dingtalk_domains}".strip(",") if _curr_np else _dingtalk_domains
    os.environ["no_proxy"] = os.environ["NO_PROXY"]

import time
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse

from app.core.config import settings
from app.core.database import Base, engine
from app.core.logger import logger
from app.api.auth import router as auth_router
from app.api.accounts import router as accounts_router
from app.api.emails import router as emails_router
from app.api.ai_chat import router as chat_router
from app.api.dingtalk import router as dingtalk_router
from app.api.calendar import router as calendar_router
from app.services.scheduler import background_mail_poller
from app.services.dingtalk_stream_listener import dingtalk_stream_manager

# 数据库架构统一由 Knex 全权版本化管理 (knexfile.js + migrations/)
# 移除原始无版本控制的 create_all()，杜绝架构冲突与数据关联隐患

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("==========================================")
    logger.info(f"【{settings.PROJECT_NAME}】正在初始化启动...")
    logger.info("==========================================")
    if settings.MOCK_MODE:
        # Mock 模式：内存数据库初始化，不执行任何外部 knex 或磁盘写操作
        from app.core.mock_data import init_mock_database
        init_mock_database()
        logger.info("[MockMode] 纯内存隔离数据库已就绪并预装 10 封全场景演示数据（零磁盘写入，零脏数据）")
        poller_task = None
    else:
        # 后端启动时自动调用 Knex 执行数据库版本检查与无损升级
        try:
            import subprocess
            root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
            if os.path.exists(os.path.join(root_dir, "knexfile.js")):
                subprocess.run(["npx", "knex", "migrate:latest"], cwd=root_dir, check=False)
                logger.info("[Database] Knex 数据库版本自动升级校验已完成")
        except Exception as db_err:
            logger.warning(f"[Database] Knex 自动升级提示: {db_err}")

        # 安全检查并自动兼容补齐 SQLite 字段
        try:
            from sqlalchemy import text
            with engine.connect() as conn:
                res = conn.execute(text("PRAGMA table_info(chat_messages);")).fetchall()
                col_names = [r[1] for r in res]
                if "draft_reply_zh" not in col_names:
                    conn.execute(text("ALTER TABLE chat_messages ADD COLUMN draft_reply_zh TEXT DEFAULT '';"))
                    logger.info("[Database] 已自动扩展 chat_messages.draft_reply_zh 字段")
                if "explanation" not in col_names:
                    conn.execute(text("ALTER TABLE chat_messages ADD COLUMN explanation TEXT DEFAULT '';"))
                    logger.info("[Database] 已自动扩展 chat_messages.explanation 字段")

                res_emails = conn.execute(text("PRAGMA table_info(email_records);")).fetchall()
                email_cols = [r[1] for r in res_emails]
                if "dingtalk_card_out_track_id" not in email_cols:
                    conn.execute(text("ALTER TABLE email_records ADD COLUMN dingtalk_card_out_track_id VARCHAR(128);"))
                    logger.info("[Database] 已自动扩展 email_records.dingtalk_card_out_track_id 字段")
                if "dingtalk_card_status" not in email_cols:
                    conn.execute(text("ALTER TABLE email_records ADD COLUMN dingtalk_card_status VARCHAR(32) DEFAULT 'none';"))
                    logger.info("[Database] 已自动扩展 email_records.dingtalk_card_status 字段")

                conn.commit()
        except Exception as alter_err:
            logger.warning(f"[Database] 字段补齐兼容检查提示: {alter_err}")

        # 启动后台邮件自动轮询协程
        poller_task = asyncio.create_task(background_mail_poller())

        # 启动钉钉 Stream 长连接客户端监听（用于响应互动卡片交互）
        try:
            dingtalk_stream_manager.start()
        except Exception as stream_err:
            logger.warning(f"[DingTalkStream] 启动长连接监听器提示: {stream_err}")

    yield

    # 应用关闭时取消任务
    logger.info(f"【{settings.PROJECT_NAME}】正在安全停机...")
    if poller_task:
        poller_task.cancel()
    if not settings.MOCK_MODE:
        dingtalk_stream_manager.stop()

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan
)

# 全局 HTTP 请求审计与耗时监控中间件（专门为宝塔部署与公测排错定制）
@app.middleware("http")
async def log_requests(request: Request, call_next):
    # 静态资源与心跳检测过滤，避免日志刷屏
    path = request.url.path
    is_api = path.startswith("/api/")
    start_time = time.time()

    client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown")
    if "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()

    try:
        response = await call_next(request)
        duration_ms = round((time.time() - start_time) * 1000, 2)

        if is_api:
            status = response.status_code
            log_msg = f"[HTTP] {request.method} {path} | 状态: {status} | 耗时: {duration_ms}ms | IP: {client_ip}"
            if status >= 500:
                logger.error(log_msg)
            elif status >= 400:
                logger.warning(log_msg)
            else:
                if duration_ms > 1000:
                    logger.warning(f"{log_msg} [慢接口警报]")
                else:
                    logger.info(log_msg)
        return response
    except Exception as exc:
        duration_ms = round((time.time() - start_time) * 1000, 2)
        logger.error(f"[HTTP] {request.method} {path} 发生未捕获异常 | 耗时: {duration_ms}ms | IP: {client_ip} | 错误: {exc}", exc_info=True)
        raise exc

# 允许跨域请求（方便前端开发与钉钉内嵌访问）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载 API 路由
app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(accounts_router, prefix=settings.API_V1_STR)
app.include_router(emails_router, prefix=settings.API_V1_STR)
app.include_router(chat_router, prefix=settings.API_V1_STR)
app.include_router(dingtalk_router, prefix=settings.API_V1_STR)
app.include_router(calendar_router, prefix=settings.API_V1_STR)

@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "AI Email Assistant"}

# 挂载前端打包产物 (宝塔一体化部署支持)
frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/dist"))
if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        def resolve_static_path(path: str) -> str:
            # 解析软链接后按目录边界比较，禁止返回 dist 外的文件。
            try:
                root = os.path.realpath(frontend_dist)
                candidate = os.path.realpath(os.path.join(root, path))
                if os.path.commonpath([root, candidate]) != root:
                    raise HTTPException(status_code=404, detail="Not Found")
                return candidate
            except (OSError, ValueError):
                raise HTTPException(status_code=404, detail="Not Found") from None

        # 排除 API 路由
        if full_path.startswith("api"):
            return {"error": "Not Found"}
        file_path = resolve_static_path(full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        index_path = resolve_static_path("index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path)
        return HTMLResponse(
            "<!doctype html><html><head><meta charset='utf-8'><title>前端构建中</title>"
            "<meta http-equiv='refresh' content='1'></head><body style='font-family:system-ui,sans-serif;text-align:center;padding:60px 20px;background:#f8fafc;color:#64748b;'>"
            "<h3 style='color:#334155;margin-bottom:8px;'>前端资源就绪中，正在自动同步...</h3>"
            "<p style='font-size:13px;'>页面将在 1 秒内自动载入完成</p></body></html>",
            status_code=200
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=4667, reload=True)
