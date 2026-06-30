"""Quick insights smoke test for local debugging."""
from __future__ import annotations

from fastapi.testclient import TestClient

import app.auth as auth
from app.api import app
from src.config import DRAFT_HUB_DB
from src.draft_hub import storage
import sqlite3

auth.hub_auth_enabled = lambda: False
client = TestClient(app, raise_server_exceptions=False)

conn = sqlite3.connect(DRAFT_HUB_DB)
row = conn.execute("SELECT id, name FROM league WHERE room_code = ?", ("0BBESQ",)).fetchone()
if not row:
    print("0BBESQ not found")
    raise SystemExit(1)

lid, name = row[0], row[1]
print("league", name, lid)
comm = conn.execute("SELECT commissioner_sub FROM league WHERE id = ?", (lid,)).fetchone()[0]
print("commissioner", comm)
storage.set_hub_focus(comm, league_id=lid)

# Patch hub auth to use commissioner
auth.hub_auth_enabled = lambda: True
from app import hub_routes

def _fake_user():
    return {"sub": comm, "email": "test@local"}

import app.hub_routes as hr
original = hr.require_hub_user
hr.require_hub_user = lambda: _fake_user()
app.dependency_overrides[original] = _fake_user

for ep in ("insights/cap", "insights/scoring", "insights/trades", "insights/status"):
    r = client.get(f"/api/hub/league/{lid}/{ep}")
    print(ep, r.status_code)
    if r.status_code != 200:
        print(r.text[:3000])
    else:
        j = r.json()
        if "analytics" in j:
            print("  teams", len((j.get("analytics") or {}).get("teams") or []))
