import email.utils
from datetime import datetime, timezone
from typing import Optional

def format_iso_utc(dt: Optional[datetime]) -> Optional[str]:
    """
    将数据库中存储的 datetime（可能是 naive datetime，但物理代表 UTC）
    安全补充 UTC 时区并序列化为标准带时区偏移量的 ISO 8601 字符串。
    如果 dt 为 None 则返回 None。
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat()

def normalize_email_date(raw_date_str: str) -> str:
    """
    解析外部邮件标头的 Date 字符串（符合 RFC 2822 等规范），
    将其统一归一化为标准的 UTC ISO 8601 格式字符串以便入库与跨端解析。
    若传入为空或解析失败，则做健壮性兜底。
    """
    if not raw_date_str:
        return datetime.now(timezone.utc).isoformat()

    clean_str = raw_date_str.strip()
    try:
        dt = email.utils.parsedate_to_datetime(clean_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.isoformat()
    except Exception:
        return clean_str
