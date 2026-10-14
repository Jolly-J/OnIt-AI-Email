import os
import secrets
from cryptography.fernet import Fernet
from pydantic_settings import BaseSettings

_ephemeral_secret_key = secrets.token_urlsafe(32)
_ephemeral_encryption_key = Fernet.generate_key().decode()

class Settings(BaseSettings):
    # API 与环境配置
    PROJECT_NAME: str = "AI Email Assistant"
    API_V1_STR: str = "/api"
    SECRET_KEY: str = os.getenv("SECRET_KEY", "") or _ephemeral_secret_key
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7天
    
    # 前端应用访问基础地址 (用于钉钉卡片 AppLink 跳转)
    APP_BASE_URL: str = os.getenv("APP_BASE_URL", "http://127.0.0.1:4667")
    
    # 数据库配置 (SQLite)
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./email_assistant.db")
    
    # 邮箱凭据对称加密秘钥 (32-urlsafe base64 key)
    # 若环境变量未配置，则自动生成临时会话密钥（生产环境必须在 .env 中显式固定配置）
    ENCRYPTION_KEY: str = os.getenv("ENCRYPTION_KEY", "") or _ephemeral_encryption_key
    
    # 企业中英文名称与域名 (用于 AI 商务拟稿、落款署名与日历日程生产商标识)
    COMPANY_NAME: str = os.getenv("COMPANY_NAME", "知了智能科技有限公司")
    COMPANY_NAME_EN: str = os.getenv("COMPANY_NAME_EN", "Zhiliao Tech Co., Ltd.")
    COMPANY_DOMAIN: str = os.getenv("COMPANY_DOMAIN", "example.com")
    
    # Mock 体验模式开关 (未配置钉钉开放平台时默认自动开启快速体验)
    MOCK_MODE: bool = os.getenv("MOCK_MODE", "false").lower() in ("true", "1", "yes")

    # DeepSeek API 配置
    DEEPSEEK_API_KEY: str = os.getenv("DEEPSEEK_API_KEY", "")
    DEEPSEEK_BASE_URL: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    DEEPSEEK_MODEL: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    
    # 邮件后台轮询检测间隔（秒）：高频轻量探针，10秒快速感知新邮件
    POLL_INTERVAL_SECONDS: int = int(os.getenv("POLL_INTERVAL_SECONDS", "10"))

    # 钉钉开放平台配置（从环境变量加载，默认留空供安全开源）
    DINGTALK_CLIENT_ID: str = os.getenv("DINGTALK_CLIENT_ID", "")
    DINGTALK_CLIENT_SECRET: str = os.getenv("DINGTALK_CLIENT_SECRET", "")
    DINGTALK_CORP_ID: str = os.getenv("DINGTALK_CORP_ID", "")
    DINGTALK_AGENT_ID: str = os.getenv("DINGTALK_AGENT_ID", "")
    # 超级管理员钉钉 userid 列表（英文逗号隔开）
    DINGTALK_ADMIN_USERIDS: str = os.getenv("DINGTALK_ADMIN_USERIDS", "")
    # 钉钉互动卡片模板 ID
    DINGTALK_CARD_TEMPLATE_ID: str = os.getenv("DINGTALK_CARD_TEMPLATE_ID", "")
    # 钉钉机器人 Code（默认可与 Client ID 一致）
    DINGTALK_ROBOT_CODE: str = os.getenv("DINGTALK_ROBOT_CODE", "")

    # 泛微 OA 会议室对接配置（可选，从环境变量加载）
    OA_BASE_URL: str = os.getenv("OA_BASE_URL", "")
    OA_AUTH_USERNAME: str = os.getenv("OA_AUTH_USERNAME", "")
    OA_AUTH_PASSWORD: str = os.getenv("OA_AUTH_PASSWORD", "")
    OA_ROOMS_JSON: str = os.getenv("OA_ROOMS_JSON", "")

    # 超大附件存储与 7 天有效期配置
    LARGE_ATTACHMENT_EXPIRE_DAYS: int = int(os.getenv("LARGE_ATTACHMENT_EXPIRE_DAYS", "7"))
    LARGE_ATTACHMENT_DIR: str = os.getenv(
        "LARGE_ATTACHMENT_DIR",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../data/large_attachments"))
    )
    # 对外公开基础链接 (生成下载直链用，优先读取 PUBLIC_BASE_URL，若无则回退到 APP_BASE_URL)
    PUBLIC_BASE_URL: str = os.getenv("PUBLIC_BASE_URL", "")

    # 大文件下载速率限制 (KB/s，默认 3072 即 3MB/s，平衡下载体验与服务器总带宽防护)
    DOWNLOAD_RATE_LIMIT_KB: int = int(os.getenv("DOWNLOAD_RATE_LIMIT_KB", "3072"))
    # 单个客户端 IP 最大并发下载连接数 (默认 2，拦截多线程下载器恶意抢占带宽)
    DOWNLOAD_MAX_CONCURRENT_PER_IP: int = int(os.getenv("DOWNLOAD_MAX_CONCURRENT_PER_IP", "2"))

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
os.makedirs(settings.LARGE_ATTACHMENT_DIR, exist_ok=True)

