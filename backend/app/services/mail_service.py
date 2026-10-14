import imaplib
import smtplib
import email
from email.header import decode_header, Header
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from email.policy import SMTP
from email.utils import formatdate, make_msgid
from typing import List, Dict, Any, Optional, Tuple
import re
import base64
import time
from bs4 import BeautifulSoup
from app.core.logger import logger
from app.core.datetime_util import normalize_email_date
from app.core.mail_recipients import normalize_recipients

# 主流邮箱服务商预设
PROVIDER_PRESETS = {
    "aliyun_enterprise": {
        "name": "阿里企业邮箱",
        "imap_host": "imap.qiye.aliyun.com",
        "imap_port": 993,
        "imap_ssl": True,
        "smtp_host": "smtp.qiye.aliyun.com",
        "smtp_port": 465,
        "smtp_ssl": True,
        "tips": "请使用阿里企业邮箱地址与客户端专有密码/授权码"
    },
    "aliyun_personal": {
        "name": "阿里个人邮箱",
        "imap_host": "imap.aliyun.com",
        "imap_port": 993,
        "imap_ssl": True,
        "smtp_host": "smtp.aliyun.com",
        "smtp_port": 465,
        "smtp_ssl": True,
        "tips": "请在网页邮箱设置中开启 IMAP/SMTP 服务并获取授权码"
    },
    "qq": {
        "name": "QQ 邮箱",
        "imap_host": "imap.qq.com",
        "imap_port": 993,
        "imap_ssl": True,
        "smtp_host": "smtp.qq.com",
        "smtp_port": 465,
        "smtp_ssl": True,
        "tips": "请在 QQ 邮箱设置 -> 账户中开启 POP3/IMAP/SMTP 服务并生成授权码"
    },
    "tencent_enterprise": {
        "name": "腾讯企业邮",
        "imap_host": "imap.exmail.qq.com",
        "imap_port": 993,
        "imap_ssl": True,
        "smtp_host": "smtp.exmail.qq.com",
        "smtp_port": 465,
        "smtp_ssl": True,
        "tips": "请在企业微信/腾讯企业邮设置中生成客户端专用密码"
    },
    "163": {
        "name": "网易 163 邮箱",
        "imap_host": "imap.163.com",
        "imap_port": 993,
        "imap_ssl": True,
        "smtp_host": "smtp.163.com",
        "smtp_port": 465,
        "smtp_ssl": True,
        "tips": "请在网易邮箱设置 -> POP3/SMTP/IMAP 中开启服务并新增授权密码"
    },
    "126": {
        "name": "网易 126 邮箱",
        "imap_host": "imap.126.com",
        "imap_port": 993,
        "imap_ssl": True,
        "smtp_host": "smtp.126.com",
        "smtp_port": 465,
        "smtp_ssl": True,
        "tips": "请在网易邮箱设置中开启服务并使用客户端授权密码"
    },
    "custom": {
        "name": "自定义企业邮箱",
        "imap_host": "",
        "imap_port": 993,
        "imap_ssl": True,
        "smtp_host": "",
        "smtp_port": 465,
        "smtp_ssl": True,
        "tips": "请填写公司管理员提供的邮件服务器地址与端口"
    }
}

def decode_mime_header(header_str: str) -> str:
    """安全解码 MIME 邮件头"""
    if not header_str:
        return ""
    try:
        decoded_fragments = decode_header(header_str)
        result = []
        for fragment, encoding in decoded_fragments:
            if isinstance(fragment, bytes):
                try:
                    enc = encoding or "utf-8"
                    result.append(fragment.decode(enc, errors="replace"))
                except Exception:
                    result.append(fragment.decode("utf-8", errors="replace"))
            else:
                result.append(str(fragment))
        return "".join(result)
    except Exception:
        return str(header_str)

def clean_html_to_text(html_content: str) -> str:
    """提取 HTML 中的正文纯文本"""
    if not html_content:
        return ""
    try:
        soup = BeautifulSoup(html_content, "html.parser")
        # 移除 scripts 与 styles
        for s in soup(["script", "style"]):
            s.decompose()
        text = soup.get_text(separator="\n")
        # 去掉多余连续空行
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        return "\n".join(lines)
    except Exception:
        return html_content

def parse_email_message(raw_email_bytes: bytes, uid: str) -> Dict[str, Any]:
    """解析邮件二进制内容为结构化字典"""
    msg = email.message_from_bytes(raw_email_bytes)
    
    subject = decode_mime_header(msg.get("Subject", "无主题"))
    sender = decode_mime_header(msg.get("From", ""))
    to_recipients = decode_mime_header(msg.get("To", ""))
    cc_recipients = decode_mime_header(msg.get("Cc", ""))
    bcc_recipients = decode_mime_header(msg.get("Bcc", ""))
    raw_date = decode_mime_header(msg.get("Date", ""))
    sent_date = normalize_email_date(raw_date)
    message_id = msg.get("Message-ID", "")

    body_text = ""
    body_html = ""

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition", ""))
            
            # 跳过附件
            if "attachment" in content_disposition:
                continue

            payload = part.get_payload(decode=True)
            if not payload:
                continue

            charset = part.get_content_charset() or "utf-8"
            try:
                decoded_str = payload.decode(charset, errors="replace")
            except Exception:
                decoded_str = payload.decode("utf-8", errors="replace")

            if content_type == "text/plain" and not body_text:
                body_text = decoded_str
            elif content_type == "text/html" and not body_html:
                body_html = decoded_str
    else:
        content_type = msg.get_content_type()
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            try:
                decoded_str = payload.decode(charset, errors="replace")
            except Exception:
                decoded_str = payload.decode("utf-8", errors="replace")
            
            if content_type == "text/html":
                body_html = decoded_str
            else:
                body_text = decoded_str

    # 如果只有 HTML 没有纯文本，转纯文本
    if not body_text and body_html:
        body_text = clean_html_to_text(body_html)

    return {
        "uid": uid,
        "message_id": message_id,
        "subject": subject,
        "sender": sender,
        "to_recipients": to_recipients,
        "cc_recipients": cc_recipients,
        "bcc_recipients": bcc_recipients,
        "sent_date": sent_date,
        "body_text": body_text,
        "body_html": body_html
    }

def decode_imap_utf7(s: str) -> str:
    """安全解码 IMAP modified UTF-7 文件夹名称 (RFC 3501)"""
    if not s or "&" not in s:
        return s

    known_mappings = {
        "&XfJT0ZOM-": "已发送",
        "&g0l6Pw-": "草稿箱",
        "&XfJWeA-": "已删除",
        "&V4NXPpCu-": "垃圾邮件",
        "&dcSTtQ-": "广告邮件",
        "&XfJSIQ-": "已发",
    }
    for k, v in known_mappings.items():
        if k in s:
            s = s.replace(k, v)
    if "&" not in s:
        return s

    def _replace_m_utf7(match):
        sub = match.group(1)
        if not sub:
            return "&"
        b64_str = sub.replace(",", "/")
        pad = len(b64_str) % 4
        if pad:
            b64_str += "=" * (4 - pad)
        try:
            raw_bytes = base64.b64decode(b64_str)
            return raw_bytes.decode("utf-16-be")
        except Exception:
            return match.group(0)

    try:
        return re.sub(r"&([A-Za-z0-9+,]*)-", _replace_m_utf7, s)
    except Exception:
        return s

def parse_imap_list_line(line: str) -> Tuple[List[str], str, str]:
    """解析 imap.list() 返回的单行数据"""
    match = re.match(r'\((?P<flags>[^)]*)\)\s+"(?P<delim>[^"]+)"\s+(?P<name>.+)', line)
    if match:
        flags = [f.strip().lower() for f in match.group("flags").split() if f.strip()]
        delim = match.group("delim")
        raw_name = match.group("name").strip()
        if raw_name.startswith('"') and raw_name.endswith('"'):
            raw_name = raw_name[1:-1]
        return flags, delim, raw_name
    return [], "/", line

def resolve_imap_folder(imap: imaplib.IMAP4, folder_type: str) -> Optional[str]:
    """
    智能匹配目标文件夹真实的远端名称
    folder_type 支持: 'inbox', 'sent', 'drafts', 'trash'
    """
    if folder_type == "inbox":
        return "INBOX"

    try:
        status, folder_lines = imap.list()
        if status != "OK" or not folder_lines:
            return None

        flag_map = {
            "sent": "\\sent",
            "drafts": "\\drafts",
            "trash": "\\trash",
        }
        target_flag = flag_map.get(folder_type)

        parsed_folders = []
        for f in folder_lines:
            if not f:
                continue
            line_str = f.decode("utf-8", errors="replace") if isinstance(f, bytes) else str(f)
            flags, delim, raw_name = parse_imap_list_line(line_str)
            decoded_name = decode_imap_utf7(raw_name)
            parsed_folders.append((flags, raw_name, decoded_name))

            if target_flag and target_flag in flags:
                return raw_name

        name_keywords = {
            "sent": ["sent messages", "sent items", "sent", "已发送", "已发", "发件箱"],
            "drafts": ["drafts", "draft", "草稿箱", "草稿"],
            "trash": ["trash", "deleted messages", "deleted items", "bin", "已删除", "废纸篓", "垃圾邮件"]
        }
        keywords = name_keywords.get(folder_type, [])

        for flags, raw_name, decoded_name in parsed_folders:
            lower_raw = raw_name.lower()
            lower_dec = decoded_name.lower()
            for kw in keywords:
                if kw == lower_raw or kw == lower_dec or kw in lower_dec:
                    return raw_name

        return None
    except Exception as e:
        logger.warning(f"[MailService] 探测 IMAP 文件夹异常 ({folder_type}): {e}")
        return None

def append_to_sent_folder(
    imap_host: str, imap_port: int, imap_ssl: bool,
    email_address: str, password: str,
    raw_email_bytes: bytes
) -> bool:
    """将已发出的邮件追加保存到远端 IMAP 发件箱"""
    try:
        if imap_ssl:
            imap = imaplib.IMAP4_SSL(imap_host, imap_port, timeout=15)
        else:
            imap = imaplib.IMAP4(imap_host, imap_port, timeout=15)
        imap.login(email_address, password)

        sent_folder = resolve_imap_folder(imap, "sent") or "Sent Messages"
        select_name = f'"{sent_folder}"' if " " in sent_folder and not sent_folder.startswith('"') else sent_folder

        date_time = imaplib.Time2Internaldate(time.time())
        res, _ = imap.append(select_name, "\\Seen", date_time, raw_email_bytes)
        imap.logout()
        return res == "OK"
    except Exception as e:
        logger.warning(f"[MailService] 追加到远端发件箱失败 ({email_address}): {e}")
        return False

def test_mail_connection(
    imap_host: str, imap_port: int, imap_ssl: bool,
    smtp_host: str, smtp_port: int, smtp_ssl: bool,
    email_address: str, password: str
) -> Tuple[bool, str]:
    """测试 IMAP 和 SMTP 连通性与账密有效性"""
    # 1. 测试 IMAP 登录
    try:
        if imap_ssl:
            imap_server = imaplib.IMAP4_SSL(imap_host, imap_port, timeout=10)
        else:
            imap_server = imaplib.IMAP4(imap_host, imap_port, timeout=10)
        imap_server.login(email_address, password)
        imap_server.logout()
    except Exception as e:
        return False, f"IMAP 连接/认证失败: {str(e)}。请检查邮箱地址、授权码及 IMAP 服务器端口。"

    # 2. 测试 SMTP 登录
    try:
        if smtp_ssl:
            smtp_server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10)
        else:
            smtp_server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
            smtp_server.starttls()
        smtp_server.login(email_address, password)
        smtp_server.quit()
    except Exception as e:
        return False, f"SMTP 连接/认证失败: {str(e)}。请检查 SMTP 服务器端口与授权码。"

    return True, "连接成功！IMAP 接收与 SMTP 发送验证均通过。"

def fetch_recent_emails(
    imap_host: str, imap_port: int, imap_ssl: bool,
    email_address: str, password: str,
    last_uid: str = "0",
    limit: int = 15,
    folder_type: str = "inbox"
) -> List[Dict[str, Any]]:
    """拉取特定文件夹中最新未同步的邮件列表"""
    emails = []
    try:
        if imap_ssl:
            imap = imaplib.IMAP4_SSL(imap_host, imap_port, timeout=15)
        else:
            imap = imaplib.IMAP4(imap_host, imap_port, timeout=15)

        imap.login(email_address, password)

        target_folder = resolve_imap_folder(imap, folder_type) or ("INBOX" if folder_type == "inbox" else None)
        if not target_folder:
            logger.info(f"[MailService] 邮箱 {email_address} 未发现对应的 {folder_type} 文件夹，跳过拉取")
            imap.logout()
            return []

        select_name = f'"{target_folder}"' if " " in target_folder and not target_folder.startswith('"') else target_folder
        status, _ = imap.select(select_name, readonly=True)
        if status != "OK":
            status, _ = imap.select(target_folder, readonly=True)
            if status != "OK":
                logger.warning(f"[MailService] 切换文件夹 {target_folder} 失败，跳过")
                imap.logout()
                return []

        # 搜索邮件
        # 如果有 last_uid 且大于 0，搜索 UID 大于 last_uid 的；否则拉取最新的 limit 封
        status, search_data = imap.uid("search", None, "ALL")
        if status != "OK" or not search_data or not search_data[0]:
            imap.logout()
            return []

        all_uids = search_data[0].split()

        try:
            last_uid_int = int(last_uid)
        except ValueError:
            last_uid_int = 0

        new_uids = [u for u in all_uids if int(u) > last_uid_int]

        # 如果是第一次绑定该文件夹，只拉取最新 limit 封，避免初次同步过大
        if last_uid_int == 0:
            target_uids = all_uids[-limit:]
        else:
            target_uids = new_uids[-limit:]

        for u in reversed(target_uids):
            uid_str = u.decode("utf-8")
            res, msg_data = imap.uid("fetch", u, "(RFC822)")
            if res == "OK" and msg_data and msg_data[0]:
                raw_email = msg_data[0][1]
                if isinstance(raw_email, bytes):
                    parsed = parse_email_message(raw_email, uid_str)
                    parsed["folder"] = folder_type
                    emails.append(parsed)

        imap.logout()
    except Exception as e:
        logger.error(f"[MailService] 拉取邮件异常 ({email_address}, folder={folder_type}): {e}", exc_info=True)

    return emails

def fetch_older_emails(
    imap_host: str, imap_port: int, imap_ssl: bool,
    email_address: str, password: str,
    before_uid: str,
    limit: int = 20,
    folder_type: str = "inbox"
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    向前拉取更早的历史邮件 (UID < before_uid)
    返回: (emails, has_more)
    """
    emails = []
    has_more = False
    try:
        if imap_ssl:
            imap = imaplib.IMAP4_SSL(imap_host, imap_port, timeout=20)
        else:
            imap = imaplib.IMAP4(imap_host, imap_port, timeout=20)

        imap.login(email_address, password)

        target_folder = resolve_imap_folder(imap, folder_type) or ("INBOX" if folder_type == "inbox" else None)
        if not target_folder:
            logger.info(f"[MailService] 邮箱 {email_address} 未发现对应的 {folder_type} 文件夹，跳过历史拉取")
            imap.logout()
            return [], False

        select_name = f'"{target_folder}"' if " " in target_folder and not target_folder.startswith('"') else target_folder
        status, _ = imap.select(select_name, readonly=True)
        if status != "OK":
            status, _ = imap.select(target_folder, readonly=True)
            if status != "OK":
                logger.warning(f"[MailService] 切换文件夹 {target_folder} 失败，跳过历史拉取")
                imap.logout()
                return [], False

        status, search_data = imap.uid("search", None, "ALL")
        if status != "OK" or not search_data or not search_data[0]:
            imap.logout()
            return [], False

        all_uids = search_data[0].split()

        try:
            before_uid_int = int(before_uid)
        except ValueError:
            before_uid_int = float("inf")

        # 筛选出严格小于 before_uid 的所有更早 UID
        older_uids = [u for u in all_uids if int(u) < before_uid_int]

        if not older_uids:
            imap.logout()
            return [], False

        # 取最靠近当前边界的倒数 limit 封（即较近的历史邮件）
        target_uids = older_uids[-limit:]
        has_more = len(older_uids) > len(target_uids)

        for u in reversed(target_uids):
            uid_str = u.decode("utf-8")
            res, msg_data = imap.uid("fetch", u, "(RFC822)")
            if res == "OK" and msg_data and msg_data[0]:
                raw_email = msg_data[0][1]
                if isinstance(raw_email, bytes):
                    parsed = parse_email_message(raw_email, uid_str)
                    parsed["folder"] = folder_type
                    emails.append(parsed)

        imap.logout()
    except Exception as e:
        logger.error(f"[MailService] 拉取历史邮件异常 ({email_address}, folder={folder_type}, before_uid={before_uid}): {e}", exc_info=True)

    return emails, has_more

def build_and_send_smtp_email(
    smtp_host: str, smtp_port: int, smtp_ssl: bool,
    email_address: str, password: str,
    to_email: str,
    subject: str,
    body_text: str,
    body_html: Optional[str] = None,
    in_reply_to: Optional[str] = None,
    references: Optional[str] = None,
    attachments: Optional[List[Dict[str, Any]]] = None,
    cc_email: str = "",
    bcc_email: str = "",
) -> Tuple[bool, str, Optional[str], Optional[bytes], List[str]]:
    """返回成功状态、提示、Message-ID、私有发件箱副本、拒收地址；部分拒收仍为成功提交。"""
    try:
        to_email, cc_email, bcc_email = normalize_recipients(to_email, cc_email, bcc_email)
        envelope = [address for group in (to_email, cc_email, bcc_email) for address in group.split(", ") if address]
        if attachments:
            msg = MIMEMultipart("mixed")
            msg["From"] = email_address
            msg["To"] = to_email
            msg["Subject"] = subject
            msg["Date"] = formatdate(localtime=True)
            message_id = make_msgid()
            msg["Message-ID"] = message_id

            if in_reply_to:
                msg["In-Reply-To"] = in_reply_to
            if references:
                msg["References"] = references

            # 正文部分封装在 alternative 中
            body_part = MIMEMultipart("alternative")
            part1 = MIMEText(body_text, "plain", "utf-8")
            body_part.attach(part1)
            if body_html:
                part2 = MIMEText(body_html, "html", "utf-8")
                body_part.attach(part2)
            msg.attach(body_part)

            # 遍历并装配附件
            for att in attachments:
                raw_content = att.get("content_bytes")
                if not raw_content and att.get("content_base64"):
                    try:
                        raw_content = base64.b64decode(att["content_base64"])
                    except Exception as b_err:
                        logger.warning(f"[MailService] 解码附件 base64 失败: {b_err}")
                        continue
                if not raw_content:
                    continue

                filename = att.get("filename", "attachment")
                part = MIMEApplication(raw_content)
                # 使用 RFC 2231 / RFC 2047 双重适配，避免中文文件名在海外或国内客户端乱码
                try:
                    part.add_header('Content-Disposition', 'attachment', filename=('utf-8', '', filename))
                except Exception:
                    encoded_name = Header(filename, 'utf-8').encode()
                    part.add_header('Content-Disposition', f'attachment; filename="{encoded_name}"')
                msg.attach(part)
        else:
            msg = MIMEMultipart("alternative")
            msg["From"] = email_address
            msg["To"] = to_email
            msg["Subject"] = subject
            msg["Date"] = formatdate(localtime=True)
            message_id = make_msgid()
            msg["Message-ID"] = message_id

            if in_reply_to:
                msg["In-Reply-To"] = in_reply_to
            if references:
                msg["References"] = references

            part1 = MIMEText(body_text, "plain", "utf-8")
            msg.attach(part1)

            if body_html:
                part2 = MIMEText(body_html, "html", "utf-8")
                msg.attach(part2)

        if cc_email:
            msg["Cc"] = cc_email
        # Never put Bcc in the message transmitted to SMTP recipients.
        wire_bytes = msg.as_bytes(policy=SMTP)

        if smtp_ssl:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=20)
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=20)
            server.starttls()

        try:
            server.login(email_address, password)
            refused = server.sendmail(email_address, envelope, wire_bytes)
        finally:
            # A QUIT failure after acceptance must not invite duplicate sending.
            try:
                server.quit()
            except Exception:
                try:
                    server.close()
                except Exception:
                    pass
        # Separate private Sent-folder copy, never reused for SMTP transmission.
        if bcc_email:
            msg["Bcc"] = bcc_email
        raw_bytes = msg.as_bytes(policy=SMTP)
        rejected = list(refused)
        if rejected:
            notice = "邮件已部分提交，以下地址被发信服务器拒收：" + "、".join(rejected) + "。请勿整封重复发送。"
        else:
            notice = "邮件发送成功！"
        return True, notice, message_id, raw_bytes, rejected
    except Exception as e:
        return False, f"邮件发送失败: {str(e)}", None, None, []

def send_smtp_email(
    smtp_host: str, smtp_port: int, smtp_ssl: bool,
    email_address: str, password: str,
    to_email: str,
    subject: str,
    body_text: str,
    body_html: Optional[str] = None,
    in_reply_to: Optional[str] = None,
    references: Optional[str] = None
) -> Tuple[bool, str]:
    """通过员工邮箱的 SMTP 代发邮件（向下兼容原接口）"""
    success, msg, _, _, _ = build_and_send_smtp_email(
        smtp_host=smtp_host, smtp_port=smtp_port, smtp_ssl=smtp_ssl,
        email_address=email_address, password=password,
        to_email=to_email, subject=subject, body_text=body_text,
        body_html=body_html, in_reply_to=in_reply_to, references=references
    )
    return success, msg
