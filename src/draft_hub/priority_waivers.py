"""Rolling-priority waiver claims for native pick-draft leagues."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from src.draft_hub import storage
from src.draft_hub.pick_draft import is_pick_draft
from src.draft_hub.rules_engine import assert_can_acquire, normalize_position
from src.draft_hub.schemas import LeagueRules

ET = ZoneInfo("America/New_York")


def _league(league_id: str) -> tuple[dict[str, Any], LeagueRules]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    rules = LeagueRules.model_validate(league["rules"])
    if not is_pick_draft(rules):
        raise ValueError("This league uses waiver bidding")
    return league, rules


def _priority_rows(conn: sqlite3.Connection, league_id: str, season: int) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM waiver_priority WHERE league_id=? AND season=? ORDER BY priority",
        (league_id, season),
    ).fetchall()


def _priority_payload(rows: list[sqlite3.Row], team_names: dict[str, str]) -> dict[str, Any]:
    return {
        "confirmed": bool(rows) and all(bool(row["confirmed"]) for row in rows),
        "teams": [
            {
                "team_id": row["team_id"],
                "team_name": team_names.get(str(row["team_id"]), str(row["team_id"])),
                "priority": int(row["priority"]),
            }
            for row in rows
        ],
    }


def waiver_priority(league_id: str) -> dict[str, Any]:
    league, _rules = _league(league_id)
    season = int(league["season"])
    teams = storage.list_league_teams(league_id)
    team_names = {str(team["id"]): str(team["name"]) for team in teams}
    team_ids = set(team_names)
    session = storage.get_draft_session(league_id) or {}
    first_round = [str(team_id) for team_id in session.get("nomination_order") or []]
    complete = len(first_round) == len(team_ids) and set(first_round) == team_ids
    with storage.get_conn() as conn:
        rows = _priority_rows(conn, league_id, season)
        if not rows and complete:
            stamp = storage._utcnow()
            conn.executemany(
                "INSERT INTO waiver_priority VALUES (?,?,?,?,1,?)",
                [
                    (league_id, season, team_id, index, stamp)
                    for index, team_id in enumerate(reversed(first_round), start=1)
                ],
            )
            rows = _priority_rows(conn, league_id, season)
        payload = _priority_payload(rows, team_names)
        row_team_ids = {str(row["team_id"]) for row in rows}
        if row_team_ids != team_ids:
            payload["confirmed"] = False
            existing = [item for item in payload["teams"] if item["team_id"] in team_ids]
            missing = [
                {"team_id": str(team["id"]), "team_name": str(team["name"]), "priority": 0}
                for team in teams
                if str(team["id"]) not in row_team_ids
            ]
            payload["teams"] = [
                {**item, "priority": index}
                for index, item in enumerate(existing + missing, start=1)
            ]
    payload["requires_confirmation"] = not payload["confirmed"]
    payload["initial_source"] = "reverse_first_round" if complete else "commissioner"
    return payload


def confirm_waiver_priority(league_id: str, team_ids: list[str]) -> dict[str, Any]:
    league, _rules = _league(league_id)
    teams = storage.list_league_teams(league_id)
    expected = {str(team["id"]) for team in teams}
    cleaned = [str(team_id) for team_id in team_ids]
    if len(cleaned) != len(expected) or set(cleaned) != expected:
        raise ValueError("Waiver order must include every league team exactly once")
    season = int(league["season"])
    stamp = storage._utcnow()
    with storage.get_conn() as conn:
        conn.execute("DELETE FROM waiver_priority WHERE league_id=? AND season=?", (league_id, season))
        conn.executemany(
            "INSERT INTO waiver_priority VALUES (?,?,?,?,1,?)",
            [(league_id, season, team_id, index, stamp) for index, team_id in enumerate(cleaned, start=1)],
        )
    return waiver_priority(league_id)


def replace_claims(
    *, league_id: str,
    team_id: str,
    window_id: str,
    claims: list[dict[str, Any]],
    user_sub: str,
) -> list[dict[str, Any]]:
    league, _rules = _league(league_id)
    workspace_id = storage.roster_workspace_for_league(league)
    roster = storage.list_team_roster(league_id, team_id)
    owned_ids = {
        str(row["player_id"])
        for row in roster
        if storage.roster_row_occupies(row)
    }
    seen: set[str] = set()
    normalized = []
    for rank, claim in enumerate(claims, start=1):
        player_id = str(claim.get("player_id") or "").strip()
        if not player_id or player_id in seen:
            raise ValueError("Each claim needs a unique player")
        position = normalize_position(str(claim.get("position") or ""))
        if position not in {"QB", "RB", "WR", "TE", "K", "DEF"}:
            raise ValueError("Each claim needs a supported player position")
        occupying = [
            row for row in storage.list_roster_slots_for_player(workspace_id, player_id)
            if storage.roster_row_occupies(row)
        ]
        if occupying:
            raise ValueError("Claims are limited to available players")
        drop_player_id = str(claim.get("drop_player_id") or "").strip() or None
        if drop_player_id == player_id:
            raise ValueError("A claim cannot drop the player being added")
        if drop_player_id and drop_player_id not in owned_ids:
            raise ValueError("Conditional drop must be on your current roster")
        claim = {**claim, "position": position}
        seen.add(player_id)
        normalized.append((rank, player_id, drop_player_id, claim))
    stamp = storage._utcnow()
    with storage.get_conn() as conn:
        if conn.execute(
            "SELECT 1 FROM waiver_process WHERE league_id=? AND window_id=?",
            (league_id, window_id),
        ).fetchone():
            raise ValueError("This waiver window has already processed")
        conn.execute(
            "UPDATE waiver_claim SET status='cancelled',updated_at=? WHERE league_id=? AND window_id=? AND team_id=? AND status='open'",
            (stamp, league_id, window_id, team_id),
        )
        for rank, player_id, drop_player_id, claim in normalized:
            conn.execute(
                """INSERT INTO waiver_claim
                   (id,league_id,season,window_id,team_id,player_id,player_name,nfl_team,position,
                    claim_rank,drop_player_id,status,user_sub,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?)""",
                (
                    str(uuid.uuid4()), league_id, int(league["season"]), window_id, team_id,
                    player_id, claim.get("player_name"), claim.get("team"), claim.get("position"),
                    rank, drop_player_id, user_sub, stamp, stamp,
                ),
            )
    return list_claims(league_id, window_id, team_id)


def list_claims(league_id: str, window_id: str, team_id: str | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM waiver_claim WHERE league_id=? AND window_id=? AND status='open'"
    params: list[Any] = [league_id, window_id]
    if team_id:
        sql += " AND team_id=?"
        params.append(team_id)
    sql += " ORDER BY team_id,claim_rank"
    with storage.get_conn() as conn:
        return [dict(row) for row in conn.execute(sql, params).fetchall()]


def _active_roster(conn: sqlite3.Connection, workspace_id: str, team_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM roster_slot WHERE workspace_id=? AND team_id=?",
        (workspace_id, team_id),
    ).fetchall()
    return [dict(row) for row in rows if storage.roster_row_occupies(row)]


def _active_owner(conn: sqlite3.Connection, workspace_id: str, player_id: str) -> str | None:
    rows = conn.execute(
        "SELECT * FROM roster_slot WHERE workspace_id=? AND player_id=?",
        (workspace_id, player_id),
    ).fetchall()
    row = next((item for item in rows if storage.roster_row_occupies(item)), None)
    return str(row["team_id"]) if row else None


def waiver_protection(league_id: str, player_id: str) -> dict[str, Any] | None:
    with storage.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM waiver_protection WHERE league_id=? AND player_id=?",
            (league_id, player_id),
        ).fetchone()
        if row and datetime.fromisoformat(str(row["eligible_at"])) <= datetime.now(timezone.utc):
            conn.execute(
                "DELETE FROM waiver_protection WHERE league_id=? AND player_id=?",
                (league_id, player_id),
            )
            row = None
    return dict(row) if row else None


def _protect_drop(
    conn: sqlite3.Connection,
    league_id: str,
    window_id: str,
    team_id: str,
    player_id: str,
    stamp: str,
) -> None:
    now_et = datetime.now(tz=ET)
    days_until_wednesday = (2 - now_et.weekday()) % 7
    eligible = (now_et + timedelta(days=days_until_wednesday)).replace(
        hour=10, minute=0, second=0, microsecond=0
    )
    if eligible <= now_et + timedelta(hours=24):
        eligible += timedelta(days=7)
    conn.execute(
        "INSERT OR REPLACE INTO waiver_protection VALUES (?,?,?,?,?)",
        (league_id, player_id, team_id, eligible.astimezone(timezone.utc).isoformat(), stamp),
    )


def process_claims(league_id: str, window_id: str) -> dict[str, Any]:
    league, rules = _league(league_id)
    priority = waiver_priority(league_id)
    if not priority["confirmed"]:
        raise ValueError("Commissioner must confirm the initial waiver order")
    workspace_id = storage.roster_workspace_for_league(league)
    stamp = storage._utcnow()
    with storage.get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        prior = conn.execute(
            "SELECT result_json FROM waiver_process WHERE league_id=? AND window_id=?",
            (league_id, window_id),
        ).fetchone()
        if prior:
            result = json.loads(prior["result_json"])
            result["already_processed"] = True
            return result
        priority_rows = _priority_rows(conn, league_id, int(league["season"]))
        queue = [str(row["team_id"]) for row in priority_rows]
        claims = [
            dict(row) for row in conn.execute(
                "SELECT * FROM waiver_claim WHERE league_id=? AND window_id=? AND status='open' ORDER BY claim_rank,created_at",
                (league_id, window_id),
            ).fetchall()
        ]
        awarded: list[dict[str, Any]] = []
        failed: list[dict[str, Any]] = []
        while claims:
            progressed = False
            for team_id in list(queue):
                claim = next((row for row in claims if str(row["team_id"]) == team_id), None)
                if claim is None:
                    continue
                claims.remove(claim)
                progressed = True
                reason = None
                if _active_owner(conn, workspace_id, str(claim["player_id"])):
                    reason = "already_rostered"
                roster = _active_roster(conn, workspace_id, team_id)
                drop_row = None
                drop_player_id = claim.get("drop_player_id")
                if not reason and drop_player_id:
                    drop_row = next((row for row in roster if str(row["player_id"]) == str(drop_player_id)), None)
                    if drop_row is None:
                        reason = "conditional_drop_unavailable"
                    else:
                        roster = [row for row in roster if int(row["id"]) != int(drop_row["id"])]
                if not reason:
                    try:
                        assert_can_acquire(rules, roster, str(claim.get("position") or ""))
                    except ValueError as exc:
                        reason = str(exc)
                if reason:
                    conn.execute(
                        "UPDATE waiver_claim SET status='failed',outcome_reason=?,updated_at=? WHERE id=?",
                        (reason, stamp, claim["id"]),
                    )
                    failed.append({"claim_id": claim["id"], "player_id": claim["player_id"], "team_id": team_id, "reason": reason})
                    continue
                if drop_row:
                    conn.execute(f"SAVEPOINT claim_{claim['id'].replace('-', '')}")
                    conn.execute("DELETE FROM roster_slot WHERE id=?", (drop_row["id"],))
                    _protect_drop(conn, league_id, window_id, team_id, str(drop_row["player_id"]), stamp)
                try:
                    slot = storage._insert_roster_slot_conn(
                        conn,
                        workspace_id,
                        {
                            "player_id": claim["player_id"],
                            "player_name": claim.get("player_name"),
                            "team": claim.get("nfl_team"),
                            "position": claim.get("position") or "WR",
                            "salary": 0.0,
                            "contract_years": 1,
                            "source": "waiver",
                            "contract": {"acquisition_type": "waiver", "years_remaining": 1, "current_salary": 0.0},
                        },
                        team_id,
                    )
                except sqlite3.IntegrityError:
                    if drop_row:
                        conn.execute(f"ROLLBACK TO claim_{claim['id'].replace('-', '')}")
                        conn.execute(f"RELEASE claim_{claim['id'].replace('-', '')}")
                    conn.execute(
                        "UPDATE waiver_claim SET status='failed',outcome_reason='already_rostered',updated_at=? WHERE id=?",
                        (stamp, claim["id"]),
                    )
                    failed.append({"claim_id": claim["id"], "player_id": claim["player_id"], "team_id": team_id, "reason": "already_rostered"})
                    continue
                if drop_row:
                    conn.execute(f"RELEASE claim_{claim['id'].replace('-', '')}")
                conn.execute("UPDATE waiver_claim SET status='won',updated_at=? WHERE id=?", (stamp, claim["id"]))
                conn.execute(
                    "DELETE FROM waiver_protection WHERE league_id=? AND player_id=?",
                    (league_id, claim["player_id"]),
                )
                conn.execute(
                    "UPDATE waiver_claim SET status='lost',outcome_reason='claimed_by_other_team',updated_at=? WHERE league_id=? AND window_id=? AND player_id=? AND status='open'",
                    (stamp, league_id, window_id, claim["player_id"]),
                )
                claims = [row for row in claims if str(row["player_id"]) != str(claim["player_id"])]
                awarded.append({
                    "claim_id": claim["id"], "player_id": claim["player_id"], "player_name": claim.get("player_name"),
                    "team_id": team_id, "drop_player_id": drop_player_id, "slot_id": int(slot["id"]),
                })
                queue.remove(team_id)
                queue.append(team_id)
            if not progressed:
                break
        conn.execute(
            "UPDATE waiver_priority SET priority=priority+1000 WHERE league_id=? AND season=?",
            (league_id, int(league["season"])),
        )
        for index, team_id in enumerate(queue, start=1):
            conn.execute(
                "UPDATE waiver_priority SET priority=?,updated_at=? WHERE league_id=? AND season=? AND team_id=?",
                (index, stamp, league_id, int(league["season"]), team_id),
            )
        storage._bump_live_for_workspace_conn(conn, workspace_id)
        result = {
            "window_id": window_id,
            "awarded": awarded,
            "failed": failed,
            "awarded_count": len(awarded),
            "priority": queue,
            "already_processed": False,
        }
        conn.execute(
            "INSERT INTO waiver_process VALUES (?,?,?,?)",
            (league_id, window_id, json.dumps(result), stamp),
        )
        conn.execute(
            "INSERT INTO draft_event (league_id,event_type,payload_json,created_at) VALUES (?,?,?,?)",
            (league_id, "waiver_processed", json.dumps(result), stamp),
        )
        return result


def process_due_claim_windows(league_id: str, current_window_id: str | None) -> dict[str, Any] | None:
    with storage.get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT window_id FROM waiver_claim WHERE league_id=? AND status='open'",
            (league_id,),
        ).fetchall()
    results = []
    blocked = []
    for row in rows:
        window_id = str(row["window_id"])
        if current_window_id and window_id == current_window_id:
            continue
        try:
            results.append(process_claims(league_id, window_id))
        except ValueError as exc:
            blocked.append({"window_id": window_id, "reason": str(exc)})
    if not results and not blocked:
        return None
    return {"processed": results, "blocked": blocked}
