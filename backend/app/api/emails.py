import os
import re
import time
import uuid
import json
import asyncio
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Query, Header, BackgroundTasks, UploadFile, File, Request
from fastapi.responses import StreamingResponse, FileResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pydantic import BaseModel
from jose import JWTError, jwt

# 全局大文件下载并发跟踪器与安全锁 (限制单个客户端 IP 最大并发数，防止拉爆带宽)
_active_download_concurrency: Dict[str, int] = {}
_concurrency_lock = asyncio.Lock()

from app.core.config import settings
from app.core.database import get_db, SessionLocal
from app.core.security import decrypt_secret
from app.core.logger import logger
from app.core.datetime_util import format_iso_utc
from app.core.language_util import detect_language_fast
from app.core.mail_recipients import normalize_recipients
from app.models.user import User
from app.models.account import MailAccount
from app.models.email import EmailRecord
from app.api.auth import get_current_user
from app.services.mail_service import send_smtp_email, build_and_send_smtp_email, append_to_sent_folder, fetch_older_emails
from app.services.scheduler import sync_single_account, analyze_and_update_email, batch_analyze_emails, account_sync_lock
from app.services.ai_service import ai_service
from app.services.event_bus import event_bus
from app.core.limiter import limiter_compose
from app.core.mock_data import get_mock_translation

router = APIRouter(prefix="/emails", tags=["邮件管理"])

def format_file_size_display(size_bytes: Optional[int]) -> str:
    if not size_bytes or size_bytes <= 0:
        return "未知大小"
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"

class AttachmentReq(BaseModel):
    filename: str
    content_base64: Optional[str] = None  # 普通附件 (<= 20MB) 直接 Base64 打包进邮件
    content_type: Optional[str] = None
    size: Optional[int] = None
    is_large: Optional[bool] = False  # 是否为超大附件 (20MB ~ 200MB 云端中转)
    large_token: Optional[str] = None  # 超大附件下载 token
    download_url: Optional[str] = None
    expires_at: Optional[str] = None

class ComposeEmailReq(BaseModel):
    account_id: int
    to_email: str
    cc_email: str = ""
    bcc_email: str = ""
    subject: str
    body_text: str
    body_html: Optional[str] = None
    attachments: Optional[List[AttachmentReq]] = []
    in_reply_to_email_id: Optional[int] = None

@router.get("/counts")
def get_folder_counts(
    account_id: Optional[int] = Query(None, description="按特定邮箱账号统计"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取各文件夹与已读/未读实时数量统计"""
    query = db.query(EmailRecord).filter(EmailRecord.user_id == current_user.id)
    if account_id:
        query = query.filter(EmailRecord.account_id == account_id)

    inbox_total = query.filter(EmailRecord.folder == "inbox", EmailRecord.status != "archived").count()
    inbox_unread = query.filter(EmailRecord.folder == "inbox", EmailRecord.is_read == False, EmailRecord.status != "archived").count()
    inbox_read = query.filter(EmailRecord.folder == "inbox", EmailRecord.is_read == True, EmailRecord.status != "archived").count()
    sent_total = query.filter(EmailRecord.folder == "sent", EmailRecord.status != "archived").count()
    drafts_total = query.filter(EmailRecord.folder == "drafts").count()
    trash_total = query.filter(EmailRecord.folder == "trash").count()
    replied_total = query.filter(EmailRecord.status == "replied").count()
    archived_total = query.filter(EmailRecord.status == "archived").count()

    return {
        "inbox_total": inbox_total,
        "inbox_unread": inbox_unread,
        "inbox_read": inbox_read,
        "sent_total": sent_total,
        "drafts_total": drafts_total,
        "trash_total": trash_total,
        "replied_total": replied_total,
        "archived_total": archived_total
    }

@router.get("")
def list_emails(
    account_id: Optional[int] = Query(None, description="按特定邮箱账号筛选"),
    folder: Optional[str] = Query(None, description="按文件夹筛选: inbox, sent, drafts, trash"),
    status: Optional[str] = Query(None, description="按状态筛选: replied, archived, or all"),
    unread_only: bool = Query(False),
    read_filter: Optional[str] = Query(None, description="all | unread | read"),
    q: Optional[str] = Query(None, description="搜索关键词"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取邮件列表（支持多账号聚合、文件夹筛选、状态筛选、关键词搜索）"""
    query = db.query(EmailRecord).filter(EmailRecord.user_id == current_user.id)

    if account_id:
        query = query.filter(EmailRecord.account_id == account_id)
    if folder and folder != "all":
        query = query.filter(EmailRecord.folder == folder)
        if status != "archived":
            query = query.filter(EmailRecord.status != "archived")
    elif status and status != "all":
        query = query.filter(EmailRecord.status == status)

    if read_filter == "unread" or unread_only:
        query = query.filter(EmailRecord.is_read == False)
    elif read_filter == "read":
        query = query.filter(EmailRecord.is_read == True)

    if q:
        kw = f"%{q.strip()}%"
        query = query.filter(
            or_(
                EmailRecord.subject.ilike(kw),
                EmailRecord.sender.ilike(kw),
                EmailRecord.to_recipients.ilike(kw),
                EmailRecord.summary_zh.ilike(kw),
                EmailRecord.body_text.ilike(kw)
            )
        )

    total = query.count()
    emails = query.order_by(EmailRecord.sent_date.desc(), EmailRecord.id.desc()).offset(offset).limit(limit).all()

    # 预加载绑定的账号名称
    accounts_map = {
        acc.id: (acc.name or acc.email_address, acc.provider)
        for acc in db.query(MailAccount).filter(MailAccount.user_id == current_user.id).all()
    }

    result = []
    for em in emails:
        acc_info = accounts_map.get(em.account_id, ("未知邮箱", "custom"))

        # 解析 JSON 数组
        key_points = []
        if em.key_points_json:
            try:
                key_points = json.loads(em.key_points_json)
            except Exception:
                pass

        result.append({
            "id": em.id,
            "account_id": em.account_id,
            "account_name": acc_info[0],
            "provider": acc_info[1],
            "subject": em.subject,
            "sender": em.sender,
            "to_recipients": em.to_recipients,
            "sent_date": em.sent_date,
            "summary_zh": em.summary_zh,
            "key_points": key_points,
            "ai_guided_question": em.ai_guided_question,
            "is_read": em.is_read,
            "folder": em.folder or "inbox",
            "status": em.status,
            "created_at": format_iso_utc(em.created_at) or ""
        })

    return {"total": total, "items": result}

def get_user_from_token_or_query(
    token: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None)
) -> User:
    actual_token = None
    if authorization and authorization.startswith("Bearer "):
        actual_token = authorization.split(" ")[1]
    elif token:
        actual_token = token

    if not actual_token:
        raise HTTPException(status_code=401, detail="未提供身份凭据")

    try:
        payload = jwt.decode(actual_token, settings.SECRET_KEY, algorithms=["HS256"])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="无效凭据")
    except JWTError:
        raise HTTPException(status_code=401, detail="无效或已过期的身份凭据")

    with SessionLocal() as db:
        user = db.query(User).filter(User.id == int(user_id)).first()
        if not user:
            raise HTTPException(status_code=401, detail="用户不存在")

        if not user.is_active:
            raise HTTPException(
                status_code=403,
                detail="您的系统使用权限已被管理员关闭，请联系管理员开通。"
            )
        db.expunge(user)
        return user

@router.get("/events")
async def email_events(
    user: User = Depends(get_user_from_token_or_query)
):
    """Server-Sent Events (SSE) 实时邮件事件推流管道"""
    queue = await event_bus.subscribe(user.id)

    async def event_generator():
        try:
            yield f"event: connected\ndata: {json.dumps({'status': 'ok'})}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        except (asyncio.CancelledError, GeneratorExit):
            pass
        finally:
            await event_bus.unsubscribe(user.id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.get("/{email_id}")
async def get_email_detail(
    email_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取单封邮件完整详情与 AI 分析数据"""
    email = db.query(EmailRecord).filter(
        EmailRecord.id == email_id,
        EmailRecord.user_id == current_user.id
    ).first()
    if not email:
        raise HTTPException(status_code=404, detail="邮件不存在")

    # 标记已读
    if not email.is_read:
        email.is_read = True
        db.commit()

    # 自动静默修复与即点即析：如果当前已有有效的 DEEPSEEK_API_KEY
    needs_analysis = False
    if ai_service.api_key:
        if "尚未配置 DEEPSEEK_API_KEY" in (email.summary_zh or "") or "配置 DeepSeek API Key" in (email.action_items_json or ""):
            needs_analysis = True
        elif not email.summary_zh or not email.key_points_json or email.key_points_json == "[]":
            # 对收件箱且正文/主题存在的邮件执行即看即析
            if email.folder == "inbox" and (email.body_text or email.subject):
                needs_analysis = True

    if needs_analysis:
        try:
            await analyze_and_update_email(email.id, force=True)
            db.refresh(email)
        except Exception as e:
            logger.warning(f"[AutoReanalyze] 即看即析失败: {e}")

    account = db.query(MailAccount).filter(MailAccount.id == email.account_id).first()

    key_points = []
    action_items = []
    if email.key_points_json:
        try:
            key_points = json.loads(email.key_points_json)
        except Exception:
            pass
    if email.action_items_json:
        try:
            action_items = json.loads(email.action_items_json)
        except Exception:
            pass

    return {
        "id": email.id,
        "account_id": email.account_id,
        "account_email": account.email_address if account else "",
        "account_name": account.name if account else "",
        "subject": email.subject,
        "sender": email.sender,
        "to_recipients": email.to_recipients,
        "cc_recipients": email.cc_recipients,
        "bcc_recipients": (email.bcc_recipients or "") if email.folder == "sent" else "",
        "sent_date": email.sent_date,
        "body_text": email.body_text,
        "body_html": email.body_html,
        "language_detected": email.language_detected,
        "summary_zh": email.summary_zh,
        "key_points": key_points,
        "action_items": action_items,
        "ai_guided_question": email.ai_guided_question,
        "initial_reply_draft": email.initial_reply_draft,
        "is_read": email.is_read,
        "folder": email.folder or "inbox",
        "status": email.status,
        "created_at": format_iso_utc(email.created_at) or ""
    }

@router.post("/{email_id}/reanalyze")
async def reanalyze_email(
    email_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """手动一键触发 AI 重新深度分析"""
    email = db.query(EmailRecord).filter(
        EmailRecord.id == email_id,
        EmailRecord.user_id == current_user.id
    ).first()
    if not email:
        raise HTTPException(status_code=404, detail="邮件不存在")

    updated_email = await analyze_and_update_email(email.id, force=True)
    if not updated_email:
        raise HTTPException(status_code=500, detail="AI 分析失败，请检查模型服务配置")

    db.refresh(email)

    key_points = []
    action_items = []
    if email.key_points_json:
        try:
            key_points = json.loads(email.key_points_json)
        except Exception:
            pass
    if email.action_items_json:
        try:
            action_items = json.loads(email.action_items_json)
        except Exception:
            pass

    return {
        "success": True,
        "message": "AI 重新分析完成！",
        "summary_zh": email.summary_zh,
        "key_points": key_points,
        "action_items": action_items,
        "ai_guided_question": email.ai_guided_question,
        "initial_reply_draft": email.initial_reply_draft
    }

class TranslateReq(BaseModel):
    target_lang: Optional[str] = "zh"

@router.post("/{email_id}/translate")
async def translate_email_content(
    email_id: int,
    req: Optional[TranslateReq] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """调用 AI 将邮件主题与正文高保真翻译为目标语言（默认中文），保留 HTML 标签与排版；Mock 模式直接秒级命中预置译文"""
    email = db.query(EmailRecord).filter(
        EmailRecord.id == email_id,
        EmailRecord.user_id == current_user.id
    ).first()
    if not email:
        raise HTTPException(status_code=404, detail="邮件不存在")

    # 1. 优先检测并返回离线预置翻译（Mock 邮件与演示数据完全不调用外部 AI，零延迟、零网络消耗）
    mock_trans = get_mock_translation(email.uid or "")
    if mock_trans:
        return {
            "success": True,
            "translated_subject": mock_trans.get("translated_subject", email.subject),
            "translated_body_html": mock_trans.get("translated_body_html", ""),
            "translated_body_text": mock_trans.get("translated_body_text", email.body_text or "")
        }

    # 2. 若在全局 Mock 模式下，直接提供本地离线优雅对照，彻底避免无 Key 报错
    if settings.MOCK_MODE:
        return {
            "success": True,
            "translated_subject": f"[译] {email.subject}",
            "translated_body_html": f"<div style='line-height:1.6;color:#1e293b;'>{email.body_html or email.body_text}</div>",
            "translated_body_text": email.body_text or ""
        }

    target_lang = req.target_lang if req and req.target_lang else "zh"
    try:
        result = await ai_service.translate_email(
            subject=email.subject or "",
            body_text=email.body_text or "",
            body_html=email.body_html or "",
            target_lang=target_lang
        )
        return {
            "success": True,
            "translated_subject": result.get("translated_subject", email.subject),
            "translated_body_html": result.get("translated_body_html", ""),
            "translated_body_text": result.get("translated_body_text", email.body_text or "")
        }
    except Exception as e:
        logger.error(f"翻译邮件 [{email_id}] 出错: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{email_id}/read")
def toggle_read_status(
    email_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    email = db.query(EmailRecord).filter(
        EmailRecord.id == email_id,
        EmailRecord.user_id == current_user.id
    ).first()
    if not email:
        raise HTTPException(status_code=404, detail="邮件不存在")
    email.is_read = not email.is_read
    db.commit()
    return {"is_read": email.is_read}

@router.put("/{email_id}/archive")
def archive_email(
    email_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    email = db.query(EmailRecord).filter(
        EmailRecord.id == email_id,
        EmailRecord.user_id == current_user.id
    ).first()
    if not email:
        raise HTTPException(status_code=404, detail="邮件不存在")
    email.status = "archived" if email.status != "archived" else "inbox"
    db.commit()
    db.refresh(email)
    msg = "邮件已归档" if email.status == "archived" else "已移出归档并恢复至收件箱"
    return {"status": email.status, "message": msg}

@router.post("/attachments/upload")
async def upload_large_attachment(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """上传大附件（支持高达 200MB），返回 7 天有效期下载 Token 与下载直链"""
    MAX_SIZE = 200 * 1024 * 1024  # 200MB
    token = uuid.uuid4().hex
    safe_filename = re.sub(r'[\r\n\t\\/]', '_', file.filename or "attachment")
    save_path = os.path.join(settings.LARGE_ATTACHMENT_DIR, f"{token}_{safe_filename}")
    meta_path = os.path.join(settings.LARGE_ATTACHMENT_DIR, f"{token}.json")

    total_bytes = 0
    try:
        with open(save_path, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):  # 1MB chunk
                total_bytes += len(chunk)
                if total_bytes > MAX_SIZE:
                    buffer.close()
                    if os.path.exists(save_path):
                        os.remove(save_path)
                    raise HTTPException(status_code=400, detail="单个大附件最大不能超过 200MB")
                buffer.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Attachment] 上传大文件失败: {e}", exc_info=True)
        if os.path.exists(save_path):
            os.remove(save_path)
        raise HTTPException(status_code=500, detail="保存附件失败，请重试")

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=settings.LARGE_ATTACHMENT_EXPIRE_DAYS)

    meta = {
        "token": token,
        "filename": file.filename or "attachment",
        "saved_file": f"{token}_{safe_filename}",
        "size": total_bytes,
        "content_type": file.content_type or "application/octet-stream",
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
        "user_id": current_user.id
    }
    with open(meta_path, "w", encoding="utf-8") as mf:
        json.dump(meta, mf, ensure_ascii=False)

    base_url = (settings.PUBLIC_BASE_URL or settings.APP_BASE_URL or "").rstrip("/")
    download_url = f"{base_url}/api/emails/attachments/download/{token}"

    return {
        "token": token,
        "filename": file.filename or "attachment",
        "size": total_bytes,
        "formatted_size": format_file_size_display(total_bytes),
        "download_url": download_url,
        "expires_at": expires_at.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "days_valid": settings.LARGE_ATTACHMENT_EXPIRE_DAYS
    }

@router.get("/attachments/download/{token}")
@router.head("/attachments/download/{token}")
async def download_shared_attachment(token: str, request: Request):
    """免登录下载通过大文件中转站分享的文件（7天有效期 + 支持断点续传 + 速率限制 + 单IP并发保护）"""
    # 严格校验 token 格式防止路径穿越攻击
    if not re.match(r"^[a-f0-9]{32}$", token):
        raise HTTPException(status_code=400, detail="无效的下载凭证")

    meta_path = os.path.join(settings.LARGE_ATTACHMENT_DIR, f"{token}.json")
    if not os.path.exists(meta_path):
        raise HTTPException(status_code=404, detail="附件不存在或已被系统清理")

    try:
        with open(meta_path, "r", encoding="utf-8") as mf:
            meta = json.load(mf)
    except Exception:
        raise HTTPException(status_code=500, detail="读取附件元数据失败")

    # 检查是否已过期 (7 天)
    try:
        expires_at = datetime.fromisoformat(meta["expires_at"])
        if datetime.now(timezone.utc) > expires_at:
            saved_file = meta.get("saved_file")
            if saved_file:
                fpath = os.path.join(settings.LARGE_ATTACHMENT_DIR, saved_file)
                if os.path.exists(fpath):
                    os.remove(fpath)
            if os.path.exists(meta_path):
                os.remove(meta_path)
            raise HTTPException(status_code=410, detail="抱歉，该附件已超过 7 天保存期限，已被系统自动销毁。")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"[Attachment] 时间校验异常: {e}")

    saved_file = meta.get("saved_file")
    file_path = os.path.join(settings.LARGE_ATTACHMENT_DIR, saved_file)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="附件文件已不存在")

    # 1. 单 IP 并发数限制检查 (防多线程下载器跑满 200Mbps 带宽)
    forwarded = request.headers.get("x-forwarded-for")
    client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")

    async with _concurrency_lock:
        current_concurrency = _active_download_concurrency.get(client_ip, 0)
        if current_concurrency >= settings.DOWNLOAD_MAX_CONCURRENT_PER_IP:
            raise HTTPException(
                status_code=429,
                detail=f"您当前已有 {current_concurrency} 个下载任务正在进行中，为保障服务器带宽健康，请等待当前下载完成。"
            )
        _active_download_concurrency[client_ip] = current_concurrency + 1

    # 2. HTTP Range 解析 (支持断点续传)
    file_size = os.path.getsize(file_path)
    range_header = request.headers.get("range")
    start = 0
    end = file_size - 1
    status_code = 200

    if range_header and range_header.startswith("bytes="):
        try:
            range_val = range_header.replace("bytes=", "").strip()
            parts = range_val.split("-")
            if parts[0]:
                start = int(parts[0])
            if len(parts) > 1 and parts[1]:
                end = int(parts[1])
            if start < file_size and end < file_size and start <= end:
                status_code = 206
            else:
                start = 0
                end = file_size - 1
        except Exception:
            start = 0
            end = file_size - 1

    content_length = end - start + 1

    # 3. 流式限速生成器 (默认 3072 KB/s，即 3MB/s，平衡高速下载与服务器总带宽防护)
    rate_bytes_sec = max(settings.DOWNLOAD_RATE_LIMIT_KB * 1024, 256 * 1024)
    chunk_size = 64 * 1024  # 64KB 块
    expected_duration = chunk_size / rate_bytes_sec

    async def rate_limited_stream():
        bytes_remaining = content_length
        try:
            with open(file_path, "rb") as f:
                f.seek(start)
                while bytes_remaining > 0:
                    t0 = time.time()
                    to_read = min(chunk_size, bytes_remaining)
                    data = f.read(to_read)
                    if not data:
                        break
                    bytes_remaining -= len(data)
                    yield data
                    elapsed = time.time() - t0
                    sleep_time = expected_duration - elapsed
                    if sleep_time > 0:
                        await asyncio.sleep(sleep_time)
        finally:
            async with _concurrency_lock:
                if client_ip in _active_download_concurrency:
                    _active_download_concurrency[client_ip] = max(0, _active_download_concurrency[client_ip] - 1)
                    if _active_download_concurrency[client_ip] == 0:
                        del _active_download_concurrency[client_ip]

    filename = meta.get("filename", "download_file")
    safe_filename = filename.replace('"', '').replace('\r', '').replace('\n', '')
    encoded_fn = quote(safe_filename)

    # 按照 RFC 6266 标准：
    # 1. filename* 使用百分号编码的 UTF-8 传递完整中文名（现代浏览器 100% 优先识别并原生显示中文）
    # 2. filename 仅作为极老旧客户端的纯 ASCII 兜底，确保整个 Header 100% 满足 HTTP latin-1 编码规范
    ascii_fallback = safe_filename.encode("ascii", "ignore").decode("ascii").strip()
    if not ascii_fallback:
        ext = safe_filename.rsplit(".", 1)[-1] if "." in safe_filename else "bin"
        ascii_fallback = f"download_file.{ext}"

    content_disposition = f'attachment; filename="{ascii_fallback}"; filename*=UTF-8\'\'{encoded_fn}'

    headers = {
        "Content-Disposition": content_disposition,
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
    }
    if status_code == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    # 针对 HEAD 探测请求（如下载工具预探测文件大小），归还并发数并直接返回响应头
    if request.method == "HEAD":
        async with _concurrency_lock:
            if client_ip in _active_download_concurrency:
                _active_download_concurrency[client_ip] = max(0, _active_download_concurrency[client_ip] - 1)
                if _active_download_concurrency[client_ip] == 0:
                    del _active_download_concurrency[client_ip]
        return Response(status_code=status_code, headers=headers, media_type=meta.get("content_type", "application/octet-stream"))

    return StreamingResponse(
        rate_limited_stream(),
        status_code=status_code,
        headers=headers,
        media_type=meta.get("content_type", "application/octet-stream")
    )

@router.post("/compose", dependencies=[Depends(limiter_compose)])
async def compose_and_send(
    req: ComposeEmailReq,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """主动写新邮件并发信，支持普通附件(MIME)与超大附件(7天云端中转)，自动归档入发件箱并同步远端"""
    try:
        req.to_email, req.cc_email, req.bcc_email = normalize_recipients(req.to_email, req.cc_email, req.bcc_email)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    account = db.query(MailAccount).filter(
        MailAccount.id == req.account_id,
        MailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="选中的发件邮箱不存在")

    plain_pass = decrypt_secret(account.encrypted_password)
    if not plain_pass:
        raise HTTPException(status_code=400, detail="邮箱授权码解密失败，请重新配置")

    # 分流附件：常规附件 vs 超大附件
    normal_attachments = []
    large_attachments = []
    for att in (req.attachments or []):
        if att.is_large:
            large_attachments.append(att)
        elif att.content_base64:
            normal_attachments.append({
                "filename": att.filename,
                "content_base64": att.content_base64,
                "content_type": att.content_type or "application/octet-stream"
            })

    # 若含有超大附件，在正文底部自动注入美观规范的极简卡片（语言智能自适应）
    final_body_text = req.body_text
    final_body_html = req.body_html

    if large_attachments:
        card_items_html = ""
        card_items_text = ""

        # 智能探测邮件语言：中文 -> 纯中文；非中文/英文 -> 纯地道商务英文
        detected_lang = detect_language_fast(req.subject or "", req.body_text or "")
        is_zh = (detected_lang == "zh")

        # 针对常见文件类型分配克制雅致的徽章色彩 (Apple/Linear 极简风)
        def get_badge_style(filename: str):
            ext = filename.rsplit('.', 1)[-1].upper() if '.' in filename else 'FILE'
            label = ext[:4]
            if ext in ['PDF', 'DOC', 'DOCX']:
                return label, '#fef2f2', '#991b1b'  # 浅酒红
            if ext in ['XLS', 'XLSX', 'CSV']:
                return label, '#f0fdf4', '#166534'  # 浅雅绿
            if ext in ['MOV', 'MP4', 'AVI', 'MKV']:
                return label, '#f5f3ff', '#5b21b6'  # 浅柔紫
            if ext in ['ZIP', 'RAR', '7Z', 'TAR']:
                return label, '#fffbeb', '#92400e'  # 浅暖琥珀
            if ext in ['JPG', 'JPEG', 'PNG', 'WEBP']:
                return label, '#f0f9ff', '#075985'  # 浅淡天蓝
            return label, '#f1f5f9', '#475569'      # 极简浅灰

        for la in large_attachments:
            sz_display = format_file_size_display(la.size)
            fn = la.filename
            d_url = la.download_url or f"{(settings.PUBLIC_BASE_URL or settings.APP_BASE_URL or '').rstrip('/')}/api/emails/attachments/download/{la.large_token}"
            exp_display = la.expires_at or ("7天内" if is_zh else "7 days")
            badge_label, badge_bg, badge_color = get_badge_style(fn)

            meta_info_str = f"7天有效 (至 <strong>{exp_display}</strong>)" if is_zh else f"Valid for 7 days (Expires: <strong>{exp_display}</strong>)"
            btn_text = "下载附件" if is_zh else "Download File"

            card_items_html += f"""
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:680px;background:#fafafa;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.03);">
                <tr>
                    <td style="padding:14px 18px;vertical-align:middle;">
                        <table cellpadding="0" cellspacing="0" border="0" width="100%">
                            <tr>
                                <td width="42" style="vertical-align:middle;padding-right:14px;">
                                    <div style="width:40px;height:40px;border-radius:8px;background:{badge_bg};color:{badge_color};font-size:11px;font-weight:700;text-align:center;line-height:40px;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif;">
                                        {badge_label}
                                    </div>
                                </td>
                                <td style="vertical-align:middle;">
                                    <div style="font-size:14px;font-weight:600;color:#0f172a;line-height:1.4;word-break:break-all;">
                                        {fn}
                                    </div>
                                    <div style="font-size:12px;color:#64748b;margin-top:3px;">
                                        <span>{sz_display}</span>
                                        <span style="color:#cbd5e1;margin:0 6px;">|</span>
                                        <span>{meta_info_str}</span>
                                    </div>
                                </td>
                                <td align="right" style="vertical-align:middle;padding-left:16px;white-space:nowrap;">
                                    <a href="{d_url}" target="_blank" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-size:13px;font-weight:500;padding:8px 18px;border-radius:7px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,0.08);">
                                        {btn_text}
                                    </a>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
            """
            card_items_text += f"\n- [{badge_label}] {fn} ({sz_display}) | {meta_info_str}\n  " + ("下载直链: " if is_zh else "Direct Link: ") + f"{d_url}\n"

        header_title = "随信大附件" if is_zh else "Cloud Attachments"
        count_label = f"共 {len(large_attachments)} 个文件" if is_zh else f"{len(large_attachments)} file(s)"
        tip_text = "* 云端中转附件支持断点续传。文件将于 7 天后由系统自动安全销毁，请及时下载保存。" if is_zh else "* Stored in secure cloud transit with breakpoint resume support. The file will be automatically removed after 7 days."

        extra_html = f"""
        <br/><br/>
        <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <div style="font-size:13px;font-weight:600;color:#334155;margin-bottom:12px;display:flex;align-items:center;gap:8px;">
                <span>{header_title}</span>
                <span style="font-size:11px;font-weight:500;color:#64748b;background:#f1f5f9;padding:2px 8px;border-radius:9999px;">
                    {count_label}
                </span>
            </div>
            {card_items_html}
            <div style="font-size:11px;color:#94a3b8;line-height:1.6;margin-top:8px;max-width:680px;">
                {tip_text}
            </div>
        </div>
        """
        extra_text = f"\n\n--------------------\n{header_title} ({count_label}):\n{card_items_text}\n{tip_text}\n"

        final_body_text = (final_body_text or "") + extra_text
        if final_body_html:
            final_body_html = final_body_html + extra_html
        else:
            final_body_html = f"<div style='white-space:pre-wrap;font-family:sans-serif;'>{req.body_text}</div>" + extra_html

    in_reply_to_msg_id = None
    references_msg_id = None
    orig_email = None
    if req.in_reply_to_email_id:
        orig_email = db.query(EmailRecord).filter(
            EmailRecord.id == req.in_reply_to_email_id,
            EmailRecord.user_id == current_user.id
        ).first()
        if orig_email and orig_email.message_id:
            in_reply_to_msg_id = orig_email.message_id
            references_msg_id = orig_email.message_id

    success, msg, msg_id, raw_bytes, refused = build_and_send_smtp_email(
        smtp_host=account.smtp_host,
        smtp_port=account.smtp_port,
        smtp_ssl=account.smtp_ssl,
        email_address=account.email_address,
        password=plain_pass,
        to_email=req.to_email.strip(),
        cc_email=req.cc_email,
        bcc_email=req.bcc_email,
        subject=req.subject.strip(),
        body_text=final_body_text,
        body_html=final_body_html,
        in_reply_to=in_reply_to_msg_id,
        references=references_msg_id,
        attachments=normal_attachments
    )
    if not success:
        raise HTTPException(status_code=500, detail=msg)

    # 若为回复原邮件，更新原邮件状态为已回复
    if orig_email:
        orig_email.status = "replied"

    # 1. 本地发件箱入库
    sent_record = EmailRecord(
        user_id=current_user.id,
        account_id=account.id,
        uid=f"local_{int(time.time()*1000)}",
        folder="sent",
        message_id=msg_id or "",
        subject=req.subject.strip(),
        sender=account.email_address,
        to_recipients=req.to_email.strip(),
        cc_recipients=req.cc_email,
        bcc_recipients=req.bcc_email,
        sent_date=datetime.now(timezone.utc).isoformat(),
        body_text=final_body_text,
        body_html=final_body_html or "",
        summary_zh=req.body_text.strip().replace("\n", " ")[:120],
        is_read=True,
        status="sent"
    )
    db.add(sent_record)
    db.commit()
    db.refresh(sent_record)

    # 2. 异步将发出的信件追加到 IMAP 服务器发件箱
    if raw_bytes:
        background_tasks.add_task(
            append_to_sent_folder,
            imap_host=account.imap_host,
            imap_port=account.imap_port,
            imap_ssl=account.imap_ssl,
            email_address=account.email_address,
            password=plain_pass,
            raw_email_bytes=raw_bytes
        )

    # 3. 广播给前端
    try:
        acc_display_name = getattr(account, "account_name", None) or getattr(account, "name", "") or account.email_address
        await event_bus.broadcast_to_user(current_user.id, "new_email", {
            "id": sent_record.id,
            "account_id": account.id,
            "account_name": acc_display_name,
            "provider": getattr(account, "provider", "custom"),
            "subject": sent_record.subject or "(无主题)",
            "sender": sent_record.sender,
            "to_recipients": sent_record.to_recipients,
            "sent_date": sent_record.sent_date,
            "summary_zh": sent_record.summary_zh,
            "key_points": [],
            "ai_guided_question": "",
            "is_read": True,
            "folder": "sent",
            "status": "sent",
            "created_at": format_iso_utc(sent_record.created_at) or ""
        })
        await event_bus.broadcast_to_user(current_user.id, "counts_updated", {})
    except Exception as b_err:
        logger.warning(f"[Compose] 广播事件异常: {b_err}")

    return {"message": msg, "email_id": sent_record.id, "delivery_warning": msg if refused else None}

@router.post("/sync_all")
def sync_all_accounts(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user)
):
    """手动收取所有邮箱的最新邮件（增加账号同步锁防重）"""
    with SessionLocal() as db:
        accounts = db.query(MailAccount).filter(
            MailAccount.user_id == current_user.id,
            MailAccount.is_active == True
        ).all()
        account_ids = [acc.id for acc in accounts]

    dispatched = 0
    already_syncing = 0
    for aid in account_ids:
        if account_sync_lock.is_syncing(aid):
            already_syncing += 1
        else:
            background_tasks.add_task(sync_single_account, aid, trigger_source="manual")
            dispatched += 1

    if dispatched == 0 and already_syncing > 0:
        return {"message": "当前所有邮箱正在同步中，请稍候查看最新邮件！", "status": "already_syncing"}

    return {"message": f"已触发 {dispatched} 个邮箱的即时收取任务！", "status": "ok"}

class LoadMoreEmailsReq(BaseModel):
    account_id: Optional[int] = None
    folder: str = "inbox"
    limit: int = 20

@router.post("/load_more")
async def load_more_emails(
    req: LoadMoreEmailsReq,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user)
):
    """按需向历史方向拉取更早的邮件 (UID < min_uid)
    【方案C关键设计】：
    1. 短连接读取目标账号凭据并立刻释放；
    2. IMAP 历史网络拉取 35 秒超时保护，拉取期间 0 数据库占用；
    3. 拿到数据后极速短连接入库与更新 min_uid。
    """
    account_meta_list = []
    with SessionLocal() as db:
        if req.account_id:
            acc = db.query(MailAccount).filter(
                MailAccount.id == req.account_id,
                MailAccount.user_id == current_user.id
            ).first()
            if not acc:
                raise HTTPException(status_code=404, detail="指定的邮箱账号不存在")
            target_accounts = [acc]
        else:
            target_accounts = db.query(MailAccount).filter(
                MailAccount.user_id == current_user.id,
                MailAccount.is_active == True
            ).all()

        if not target_accounts:
            return {"loaded_count": 0, "has_more": False, "message": "未找到有效邮箱账号"}

        for account in target_accounts:
            plain_password = decrypt_secret(account.encrypted_password)
            if not plain_password:
                continue

            folder_min_uid = account.get_folder_min_uid(req.folder)
            if not folder_min_uid:
                existing_records = db.query(EmailRecord.uid).filter(
                    EmailRecord.account_id == account.id,
                    EmailRecord.folder == req.folder
                ).all()
                valid_uids = [int(r[0]) for r in existing_records if r[0] and r[0].isdigit()]
                folder_min_uid = str(min(valid_uids)) if valid_uids else "999999999"

            account_meta_list.append({
                "id": account.id,
                "email_address": account.email_address,
                "password": plain_password,
                "imap_host": account.imap_host,
                "imap_port": account.imap_port,
                "imap_ssl": account.imap_ssl,
                "folder_min_uid": folder_min_uid
            })

    total_loaded = 0
    overall_has_more = False
    new_loaded_ids = []

    for meta in account_meta_list:
        try:
            older_emails, has_more = await asyncio.wait_for(
                asyncio.to_thread(
                    fetch_older_emails,
                    imap_host=meta["imap_host"],
                    imap_port=meta["imap_port"],
                    imap_ssl=meta["imap_ssl"],
                    email_address=meta["email_address"],
                    password=meta["password"],
                    before_uid=meta["folder_min_uid"],
                    limit=req.limit,
                    folder_type=req.folder
                ),
                timeout=35.0
            )
        except asyncio.TimeoutError:
            logger.warning(f"[LoadMore] 拉取历史邮件超时(>35s) ({meta['email_address']})")
            continue
        except Exception as err:
            logger.error(f"[LoadMore] 拉取历史邮件失败 ({meta['email_address']}): {err}")
            continue

        if has_more:
            overall_has_more = True

        if not older_emails:
            continue

        new_min_uid = float("inf")
        with SessionLocal() as db:
            for m in older_emails:
                uid = m["uid"]
                try:
                    u_int = int(uid)
                    if u_int < new_min_uid:
                        new_min_uid = u_int
                except ValueError:
                    pass

                exists = db.query(EmailRecord.id).filter(
                    EmailRecord.account_id == meta["id"],
                    EmailRecord.folder == req.folder,
                    EmailRecord.uid == uid
                ).first()

                if not exists:
                    total_loaded += 1
                    clean_preview = (m.get("body_text") or "").strip().replace("\n", " ")[:120]
                    is_inbox = (req.folder == "inbox")
                    record = EmailRecord(
                        user_id=current_user.id,
                        account_id=meta["id"],
                        uid=uid,
                        folder=req.folder,
                        message_id=m.get("message_id", ""),
                        subject=m.get("subject", "无主题"),
                        sender=m.get("sender", ""),
                        to_recipients=m.get("to_recipients", ""),
                        cc_recipients=m.get("cc_recipients", ""),
                        bcc_recipients=m.get("bcc_recipients", "") if req.folder == "sent" else "",
                        sent_date=m.get("sent_date") or datetime.now(timezone.utc).isoformat(),
                        body_text=m.get("body_text", ""),
                        body_html=m.get("body_html", ""),
                        language_detected=detect_language_fast(m.get("subject", ""), m.get("body_text", "")),
                        summary_zh="" if is_inbox else clean_preview,
                        key_points_json="[]",
                        action_items_json="[]",
                        ai_guided_question="",
                        initial_reply_draft="",
                        is_read=True if not is_inbox else False,
                        status=req.folder
                    )
                    db.add(record)
                    db.commit()
                    db.refresh(record)
                    if is_inbox:
                        new_loaded_ids.append(record.id)

            if new_min_uid != float("inf"):
                acc = db.query(MailAccount).filter(MailAccount.id == meta["id"]).first()
                if acc:
                    acc.set_folder_uids(req.folder, min_uid=str(new_min_uid))
                    db.commit()

    if new_loaded_ids:
        background_tasks.add_task(batch_analyze_emails, new_loaded_ids, max_concurrency=2)

    if total_loaded > 0:
        try:
            await event_bus.broadcast_to_user(current_user.id, "counts_updated", {})
        except Exception as e:
            logger.warning(f"[LoadMore] 广播 counts_updated 异常: {e}")

    return {
        "loaded_count": total_loaded,
        "has_more": overall_has_more,
        "message": f"成功为您加载了 {total_loaded} 封历史邮件！" if total_loaded > 0 else "没有更早的历史邮件了"
    }

