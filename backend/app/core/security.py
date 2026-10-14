from datetime import datetime, timedelta, timezone
from typing import Optional, Union, Any
from jose import jwt
import bcrypt
from cryptography.fernet import Fernet
import base64
import hashlib
from app.core.config import settings

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        pw_bytes = plain_password.encode("utf-8")[:72]
        return bcrypt.checkpw(pw_bytes, hashed_password.encode("utf-8"))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    pw_bytes = password.encode("utf-8")[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pw_bytes, salt).decode("utf-8")

def create_access_token(subject: Union[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm="HS256")
    return encoded_jwt

# 保证对称密钥格式合法
def _get_fernet_key() -> bytes:
    key_bytes = settings.ENCRYPTION_KEY.encode()
    if len(key_bytes) == 44 and key_bytes.endswith(b'='):
        return key_bytes
    # 如果配置的不标准，做一次sha256哈希并base64转换为标准的32字节Fernet key
    digest = hashlib.sha256(key_bytes).digest()
    return base64.urlsafe_b64encode(digest)

def encrypt_secret(plain_text: str) -> str:
    if not plain_text:
        return ""
    f = Fernet(_get_fernet_key())
    return f.encrypt(plain_text.encode("utf-8")).decode("utf-8")

def decrypt_secret(encrypted_text: str) -> str:
    if not encrypted_text:
        return ""
    f = Fernet(_get_fernet_key())
    try:
        return f.decrypt(encrypted_text.encode("utf-8")).decode("utf-8")
    except Exception:
        return ""
