import time
import asyncio
from typing import Dict, List
from fastapi import Request, HTTPException, status
from jose import jwt, JWTError
from app.core.config import settings

class SlidingWindowRateLimiter:
    """
    轻量级滑动窗口限流器 (纯原生零依赖实现)
    优先使用用户凭证标识（防止企业局域网公网 IP 共享冲突），无凭证时使用客户端真实 IP。
    """
    def __init__(self, times: int, seconds: int, scope: str = "default"):
        self.times = times
        self.seconds = seconds
        self.scope = scope
        self._records: Dict[str, List[float]] = {}
        self._lock = asyncio.Lock()
        self._last_cleanup = time.time()

    def _get_client_key(self, request: Request) -> str:
        # 1. 优先从 Authorization 请求头提取用户标识
        auth = request.headers.get("authorization")
        if auth and auth.startswith("Bearer "):
            token = auth.split(" ", 1)[1].strip()
            try:
                payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
                sub = payload.get("sub")
                if sub:
                    return f"user:{sub}"
            except JWTError:
                pass

        # 2. 尝试从 Query 参数中的 token 提取
        token_q = request.query_params.get("token")
        if token_q:
            try:
                payload = jwt.decode(token_q, settings.SECRET_KEY, algorithms=["HS256"])
                sub = payload.get("sub")
                if sub:
                    return f"user:{sub}"
            except JWTError:
                pass

        # 3. 回退为客户端真实 IP (解析 x-forwarded-for，取第一段真实公网 IP)
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip = forwarded.split(",")[0].strip()
        else:
            ip = request.client.host if request.client else "unknown"
        return f"ip:{ip}"

    async def __call__(self, request: Request):
        client_key = self._get_client_key(request)
        key = f"{self.scope}:{client_key}"
        now = time.time()
        cutoff = now - self.seconds

        async with self._lock:
            # 定期清理长期未活跃的过期键，防止内存占用膨胀 (每 5 分钟清理一次)
            if now - self._last_cleanup > 300:
                self._cleanup(cutoff)
                self._last_cleanup = now

            timestamps = self._records.get(key, [])
            # 过滤掉超出时间窗口的历史记录
            valid_timestamps = [t for t in timestamps if t > cutoff]

            if len(valid_timestamps) >= self.times:
                retry_after = max(int(valid_timestamps[0] + self.seconds - now) + 1, 1)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"操作过于频繁，请在 {retry_after} 秒后再试。",
                    headers={"Retry-After": str(retry_after)}
                )

            valid_timestamps.append(now)
            self._records[key] = valid_timestamps

    def _cleanup(self, cutoff: float):
        keys_to_delete = []
        for k, v in self._records.items():
            active = [t for t in v if t > cutoff]
            if not active:
                keys_to_delete.append(k)
            else:
                self._records[k] = active
        for k in keys_to_delete:
            del self._records[k]


# 预置高敏/高频接口限流器实例
# 1. 邮箱连通性测试：每分钟限 5 次，杜绝扫描与暴力爆破
limiter_account_test = SlidingWindowRateLimiter(times=5, seconds=60, scope="account_test")
# 2. AI 对话与拟稿：每分钟限 15 次，保护 DeepSeek API 额度不被刷爆
limiter_chat = SlidingWindowRateLimiter(times=15, seconds=60, scope="ai_chat")
# 3. 邮件主动发信：每分钟限 10 次，防止发信服务器被风控封号
limiter_compose = SlidingWindowRateLimiter(times=10, seconds=60, scope="compose_mail")
