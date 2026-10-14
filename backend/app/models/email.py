from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base

class EmailRecord(Base):
    __tablename__ = "email_records"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("mail_accounts.id"), nullable=False)
    
    uid = Column(String(64), index=True)
    message_id = Column(String(255), index=True)
    subject = Column(String(512), default="无主题")
    sender = Column(String(255), nullable=False)
    to_recipients = Column(Text, default="")
    cc_recipients = Column(Text, default="")
    bcc_recipients = Column(Text, default="")
    sent_date = Column(String(64), default="")
    
    body_text = Column(Text, default="")
    body_html = Column(Text, default="")
    
    # AI 分析字段
    language_detected = Column(String(32), default="zh")
    summary_zh = Column(Text, default="") # 中文核心摘要
    key_points_json = Column(Text, default="[]") # 中文核心要点列表 JSON
    action_items_json = Column(Text, default="[]") # 对方诉求与待办列表 JSON
    ai_guided_question = Column(Text, default="") # AI主动向员工提出的引导性问题
    initial_reply_draft = Column(Text, default="") # AI 初步建议的专业回复草稿
    
    is_read = Column(Boolean, default=False)
    folder = Column(String(32), default="inbox", index=True) # inbox, sent, drafts, trash
    status = Column(String(32), default="inbox") # inbox (收件箱), replied (已回复), archived (已归档)
    # 钉钉互动卡片关联字段
    dingtalk_card_out_track_id = Column(String(128), index=True, nullable=True) # 卡片实例 outTrackId
    dingtalk_card_status = Column(String(32), default="none") # none, delivered, replied, failed
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="emails")
    account = relationship("MailAccount", back_populates="emails")
    messages = relationship("ChatMessage", back_populates="email")
