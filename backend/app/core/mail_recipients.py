"""Shared recipient validation; no database or network dependencies."""
import re
from typing import Tuple


_MAILBOX = re.compile(
    r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
    r"@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
)


def normalize_recipients(to: str, cc: str = "", bcc: str = "") -> Tuple[str, str, str]:
    """Accept comma/semicolon separated mailboxes, deduplicate To > Cc > Bcc."""
    seen = set()
    groups = []
    for label, value in (("收件人", to), ("抄送", cc), ("密送", bcc)):
        if "\r" in value or "\n" in value:
            raise ValueError(f"{label}地址不能包含换行")
        addresses = []
        for item in re.split(r'[,;，；](?=(?:[^"]*"[^"]*")*[^"]*$)', value):
            address = item.strip()
            if not address:
                continue
            # Also accept simple display names from existing reply/Stream callers.
            if "<" in address or ">" in address:
                match = re.fullmatch(r'[^<>@]+<([^<>]+)>', address)
                if not match:
                    raise ValueError(f"{label}邮箱格式不正确")
                address = match.group(1).strip()
            if not _MAILBOX.fullmatch(address):
                raise ValueError(f"{label}邮箱格式不正确，请用逗号或分号分隔邮箱地址")
            local, domain = address.rsplit("@", 1)
            address = f"{local}@{domain.lower()}"
            if address not in seen:
                seen.add(address)
                addresses.append(address)
        groups.append(", ".join(addresses))
    if not groups[0]:
        raise ValueError("请输入收件人邮箱地址")
    return tuple(groups)
