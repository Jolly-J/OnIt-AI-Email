import json
import asyncio
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from dingtalk_stream import AckMessage, CallbackMessage, CardCallbackMessage, CallbackHandler, DingTalkStreamClient, Credential

from app.core.config import settings
from app.core.logger import logger
from app.core.database import SessionLocal
from app.core.security import decrypt_secret
from app.core.datetime_util import format_iso_utc
from app.models.email import EmailRecord
from app.models.account import MailAccount
from app.models.user import User
from app.services.mail_service import build_and_send_smtp_email, append_to_sent_folder
from app.services.event_bus import event_bus

from app.models.message import ChatMessage
from app.services.ai_service import ai_service

class EmailCardCallbackHandler(CallbackHandler):
    """处理钉钉互动卡片上的交互回传（两阶段闭环：生成草稿预览 -> 确认发送邮件）"""

    async def process(self, callback: CallbackMessage):
        logger.info(f"[DingTalkStream] 收到互动卡片回调事件: message_id={callback.headers.message_id}")
        try:
            raw_data = callback.data
            if isinstance(raw_data, str):
                raw_data = json.loads(raw_data)

            # 解析回调消息体
            incoming = CardCallbackMessage.from_dict(raw_data)
            out_track_id = incoming.card_instance_id or raw_data.get("outTrackId", "")
            operator_ding_uid = incoming.user_id or raw_data.get("userId", "")
            
            content_dict = incoming.content or {}
            card_private_data = content_dict.get("cardPrivateData", {})
            params = card_private_data.get("params", {})
            
            if not isinstance(params, dict):
                try:
                    params = json.loads(params)
                except Exception:
                    params = {}

            logger.info(f"[DingTalkStream] 卡片回传解析: outTrackId={out_track_id}, operator={operator_ding_uid}, params={params}")

            if not out_track_id:
                return AckMessage.STATUS_OK, {"message": "missing outTrackId"}

            # 处理业务逻辑
            res_card_data = await self._handle_card_reply(out_track_id, params, operator_ding_uid)
            
            response = {
                "cardUpdateOptions": {
                    "updateCardDataByKey": True
                },
                "cardData": {
                    "cardParamMap": res_card_data
                }
            }
            return AckMessage.STATUS_OK, response

        except Exception as e:
            logger.error(f"[DingTalkStream] 处理卡片交互回调异常: {e}", exc_info=True)
            return AckMessage.STATUS_OK, {
                "cardUpdateOptions": {"updateCardDataByKey": True},
                "cardData": {"cardParamMap": {"statusText": f"❌ 处理失败: {str(e)[:40]}"}}
            }

    async def _handle_card_reply(self, out_track_id: str, params: Dict[str, Any], operator_ding_uid: str) -> Dict[str, str]:
        """执行两阶段交互：阶段 1 起草微调；阶段 2 确认发信"""
        db = SessionLocal()
        try:
            # 1. 查询关联的邮件记录
            email_record = db.query(EmailRecord).filter(
                EmailRecord.dingtalk_card_out_track_id == out_track_id
            ).first()

            # 备选：根据 params 中的 emailId 查找
            if not email_record and params.get("emailId"):
                try:
                    e_id = int(params["emailId"])
                    email_record = db.query(EmailRecord).filter(EmailRecord.id == e_id).first()
                except ValueError:
                    pass

            if not email_record:
                logger.warning(f"[DingTalkStream] 未找到关联的邮件记录 (outTrackId={out_track_id})")
                return {"statusText": "⚠️ 未找到对应的邮件记录"}

            owner = db.query(User).filter(User.id == email_record.user_id).first()
            if not owner:
                return {"statusText": "⚠️ 邮件所有者档案异常"}

            # 2. 严格用户隔离拦截防线：校验操作人与邮件属主是否一致
            if operator_ding_uid and owner.dingtalk_userid and operator_ding_uid != owner.dingtalk_userid:
                logger.warning(f"[DingTalkStream] 越权操作拦截: 操作人 {operator_ding_uid} 试图操作属主 {owner.dingtalk_userid} 的邮件卡片")
                return {
                    "statusText": f"⛔ 权限不足：当前卡片属于员工【{owner.display_name}】，您无权代为操作！"
                }

            action = params.get("action", "")

            # ──────────────────────────────────────────
            # 动作分支 1：让 AI 起草/微调回复草稿 (阶段一)
            # ──────────────────────────────────────────
            if action == "generate_draft":
                instruction = (
                    params.get("userInstruction") or 
                    params.get("form", {}).get("userInstruction") or 
                    ""
                ).strip()
                if not instruction:
                    instruction = "请根据发件人诉求撰写专业得体的商务回复邮件"

                logger.info(f"[DingTalkStream] AI 起草触发 (Email ID: {email_record.id}): {instruction}")

                # 加载该用户针对该邮件的历史多轮上下文（用户隔离）
                history_records = db.query(ChatMessage).filter(
                    ChatMessage.email_id == email_record.id,
                    ChatMessage.user_id == owner.id
                ).order_by(ChatMessage.created_at.asc()).all()

                chat_history = []
                for m in history_records:
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
                        chat_history.append({"role": "user", "content": m.content or ""})

                user_display = (owner.display_name or owner.username or "业务专员").strip()
                dept_display = (owner.department_name or "商务部").strip()

                kp = []
                if email_record.key_points_json:
                    try:
                        kp = json.loads(email_record.key_points_json)
                    except Exception:
                        kp = []
                ai_acts = []
                if email_record.action_items_json:
                    try:
                        ai_acts = json.loads(email_record.action_items_json)
                    except Exception:
                        ai_acts = []

                try:
                    ai_result = await ai_service.chat_and_refine_reply(
                        subject=email_record.subject or "无主题",
                        sender=email_record.sender or "",
                        original_body=email_record.body_text or "",
                        chat_history=chat_history,
                        user_instruction=instruction,
                        language_detected=email_record.language_detected or "zh",
                        user_name=user_display,
                        user_department=dept_display,
                        company_name=settings.COMPANY_NAME,
                        company_name_en=settings.COMPANY_NAME_EN,
                        ai_summary=email_record.summary_zh or "",
                        key_points=kp,
                        action_items=ai_acts
                    )
                except Exception as ai_err:
                    logger.error(f"[DingTalkStream] AI 起草失败: {ai_err}")
                    return {"statusText": f"❌ AI 起草失败: {str(ai_err)[:40]}"}

                draft_reply = ai_result.get("draft_reply", "")
                draft_reply_zh = ai_result.get("draft_reply_zh", "")
                explanation = ai_result.get("explanation", "")

                # 持久化对话消息，保证多轮微调上下文连续
                user_msg = ChatMessage(
                    email_id=email_record.id,
                    user_id=owner.id,
                    role="user",
                    content=instruction
                )
                db.add(user_msg)

                assistant_msg = ChatMessage(
                    email_id=email_record.id,
                    user_id=owner.id,
                    role="assistant",
                    content=ai_result.get("response", ""),
                    draft_reply=draft_reply,
                    draft_reply_zh=draft_reply_zh,
                    explanation=explanation
                )
                db.add(assistant_msg)

                # 更新最新草稿
                email_record.initial_reply_draft = draft_reply
                db.commit()

                # 拼装 AI 回复草稿 Markdown（外文草稿 + 逐段对称中文对照 + 策略说明）
                draft_markdown = (
                    f"**策略要点**：{explanation}\n\n"
                    f"---\n"
                    f"**【外文回复邮件草稿】**\n"
                    f"```text\n{draft_reply}\n```\n\n"
                    f"**【逐段对称中文公文对照】**\n"
                    f"{draft_reply_zh}"
                )

                # 动态切换按钮组：展示【重新起草】与【确认发送此邮件】两个操作按钮
                stage2_buttons = [
                    {
                        "text": "重新起草",
                        "color": "gray",
                        "status": "normal",
                        "event": {
                            "type": "sendCardRequest",
                            "params": {
                                "actionId": "generate_draft",
                                "params": {
                                    "action": "generate_draft",
                                    "emailId": str(email_record.id),
                                    "userInstruction": instruction
                                }
                            }
                        }
                    },
                    {
                        "text": "确认发送此邮件",
                        "color": "blue",
                        "status": "normal",
                        "event": {
                            "type": "sendCardRequest",
                            "params": {
                                "actionId": "confirm_send",
                                "params": {
                                    "action": "confirm_send",
                                    "emailId": str(email_record.id),
                                    "draftReply": draft_reply
                                }
                            }
                        }
                    }
                ]

                return {
                    # 关键业务字段更新
                    "huifucaogao": draft_markdown,
                    "anniuzu": json.dumps(stage2_buttons, ensure_ascii=False),
                    "stage": "draft_generated",
                    "draftReply": draft_reply,
                    "draftReplyZh": draft_reply_zh,
                    "explanation": explanation,
                    "userInstruction": instruction,
                    "statusText": "🤖 AI 回复草稿已就绪，请展开上方【回复草稿】核对确认"
                }

            # ──────────────────────────────────────────
            # 动作分支 2：确认发送此邮件 (阶段二)
            # ──────────────────────────────────────────
            elif action == "confirm_send" or action == "quick_reply":
                # 防重复回复
                if email_record.status == "replied" or email_record.dingtalk_card_status == "replied":
                    return {
                        "stage": "replied",
                        "statusText": "ℹ️ 该邮件此前已成功回复，请勿重复发信"
                    }

                account = db.query(MailAccount).filter(MailAccount.id == email_record.account_id).first()
                if not account or not account.is_active:
                    return {"statusText": "⚠️ 关联发信邮箱账号已停用或失效"}

                plain_pwd = decrypt_secret(account.encrypted_password)
                if not plain_pwd:
                    return {"statusText": "⚠️ 邮箱密码解密失败，无法调用 SMTP"}

                draft_to_send = (
                    params.get("draftReply") or 
                    email_record.initial_reply_draft or 
                    ""
                ).strip()

                if not draft_to_send:
                    return {"statusText": "⚠️ 当前无草稿内容，请先输入指令让 AI 起草回复"}

                orig_subject = email_record.subject or "无主题"
                reply_subject = orig_subject if orig_subject.lower().startswith("re:") else f"Re: {orig_subject}"
                to_email = email_record.sender.strip()

                send_success, err_msg, new_msg_id, raw_bytes, refused = await asyncio.to_thread(
                    build_and_send_smtp_email,
                    smtp_host=account.smtp_host,
                    smtp_port=account.smtp_port,
                    smtp_ssl=account.smtp_ssl,
                    email_address=account.email_address,
                    password=plain_pwd,
                    to_email=to_email,
                    subject=reply_subject,
                    body_text=draft_to_send,
                    body_html=None,
                    in_reply_to=email_record.message_id,
                    references=email_record.message_id
                )

                if not send_success:
                    logger.error(f"[DingTalkStream] 发信失败: {err_msg}")
                    return {"statusText": f"❌ 发信失败: {err_msg[:40]}"}

                now_dt = datetime.now(timezone.utc)
                now_local_str = datetime.now().strftime("%H:%M")

                sent_record = EmailRecord(
                    user_id=owner.id,
                    account_id=account.id,
                    uid=f"sent_{int(datetime.now().timestamp())}",
                    message_id=new_msg_id or "",
                    subject=reply_subject,
                    sender=account.email_address,
                    to_recipients=to_email,
                    sent_date=now_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    body_text=draft_to_send,
                    folder="sent",
                    status="sent",
                    is_read=True
                )
                db.add(sent_record)

                email_record.status = "replied"
                email_record.dingtalk_card_status = "replied"
                db.commit()

                # 异步追加至远端 IMAP 发件箱
                if raw_bytes:
                    asyncio.create_task(asyncio.to_thread(
                        append_to_sent_folder,
                        imap_host=account.imap_host,
                        imap_port=account.imap_port,
                        imap_ssl=account.imap_ssl,
                        email_address=account.email_address,
                        password=plain_pwd,
                        raw_email_bytes=raw_bytes
                    ))

                # 广播给 Web 前端实时刷新
                try:
                    await event_bus.broadcast_to_user(owner.id, "email_replied", {
                        "original_id": email_record.id,
                        "sent_id": sent_record.id,
                        "replied_at": format_iso_utc(now_dt)
                    })
                except Exception as b_err:
                    logger.warning(f"[DingTalkStream] 广播 email_replied 异常: {b_err}")

                status_text = err_msg if refused else f"✅ 已于 {now_local_str} 由【{owner.display_name}】成功发出邮件回复"
                logger.info(f"[DingTalkStream] 邮件成功发出闭环: Email ID={email_record.id}, To={to_email}")

                sent_buttons = [
                    {
                        "text": "已发送回复",
                        "color": "gray",
                        "status": "disabled",
                        "event": {
                            "type": "openLink",
                            "params": {"url": "https://www.dingtalk.com"}
                        }
                    }
                ]

                huifucaogao_sent = (
                    f"### {status_text}\n\n"
                    f"> **发件账号**：`{account.email_address}` ➔ **收件人**：`{to_email}`\n\n"
                    f"**【已发出的正式回复】**\n"
                    f"```text\n{draft_to_send}\n```"
                )

                return {
                    "stage": "replied",
                    "statusText": status_text,
                    "huifucaogao": huifucaogao_sent,
                    "anniuzu": json.dumps(sent_buttons, ensure_ascii=False),
                    "draftReply": draft_to_send
                }

            else:
                return {"statusText": f"⚠️ 未知操作动作: {action}"}

        finally:
            db.close()

class DingTalkStreamManager:
    """管理钉钉 Stream 长连接客户端生命周期"""

    def __init__(self):
        self._client: Optional[DingTalkStreamClient] = None
        self._task: Optional[asyncio.Task] = None

    def start(self):
        """在后台异步任务中启动 Stream 客户端"""
        client_id = settings.DINGTALK_CLIENT_ID.strip()
        client_secret = settings.DINGTALK_CLIENT_SECRET.strip()

        if not client_id or not client_secret:
            logger.info("[DingTalkStream] 未配置 DINGTALK_CLIENT_ID 或 DINGTALK_CLIENT_SECRET，跳过 Stream 监听启动")
            return

        credential = Credential(client_id, client_secret)
        self._client = DingTalkStreamClient(credential)

        # 注册卡片交互回调处理器
        handler = EmailCardCallbackHandler()
        self._client.register_callback_handler(
            CallbackHandler.TOPIC_CARD_CALLBACK,
            handler
        )

        logger.info(f"[DingTalkStream] 正在启动钉钉 Stream 长连接客户端 (AppKey={client_id[:6]}...)...")
        self._task = asyncio.create_task(self._run())

    async def _run(self):
        try:
            await self._client.start()
        except asyncio.CancelledError:
            logger.info("[DingTalkStream] Stream 客户端任务已取消并关闭")
        except Exception as e:
            logger.error(f"[DingTalkStream] Stream 客户端运行异常: {e}", exc_info=True)

    def stop(self):
        """停止 Stream 客户端"""
        if self._task and not self._task.done():
            self._task.cancel()
            logger.info("[DingTalkStream] 已请求终止 Stream 监听任务")

dingtalk_stream_manager = DingTalkStreamManager()
