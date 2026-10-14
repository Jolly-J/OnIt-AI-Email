import os
import sys
import re
import time
import logging
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

# ==================== 路径与常量定义 ====================
# 项目根目录（backend 的上一级：/Users/Python/邮箱助手agent 或宝塔根目录）
CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent.parent.parent
LOG_DIR = Path(os.environ.get("LOG_DIR", PROJECT_ROOT / "logs"))

# 敏感字段过滤关键字（防公测泄露凭证，支持带引号与不带引号）
SENSITIVE_PATTERNS = [
    r'((?:password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|auth_code|authorization)[\'"]?\s*[:=]\s*[\'"])([^\'"\s]+)([\'"])',
    r'((?:password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|auth_code|authorization)\s*[:=]\s*)([^\s,;&"\']+)',
]

class SensitiveDataFilter(logging.Filter):
    """敏感信息自动脱敏过滤器"""
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            for pattern in SENSITIVE_PATTERNS:
                record.msg = re.sub(pattern, r'\1[REDACTED]', record.msg, flags=re.IGNORECASE)
        return True

class ColoredConsoleFormatter(logging.Formatter):
    """终端彩色高亮格式化器（中文友好、按级别着色）"""
    COLOR_MAP = {
        logging.DEBUG: "\033[90m",    # 灰色
        logging.INFO: "\033[32m",     # 绿色
        logging.WARNING: "\033[33m",  # 黄色
        logging.ERROR: "\033[31m",    # 红色
        logging.CRITICAL: "\033[35m", # 紫色
    }
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLOR_MAP.get(record.levelno, self.RESET)
        time_str = self.formatTime(record, "%Y-%m-%d %H:%M:%S")
        level_name = record.levelname.ljust(5)
        tag = f"{color}{self.BOLD}[{level_name}]{self.RESET}"
        name_tag = f"{self.DIM}[{record.name}]{self.RESET}"
        msg = record.getMessage()

        res = f"{self.DIM}{time_str}{self.RESET} {tag} {name_tag} {msg}"
        if record.exc_info:
            if not record.exc_text:
                record.exc_text = self.formatException(record.exc_info)
            if record.exc_text:
                res += f"\n{color}{record.exc_text}{self.RESET}"
        return res

def setup_logger(name: str = "email_assistant") -> logging.Logger:
    """初始化并配置日志记录器"""
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    app_logger = logging.getLogger(name)
    app_logger.setLevel(logging.INFO)

    # 避免重复挂载 handler
    if app_logger.handlers:
        return app_logger

    app_logger.addFilter(SensitiveDataFilter())

    # 1. 终端彩色输出 Handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(ColoredConsoleFormatter())
    app_logger.addHandler(console_handler)

    # 2. 全量日志文件 Handler (logs/app.log)，按天切割，保留14天
    app_log_path = LOG_DIR / "app.log"
    file_formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    app_file_handler = TimedRotatingFileHandler(
        filename=str(app_log_path),
        when="midnight",
        interval=1,
        backupCount=14,
        encoding="utf-8"
    )
    app_file_handler.setLevel(logging.INFO)
    app_file_handler.setFormatter(file_formatter)
    app_logger.addHandler(app_file_handler)

    # 3. 错误专属日志文件 Handler (logs/error.log，方便宝塔面板一键排错)，按天切割，保留30天
    error_log_path = LOG_DIR / "error.log"
    error_file_handler = TimedRotatingFileHandler(
        filename=str(error_log_path),
        when="midnight",
        interval=1,
        backupCount=30,
        encoding="utf-8"
    )
    error_file_handler.setLevel(logging.WARNING)
    error_file_handler.setFormatter(file_formatter)
    app_logger.addHandler(error_file_handler)

    # 4. 拦截 uvicorn 访问日志重定向
    uvicorn_logger = logging.getLogger("uvicorn.error")
    uvicorn_logger.handlers = app_logger.handlers

    return app_logger

# 全局默认 logger 实例
logger = setup_logger()
