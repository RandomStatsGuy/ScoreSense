"""WebSocket broadcast manager for draft rooms."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import WebSocket

from src.ops.job_diagnostics import annotate_job


class DraftRoomManager:
    """Room presence is process-local; the API runs one worker, so this is every viewer."""

    def __init__(self) -> None:
        self._rooms: dict[str, dict[WebSocket, dict[str, Any]]] = {}
        self._lock = asyncio.Lock()
        self._last_seen: dict[str, float] = {}
        self._started = time.monotonic()

    def touch(self, league_id: str) -> None:
        self._last_seen[league_id] = time.monotonic()

    def has_listeners(self, league_id: str) -> bool:
        return bool(self._rooms.get(league_id))

    def watched_league_ids(self, grace_s: float) -> set[str] | None:
        """Rooms open now or within ``grace_s``; ``None`` until a full grace has passed since startup."""
        now = time.monotonic()
        if now - self._started < grace_s:
            return None
        for league_id, seen in list(self._last_seen.items()):
            if now - seen >= grace_s:
                self._last_seen.pop(league_id, None)
        return set(self._last_seen) | set(self._rooms)

    async def connect(self, league_id: str, ws: WebSocket, *, staff: bool = False) -> None:
        await ws.accept()
        async with self._lock:
            self._rooms.setdefault(league_id, {})[ws] = {"staff": bool(staff)}
        self.touch(league_id)

    async def disconnect(self, league_id: str, ws: WebSocket) -> None:
        self.touch(league_id)
        async with self._lock:
            conns = self._rooms.get(league_id)
            if not conns:
                return
            conns.pop(ws, None)
            if not conns:
                self._rooms.pop(league_id, None)

    async def broadcast(
        self,
        league_id: str,
        payload: dict[str, Any],
        *,
        staff_only: bool = False,
    ) -> None:
        async with self._lock:
            items = list(self._rooms.get(league_id, {}).items())
        dead: list[WebSocket] = []
        text = json.dumps(payload)

        async def send_safe(ws_conn: WebSocket) -> None:
            try:
                await ws_conn.send_text(text)
            except Exception:
                dead.append(ws_conn)

        targets = [
            ws
            for ws, meta in items
            if not (staff_only and not meta.get("staff"))
        ]
        annotate_job(recipients=len(targets))
        if targets:
            await asyncio.gather(*(send_safe(ws) for ws in targets))
        for ws in dead:
            await self.disconnect(league_id, ws)


draft_room_manager = DraftRoomManager()
