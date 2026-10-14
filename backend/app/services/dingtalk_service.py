import time
import httpx
from typing import Dict, Any, List, Optional, Tuple
from app.core.config import settings
from app.core.logger import logger

class DingTalkService:
    def __init__(self):
        self._access_token: Optional[str] = None
        self._token_expires_at: float = 0.0

    async def get_access_token(self) -> str:
        """获取企业 access_token（带内存缓存，提前 300 秒刷新）"""
        now = time.time()
        if self._access_token and now < self._token_expires_at:
            return self._access_token

        if not settings.DINGTALK_CLIENT_ID or not settings.DINGTALK_CLIENT_SECRET:
            raise ValueError("钉钉未配置 DINGTALK_CLIENT_ID 或 DINGTALK_CLIENT_SECRET")

        url = "https://api.dingtalk.com/v1.0/oauth2/accessToken"
        payload = {
            "appKey": settings.DINGTALK_CLIENT_ID.strip(),
            "appSecret": settings.DINGTALK_CLIENT_SECRET.strip()
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            data = resp.json()

        token = data.get("accessToken")
        expire_in = data.get("expireIn", 7200)

        if not token:
            errmsg = data.get("message") or data.get("errmsg") or "未知错误"
            raise RuntimeError(f"获取钉钉应用凭证失败: {errmsg}")

        self._access_token = token
        self._token_expires_at = now + max(expire_in - 300, 60)
        return self._access_token

    async def get_user_detail_by_id(self, userid: str) -> Dict[str, Any]:
        """通过企业 userid 获取员工详细信息"""
        access_token = await self.get_access_token()
        url = f"https://oapi.dingtalk.com/topapi/v2/user/get?access_token={access_token}"
        payload = {"userid": userid, "language": "zh_CN"}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            data = resp.json()

        if data.get("errcode") != 0 or not data.get("result"):
            raise RuntimeError(f"获取员工详情失败: {data.get('errmsg')} (errcode={data.get('errcode')})")

        return data["result"]

    async def get_user_by_internal_code(self, auth_code: str) -> Dict[str, Any]:
        """钉钉内免登：使用免登 authCode 换取企业用户详情"""
        access_token = await self.get_access_token()
        url = f"https://oapi.dingtalk.com/topapi/v2/user/getuserinfo?access_token={access_token}"
        payload = {"code": auth_code}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            data = resp.json()

        if data.get("errcode") != 0 or not data.get("result", {}).get("userid"):
            raise RuntimeError(f"免登验证失败: {data.get('errmsg')} (errcode={data.get('errcode')})")

        userid = data["result"]["userid"]
        return await self.get_user_detail_by_id(userid)

    async def get_user_by_qr_code(self, auth_code: str) -> Dict[str, Any]:
        """外部扫码登录：使用扫码 code 换取 userToken -> unionId -> 企业 userid -> 员工详情"""
        # 1. 换取 userAccessToken
        token_url = "https://api.dingtalk.com/v1.0/oauth2/userAccessToken"
        token_payload = {
            "clientId": settings.DINGTALK_CLIENT_ID.strip(),
            "clientSecret": settings.DINGTALK_CLIENT_SECRET.strip(),
            "code": auth_code,
            "grantType": "authorization_code"
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(token_url, json=token_payload)
            token_data = resp.json()

        user_token = token_data.get("accessToken")
        if not user_token:
            errmsg = token_data.get("message") or token_data.get("errmsg") or "获取扫码令牌失败"
            raise RuntimeError(f"扫码换票失败: {errmsg}")

        # 2. 获取用户自身档案（包含 unionId）
        profile_url = "https://api.dingtalk.com/v1.0/contact/users/me"
        headers = {"x-acs-dingtalk-access-token": user_token}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(profile_url, headers=headers)
            profile_data = resp.json()

        union_id = profile_data.get("unionId")
        if not union_id:
            raise RuntimeError("无法获取当前扫码用户的 unionId")

        # 3. 将 unionId 转换为本企业的 userid
        access_token = await self.get_access_token()
        union_url = f"https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token={access_token}"
        union_payload = {"unionid": union_id}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(union_url, json=union_payload)
            union_resp = resp.json()

        if union_resp.get("errcode") != 0 or not union_resp.get("result", {}).get("userid"):
            raise RuntimeError(f"该钉钉账号不属于当前企业或未加入企业组织: {union_resp.get('errmsg')}")

        userid = union_resp["result"]["userid"]
        return await self.get_user_detail_by_id(userid)

    async def get_department_list(self, parent_id: int = 1) -> List[Dict[str, Any]]:
        """获取下级部门列表"""
        access_token = await self.get_access_token()
        url = f"https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token={access_token}"
        payload = {"dept_id": parent_id, "language": "zh_CN"}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            data = resp.json()

        if data.get("errcode") != 0:
            return []
        return data.get("result", [])

    async def get_department_users(self, dept_id: int, cursor: int = 0, size: int = 100) -> Tuple[List[Dict[str, Any]], bool, int]:
        """分页获取部门员工精简列表"""
        access_token = await self.get_access_token()
        url = f"https://oapi.dingtalk.com/topapi/user/listsimple?access_token={access_token}"
        payload = {"dept_id": dept_id, "cursor": cursor, "size": size}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            data = resp.json()

        if data.get("errcode") != 0 or not data.get("result"):
            return [], False, 0

        res = data["result"]
        return res.get("list", []), res.get("has_more", False), res.get("next_cursor", 0)

    async def fetch_all_org_users(self) -> List[Dict[str, Any]]:
        """递归拉取全企业组织部门及所有员工完整档案"""
        synced_user_ids = set()
        user_list = []

        # 1. 递归获取所有部门 ID（根部门一般为 1）
        all_dept_ids = [1]
        queue = [1]

        while queue:
            current_dept = queue.pop(0)
            sub_depts = await self.get_department_list(current_dept)
            for d in sub_depts:
                d_id = d.get("dept_id")
                if d_id and d_id not in all_dept_ids:
                    all_dept_ids.append(d_id)
                    queue.append(d_id)

        # 2. 遍历各部门拉取员工并去重
        for d_id in all_dept_ids:
            cursor = 0
            has_more = True
            while has_more:
                users_simple, has_more, next_cursor = await self.get_department_users(d_id, cursor=cursor, size=100)
                for u in users_simple:
                    uid = u.get("userid")
                    if uid and uid not in synced_user_ids:
                        synced_user_ids.add(uid)
                        try:
                            detail = await self.get_user_detail_by_id(uid)
                            user_list.append(detail)
                        except Exception as e:
                            logger.warning(f"[DingTalk] 获取员工详情失败 (userid={uid}): {e}")
                cursor = next_cursor

        return user_list

    async def create_calendar_event(
        self,
        union_id: str,
        summary: str,
        start_time_iso: str,
        end_time_iso: str,
        description: str = "",
        location_name: Optional[str] = None,
        attendee_userids: Optional[List[str]] = None,
        attendee_mobiles: Optional[List[str]] = None,
        enable_video_meeting: bool = True
    ) -> Dict[str, Any]:
        """
        调用钉钉日历 V1.0 API 创建带视频会议的正式日程
        :param union_id: 发起人 DingTalk unionId
        :param summary: 会议日程主题
        :param start_time_iso: ISO 8601 格式开始时间 (如 "2026-09-07T15:00:00+08:00")
        :param end_time_iso: ISO 8601 格式结束时间
        :param description: 会议说明/背景
        :param location_name: 线下会议室名称 (如 "1号会议室 (8人)")
        :param attendee_userids: 内部员工 userid 列表
        :param attendee_mobiles: 外部参会人手机号列表 (钉钉日程助手直接推送)
        :param enable_video_meeting: 是否自动生成线上视频会议室 (DingTalk Meeting)
        """
        access_token = await self.get_access_token()
        url = f"https://api.dingtalk.com/v1.0/calendar/users/{union_id}/calendars/primary/events"
        headers = {
            "x-acs-dingtalk-access-token": access_token,
            "Content-Type": "application/json"
        }

        # 组装内部参与人列表 (必须携带 unionId)
        attendees = []
        if attendee_userids:
            for uid in attendee_userids:
                if uid:
                    attendees.append({"id": uid, "isOptional": False})

        payload: Dict[str, Any] = {
            "summary": summary,
            "description": description,
            "start": {
                "dateTime": start_time_iso,
                "timeZone": "Asia/Shanghai"
            },
            "end": {
                "dateTime": end_time_iso,
                "timeZone": "Asia/Shanghai"
            },
            "reminders": [
                {"method": "dingtalk", "minutes": 15}
            ]
        }

        if location_name:
            payload["location"] = {"displayName": location_name}

        if enable_video_meeting:
            payload["onlineMeetingInfo"] = {"type": "dingtalk"}

        if attendees:
            payload["attendees"] = attendees

        logger.info(f"[DingTalkCalendar] 正在创建日程: {summary} | 参与人: {len(attendees)} 人 ({attendees}) | 发起人 unionId: {union_id}")
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            res_data = resp.json()

        if resp.status_code != 200:
            err_code = res_data.get("code") or res_data.get("errcode")
            err_msg = res_data.get("message") or res_data.get("errmsg") or resp.text
            logger.error(f"[DingTalkCalendar] 创建日程失败: HTTP {resp.status_code} | {err_code}: {err_msg}")
            raise RuntimeError(f"创建钉钉日程失败: {err_msg} ({err_code})")

        logger.info(f"[DingTalkCalendar] 日程创建成功! Event ID: {res_data.get('id')}")
        return res_data

dingtalk_service = DingTalkService()
