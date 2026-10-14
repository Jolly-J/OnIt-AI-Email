from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base

class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("email_records.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    role = Column(String(16), nullable=False) # 'user' or 'assistant'
    content = Column(Text, nullable=False)
    draft_reply = Column(Text, default="") # 外语回复草稿（或中文邮件草稿）
    draft_reply_zh = Column(Text, default="") # 与外语草稿严格 1:1 对应的完整中文商务公文
    explanation = Column(Text, default="") # 本轮回信表达的内容对照与商务策略要点说明
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    email = relationship("EmailRecord", back_populates="messages")
