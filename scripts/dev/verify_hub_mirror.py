"""Verify local Draft Hub mirror (cap sheet rosters + trade insights)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.draft_hub import storage
from src.draft_hub.trade_insights import build_trade_insights

DEFAULT_LEAGUE_ID = "ebccda0e-42d3-421b-90d3-5eaff11339d2"


DEFAULT_LEAGUE_ROOM = "0BBESQ"


def main(league_id: str | None = None, room_code: str = DEFAULT_LEAGUE_ROOM) -> int:
    if not league_id and room_code:
        with storage.get_conn() as conn:
            row = conn.execute(
                "SELECT id FROM league WHERE room_code = ? ORDER BY created_at DESC LIMIT 1",
                (room_code.strip().upper(),),
            ).fetchone()
        if not row:
            print(f"No league with room code {room_code}")
            return 1
        league_id = str(row["id"])
    if not league_id:
        league_id = DEFAULT_LEAGUE_ID
    overview = storage.league_roster_overview(league_id)
    league = overview.get("league") or {}
    teams = overview.get("teams") or []
    total = sum(int(b.get("player_count") or 0) for b in teams)
    print(f"League: {league.get('name')} ({league_id})")
    print(f"Teams: {len(teams)} | Players: {total}")
    for block in teams:
        team = block.get("team") or {}
        print(
            f"  {team.get('name')}: {block.get('player_count')} players, "
            f"${block.get('total_salary')} committed"
        )
    my_id = str((teams[0].get("team") or {}).get("id") or "") if teams else ""
    trade = build_trade_insights(
        overview,
        my_team_id=my_id,
        season=int(league.get("season") or 2025),
        draft_completed=True,
    )
    suggestions = trade.get("suggestions") or []
    print(f"Trade suggestions: {len(suggestions)}")
    if trade.get("empty_reason"):
        print(f"Empty reason: {trade['empty_reason']}")
    if suggestions:
        print(f"Sample: {suggestions[0].get('rationale')}")
    return 0 if total > 0 else 1


if __name__ == "__main__":
    lid = None
    room = DEFAULT_LEAGUE_ROOM
    if len(sys.argv) > 1:
        if len(sys.argv[1]) <= 8 and sys.argv[1].isalnum():
            room = sys.argv[1]
        else:
            lid = sys.argv[1]
    raise SystemExit(main(lid, room))
