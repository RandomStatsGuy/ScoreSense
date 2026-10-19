"""Admin-only registered service credentials; request bodies are never echoed."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from app.admin_ops_routes import actor_for
from app.auth import require_admin
from src.auth.rate_limit import check_rate_limit
from src.ops import connection_store

router = APIRouter(prefix="/api/admin/connections", tags=["admin"])


def _known(connection_id: str) -> None:
    try:
        connection_store.connection_spec(connection_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Connection not found") from None


def _no_cache(response: Response):
    response.headers["Cache-Control"] = "no-store"


@router.get("")
def connections(response: Response, _admin=Depends(require_admin)):
    _no_cache(response)
    return {"connections": connection_store.list_connections()}


@router.put("/{connection_id}")
async def save_connection(connection_id: str, request: Request, response: Response, admin=Depends(require_admin)):
    _known(connection_id)
    _no_cache(response)
    # Parse here so validation never reflects a submitted token in a 422 body.
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 32768:
            raise HTTPException(status_code=413, detail="Connection form is too large")
    try:
        body = json.loads(raw)
        if not isinstance(body, dict) or set(body) != {"values"}:
            raise ValueError()
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Use the connection form fields") from None
    try:
        return await run_in_threadpool(connection_store.save_connection, connection_id,
                                       body["values"], actor=actor_for(admin))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except connection_store.ConnectionStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


@router.delete("/{connection_id}")
def reset_connection(connection_id: str, response: Response, admin=Depends(require_admin)):
    _known(connection_id)
    _no_cache(response)
    return connection_store.reset_connection(connection_id, actor=actor_for(admin))


@router.post("/{connection_id}/check")
def check_connection(connection_id: str, response: Response, admin=Depends(require_admin)):
    _known(connection_id)
    _no_cache(response)
    if not check_rate_limit(f"connection-check:{admin.get('sub')}:{connection_id}", max_calls=12, window_seconds=60):
        raise HTTPException(status_code=429, detail="Wait a minute before checking again.")
    if connection_id == "jira":
        from src.support.jira_bugs import check_jira_connection
        try:
            return check_jira_connection()
        except connection_store.ConnectionStoreError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from None
    raise HTTPException(status_code=400, detail="This connection has no connection check yet.")
