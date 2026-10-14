import os
import re
import json
import time
import base64
import asyncio
from typing import Dict, Any, List, Optional, Tuple
import httpx
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import serialization

from app.core.config import settings
from app.core.logger import logger

def _load_known_rooms() -> List[Dict[str, Any]]:
    """从环境变量 OA_ROOMS_JSON 加载会议室字典，若未配置则提供通用标准会议室"""
    if getattr(settings, "OA_ROOMS_JSON", None):
        try:
            parsed = json.loads(settings.OA_ROOMS_JSON)
            if isinstance(parsed, list):
                return parsed
        except Exception as e:
            logger.warning(f"[OAMeeting] 解析 OA_ROOMS_JSON 异常: {e}")
    return [
        {"id": "1", "name": "第一会议室 (8人)", "capacity": 8, "building": "办公楼", "floor": "2楼"},
        {"id": "2", "name": "第二会议室 (12人)", "capacity": 12, "building": "办公楼", "floor": "3楼"},
        {"id": "3", "name": "多功能报告厅 (50人)", "capacity": 50, "building": "综合楼", "floor": "1楼"},
    ]

KNOWN_ROOMS = _load_known_rooms()

def _rsa_encrypt_weaver(plain_text: str, pub_key_pem: str, rsa_code: str, rsa_flag: str) -> str:
    """遵循泛微 e-cology9 rsa.js 的 PKCS#1 v1.5 标准前端加密"""
    pem_str = pub_key_pem.strip()
    if not pem_str.startswith("-----BEGIN"):
        pem_str = f"-----BEGIN PUBLIC KEY-----\n{pem_str}\n-----END PUBLIC KEY-----"
    
    pub_key = serialization.load_pem_public_key(pem_str.encode("utf-8"))
    data_to_encrypt = (plain_text + (rsa_code or "")).encode("utf-8")
    
    encrypted_bytes = pub_key.encrypt(
        data_to_encrypt,
        padding.PKCS1v15()
    )
    b64 = base64.b64encode(encrypted_bytes).decode("utf-8")
    return b64 + (rsa_flag or "")

class OAMeetingService:
    """
    泛微 OA 会议室预订静默服务
    - 仅用于在 OA 内进行物理会议室的静默占位与审批发起
    - 与钉钉真实日程完全解耦，不依赖 OA 日程同步
    - 内存维持登录会话 Cookie，带自动心跳重连与异常重登
    """
    def __init__(self):
        self.base_url = settings.OA_BASE_URL.rstrip("/")
        self._cookies: Dict[str, str] = {}
        self._access_token: Optional[str] = None
        self._last_login_time: float = 0.0
        self._lock = asyncio.Lock()
        self._session_valid_seconds = 1200 # 20 分钟换票周期

    def is_configured(self) -> bool:
        """是否已配置 OA 登录凭据"""
        return bool(settings.OA_AUTH_USERNAME and settings.OA_AUTH_PASSWORD)

    def get_room_catalog(self) -> List[Dict[str, Any]]:
        """获取所有可用会议室基础字典"""
        return KNOWN_ROOMS

    async def _login(self, client: httpx.AsyncClient) -> bool:
        """执行 RSA 握手与静默登录"""
        if not self.is_configured():
            logger.warning("[OAMeeting] 未配置 OA_AUTH_USERNAME 或 OA_AUTH_PASSWORD，跳过 OA 登录")
            return False

        logger.info(f"[OAMeeting] 正在发起泛微 OA 登录握手: {self.base_url}")
        try:
            # 1. 获取 RSA 公钥与随机因子
            rsa_resp = await client.get(f"{self.base_url}/rsa/weaver.rsa.GetRsaInfo", timeout=10.0)
            if rsa_resp.status_code != 200:
                logger.error(f"[OAMeeting] 获取 RSA 公钥失败: HTTP {rsa_resp.status_code}")
                return False
            
            rsa_data = rsa_resp.json()
            rsa_pub = rsa_data.get("rsa_pub")
            rsa_code = rsa_data.get("rsa_code", "")
            rsa_flag = rsa_data.get("rsa_flag", "")
            
            if not rsa_pub:
                logger.error("[OAMeeting] RSA 响应未包含公钥")
                return False

            # 2. RSA 加密账号与密码
            enc_user = _rsa_encrypt_weaver(settings.OA_AUTH_USERNAME, rsa_pub, rsa_code, rsa_flag)
            enc_pwd = _rsa_encrypt_weaver(settings.OA_AUTH_PASSWORD, rsa_pub, rsa_code, rsa_flag)

            # 3. 提交登录验证
            headers = {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            login_data = {
                "loginid": enc_user,
                "userpassword": enc_pwd,
                "logintype": "1",
                "islanguid": "7",
                "isie": False
            }
            login_resp = await client.post(
                f"{self.base_url}/api/hrm/login/checkLogin",
                data=login_data,
                headers=headers,
                timeout=12.0
            )

            # 记录会话 Cookies
            self._cookies = dict(client.cookies)
            if login_resp.status_code == 200:
                resp_json = login_resp.json()
                self._access_token = resp_json.get("access_token")
                self._last_login_time = time.time()
                logger.info(f"[OAMeeting] 泛微 OA 登录成功，用户: {settings.OA_AUTH_USERNAME}")
                return True
            else:
                logger.error(f"[OAMeeting] 登录响应异常: HTTP {login_resp.status_code} | {login_resp.text}")
                return False

        except Exception as e:
            logger.error(f"[OAMeeting] 登录流程异常: {e}", exc_info=True)
            return False

    async def _get_authenticated_client(self) -> Tuple[Optional[httpx.AsyncClient], Dict[str, str]]:
        """获取已认证的 httpx 客户端与请求头"""
        async with self._lock:
            client = httpx.AsyncClient(cookies=self._cookies, timeout=15.0)
            now = time.time()
            if not self._cookies or (now - self._last_login_time > self._session_valid_seconds):
                success = await self._login(client)
                if not success:
                    await client.aclose()
                    return None, {}

            headers = {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            return client, headers

    async def check_room_available(
        self,
        room_id: str,
        meeting_date: str,
        start_time: str,
        end_time: str
    ) -> Tuple[bool, str]:
        """
        探测指定物理会议室在目标时段是否可用
        :param room_id: 泛微会议室 ID（如 "1"）
        :param meeting_date: 日期 "YYYY-MM-DD"
        :param start_time: 开始时间 "HH:MM"
        :param end_time: 结束时间 "HH:MM"
        :return: (is_available, message)
        """
        if not self.is_configured():
            return True, "OA 凭据未配置，跳过物理冲突检测"

        try:
            rooms = await self.get_rooms_status(meeting_date, start_time, end_time)
            for r in rooms:
                if str(r.get("id")) == str(room_id):
                    return r.get("is_available", True), r.get("status_message", "会议室空闲可用")
            return True, "会议室空闲可用"
        except Exception as e:
            logger.error(f"[OAMeeting] 检测会议室占用失败: {e}")
            return False, f"检测异常: {e}"

    async def _get_rooms_catalog_dynamic(self, client: httpx.AsyncClient, headers: Dict[str, str]) -> List[Dict[str, Any]]:
        """从 OA 动态拉取全量会议室列表，附带 1 小时内存缓存"""
        now = time.time()
        if hasattr(self, "_dynamic_rooms_cache") and self._dynamic_rooms_cache and (now - getattr(self, "_dynamic_rooms_cache_time", 0) < 3600):
            return self._dynamic_rooms_cache

        try:
            r = await client.post(f"{self.base_url}/api/meeting/room/getRoomReportData", headers=headers, data={})
            if r.status_code == 200:
                raw_rooms = r.json().get("rooms", [])
                if raw_rooms:
                    parsed = []
                    for r_item in raw_rooms:
                        rid = str(r_item.get("id", ""))
                        name = r_item.get("name", "")
                        titles = r_item.get("title", [])
                        cap = 0
                        cap_match = re.search(r"(\d+)\s*人", name)
                        if cap_match:
                            cap = int(cap_match.group(1))
                        building = ""
                        floor = ""
                        for t in titles:
                            if "所在大楼:" in t:
                                building = t.split(":", 1)[1].strip()
                            if "所在楼层:" in t:
                                floor = t.split(":", 1)[1].strip()
                            if not cap:
                                m = re.search(r"容纳.*?(\d+)\s*人", t)
                                if m:
                                    cap = int(m.group(1))
                        if not building:
                            building = "办公区"
                        if not floor:
                            floor = "标准楼层"
                        parsed.append({
                            "id": rid,
                            "name": name,
                            "capacity": cap,
                            "building": building,
                            "floor": floor
                        })
                    self._dynamic_rooms_cache = parsed
                    self._dynamic_rooms_cache_time = now
                    logger.info(f"[OAMeeting] 动态从 OA 载入 {len(parsed)} 间会议室")
                    return parsed
        except Exception as e:
            logger.warning(f"[OAMeeting] 动态拉取会议室列表异常，使用兜底列表: {e}")
        return KNOWN_ROOMS

    async def get_rooms_status(
        self,
        meeting_date: str,
        start_time: str,
        end_time: str
    ) -> List[Dict[str, Any]]:
        """
        获取全量 28 间会议室并在目标日期时段进行 100% 真实的排期冲突检测
        """
        if not self.is_configured():
            return [{**r, "is_available": True, "status_message": "未配置 OA 凭据"} for r in KNOWN_ROOMS]

        client, headers = await self._get_authenticated_client()
        if not client:
            return [{**r, "is_available": False, "status_message": "OA 未连接"} for r in KNOWN_ROOMS]

        try:
            # 1. 优先拉取全量最新会议室字典
            rooms = await self._get_rooms_catalog_dynamic(client, headers)
            if not rooms:
                rooms = KNOWN_ROOMS

            # 2. 从泛微 OA 会议排期大盘拉取目标日期所有真实已排会议 (datas)
            report_payload = {
                "meetingdate": meeting_date,
                "timeType": "day",
                "bywhat": "4"
            }
            resp = await client.post(
                f"{self.base_url}/api/meeting/room/getRoomReportData",
                data=report_payload,
                headers=headers
            )
            
            # 若会话过期重登重试一次
            if resp.status_code in (401, 302) or "login.jsp" in resp.text.lower():
                async with self._lock:
                    await self._login(client)
                resp = await client.post(
                    f"{self.base_url}/api/meeting/room/getRoomReportData",
                    data=report_payload,
                    headers=headers
                )

            room_schedules: Dict[str, List[Dict[str, str]]] = {}
            if resp.status_code == 200:
                try:
                    res_json = json.loads(resp.text)
                    for rentry in res_json.get("datas", []):
                        rid = str(rentry.get("roomid", ""))
                        if not rid:
                            continue
                        room_schedules[rid] = []
                        for info in rentry.get("info", []):
                            for t_group in info.get("title", []):
                                m_info: Dict[str, str] = {}
                                for line in t_group:
                                    if line.startswith("会议名称:"):
                                        m_info["name"] = line.split(":", 1)[1].strip()
                                    elif line.startswith("召集人:"):
                                        m_info["caller"] = line.split(":", 1)[1].strip()
                                    elif line.startswith("开始时间:"):
                                        m_info["start"] = line.split(":", 1)[1].strip()
                                    elif line.startswith("结束时间:"):
                                        m_info["end"] = line.split(":", 1)[1].strip()
                                if m_info and m_info not in room_schedules[rid]:
                                    room_schedules[rid].append(m_info)
                except Exception as ex:
                    logger.warning(f"[OAMeeting] 解析 OA 日程大盘数据异常: {ex}")

            # 3. 针对每间会议室，精准计算用户所选时段 [start_time, end_time] 与已排会议交集
            results = []
            for room in rooms:
                rid = str(room["id"])
                bookings = room_schedules.get(rid, [])
                is_conflict = False
                conflict_desc = ""

                for b in bookings:
                    b_start_str = b.get("start", "").split()[-1] # "HH:MM"
                    b_end_str = b.get("end", "").split()[-1]     # "HH:MM"
                    # 时段交集判断: max(start1, start2) < min(end1, end2)
                    if b_start_str and b_end_str:
                        if max(start_time, b_start_str) < min(end_time, b_end_str):
                            is_conflict = True
                            b_caller = b.get("caller", "他人")
                            b_name = b.get("name", "会议")
                            conflict_desc = f"已被预约: {b_start_str}-{b_end_str} 召集人:{b_caller} ({b_name})"
                            break

                if is_conflict:
                    results.append({
                        **room,
                        "is_available": False,
                        "status_message": conflict_desc
                    })
                else:
                    status_text = "空闲 (需审批)" if "需审批" in room.get("name", "") else "空闲可用"
                    results.append({
                        **room,
                        "is_available": True,
                        "status_message": status_text
                    })

            return results
        finally:
            await client.aclose()

    async def quick_book_room(
        self,
        room_id: str,
        name: str,
        meeting_date: str,
        start_time: str,
        end_time: str
    ) -> Dict[str, Any]:
        """
        静默发起泛微 OA 快捷会议室预约（仅作物理占位）
        :return: {"success": bool, "requestid": str, "message": str}
        """
        if not self.is_configured():
            return {"success": False, "requestid": "", "message": "OA 凭证未配置"}

        # 1. 预先检测是否冲突
        can_use, msg = await self.check_room_available(room_id, meeting_date, start_time, end_time)
        if not can_use:
            logger.warning(f"[OAMeeting] 预约拦截：会议室 {room_id} 不可用 ({msg})")
            return {"success": False, "requestid": "", "message": f"物理会议室冲突: {msg}"}

        # 2. 执行快速预约
        client, headers = await self._get_authenticated_client()
        if not client:
            return {"success": False, "requestid": "", "message": "无法连接 OA 服务"}

        booking_payload = {
            "isquick": "1",
            "name": f"[邮箱助手] {name}",
            "address": str(room_id),
            "begindate": meeting_date,
            "enddate": meeting_date,
            "begintime": start_time,
            "endtime": end_time
        }

        try:
            resp = await client.post(
                f"{self.base_url}/api/meeting/base/newMeeting",
                data=booking_payload,
                headers=headers
            )
            # 若会话失效重试一次
            if resp.status_code in (401, 302) or "login.jsp" in resp.text.lower():
                async with self._lock:
                    await self._login(client)
                resp = await client.post(
                    f"{self.base_url}/api/meeting/base/newMeeting",
                    data=booking_payload,
                    headers=headers
                )

            res_json = resp.json() if resp.status_code == 200 else {}
            status_val = res_json.get("status")
            api_status = res_json.get("api_status")
            ret_status = res_json.get("retstatus")
            meeting_id = str(res_json.get("meetingid", "") or "")
            request_id = str(res_json.get("requestid", "") or res_json.get("data", "") or "")

            # 1. 免审直接预约成功（OA 返回 meetingid，且 status/retstatus 为 True 或 '1'）
            if meeting_id and (status_val in (True, "1", 1) or ret_status is True or api_status is True):
                logger.info(f"[OAMeeting] 免审会议室直接预订成功! MeetingID: {meeting_id}")
                return {
                    "success": True,
                    "status_type": "direct_booked",
                    "meetingid": meeting_id,
                    "requestid": "",
                    "message": "OA 免审会议室已直接锁房成功"
                }
            # 2. 需审批会议室已生成审批流（OA 返回 requestid）
            elif request_id and request_id != "0":
                logger.info(f"[OAMeeting] 需审会议室审批流程发起成功! RequestID: {request_id}")
                return {
                    "success": True,
                    "status_type": "approval_pending",
                    "meetingid": "",
                    "requestid": request_id,
                    "message": "OA 会议室审批流程已发起"
                }
            # 3. 兜底成功判定
            elif status_val in (True, "1", 1) or ret_status is True or api_status is True:
                logger.info(f"[OAMeeting] 会议室预订成功 (兜底状态匹配): {res_json}")
                return {
                    "success": True,
                    "status_type": "direct_booked" if meeting_id else "approval_pending",
                    "meetingid": meeting_id,
                    "requestid": request_id,
                    "message": "OA 会议室预订成功"
                }
            else:
                err_msg = res_json.get("msg") or res_json.get("message") or "OA 未返回预订成功标识"
                logger.warning(f"[OAMeeting] 预约返回非成功状态: {res_json}")
                return {
                    "success": False,
                    "status_type": "failed",
                    "meetingid": "",
                    "requestid": "",
                    "message": f"OA 预约响应: {err_msg}"
                }

        except Exception as e:
            logger.error(f"[OAMeeting] 静默预约调用失败: {e}", exc_info=True)
            return {
                "success": False,
                "status_type": "failed",
                "meetingid": "",
                "requestid": "",
                "message": f"请求异常: {str(e)}"
            }
        finally:
            await client.aclose()

oa_meeting_service = OAMeetingService()
