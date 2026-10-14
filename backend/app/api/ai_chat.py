from typing import List, Optional
import time
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from app.core.datetime_util import format_iso_utc
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decrypt_secret
from app.models.user import User
from app.models.account import MailAccount
from app.models.email import EmailRecord
from app.models.message import ChatMessage
from app.api.auth import get_current_user
from app.core.limiter import limiter_chat
from app.services.ai_service import ai_service
from app.services.mail_service import send_smtp_email, build_and_send_smtp_email, append_to_sent_folder
from app.services.event_bus import event_bus
from app.core.logger import logger
from app.core.mail_recipients import normalize_recipients

router = APIRouter(prefix="/chat", tags=["AI 对话与起草"])

class SendInstructionReq(BaseModel):
    instruction: str
    current_draft: Optional[str] = None

class SendReplyReq(BaseModel):
    reply_body: str
    custom_subject: Optional[str] = None
    cc_email: str = ""
    bcc_email: str = ""

class ComposeInstructionReq(BaseModel):
    instruction: str
    to_email: Optional[str] = ""
    subject: Optional[str] = ""
    current_draft: Optional[str] = None
    chat_history: Optional[List[dict]] = None
    language_preference: Optional[str] = "auto"

@router.post("/compose", dependencies=[Depends(limiter_chat)])
async def chat_compose_with_ai(
    req: ComposeInstructionReq,
    current_user: User = Depends(get_current_user)
):
    """写新邮件时的人机协同起草与润色对话（无状态会话级）"""
    if not req.instruction or not req.instruction.strip():
        raise HTTPException(status_code=400, detail="起草指令不能为空")

    user_name = (current_user.display_name or current_user.username or "业务专员").strip()
    user_department = (current_user.department_name or "商务部").strip()

    try:
        ai_result = await ai_service.compose_new_mail(
            user_instruction=req.instruction.strip(),
            to_email=(req.to_email or "").strip(),
            subject=(req.subject or "").strip(),
            current_draft=(req.current_draft or "").strip() or None,
            chat_history=req.chat_history or [],
            language_preference=req.language_preference or "auto",
            user_name=user_name,
            user_department=user_department,
            company_name=settings.COMPANY_NAME,
            company_name_en=settings.COMPANY_NAME_EN
        )
    except Exception as e:
        logger.error(f"[ChatAPI] 写信 AI 拟稿失败: {e}")
        raise HTTPException(
            status_code=500,
            detail=str(e) or "写信 AI 拟稿生成异常，请稍后重试"
        )

    return {
        "id": int(time.time() * 1000),
        "role": "assistant",
        "content": ai_result.get("response", ""),
        "draft_reply": ai_result.get("draft_reply", ""),
        "draft_reply_zh": ai_result.get("draft_reply_zh", ""),
        "explanation": ai_result.get("explanation", ""),
        "created_at": format_iso_utc(datetime.now(timezone.utc)) or ""
    }

@router.get("/{email_id}")
def get_chat_history(
    email_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取单封邮件的 AI 拟稿对话历史"""
    email = db.query(EmailRecord).filter(
        EmailRecord.id == email_id,
        EmailRecord.user_id == current_user.id
    ).first()
    if not email:
        raise HTTPException(status_code=404, detail="邮件不存在")

    messages = db.query(ChatMessage).filter(
        ChatMessage.email_id == email_id,
        ChatMessage.user_id == current_user.id
    ).order_by(ChatMessage.created_at.asc()).all()

    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "draft_reply": m.draft_reply,
            "draft_reply_zh": getattr(m, "draft_reply_zh", "") or "",
            "explanation": getattr(m, "explanation", "") or "",
            "created_at": format_iso_utc(m.created_at) or ""
        }
        for m in messages
    ]

@router.post("/{email_id}", dependencies=[Depends(limiter_chat)])
async def chat_with_ai(
    email_id: int,
    req: SendInstructionReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """针对当前邮件输入指导意图，让 AI 微调生成回复草稿"""
    email = db.query(EmailRecord).filter(
        EmailRecord.id == email_id,
        EmailRecord.user_id == current_user.id
    ).first()
    if not email:
        raise HTTPException(status_code=404, detail="邮件不存在")

    # 提取前置 AI 分析事实锚点
    key_points = []
    if email.key_points_json:
        try:
            key_points = json.loads(email.key_points_json)
        except Exception:
            key_points = []

    action_items = []
    if email.action_items_json:
        try:
            action_items = json.loads(email.action_items_json)
        except Exception:
            action_items = []

    # 获取历史对话上下文，并完整还原助手草稿与策略结构（杜绝多轮记忆断层）
    history_records = db.query(ChatMessage).filter(
        ChatMessage.email_id == email_id,
        ChatMessage.user_id == current_user.id
    ).order_by(ChatMessage.created_at.asc()).all()

    # 智能清洗历史上下文：彻底过滤无实质信息量的机械兜底记录（彻底杜绝负向少样本诱导大模型复读/置空）
    clean_history_records = []
    trivial_fallbacks = [
        "回复稿已更新",
        "已收到您的指示。如需帮您撰写或调整回复邮件",
        "已收到您的指示，暂未生成新草稿",
        "已根据您的最新指示为您生成/更新回复草稿"
    ]

    for m in history_records:
        if m.role == "assistant":
            c = (m.content or "").strip()
            has_draft = bool((m.draft_reply or "").strip() or getattr(m, "draft_reply_zh", "").strip())
            # 如果没有草稿且内容属于历史已知的机械兜底套话，则判定为无效负向样本，跳过送入 LLM 上下文
            is_trivial = not has_draft and any(tf in c for tf in trivial_fallbacks)
            if is_trivial:
                # 若上一条是“重新回答”等无上下文提问，也予以连带弹出，保持上下文自然连贯
                if clean_history_records and clean_history_records[-1].role == "user" and clean_history_records[-1].content.strip() in ["重新回答", "重新回答。"]:
                    clean_history_records.pop()
                continue
        clean_history_records.append(m)

    chat_history = []
    for m in clean_history_records:
        if m.role == "assistant":
            parts = []
            if m.content:
                parts.append(m.content)
            if m.draft_reply:
                parts.append(f"【外语回复草稿】:\n{m.draft_reply}")
            if getattr(m, "draft_reply_zh", ""):
                parts.append(f"【完整中文公文对照】:\n{m.draft_reply_zh}")
            if getattr(m, "explanation", ""):
                parts.append(f"【策略与要点说明】:\n{m.explanation}")
            chat_history.append({
                "role": "assistant",
                "content": "\n\n".join(parts) if parts else (m.content or "")
            })
        else:
            chat_history.append({
                "role": "user",
                "content": m.content or ""
            })

    # 调用 AI（带 60 秒超时与自动重试）
    try:
        user_name = (current_user.display_name or current_user.username or "业务专员").strip()
        user_department = (current_user.department_name or "商务部").strip()

        ai_result = await ai_service.chat_and_refine_reply(
            subject=email.subject,
            sender=email.sender,
            original_body=email.body_text,
            chat_history=chat_history,
            user_instruction=req.instruction.strip(),
            language_detected=email.language_detected or "zh",
            user_name=user_name,
            user_department=user_department,
            company_name=settings.COMPANY_NAME,
            company_name_en=settings.COMPANY_NAME_EN,
            ai_summary=email.summary_zh or "",
            key_points=key_points,
            action_items=action_items,
            current_draft=req.current_draft
        )
    except Exception as e:
        logger.error(f"[ChatAPI] 邮件 [{email_id}] AI 拟稿失败: {e}")
        raise HTTPException(
            status_code=500,
            detail=str(e) or "AI 拟稿生成异常，请稍后重试"
        )

    # 仅在 AI 成功生成时，才成对持久化本次对话记录，彻底避免错误历史污染上下文
    user_msg = ChatMessage(
        email_id=email_id,
        user_id=current_user.id,
        role="user",
        content=req.instruction.strip()
    )
    db.add(user_msg)

    assistant_msg = ChatMessage(
        email_id=email_id,
        user_id=current_user.id,
        role="assistant",
        content=ai_result.get("response", ""),
        draft_reply=ai_result.get("draft_reply", ""),
        draft_reply_zh=ai_result.get("draft_reply_zh", ""),
        explanation=ai_result.get("explanation", "")
    )
    db.add(assistant_msg)
    db.commit()
    db.refresh(assistant_msg)

    return {
        "id": assistant_msg.id,
        "role": assistant_msg.role,
        "content": assistant_msg.content,
        "draft_reply": assistant_msg.draft_reply,
        "draft_reply_zh": assistant_msg.draft_reply_zh,
        "explanation": assistant_msg.explanation,
        "created_at": format_iso_utc(assistant_msg.created_at) or ""
    }

@router.post("/{email_id}/send_reply")
async def send_confirmed_reply(
    email_id: int,
    req: SendReplyReq,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """确认无误后，一键通过原收件邮箱 SMTP 发送回复，并自动落库发件箱与同步远端"""
    email = db.query(EmailRecord).filter(
        EmailRecord.id == email_id,
        EmailRecord.user_id == current_user.id
    ).first()
    if not email:
        raise HTTPException(status_code=404, detail="邮件不存在")

    account = db.query(MailAccount).filter(
        MailAccount.id == email.account_id,
        MailAccount.user_id == current_user.id,
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="关联的原收件邮箱不存在或已解绑")

    plain_pass = decrypt_secret(account.encrypted_password)
    if not plain_pass:
        raise HTTPException(status_code=400, detail="邮箱授权码解密失败，请重新配置该邮箱授权码")

    # 提取对方纯邮箱地址（去掉姓名如 "John <john@example.com>"）
    to_addr = email.sender
    if "<" in to_addr and ">" in to_addr:
        to_addr = to_addr.split("<")[1].split(">")[0].strip()

    try:
        to_addr, cc_email, bcc_email = normalize_recipients(to_addr, req.cc_email, req.bcc_email)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    reply_subject = req.custom_subject or email.subject
    if not reply_subject.lower().startswith("re:"):
        reply_subject = f"Re: {reply_subject}"

    success, msg, msg_id, raw_bytes, refused = build_and_send_smtp_email(
        smtp_host=account.smtp_host,
        smtp_port=account.smtp_port,
        smtp_ssl=account.smtp_ssl,
        email_address=account.email_address,
        password=plain_pass,
        to_email=to_addr,
        cc_email=cc_email,
        bcc_email=bcc_email,
        subject=reply_subject,
        body_text=req.reply_body,
        in_reply_to=email.message_id,
        references=email.message_id
    )

    if not success:
        raise HTTPException(status_code=500, detail=msg)

    # 发送成功，更新原邮件状态为“已回复”
    email.status = "replied"
    
    # 本地生成发件箱记录
    sent_record = EmailRecord(
        user_id=current_user.id,
        account_id=account.id,
        uid=f"local_reply_{int(time.time()*1000)}",
        folder="sent",
        message_id=msg_id or "",
        subject=reply_subject,
        sender=account.email_address,
        to_recipients=to_addr,
        cc_recipients=cc_email,
        bcc_recipients=bcc_email,
        sent_date=datetime.now(timezone.utc).isoformat(),
        body_text=req.reply_body,
        summary_zh=f"回复: {email.subject[:50]}",
        is_read=True,
        status="sent"
    )
    db.add(sent_record)
    db.commit()

    # 异步追加到 IMAP 服务器已发送文件夹
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

    # 广播事件
    try:
        await event_bus.broadcast_to_user(current_user.id, "counts_updated", {})
    except Exception:
        pass

    return {
        "success": True,
        "message": msg if refused else f"回复已通过【{account.name or account.email_address}】成功发出！",
        "delivery_warning": msg if refused else None,
        "status": email.status,
        "sent_id": sent_record.id
    }
