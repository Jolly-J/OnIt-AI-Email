import uuid
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pydantic import BaseModel

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, get_password_hash
from app.models.user import User
from app.api.auth import get_current_user
from app.services.dingtalk_service import dingtalk_service

router = APIRouter(tags=["钉钉集成与管理"])

class DingTalkLoginReq(BaseModel):
    code: str
    mode: str = "internal" # "internal" (免登) | "qr" (扫码)

class UserAccessUpdateReq(BaseModel):
    is_active: bool

class UserAdminUpdateReq(BaseModel):
    is_admin: bool

@router.get("/auth/dingtalk/config")
def get_dingtalk_public_config():
    """获取钉钉客户端公开配置与 Mock 演示模式状态（供前端动态渲染）"""
    is_mock_enabled = settings.MOCK_MODE or not bool(settings.DINGTALK_CLIENT_ID.strip())
    return {
        "client_id": "" if settings.MOCK_MODE else settings.DINGTALK_CLIENT_ID.strip(),
        "corp_id": "" if settings.MOCK_MODE else settings.DINGTALK_CORP_ID.strip(),
        "mock_enabled": is_mock_enabled,
        "mock_mode": settings.MOCK_MODE
    }

@router.post("/auth/dingtalk/login")
async def dingtalk_login(req: DingTalkLoginReq, db: Session = Depends(get_db)):
    """钉钉免登与扫码统一登录换票接口"""
    code = req.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="缺少认证授权码 code")

    try:
        if req.mode == "internal":
            ding_user = await dingtalk_service.get_user_by_internal_code(code)
        else:
            ding_user = await dingtalk_service.get_user_by_qr_code(code)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    userid = str(ding_user.get("userid", "")).strip()
    name = str(ding_user.get("name", "")).strip() or "钉钉员工"
    avatar = str(ding_user.get("avatar", "")).strip()
    unionid = str(ding_user.get("unionid", "")).strip()
    mobile = str(ding_user.get("mobile", "")).strip()
    email = str(ding_user.get("email", "")).strip()
    job_number = str(ding_user.get("job_number", "")).strip()
    title = str(ding_user.get("title", "")).strip()

    # 判断是否属于管理员清单
    admin_uids = [u.strip() for u in settings.DINGTALK_ADMIN_USERIDS.split(",") if u.strip()]
    is_configured_admin = userid in admin_uids

    # 查库匹配
    user = db.query(User).filter(User.dingtalk_userid == userid).first()

    # 初始超级管理员判断：如果数据库没有任何管理员，首位登录者自动获得系统管理权限
    total_admins = db.query(User).filter(User.is_admin == True).count()
    should_be_first_admin = (total_admins == 0)

    if not user:
        # 尝试通过 unionid 匹配
        if unionid:
            user = db.query(User).filter(User.unionid == unionid).first()

    if not user:
        # 新员工首次登录建档
        is_admin = is_configured_admin or should_be_first_admin
        is_active = is_admin  # 如果是管理员则自动开通权限，否则默认待授权

        user = User(
            username=f"dd_{userid}",
            hashed_password=get_password_hash(uuid.uuid4().hex),
            display_name=name,
            dingtalk_userid=userid,
            unionid=unionid,
            avatar=avatar,
            mobile=mobile,
            email=email,
            job_number=job_number,
            department_name=title,
            is_admin=is_admin,
            is_active=is_active
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        # 更新最新资料
        user.display_name = name
        user.avatar = avatar or user.avatar
        user.mobile = mobile or user.mobile
        user.email = email or user.email
        user.job_number = job_number or user.job_number
        if title:
            user.department_name = title

        if is_configured_admin or should_be_first_admin:
            user.is_admin = True
            user.is_active = True

        db.commit()
        db.refresh(user)

    # 权限准入拦截：没权限的人不允许使用
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您暂未获得本系统使用权限，请联系管理员在后台开通授权。"
        )

    token = create_access_token(subject=user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "avatar": user.avatar,
            "dingtalk_userid": user.dingtalk_userid,
            "is_admin": user.is_admin,
            "is_active": user.is_active,
            "job_number": user.job_number,
            "department_name": user.department_name
        }
    }

# ──────────────────────────────────────────
# 管理员后台接口
# ──────────────────────────────────────────

def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="权限不足，仅系统管理员可访问管理后台"
        )
    return current_user

@router.post("/admin/dingtalk/sync")
async def sync_dingtalk_organization(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """一键递归同步钉钉企业组织与员工通讯录"""
    try:
        org_users = await dingtalk_service.fetch_all_org_users()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"同步企业组织失败: {str(e)}")

    admin_uids = [u.strip() for u in settings.DINGTALK_ADMIN_USERIDS.split(",") if u.strip()]
    added_count = 0
    updated_count = 0

    for item in org_users:
        uid = str(item.get("userid", "")).strip()
        if not uid:
            continue

        name = str(item.get("name", "")).strip() or "钉钉员工"
        avatar = str(item.get("avatar", "")).strip()
        unionid = str(item.get("unionid", "")).strip()
        mobile = str(item.get("mobile", "")).strip()
        email = str(item.get("email", "")).strip()
        job_number = str(item.get("job_number", "")).strip()
        title = str(item.get("title", "")).strip()

        existing = db.query(User).filter(User.dingtalk_userid == uid).first()
        if existing:
            existing.display_name = name
            if avatar:
                existing.avatar = avatar
            if mobile:
                existing.mobile = mobile
            if email:
                existing.email = email
            if job_number:
                existing.job_number = job_number
            if title:
                existing.department_name = title
            if uid in admin_uids:
                existing.is_admin = True
                existing.is_active = True
            updated_count += 1
        else:
            is_admin = (uid in admin_uids)
            # 新同步的用户默认待授权使用
            new_user = User(
                username=f"dd_{uid}",
                hashed_password=get_password_hash(uuid.uuid4().hex),
                display_name=name,
                dingtalk_userid=uid,
                unionid=unionid,
                avatar=avatar,
                mobile=mobile,
                email=email,
                job_number=job_number,
                department_name=title,
                is_admin=is_admin,
                is_active=is_admin
            )
            db.add(new_user)
            added_count += 1

    db.commit()
    return {
        "success": True,
        "message": f"组织通讯录同步完成！新增 {added_count} 人，更新 {updated_count} 人。",
        "total_synced": len(org_users),
        "added_count": added_count,
        "updated_count": updated_count
    }

@router.get("/admin/users")
def list_admin_users(
    keyword: Optional[str] = Query(None),
    status_filter: Optional[str] = Query("all"), # "all" | "active" | "inactive" | "admin"
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """管理员获取企业员工列表与权限状态"""
    query = db.query(User)

    if keyword:
        kw = f"%{keyword.strip()}%"
        query = query.filter(
            or_(
                User.display_name.ilike(kw),
                User.username.ilike(kw),
                User.job_number.ilike(kw),
                User.department_name.ilike(kw),
                User.dingtalk_userid.ilike(kw)
            )
        )

    if status_filter == "active":
        query = query.filter(User.is_active == True)
    elif status_filter == "inactive":
        query = query.filter(User.is_active == False)
    elif status_filter == "admin":
        query = query.filter(User.is_admin == True)

    users = query.order_by(User.is_admin.desc(), User.is_active.desc(), User.id.asc()).all()

    return [
        {
            "id": u.id,
            "username": u.username or "",
            "display_name": u.display_name or u.username or "员工",
            "avatar": u.avatar or "",
            "dingtalk_userid": u.dingtalk_userid or "",
            "mobile": u.mobile or "",
            "email": u.email or "",
            "job_number": u.job_number or "",
            "department_name": u.department_name or "",
            "is_admin": bool(u.is_admin),
            "is_active": bool(u.is_active),
            "created_at": u.created_at.isoformat() if u.created_at else None
        }
        for u in users
    ]

@router.put("/admin/users/{user_id}/access")
def toggle_user_access(
    user_id: int,
    req: UserAccessUpdateReq,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """切换员工系统使用权限（开通/禁用）"""
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="员工不存在")

    if target_user.id == admin.id and not req.is_active:
        raise HTTPException(status_code=400, detail="当前管理员不可关闭自己的使用权限")

    target_user.is_active = req.is_active
    db.commit()
    return {"id": target_user.id, "is_active": target_user.is_active}

@router.put("/admin/users/{user_id}/admin")
def toggle_user_admin(
    user_id: int,
    req: UserAdminUpdateReq,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """切换管理员权限"""
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="员工不存在")

    if target_user.id == admin.id and not req.is_admin:
        raise HTTPException(status_code=400, detail="不可撤销当前登录账号的管理员角色")

    if not req.is_admin:
        # 保证系统至少保留一位管理员
        admin_count = db.query(User).filter(User.is_admin == True).count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="系统必须至少保留一名管理员")

    target_user.is_admin = req.is_admin
    # 若被赋予管理员，自动确保其有系统使用权限
    if req.is_admin:
        target_user.is_active = True

    db.commit()
    return {"id": target_user.id, "is_admin": target_user.is_admin}
