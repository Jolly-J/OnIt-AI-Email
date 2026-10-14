import base64
import httpx
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import serialization

import os
from dotenv import load_dotenv

load_dotenv()

OA_BASE = os.getenv("OA_BASE_URL", "http://oa.example.com:8008")
LOGIN_ID = os.getenv("OA_AUTH_USERNAME", "")
LOGIN_PASS = os.getenv("OA_AUTH_PASSWORD", "")
ROOM_ID = os.getenv("OA_TEST_ROOM_ID", "1")
TARGET_DATE = "2026-09-07"
TARGET_START = "15:00"
TARGET_END = "16:00"

def rsa_encrypt(plain_text: str, pub_key_pem: str, rsa_code: str, rsa_flag: str) -> str:
    # 泛微规范：如果 PEM 没带标准标头则补全
    pem_str = pub_key_pem.strip()
    if not pem_str.startswith("-----BEGIN"):
        pem_str = f"-----BEGIN PUBLIC KEY-----\n{pem_str}\n-----END PUBLIC KEY-----"
    
    pub_key = serialization.load_pem_public_key(pem_str.encode("utf-8"))
    data_to_encrypt = (plain_text + (rsa_code or "")).encode("utf-8")
    
    # 泛微 rsa.js 底层采用 JSEncrypt，默认使用 PKCS1v15 padding
    encrypted_bytes = pub_key.encrypt(
        data_to_encrypt,
        padding.PKCS1v15()
    )
    b64 = base64.b64encode(encrypted_bytes).decode("utf-8")
    return b64 + (rsa_flag or "")

def main():
    print("[1] 获取泛微 RSA 公钥与初始 Cookie...")
    client = httpx.Client(timeout=15.0)
    
    rsa_resp = client.get(f"{OA_BASE}/rsa/weaver.rsa.GetRsaInfo")
    if rsa_resp.status_code != 200:
        print(f"获取 RSA 失败: {rsa_resp.status_code}")
        return
    
    rsa_data = rsa_resp.json()
    rsa_pub = rsa_data.get("rsa_pub")
    rsa_code = rsa_data.get("rsa_code", "")
    rsa_flag = rsa_data.get("rsa_flag", "")
    
    print(f"    - rsa_code: {rsa_code}")
    print(f"    - rsa_flag: {rsa_flag}")
    print(f"    - Cookies: {dict(client.cookies)}")
    
    print("\n[2] 执行密码与账号 RSA 加密...")
    enc_login_id = rsa_encrypt(LOGIN_ID, rsa_pub, rsa_code, rsa_flag)
    enc_password = rsa_encrypt(LOGIN_PASS, rsa_pub, rsa_code, rsa_flag)
    
    print("\n[3] 发起 /api/hrm/login/checkLogin 登录验证...")
    login_payload = {
        "loginid": enc_login_id,
        "userpassword": enc_password,
        "logintype": "1",
        "islanguid": "7",
        "isie": False
    }
    
    headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    login_resp = client.post(
        f"{OA_BASE}/api/hrm/login/checkLogin",
        data=login_payload,
        headers=headers
    )
    
    print(f"    - 响应状态码: {login_resp.status_code}")
    print(f"    - 响应内容: {login_resp.text}")
    print(f"    - 登录后 Cookies: {dict(client.cookies)}")
    
    login_json = login_resp.json() if login_resp.status_code == 200 else {}
    access_token = login_json.get("access_token", "")
    
    print("\n[4] 测试用户指定考验项及其他典型会议室在 2026-09-07 15:00-16:00 状态...")
    test_rooms = [
        ("1", "第一会议室 (测试)"),
        ("2", "第二会议室"),
        ("3", "多功能报告厅"),
    ]
    
    for rid, rname in test_rooms:
        check_payload = {
            "roomid": rid,
            "meetingdate": TARGET_DATE,
            "startTime": TARGET_START,
            "endTime": TARGET_END,
            "timeType": "day"
        }
        check_resp = client.post(
            f"{OA_BASE}/api/meeting/room/chkRoomCanUse",
            data=check_payload,
            headers=headers
        )
        print(f"    - {rname} [ID: {rid}]: {check_resp.text}")

if __name__ == "__main__":
    main()
