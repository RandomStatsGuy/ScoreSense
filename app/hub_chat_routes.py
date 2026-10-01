"""Authenticated communication endpoints. All reads preserve saved league focus."""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime
from pydantic import BaseModel, Field, StrictBool

from app.auth import require_hub_user
from app.hub_routes import _ctx_for_league, _sub
from src.draft_hub import chat
from src.draft_hub.ws_manager import draft_room_manager

router = APIRouter(prefix="/api/hub", tags=["Fantasy chat"])


class MessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    mentions: list[str] = Field(default_factory=list, max_length=30)


class ReadRequest(BaseModel):
    thread: str = Field(max_length=100)
    last_id: str = Field(max_length=100)


class ReactionRequest(BaseModel):
    emoji: str = Field(max_length=16)
    pressed: StrictBool


class PreferencesRequest(BaseModel):
    preferences: dict[str, StrictBool]


class NotificationReadRequest(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=100)
    through: datetime | None = None


def _call(operation, *args, **kwargs):
    try:
        return operation(*args, **kwargs)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/notifications/preferences")
def get_preferences(user=Depends(require_hub_user)):
    return {"preferences": chat.preferences(_sub(user))}


@router.put("/notifications/preferences")
def put_preferences(body: PreferencesRequest, user=Depends(require_hub_user)):
    return {"preferences": _call(chat.preferences, _sub(user), body.preferences)}


@router.get("/league/{league_id}/chat/summary")
def get_summary(league_id: str, user=Depends(require_hub_user)):
    sub = _sub(user)
    _ctx_for_league(sub, league_id)
    return _call(chat.summary, league_id, sub)


@router.get("/league/{league_id}/chat/thread/{thread}")
def get_thread(league_id: str, thread: str, user=Depends(require_hub_user)):
    sub = _sub(user)
    _ctx_for_league(sub, league_id)
    return {"messages": _call(chat.list_messages, league_id, sub, thread)}


@router.post("/league/{league_id}/chat/thread/{thread}")
async def post_thread(league_id: str, thread: str, body: MessageRequest, user=Depends(require_hub_user)):
    sub = _sub(user)
    _ctx_for_league(sub, league_id)
    message = _call(chat.post_message, league_id, sub, thread, body.body, body.mentions)
    if thread in ("league", "office"):
        await draft_room_manager.broadcast(league_id, {"type": "chat", "kind": thread, "message": message}, staff_only=thread == "office")
    return {"message": message}


@router.post("/league/{league_id}/chat/read")
def read_thread(league_id: str, body: ReadRequest, user=Depends(require_hub_user)):
    sub = _sub(user)
    _ctx_for_league(sub, league_id)
    _call(chat.mark_read, league_id, sub, body.thread, body.last_id)
    return {"ok": True}


@router.put("/league/{league_id}/chat/messages/{message_id}/reactions")
def react(league_id: str, message_id: str, body: ReactionRequest, user=Depends(require_hub_user)):
    sub = _sub(user)
    _ctx_for_league(sub, league_id)
    return {"message": _call(chat.set_reaction, league_id, sub, message_id, body.emoji, body.pressed)}


@router.post("/league/{league_id}/notifications/read")
def read_notifications(league_id: str, body: NotificationReadRequest, user=Depends(require_hub_user)):
    sub = _sub(user)
    _ctx_for_league(sub, league_id)
    _call(chat.read_notifications, league_id, sub, body.ids, body.through.isoformat() if body.through else None)
    return {"ok": True}
