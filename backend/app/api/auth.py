import json
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel
from jose import JWTError, jwt

from app.core.config import settings
from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token, encrypt_secret
from app.models.user import User
from app.models.account import MailAccount
from app.models.email import EmailRecord

router = APIRouter(prefix="/auth", tags=["认证"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")

class UserRegisterReq(BaseModel):
    username: str
    password: str
    display_name: str = ""

class UserLoginReq(BaseModel):
    username: str
    password: str

class TokenResp(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="登录凭据无效或已过期，请重新登录",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        raise credentials_exception

    # 校验使用权限：若已被管理员禁用，阻断访问
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您的系统使用权限已被管理员关闭，请联系管理员开通。"
        )

    return user

@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "display_name": current_user.display_name,
        "avatar": current_user.avatar,
        "dingtalk_userid": current_user.dingtalk_userid,
        "job_number": current_user.job_number,
        "department_name": current_user.department_name,
        "is_admin": current_user.is_admin,
        "is_active": current_user.is_active,
        "created_at": current_user.created_at.isoformat() if current_user.created_at else ""
    }

from app.core.mock_data import init_mock_database

@router.post("/mock-login", response_model=TokenResp)
def mock_login(db: Session = Depends(get_db)):
    """Mock 模式一键体验登录（免钉钉配置即可快速体验）"""
    is_mock_allowed = settings.MOCK_MODE or not bool(settings.DINGTALK_CLIENT_ID.strip())
    if not is_mock_allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前已配置钉钉企业应用凭据，请使用钉钉客户端或扫码登录"
        )

    user = None
    try:
        user = db.query(User).filter(User.username == "demo_admin").first()
    except Exception:
        db.rollback()
        user = None

    if not user:
        init_mock_database(db)
        user = db.query(User).filter(User.username == "demo_admin").first()

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
            "job_number": user.job_number,
            "department_name": user.department_name,
            "is_admin": user.is_admin,
            "is_active": user.is_active
        }
    }
