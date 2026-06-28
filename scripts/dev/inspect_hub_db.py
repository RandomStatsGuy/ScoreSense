"""Inspect Draft Hub DB for Sleeper/roster state."""
import json
import sys

from src.draft_hub import storage

with storage.get_conn() as conn:
    print("DB:", storage.DRAFT_HUB_DB)
    leagues = conn.execute("SELECT id, name, sleeper_league_id, workspace_id FROM league").fetchall()
    print("\nLeagues:")
    for row in leagues:
        print(dict(row))

    teams = conn.execute(
        "SELECT id, league_id, name, sleeper_roster_id, sleeper_team_name, sleeper_player_ids_json, user_sub FROM team"
    ).fetchall()
    print("\nTeams:")
    for t in teams:
        d = dict(t)
        ids = d.pop("sleeper_player_ids_json", None)
        d["sleeper_player_count"] = len(json.loads(ids)) if ids else 0
        print(d)

    total = conn.execute("SELECT COUNT(*) AS c FROM roster_slot").fetchone()["c"]
    orphans = conn.execute(
        "SELECT COUNT(*) AS c FROM roster_slot WHERE team_id IS NULL OR team_id = ''"
    ).fetchone()["c"]
    print(f"\nRoster slots: {total} total, {orphans} orphans")

    by_team = conn.execute(
        """SELECT t.name, COUNT(r.id) AS n
           FROM team t
           LEFT JOIN roster_slot r ON r.team_id = t.id
           GROUP BY t.id
           ORDER BY t.name"""
    ).fetchall()
    print("\nRoster count by team:")
    for row in by_team:
        print(dict(row))

    if len(sys.argv) > 1 and sys.argv[1] == "--sample":
        sample = conn.execute(
            "SELECT player_name, position, team_id, source, sleeper_player_id FROM roster_slot LIMIT 20"
        ).fetchall()
        for row in sample:
            print(dict(row))
