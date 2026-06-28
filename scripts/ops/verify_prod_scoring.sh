#!/usr/bin/env bash
set -euo pipefail
cd /root/scoresense
docker compose -f deploy/docker-compose.prod.yml exec -T api python <<'PY'
import json
import sqlite3

from src.draft_hub.league_history import build_sleeper_scoring_history
from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id
from src.draft_hub import storage

conn = sqlite3.connect("data/draft_hub/draft_hub.db")
conn.row_factory = sqlite3.Row

LEAGUE_IDS = [
    "2d7f0566-3122-48ad-af21-6fc109b4c922",
    "76a70d52-d059-4421-86b2-378d8ebe8381",
]

print("=== Panda leagues on production ===")
for league_id in LEAGUE_IDS:
    row = conn.execute(
        "SELECT id, name, sleeper_league_id, commissioner_sub FROM league WHERE id = ?",
        (league_id,),
    ).fetchone()
    if not row:
        print(league_id, "NOT FOUND")
        continue
    print(dict(row))
    resolved = resolve_sleeper_league_id(league_id)
    overview = storage.league_roster_overview(league_id)
    hub_teams = [
        {
            "name": (b.get("team") or {}).get("name"),
            "sleeper_roster_id": (b.get("team") or {}).get("sleeper_roster_id"),
        }
        for b in overview.get("teams") or []
    ]
    scoring = build_sleeper_scoring_history(str(resolved), hub_teams=hub_teams) if resolved else {}
    print(
        "  teams=",
        len(hub_teams),
        "resolved=",
        resolved,
        "available=",
        scoring.get("available"),
        "standings=",
        len(scoring.get("standings") or []),
        "weeks=",
        len(scoring.get("weeks") or []),
        "preseason=",
        scoring.get("preseason"),
    )

print("=== auth tables ===")
try:
    auth = sqlite3.connect("data/auth/users.db")
    auth.row_factory = sqlite3.Row
    tables = [r[0] for r in auth.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print(tables)
    users = auth.execute(
        "SELECT id, email, display_name FROM app_user "
        "WHERE lower(display_name) LIKE '%kheylub%' OR lower(email) LIKE '%kheylub%'"
    ).fetchall()
    print("kheylub app_user:", [dict(u) for u in users])
    for u in users:
        sub = f"ss:{u['id']}"
        memberships = conn.execute(
            "SELECT t.league_id, t.name, l.name, l.sleeper_league_id FROM team t "
            "JOIN league l ON l.id = t.league_id WHERE t.user_sub = ?",
            (sub,),
        ).fetchall()
        print("  memberships:", [dict(m) for m in memberships])
except Exception as exc:
    print("auth lookup failed:", exc)

print("=== teams with Kheylub in name ===")
rows = conn.execute(
    "SELECT t.league_id, t.user_sub, t.name, l.name AS league_name FROM team t "
    "JOIN league l ON l.id = t.league_id WHERE lower(t.name) LIKE '%kheylub%' OR lower(t.name) LIKE '%panda%'"
).fetchall()
print([dict(r) for r in rows[:15]])
PY
