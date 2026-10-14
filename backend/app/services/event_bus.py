import asyncio
import json
from typing import Dict, Set, Any

class EventBroadcaster:
    """轻量级用户级内存事件广播中心 (用于 SSE 实时推流)"""
    def __init__(self):
        self._listeners: Dict[int, Set[asyncio.Queue]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, user_id: int) -> asyncio.Queue:
        """为特定登录用户创建事件订阅队列"""
        queue: asyncio.Queue = asyncio.Queue()
        async with self._lock:
            if user_id not in self._listeners:
                self._listeners[user_id] = set()
            self._listeners[user_id].add(queue)
        return queue

    async def unsubscribe(self, user_id: int, queue: asyncio.Queue):
        """用户断开连接时移除其订阅队列"""
        async with self._lock:
            if user_id in self._listeners:
                self._listeners[user_id].discard(queue)
                if not self._listeners[user_id]:
                    del self._listeners[user_id]

    async def broadcast_to_user(self, user_id: int, event_type: str, data: Any):
        """向指定用户的所有活跃客户端广播事件消息"""
        payload = json.dumps({"event": event_type, "data": data}, ensure_ascii=False)
        async with self._lock:
            queues = list(self._listeners.get(user_id, set()))
        for q in queues:
            await q.put(payload)

event_bus = EventBroadcaster()
