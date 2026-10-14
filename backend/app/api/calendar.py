import uuid
from urllib.parse import quote, urlencode
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.logger import logger
from app.core.config import settings
from app.api.auth import get_current_user
from app.models.user import User
from app.models.account import MailAccount
from app.services.oa_meeting_service import oa_meeting_service
from app.services.dingtalk_service import dingtalk_service
from app.services.mail_service import build_and_send_smtp_email
from app.core.security import decrypt_secret

router = APIRouter(prefix="/calendar", tags=["日历与会议预约"])

# ==================== 请求/响应模型 ====================

class CheckRoomReq(BaseModel):
    room_id: str
    meeting_date: str = Field(..., example="2026-09-07")
    start_time: str = Field(..., example="15:00")
    end_time: str = Field(..., example="16:00")

class CreateMeetingReq(BaseModel):
    summary: str = Field(..., example="线上商务沟通")
    description: str = Field(default="", example="探讨合作方案与技术对接")
    meeting_date: str = Field(..., example="2026-09-07")
    start_time: str = Field(..., example="15:00")
    end_time: str = Field(..., example="16:00")
    room_id: Optional[str] = Field(None, example="1")
    room_name: Optional[str] = Field(None, example="第一会议室 (8人)")
    attendee_mobiles: List[str] = Field(default_factory=list)
    attendee_userids: List[str] = Field(default_factory=list)
    attendee_emails: List[str] = Field(default_factory=list)
    enable_video_meeting: bool = True
    send_ics_email: bool = False
    email_account_id: Optional[int] = None

class ExtractProposalReq(BaseModel):
    content: str
    email_subject: Optional[str] = ""

# ==================== 辅助方法：生成 iCalendar ICS ====================

def _generate_ics_content(
    summary: str,
    description: str,
    location: str,
    meeting_date: str,
    start_time: str,
    end_time: str,
    organizer_email: str,
    organizer_name: str
) -> str:
    """生成标准 RFC 5545 规范的 iCalendar .ics 字符串"""
    event_uid = f"{uuid.uuid4()}@{settings.COMPANY_DOMAIN}"
    dtstamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    
    # 转换为 UTC 时间格式 YYYYMMDDTHHMMSSZ (UTC+8 需减 8 小时)
    start_dt = datetime.strptime(f"{meeting_date} {start_time}", "%Y-%m-%d %H:%M")
    end_dt = datetime.strptime(f"{meeting_date} {end_time}", "%Y-%m-%d %H:%M")
    
    # 钉钉通常在中国标准时区 UTC+8
    start_utc = datetime.fromtimestamp(start_dt.timestamp() - 8 * 3600, tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    end_utc = datetime.fromtimestamp(end_dt.timestamp() - 8 * 3600, tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    clean_desc = description.replace("\n", "\\n")
    
    ics_lines = [
        "BEGIN:VCALENDAR",
        "PRODID:-//AI Email Assistant//CN",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        f"UID:{event_uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART:{start_utc}",
        f"DTEND:{end_utc}",
        f"SUMMARY:{summary}",
        f"DESCRIPTION:{clean_desc}",
        f"LOCATION:{location or '线上视频会议'}",
        "STATUS:CONFIRMED",
        f"ORGANIZER;CN={organizer_name or '会议发起人'}:mailto:{organizer_email}",
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "ACTION:DISPLAY",
        "DESCRIPTION:Reminder",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR"
    ]
    return "\r\n".join(ics_lines)

# ==================== API 路由端点 ====================

@router.get("/rooms")
async def get_rooms(
    meeting_date: Optional[str] = Query(None, description="日期 YYYY-MM-DD"),
    start_time: Optional[str] = Query(None, description="开始时间 HH:MM"),
    end_time: Optional[str] = Query(None, description="结束时间 HH:MM"),
    current_user: User = Depends(get_current_user)
):
    """
    获取会议室列表及其实时可用状态
    """
    if meeting_date and start_time and end_time:
        rooms = await oa_meeting_service.get_rooms_status(meeting_date, start_time, end_time)
        return {"rooms": rooms, "date": meeting_date, "time_range": f"{start_time}-{end_time}"}
    else:
        catalog = oa_meeting_service.get_room_catalog()
        return {"rooms": catalog}

@router.post("/rooms/check")
async def check_room_availability(
    req: CheckRoomReq,
    current_user: User = Depends(get_current_user)
):
    """
    精确探测单个物理会议室在指定时段的可用情况
    """
    is_avail, msg = await oa_meeting_service.check_room_available(
        room_id=req.room_id,
        meeting_date=req.meeting_date,
        start_time=req.start_time,
        end_time=req.end_time
    )
    return {"room_id": req.room_id, "is_available": is_avail, "message": msg}

@router.get("/contacts")
def search_internal_contacts(
    query: Optional[str] = Query(None, description="按姓名、部门或工号搜索"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    搜索企业内部同事（用于添加钉钉日程内部参会人）
    """
    q = db.query(User).filter(User.dingtalk_userid.isnot(None), User.dingtalk_userid != "")
    if query and query.strip():
        k = f"%{query.strip()}%"
        q = q.filter(
            (User.display_name.ilike(k)) |
            (User.department_name.ilike(k)) |
            (User.job_number.ilike(k)) |
            (User.username.ilike(k))
        )

    users = q.limit(30).all()
    return [
        {
            "id": u.id,
            "name": u.display_name or u.username,
            "userid": u.dingtalk_userid,
            "unionid": u.unionid or "",
            "avatar": u.avatar or "",
            "department": u.department_name or "",
            "job_number": u.job_number or "",
            "mobile": u.mobile or "",
            "email": u.email or ""
        }
        for u in users
    ]

@router.post("/meetings")
async def create_meeting(
    req: CreateMeetingReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建钉钉线上会议日程 + 泛微 OA 会议室静默物理预订 (方案一：协同容错)
    """
    # 1. 检验发起人钉钉身份标识
    union_id = current_user.unionid
    if not union_id and current_user.dingtalk_userid:
        try:
            user_detail = await dingtalk_service.get_user_detail_by_id(current_user.dingtalk_userid)
            union_id = user_detail.get("unionid")
            if union_id:
                current_user.unionid = union_id
                db.commit()
        except Exception as e:
            logger.warning(f"[CalendarAPI] 无法通过 userid 获取 unionid: {e}")

    if not union_id:
        raise HTTPException(
            status_code=400,
            detail="当前用户未绑定钉钉账号或缺少 unionId，无法在钉钉日历中发起日程"
        )

    # 2. 构造起止时间与地点
    start_time_iso = f"{req.meeting_date}T{req.start_time}:00+08:00"
    end_time_iso = f"{req.meeting_date}T{req.end_time}:00+08:00"
    location_display = f"{req.room_name} (线下)" if req.room_name else "钉钉线上视频会议"

    # 3. 将内部参会人员标识解析转化为钉钉日历 V1.0 API 要求的 unionId (双重兜底)
    resolved_attendee_unionids: List[str] = []
    if req.attendee_userids:
        for raw_id in req.attendee_userids:
            if not raw_id:
                continue
            # 本地数据库优先命中匹配 (按 unionid 或 dingtalk_userid)
            matched_user = db.query(User).filter(
                (User.unionid == raw_id) | (User.dingtalk_userid == raw_id)
            ).first()

            if matched_user and matched_user.unionid:
                if matched_user.unionid not in resolved_attendee_unionids:
                    resolved_attendee_unionids.append(matched_user.unionid)
            elif matched_user and matched_user.dingtalk_userid:
                # 本地库存在但缺少 unionid，调用钉钉在线接口补齐
                try:
                    u_detail = await dingtalk_service.get_user_detail_by_id(matched_user.dingtalk_userid)
                    fetched_union_id = u_detail.get("unionid")
                    if fetched_union_id:
                        matched_user.unionid = fetched_union_id
                        db.commit()
                        if fetched_union_id not in resolved_attendee_unionids:
                            resolved_attendee_unionids.append(fetched_union_id)
                    else:
                        resolved_attendee_unionids.append(raw_id)
                except Exception as ex:
                    logger.warning(f"[CalendarAPI] 在线获取员工 {raw_id} unionid 失败: {ex}")
                    resolved_attendee_unionids.append(raw_id)
            else:
                # 本地库未收录（如新入职员工），尝试直接调用钉钉接口解析
                try:
                    u_detail = await dingtalk_service.get_user_detail_by_id(raw_id)
                    fetched_union_id = u_detail.get("unionid")
                    if fetched_union_id:
                        if fetched_union_id not in resolved_attendee_unionids:
                            resolved_attendee_unionids.append(fetched_union_id)
                    else:
                        resolved_attendee_unionids.append(raw_id)
                except Exception:
                    resolved_attendee_unionids.append(raw_id)

    # 4. 优先创建钉钉线上日程 (主事务)
    try:
        dingtalk_resp = await dingtalk_service.create_calendar_event(
            union_id=union_id,
            summary=req.summary,
            start_time_iso=start_time_iso,
            end_time_iso=end_time_iso,
            description=req.description,
            location_name=location_display,
            attendee_userids=resolved_attendee_unionids,
            attendee_mobiles=req.attendee_mobiles,
            enable_video_meeting=req.enable_video_meeting
        )
    except Exception as d_err:
        logger.error(f"[CalendarAPI] 创建钉钉日程失败: {d_err}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"创建钉钉日程失败: {str(d_err)}")

    # 提取钉钉组织者信息与视频会议直达信息 (完全依托官方标准接口)
    organizer_info = dingtalk_resp.get("organizer") or {}
    organizer_name = organizer_info.get("displayName") or getattr(current_user, "display_name", None) or "会议发起人"

    # 提取钉钉视频会议直达链接与会议号
    online_info = dingtalk_resp.get("onlineMeetingInfo") or {}
    video_url = online_info.get("url") or ""
    conference_id = online_info.get("conferenceId") or ""

    # 4. 静默执行泛微 OA 会议室预订 (仅作物理占位，容错处理)
    oa_result = {
        "booked": False,
        "status_type": "none",
        "meetingid": "",
        "requestid": "",
        "message": "未选定物理会议室"
    }
    if req.room_id:
        try:
            logger.info(f"[CalendarAPI] 正在静默向 OA 发起物理会议室预订: Room {req.room_id}")
            booking_res = await oa_meeting_service.quick_book_room(
                room_id=req.room_id,
                name=req.summary,
                meeting_date=req.meeting_date,
                start_time=req.start_time,
                end_time=req.end_time
            )
            oa_result = {
                "booked": booking_res.get("success", False),
                "status_type": booking_res.get("status_type", "failed" if not booking_res.get("success") else "direct_booked"),
                "meetingid": booking_res.get("meetingid", ""),
                "requestid": booking_res.get("requestid", ""),
                "message": booking_res.get("message", "")
            }
        except Exception as oa_err:
            logger.warning(f"[CalendarAPI] OA 静默预约异常（不阻断钉钉日程）: {oa_err}")
            oa_result = {
                "booked": False,
                "status_type": "failed",
                "meetingid": "",
                "requestid": "",
                "message": f"OA 预订遇到异常: {str(oa_err)}"
            }

    # 5. 若配置了邮件同步发送，生成 .ics 并投递
    email_result = {"sent": False, "message": "未勾选邮件通知"}
    if req.send_ics_email and req.attendee_emails and req.email_account_id:
        account = db.query(MailAccount).filter(
            MailAccount.id == req.email_account_id,
            MailAccount.user_id == current_user.id
        ).first()
        if account:
            try:
                real_password = decrypt_secret(account.encrypted_password)
                ics_location = video_url or location_display
                
                desc_parts = [req.description] if req.description else []
                if conference_id:
                    desc_parts.append(f"钉钉视频会议号: {conference_id}")
                if video_url:
                    desc_parts.append(f"入会直达链接: {video_url}")
                full_description = "\n\n".join(desc_parts)

                organizer_display = getattr(account, "name", None) or getattr(current_user, "display_name", None) or getattr(account, "email_address", None) or "会议发起人"

                ics_text = _generate_ics_content(
                    summary=req.summary,
                    description=full_description,
                    location=ics_location,
                    meeting_date=req.meeting_date,
                    start_time=req.start_time,
                    end_time=req.end_time,
                    organizer_email=account.email_address,
                    organizer_name=organizer_display
                )
                ics_attachment = {
                    "filename": "meeting_invite.ics",
                    "content_bytes": ics_text.encode("utf-8"),
                    "content_type": "text/calendar; charset=UTF-8; method=REQUEST"
                }
                
                mail_body = f"""您好，
已为您安排以下会议日程：
- 会议主题：{req.summary}
- 组织者：{organizer_name}
- 会议时间：{req.meeting_date} {req.start_time} - {req.end_time} (GMT+8)
- 会议地点：{location_display}
"""
                if conference_id:
                    mail_body += f"- 钉钉视频会议号：{conference_id}\n"
                if video_url:
                    mail_body += f"- 钉钉视频入会链接：{video_url}\n"
                if req.description:
                    mail_body += f"- 会议详情：{req.description}\n"

                mail_body += "\n请查收随信附带的标准日历文件 (.ics)，双击即可一键导入您的日历系统。"

                for to_mail in req.attendee_emails:
                    if to_mail and "@" in to_mail:
                        build_and_send_smtp_email(
                            smtp_host=account.smtp_host,
                            smtp_port=account.smtp_port,
                            smtp_ssl=account.smtp_ssl,
                            email_address=account.email_address,
                            password=real_password,
                            to_email=to_mail.strip(),
                            subject=f"【会议邀请】{req.summary}",
                            body_text=mail_body,
                            attachments=[ics_attachment]
                        )
                email_result = {"sent": True, "message": f"已向 {len(req.attendee_emails)} 个客户邮箱发送日程邀请与 .ics 附件"}
            except Exception as mail_err:
                logger.error(f"[CalendarAPI] 发送日历邮件失败: {mail_err}")
                email_result = {"sent": False, "message": f"邮件发送失败: {str(mail_err)}"}

    return {
        "success": True,
        "dingtalk_event": dingtalk_resp,
        "organizer_name": organizer_name,
        "video_meeting": {
            "url": video_url,
            "conference_id": conference_id
        },
        "oa_booking": oa_result,
        "email_notice": email_result,
        "message": "钉钉日程创建成功" + (f" (OA会议室: {oa_result['message']})" if req.room_id else "")
    }

@router.post("/extract-proposal")
async def extract_meeting_proposal(
    req: ExtractProposalReq,
    current_user: User = Depends(get_current_user)
):
    """
    使用 AI 从邮件往来或发信正文中智能提取会议提议（主题、起止时间、参会人）
    """
    from app.services.ai_service import ai_service
    result = await ai_service.extract_meeting_proposal(
        content=req.content,
        subject=req.email_subject
    )
    return result
