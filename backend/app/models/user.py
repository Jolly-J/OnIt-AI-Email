from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.orm import relationship
from app.core.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    display_name = Column(String(64), default="")
    dingtalk_userid = Column(String(64), nullable=True, index=True) # 钉钉员工 userid
    unionid = Column(String(64), nullable=True, index=True) # 钉钉全局 unionid
    avatar = Column(String(512), default="") # 钉钉头像
    mobile = Column(String(32), default="")
    email = Column(String(128), default="")
    job_number = Column(String(64), default="") # 员工工号
    department_id = Column(String(64), nullable=True)
    department_name = Column(String(128), default="") # 所在部门
    is_admin = Column(Boolean, default=False) # 是否为系统管理员
    is_active = Column(Boolean, default=False) # 系统使用权限：True 允许登录使用，False 阻断拦截
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    accounts = relationship("MailAccount", back_populates="user")
    emails = relationship("EmailRecord", back_populates="user")
