"""WebSocket broadcast manager for draft rooms."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import WebSocket


class DraftRoomManager:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, league_id: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._rooms.setdefault(league_id, set()).add(ws)

    async def disconnect(self, league_id: str, ws: WebSocket) -> None:
        async with self._lock:
            conns = self._rooms.get(league_id)
            if not conns:
                return
            conns.discard(ws)
            if not conns:
                self._rooms.pop(league_id, None)

    async def broadcast(self, league_id: str, payload: dict[str, Any]) -> None:
        async with self._lock:
            conns = list(self._rooms.get(league_id, set()))
        dead: list[WebSocket] = []
        text = json.dumps(payload)
        for ws in conns:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(league_id, ws)


draft_room_manager = DraftRoomManager()
