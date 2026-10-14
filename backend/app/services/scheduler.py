import asyncio
import json
import os
import time
from datetime import datetime, timezone
from app.core.database import SessionLocal
from app.core.config import settings
from app.core.security import decrypt_secret
from app.core.logger import logger
from app.models.account import MailAccount
from app.models.email import EmailRecord
from app.services.mail_service import fetch_recent_emails
from app.services.ai_service import ai_service
from app.services.event_bus import event_bus
from app.services.dingtalk_card_service import dingtalk_card_service
from app.core.datetime_util import format_iso_utc
from app.core.language_util import detect_language_fast

from typing import List, Optional

class AccountSyncLock:
    """邮箱账号同步互斥锁：防止同一邮箱并发拉取造成重复进程与连接耗尽"""
    def __init__(self):
        self._active = {}  # account_id -> start_timestamp
        self._lock = asyncio.Lock()

    async def acquire(self, account_id: int, max_duration: float = 180.0) -> bool:
        async with self._lock:
            now = time.time()
            if account_id in self._active:
                if now - self._active[account_id] > max_duration:
                    logger.warning(f"[Scheduler] 账号 {account_id} 同步锁超时(>180s)，自动强制释放旧锁")
                    del self._active[account_id]
                else:
                    return False
            self._active[account_id] = now
            return True

    async def release(self, account_id: int):
        async with self._lock:
            self._active.pop(account_id, None)

    def is_syncing(self, account_id: int) -> bool:
        now = time.time()
        if account_id in self._active:
            if now - self._active[account_id] <= 180.0:
                return True
            else:
                self._active.pop(account_id, None)
        return False

account_sync_lock = AccountSyncLock()
_ai_semaphore = asyncio.Semaphore(3)  # 全局受控 DeepSeek API 最大并发数

async def sync_single_account(
    account_id: int,
    folders: Optional[List[str]] = None,
    trigger_source: str = "manual"
):
    """为单个邮箱账号拉取多文件夹新邮件并执行对应处理 (trigger_source: 'manual' | 'initial' | 'background_poll')
    【方案C关键设计】：
    1. 账号级互斥锁，拦截重复并发；
    2. 短连接设计：网络 I/O 与 AI 分析期间绝对不持有数据库连接；
    3. IMAP 35 秒硬超时保护，防止单次拉取挂死。
    """
    acquired = await account_sync_lock.acquire(account_id)
    if not acquired:
        logger.info(f"[Scheduler] 账号 {account_id} 已在同步中，跳过本次触发 (来源: {trigger_source})")
        return

    try:
        # 1. 快速短连接读取账号信息与各文件夹 last_uid
        with SessionLocal() as db:
            account = db.query(MailAccount).filter(MailAccount.id == account_id).first()
            if not account or not account.is_active:
                return

            plain_password = decrypt_secret(account.encrypted_password)
            if not plain_password:
                return

            imap_host = account.imap_host
            imap_port = account.imap_port
            imap_ssl = account.imap_ssl
            email_address = account.email_address
            user_id = account.user_id
            acc_display_name = getattr(account, "account_name", None) or getattr(account, "name", "") or account.email_address
            provider = getattr(account, "provider", "custom")

            target_folders = folders or ["inbox", "sent", "drafts", "trash"]
            folder_last_uids = {f: account.get_folder_last_uid(f) for f in target_folders}

        total_new_count = 0

        for folder in target_folders:
            folder_last_uid = folder_last_uids.get(folder, "0")
            is_initial = (folder_last_uid == "0")
            if is_initial:
                fetch_limit = 25 if folder in ["inbox", "sent"] else 8
            else:
                fetch_limit = 15 if folder in ["inbox", "sent"] else 5

            # 2. IMAP 网络拉取（设置 35 秒硬超时熔断，期间 0 数据库连接占用）
            try:
                new_emails = await asyncio.wait_for(
                    asyncio.to_thread(
                        fetch_recent_emails,
                        imap_host=imap_host,
                        imap_port=imap_port,
                        imap_ssl=imap_ssl,
                        email_address=email_address,
                        password=plain_password,
                        last_uid=folder_last_uid,
                        limit=fetch_limit,
                        folder_type=folder
                    ),
                    timeout=35.0
                )
            except asyncio.TimeoutError:
                logger.warning(f"[Scheduler] 拉取文件夹 {folder} 网络超时(>35s) ({email_address})，自动跳过")
                continue
            except Exception as f_err:
                logger.warning(f"[Scheduler] 拉取文件夹 {folder} 异常 ({email_address}): {f_err}")
                continue

            if not new_emails:
                continue

            max_folder_uid = 0
            min_folder_uid = float("inf")
            ai_analyze_ids = []
            card_notify_ids = []
            broadcast_payloads = []

            # 3. 极速短连接批量入库与去重
            with SessionLocal() as db:
                ai_analyzed_count = 0
                for m in new_emails:
                    uid = m["uid"]
                    try:
                        u_int = int(uid)
                        if u_int > max_folder_uid:
                            max_folder_uid = u_int
                        if u_int < min_folder_uid:
                            min_folder_uid = u_int
                    except ValueError:
                        pass

                    exists = db.query(EmailRecord.id).filter(
                        EmailRecord.account_id == account_id,
                        EmailRecord.folder == folder,
                        EmailRecord.uid == uid
                    ).first()

                    if not exists:
                        total_new_count += 1
                        is_inbox = (folder == "inbox")
                        clean_preview = (m.get("body_text") or "").strip().replace("\n", " ")[:120]
                        record = EmailRecord(
                            user_id=user_id,
                            account_id=account_id,
                            uid=uid,
                            folder=folder,
                            message_id=m["message_id"],
                            subject=m["subject"],
                            sender=m["sender"],
                            to_recipients=m["to_recipients"],
                            cc_recipients=m["cc_recipients"],
                            bcc_recipients=m.get("bcc_recipients", "") if folder == "sent" else "",
                            sent_date=m["sent_date"],
                            body_text=m["body_text"],
                            body_html=m["body_html"],
                            language_detected=detect_language_fast(m.get("subject", ""), m.get("body_text", "")),
                            summary_zh="" if is_inbox else clean_preview,
                            is_read=True if not is_inbox else False,
                            status=folder
                        )
                        db.add(record)
                        db.commit()
                        db.refresh(record)

                        broadcast_payloads.append({
                            "id": record.id,
                            "account_id": account_id,
                            "account_name": acc_display_name,
                            "provider": provider,
                            "subject": record.subject or "(无主题)",
                            "sender": record.sender or "",
                            "to_recipients": record.to_recipients or "",
                            "sent_date": record.sent_date or "",
                            "summary_zh": record.summary_zh or "",
                            "key_points": [],
                            "ai_guided_question": "",
                            "is_read": record.is_read,
                            "folder": record.folder,
                            "status": record.status,
                            "created_at": format_iso_utc(record.created_at) or ""
                        })

                        if is_inbox and ai_analyzed_count < 5:
                            ai_analyzed_count += 1
                            ai_analyze_ids.append(record.id)

                        if trigger_source == "background_poll" and is_inbox and not is_initial:
                            card_notify_ids.append(record.id)

                if max_folder_uid > 0:
                    acc = db.query(MailAccount).filter(MailAccount.id == account_id).first()
                    if acc:
                        acc.set_folder_uids(
                            folder,
                            max_uid=str(max_folder_uid),
                            min_uid=str(min_folder_uid) if min_folder_uid != float("inf") else None
                        )
                        acc.last_sync_at = datetime.now(timezone.utc)
                        db.commit()

            # 4. 会话释放后：广播 new_email SSE 事件
            for payload in broadcast_payloads:
                try:
                    await event_bus.broadcast_to_user(user_id, "new_email", payload)
                except Exception as b_err:
                    logger.warning(f"[Scheduler] 广播 new_email 异常 (Email ID: {payload.get('id')}): {b_err}")

            # 5. 会话释放后：逐封进行受控 AI 深度分析（analyze_and_update_email 内部短连接+限流）
            for eid in ai_analyze_ids:
                try:
                    await analyze_and_update_email(eid, force=False)
                except Exception as ai_err:
                    logger.error(f"[Scheduler] AI 分析单封邮件异常 (Email ID: {eid}): {ai_err}")

            # 6. 会话释放后：钉钉互动卡片推送
            for cid in card_notify_ids:
                try:
                    card_user = None
                    card_account = None
                    card_record = None
                    with SessionLocal() as db:
                        rec = db.query(EmailRecord).filter(EmailRecord.id == cid).first()
                        if rec and rec.account and rec.account.user:
                            card_user = rec.account.user
                            card_account = rec.account
                            card_record = rec
                            db.expunge(card_user)
                            db.expunge(card_account)
                            db.expunge(card_record)

                    if card_user and card_account and card_record:
                        out_track_id = await dingtalk_card_service.send_new_email_card(
                            user=card_user,
                            account=card_account,
                            email_record=card_record
                        )
                        if out_track_id:
                            with SessionLocal() as db:
                                rec_to_update = db.query(EmailRecord).filter(EmailRecord.id == cid).first()
                                if rec_to_update:
                                    rec_to_update.dingtalk_card_out_track_id = out_track_id
                                    rec_to_update.dingtalk_card_status = "delivered"
                                    db.commit()
                except Exception as card_err:
                    logger.error(f"[Scheduler] 推送钉钉互动卡片异常 (Email ID: {cid}): {card_err}", exc_info=True)

        if total_new_count > 0:
            try:
                await event_bus.broadcast_to_user(user_id, "counts_updated", {})
            except Exception as c_err:
                logger.warning(f"[Scheduler] 广播 counts_updated 异常: {c_err}")

    except Exception as e:
        logger.error(f"[Scheduler] 同步邮箱失败 (Account ID: {account_id}): {e}", exc_info=True)
    finally:
        await account_sync_lock.release(account_id)

async def analyze_and_update_email(email_id: int, force: bool = False) -> Optional[EmailRecord]:
    """分析单封邮件并落库，触发 SSE 广播。
    【方案C关键设计】：
    1. 短连接仅在读取和写入两端开启几毫秒；
    2. 调用 DeepSeek API 期间绝不霸占数据库连接；
    3. 受全局 _ai_semaphore 限流，杜绝突发打爆 LLM 速率限制。
    """
    try:
        # 1. 短连接读取邮件数据并判定是否需分析
        with SessionLocal() as db:
            email = db.query(EmailRecord).filter(EmailRecord.id == email_id).first()
            if not email:
                return None

            if not force:
                has_summary = bool(email.summary_zh and email.summary_zh.strip())
                has_key_points = bool(email.key_points_json and email.key_points_json not in ("[]", ""))
                has_old_unconfigured_tip = "尚未配置 DEEPSEEK_API_KEY" in (email.summary_zh or "") or "配置 DeepSeek API Key" in (email.action_items_json or "")
                if has_summary and has_key_points and not has_old_unconfigured_tip:
                    db.expunge(email)
                    return email

            user_id = email.user_id
            subject = email.subject or ""
            sender = email.sender or ""
            body_text = email.body_text or ""

        # 2. 全局受控并发调用大模型（期间 0 数据库连接占用！）
        async with _ai_semaphore:
            analysis = await ai_service.analyze_email(
                subject=subject,
                sender=sender,
                body_text=body_text
            )

        # 3. 短连接回写分析结果
        with SessionLocal() as db:
            email = db.query(EmailRecord).filter(EmailRecord.id == email_id).first()
            if not email:
                return None

            email.language_detected = analysis.get("language_detected", "en")
            email.summary_zh = analysis.get("summary_zh", "")
            email.key_points_json = json.dumps(analysis.get("key_points", []), ensure_ascii=False)
            email.action_items_json = json.dumps(analysis.get("action_items", []), ensure_ascii=False)
            email.ai_guided_question = analysis.get("guided_question", "")
            email.initial_reply_draft = analysis.get("initial_reply_draft", "")
            db.commit()
            db.refresh(email)
            db.expunge(email)

        # 4. 广播 email_analyzed SSE 事件
        try:
            await event_bus.broadcast_to_user(user_id, "email_analyzed", {
                "id": email.id,
                "summary_zh": email.summary_zh,
                "key_points": analysis.get("key_points", []),
                "action_items": analysis.get("action_items", []),
                "ai_guided_question": email.ai_guided_question
            })
        except Exception as sse_err:
            logger.warning(f"[Scheduler] 广播 email_analyzed 异常 (Email ID: {email.id}): {sse_err}")

        return email
    except Exception as e:
        logger.error(f"[Scheduler] AI 分析单封邮件异常 (Email ID: {email_id}): {e}")
        return None

async def batch_analyze_emails(email_ids: List[int], max_concurrency: int = 3):
    """受控并发批量分析邮件，防止打爆 LLM 速率限制"""
    if not email_ids:
        return
    semaphore = asyncio.Semaphore(max_concurrency)

    async def _worker(eid: int):
        async with semaphore:
            try:
                await analyze_and_update_email(eid, force=False)
            except Exception as err:
                logger.error(f"[Scheduler] 批量分析邮件异常 (Email ID: {eid}): {err}")

    tasks = [_worker(eid) for eid in email_ids]
    await asyncio.gather(*tasks, return_exceptions=True)

async def heal_unanalyzed_emails():
    """自动自愈补全收件箱中尚未完成 AI 分析的邮件"""
    with SessionLocal() as db:
        unanalyzed = db.query(EmailRecord.id).filter(
            EmailRecord.folder == "inbox",
            (
                (EmailRecord.summary_zh == "") | 
                (EmailRecord.summary_zh == None) | 
                (EmailRecord.key_points_json == "[]") | 
                (EmailRecord.key_points_json == None)
            )
        ).order_by(EmailRecord.id.desc()).limit(10).all()
        ids = [r[0] for r in unanalyzed]

    if ids:
        await batch_analyze_emails(ids, max_concurrency=2)

_last_attachment_cleanup = 0.0

def clean_expired_large_attachments():
    """定期清理超过 7 天保存期的超大附件物理文件与元数据，保持磁盘零垃圾堆积"""
    global _last_attachment_cleanup
    now_ts = time.time()
    # 限制每 2 小时执行一次深度扫描
    if now_ts - _last_attachment_cleanup < 7200:
        return
    _last_attachment_cleanup = now_ts

    storage_dir = getattr(settings, "LARGE_ATTACHMENT_DIR", None)
    if not storage_dir or not os.path.exists(storage_dir):
        return

    try:
        now_utc = datetime.now(timezone.utc)
        cleaned_count = 0
        for entry in os.listdir(storage_dir):
            if entry.endswith(".json"):
                meta_path = os.path.join(storage_dir, entry)
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                    expires_str = meta.get("expires_at")
                    if expires_str:
                        exp_dt = datetime.fromisoformat(expires_str)
                        if now_utc > exp_dt:
                            # 已经超期，物理删除文件与对应 json 元数据
                            saved_file = meta.get("saved_file")
                            if saved_file:
                                fpath = os.path.join(storage_dir, saved_file)
                                if os.path.exists(fpath):
                                    os.remove(fpath)
                            if os.path.exists(meta_path):
                                os.remove(meta_path)
                            cleaned_count += 1
                except Exception as meta_err:
                    logger.debug(f"[Scheduler] 检查附件生命周期异常: {meta_err}")
        if cleaned_count > 0:
            logger.info(f"[Scheduler] 自动清理 7 天过期大附件完成，共回收释放 {cleaned_count} 个过期文件")
    except Exception as e:
        logger.warning(f"[Scheduler] 周期清理过期附件失败: {e}")

async def background_mail_poller():
    """后台常驻轮询器"""
    logger.info("[Scheduler] 邮件后台常驻调度器已成功启动并开始运行")
    # 启动时自愈补全之前遗留未分析的邮件
    try:
        await heal_unanalyzed_emails()
    except Exception as heal_err:
        logger.error(f"[Scheduler] 启动时自愈分析异常: {heal_err}", exc_info=True)

    while True:
        try:
            # 尝试执行超期大附件清理巡检
            clean_expired_large_attachments()

            with SessionLocal() as db:
                active_accounts = db.query(MailAccount.id).filter(MailAccount.is_active == True).all()
                account_ids = [a[0] for a in active_accounts]

            # 过滤掉已经在同步中的账号，避免与前台用户手动触发或长任务并发冲突
            candidate_ids = [aid for aid in account_ids if not account_sync_lock.is_syncing(aid)]
            tasks = [sync_single_account(acc_id, trigger_source="background_poll") for acc_id in candidate_ids]
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

        except Exception as e:
            logger.error(f"[Scheduler] 调度器主循环异常: {e}", exc_info=True)

        await asyncio.sleep(settings.POLL_INTERVAL_SECONDS)

