import json
from typing import Optional
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.core.database import Base

class MailAccount(Base):
    __tablename__ = "mail_accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    provider = Column(String(32), default="aliyun_enterprise") # aliyun_enterprise, qq, 163, etc.
    name = Column(String(64), default="") # 显示别名，如：我的工作邮箱
    email_address = Column(String(128), nullable=False)
    encrypted_password = Column(String(255), nullable=False) # 授权码 AES 加密存储
    
    # IMAP 配置
    imap_host = Column(String(128), nullable=False)
    imap_port = Column(Integer, default=993)
    imap_ssl = Column(Boolean, default=True)
    
    # SMTP 配置
    smtp_host = Column(String(128), nullable=False)
    smtp_port = Column(Integer, default=465)
    smtp_ssl = Column(Boolean, default=True)

    is_active = Column(Boolean, default=True) # 是否开启后台自动监听
    last_sync_at = Column(DateTime, nullable=True)
    last_uid = Column(String(64), default="0")
    folder_uids_json = Column(Text, default="{}")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="accounts")
    emails = relationship("EmailRecord", back_populates="account")

    @property
    def account_name(self) -> str:
        """兼容别名：支持 account.account_name 与 account.name 互通访问"""
        return self.name or self.email_address

    @property
    def display_name(self) -> str:
        """兼容别名：支持 account.display_name 与 account.name 互通访问"""
        return self.name or self.email_address

    def get_folder_last_uid(self, folder_type: str = "inbox") -> str:
        try:
            mapping = json.loads(self.folder_uids_json or "{}")
            if folder_type in mapping:
                val = mapping[folder_type]
                if isinstance(val, dict):
                    return str(val.get("max", "0"))
                return str(val)
        except Exception:
            pass
        if folder_type == "inbox":
            return self.last_uid or "0"
        return "0"

    def get_folder_min_uid(self, folder_type: str = "inbox") -> Optional[str]:
        try:
            mapping = json.loads(self.folder_uids_json or "{}")
            if folder_type in mapping:
                val = mapping[folder_type]
                if isinstance(val, dict) and "min" in val:
                    return str(val["min"])
        except Exception:
            pass
        return None

    def set_folder_uids(self, folder_type: str, max_uid: Optional[str] = None, min_uid: Optional[str] = None):
        try:
            mapping = json.loads(self.folder_uids_json or "{}")
        except Exception:
            mapping = {}

        current = mapping.get(folder_type)
        if isinstance(current, dict):
            target = current
        elif current is not None:
            target = {"max": str(current), "min": str(current)}
        else:
            target = {}

        if max_uid is not None:
            # 如果已有 max，取两者的较大值
            old_max = int(target.get("max", 0)) if str(target.get("max", "0")).isdigit() else 0
            new_max = int(max_uid) if str(max_uid).isdigit() else 0
            target["max"] = str(max(old_max, new_max))
        if min_uid is not None:
            # 如果已有 min，取两者的较小值
            old_min = int(target.get("min", 0)) if str(target.get("min", "0")).isdigit() else 0
            new_min = int(min_uid) if str(min_uid).isdigit() else 0
            if old_min == 0:
                target["min"] = str(new_min)
            elif new_min > 0:
                target["min"] = str(min(old_min, new_min))

        mapping[folder_type] = target
        self.folder_uids_json = json.dumps(mapping, ensure_ascii=False)
        if folder_type == "inbox" and "max" in target:
            self.last_uid = str(target["max"])

    def set_folder_last_uid(self, folder_type: str, uid: str):
        self.set_folder_uids(folder_type, max_uid=uid)

