from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import encrypt_secret, decrypt_secret
from app.models.user import User
from app.models.account import MailAccount
from app.api.auth import get_current_user
from app.core.limiter import limiter_account_test
from app.services.mail_service import PROVIDER_PRESETS, test_mail_connection
from app.services.scheduler import sync_single_account, account_sync_lock
from app.core.datetime_util import format_iso_utc

router = APIRouter(prefix="/accounts", tags=["邮箱配置"])

class AccountCreateReq(BaseModel):
    provider: str = "aliyun_enterprise"
    name: str = ""
    email_address: str
    password: str # 授权码/客户端密码
    imap_host: str
    imap_port: int = 993
    imap_ssl: bool = True
    smtp_host: str
    smtp_port: int = 465
    smtp_ssl: bool = True
    is_active: bool = True

class AccountTestReq(BaseModel):
    email_address: str
    password: str
    imap_host: str
    imap_port: int = 993
    imap_ssl: bool = True
    smtp_host: str
    smtp_port: int = 465
    smtp_ssl: bool = True

@router.get("/presets")
def get_presets():
    """获取支持的主流邮箱服务商预设列表"""
    return PROVIDER_PRESETS

@router.get("")
def list_accounts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取当前员工绑定的所有邮箱"""
    accounts = db.query(MailAccount).filter(MailAccount.user_id == current_user.id).all()
    res = []
    for acc in accounts:
        res.append({
            "id": acc.id,
            "provider": acc.provider,
            "name": acc.name or acc.email_address,
            "email_address": acc.email_address,
            "imap_host": acc.imap_host,
            "imap_port": acc.imap_port,
            "smtp_host": acc.smtp_host,
            "smtp_port": acc.smtp_port,
            "is_active": acc.is_active,
            "last_sync_at": format_iso_utc(acc.last_sync_at),
            "created_at": format_iso_utc(acc.created_at)
        })
    return res

@router.post("/test", dependencies=[Depends(limiter_account_test)])
def test_connection(
    req: AccountTestReq,
    current_user: User = Depends(get_current_user)
):
    """一键测试邮箱 IMAP/SMTP 连通性"""
    success, message = test_mail_connection(
        imap_host=req.imap_host,
        imap_port=req.imap_port,
        imap_ssl=req.imap_ssl,
        smtp_host=req.smtp_host,
        smtp_port=req.smtp_port,
        smtp_ssl=req.smtp_ssl,
        email_address=req.email_address.strip(),
        password=req.password.strip()
    )
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"success": True, "message": message}

@router.post("")
def create_account(
    req: AccountCreateReq,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """绑定新邮箱"""
    # 先做一次连通性校验，避免保存错误账密
    ok, msg = test_mail_connection(
        imap_host=req.imap_host,
        imap_port=req.imap_port,
        imap_ssl=req.imap_ssl,
        smtp_host=req.smtp_host,
        smtp_port=req.smtp_port,
        smtp_ssl=req.smtp_ssl,
        email_address=req.email_address.strip(),
        password=req.password.strip()
    )
    if not ok:
        raise HTTPException(status_code=400, detail=f"邮箱验证失败: {msg}")

    account = MailAccount(
        user_id=current_user.id,
        provider=req.provider,
        name=req.name.strip() or req.email_address.strip(),
        email_address=req.email_address.strip(),
        encrypted_password=encrypt_secret(req.password.strip()),
        imap_host=req.imap_host.strip(),
        imap_port=req.imap_port,
        imap_ssl=req.imap_ssl,
        smtp_host=req.smtp_host.strip(),
        smtp_port=req.smtp_port,
        smtp_ssl=req.smtp_ssl,
        is_active=req.is_active
    )
    db.add(account)
    db.commit()
    db.refresh(account)

    # 异步在后台立即触发首次同步（标记为 initial，绝对不推钉钉卡片）
    background_tasks.add_task(sync_single_account, account.id, trigger_source="initial")

    return {
        "id": account.id,
        "name": account.name,
        "email_address": account.email_address,
        "message": "邮箱绑定成功，正在后台为您同步最新邮件！"
    }

@router.delete("/{account_id}")
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """解绑并删除邮箱"""
    account = db.query(MailAccount).filter(
        MailAccount.id == account_id,
        MailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="邮箱不存在")
    db.delete(account)
    db.commit()
    return {"message": "邮箱已成功解绑"}

@router.post("/{account_id}/sync")
def trigger_sync(
    account_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """手动触发单邮箱即时拉取（标记为 manual，绝对不推钉钉卡片）"""
    account = db.query(MailAccount).filter(
        MailAccount.id == account_id,
        MailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="邮箱不存在")

    if account_sync_lock.is_syncing(account.id):
        return {"message": "该邮箱当前正在同步中，请稍候...", "status": "already_syncing"}

    background_tasks.add_task(sync_single_account, account.id, trigger_source="manual")
    return {"message": "已触发即时同步，请稍候刷新邮件列表", "status": "ok"}

class AccountUpdateNameReq(BaseModel):
    name: str

@router.put("/{account_id}/name")
def update_account_name(
    account_id: int,
    req: AccountUpdateNameReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """修改邮箱显示别名"""
    account = db.query(MailAccount).filter(
        MailAccount.id == account_id,
        MailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="邮箱不存在")

    account.name = req.name.strip() or account.email_address
    db.commit()
    db.refresh(account)

    return {
        "id": account.id,
        "name": account.name,
        "email_address": account.email_address,
        "message": "邮箱别名已成功更新！"
    }
