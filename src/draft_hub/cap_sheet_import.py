"""Import commissioner cap sheet (manager / position / player / salary / contract grid)."""

from __future__ import annotations

import io
import re
from typing import Any

import pandas as pd

from src.draft_hub.contracts import build_contract_from_roster_edit
from src.draft_hub.schemas import LeagueRules
from src.integrations.external_projections import _normalize_name
from src.integrations.sleeper import players_dataframe

_SKILL = frozenset({"QB", "RB", "WR", "TE", "FB", "K", "DEF", "DST"})
_TERM_CUT = re.compile(r"\bcut\b", re.I)
_TERM_NA = re.compile(r"\bNA\s*2026\b", re.I)
_TERM_YR = re.compile(r"^(\d+)/(\d+)$")
_NUM = re.compile(r"^\d+(?:\.\d+)?$")


def _parse_float(val: Any) -> float | None:
    if val is None:
        return None
    text = str(val).strip().replace("$", "").replace(",", "")
    if not text or text.lower() in {"-", "—", "na", "n/a"}:
        return None
    if _NUM.match(text):
        return float(text)
    return None


def parse_contract_term(term: str) -> tuple[int, bool, bool]:
    """Return (years_remaining, is_cut, na_2026)."""
    raw = str(term or "").strip()
    if not raw:
        return 1, False, False
    if _TERM_CUT.search(raw):
        return 1, True, False
    if _TERM_NA.search(raw):
        return 1, False, True
    m = _TERM_YR.match(raw.split()[0])
    if m:
        current, total = int(m.group(1)), int(m.group(2))
        return max(1, total - current + 1), False, False
    return 1, False, False


def _match_player(name: str, position: str, df: pd.DataFrame) -> dict[str, Any] | None:
    pos = str(position or "").strip().upper()
    if pos == "FB":
        pos = "RB"
    clean = re.sub(r"\s+", " ", str(name or "").strip())
    if not clean:
        return None

    positions = [pos] if pos in _SKILL else list(_SKILL)
    for try_pos in positions:
        hit = _match_player_pos(clean, try_pos, df)
        if hit:
            return hit
    return None


def _match_player_pos(clean: str, pos: str, df: pd.DataFrame) -> dict[str, Any] | None:
    pool = df[df["position"].astype(str).str.upper().isin({pos, "FB" if pos == "RB" else pos})]
    if pool.empty:
        return None

    norm = _normalize_name(clean)
    for _, row in pool.iterrows():
        if _normalize_name(row.get("full_name")) == norm:
            return _row_hit(row, pos)

    parts = [p.strip(".") for p in re.sub(r"[^\w\s'.-]", " ", clean).split() if p.strip(".")]
    if len(parts) < 1:
        return None
    if parts[-1].lower() in {"jr", "sr", "ii", "iii", "iv"} and len(parts) >= 2:
        parts = parts[:-1]
    if len(parts) < 2:
        return None
    last = parts[-1]
    first = parts[0]
    by_last = pool[pool["last_name"].astype(str).str.lower() == last.lower()]
    if by_last.empty:
        # compound last names: St Brown
        if len(parts) >= 3:
            last2 = f"{parts[-2]} {parts[-1]}"
            by_last = pool[pool["last_name"].astype(str).str.lower() == last2.lower()]
    if by_last.empty:
        return None
    if len(by_last) == 1:
        return _row_hit(by_last.iloc[0], pos)

    initial = first[0].lower()
    filt = by_last[by_last["first_name"].astype(str).str.lower().str.startswith(initial)]
    if len(filt) == 1:
        return _row_hit(filt.iloc[0], pos)

    if len(first) >= 2:
        filt2 = by_last[
            by_last["first_name"].astype(str).str.lower().str[0] == first[0].lower()
        ]
        if len(filt2) == 1:
            return _row_hit(filt2.iloc[0], pos)
    return None


def _row_hit(row: pd.Series, position: str) -> dict[str, Any] | None:
    gsis = str(row.get("gsis_id") or row.get("player_id") or "").strip()
    if not gsis.startswith("00-"):
        sid = str(row.get("sleeper_id") or "")
        gsis = f"sleeper-{sid}" if sid else ""
    if not gsis:
        return None
    pos = str(row.get("position") or position).upper()
    if pos == "FB":
        pos = "RB"
    return {
        "player_id": gsis,
        "player_name": str(row.get("full_name") or ""),
        "team": str(row.get("team") or "").upper(),
        "position": pos,
    }


def _build_schedule(
    salary: float,
    years_remaining: int,
    future: list[float | None],
    *,
    rules: LeagueRules,
    na_2026: bool,
) -> dict[str, Any]:
    schedule_vals: list[float] = [salary]
    for val in future:
        if val is not None and val > 0:
            schedule_vals.append(val)
    if len(schedule_vals) == 1 and years_remaining > 1 and not na_2026:
        step = float(rules.contracts.extension_step_up)
        while len(schedule_vals) < years_remaining:
            schedule_vals.append(round(schedule_vals[-1] + step, 2))
    yrs = max(1, len(schedule_vals)) if len(schedule_vals) > 1 else years_remaining
    return build_contract_from_roster_edit(
        rules,
        current_salary=salary,
        years_remaining=yrs,
        salary_schedule=schedule_vals if len(schedule_vals) > 1 else None,
        contract_type="extension" if len(schedule_vals) > 1 else "veteran",
    )


def parse_cap_sheet_tsv(
    raw: bytes | str,
    *,
    season: int = 2025,
    rules: LeagueRules | None = None,
) -> dict[str, Any]:
    """Parse tab-separated cap sheet rows into import-ready roster rows."""
    rules = rules or LeagueRules()
    if isinstance(raw, bytes):
        text = raw.decode("utf-8-sig", errors="replace")
    else:
        text = raw
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return {"rows": [], "unmatched": [], "stats": {}}

    header_like = lines[0].lower()
    if "manager" in header_like or "player" in header_like:
        buf = io.StringIO("\n".join(lines))
        df = pd.read_csv(buf, sep="\t")
    else:
        buf = io.StringIO(
            "manager\tposition\tplayer\tsalary\tcontract\tyear2\tyear3\tyear4\tnotes\n"
            + "\n".join(lines)
        )
        df = pd.read_csv(buf, sep="\t")

    df = df.drop_duplicates()
    players_df = players_dataframe()
    rows_out: list[dict[str, Any]] = []
    unmatched: list[str] = []
    duplicates: list[str] = []
    seen: set[tuple[str, str]] = set()

    col = {c.lower().strip(): c for c in df.columns}
    mgr_c = col.get("manager") or col.get("manager_team") or df.columns[0]
    pos_c = col.get("position") or col.get("pos") or df.columns[1]
    name_c = col.get("player") or col.get("player_name") or df.columns[2]
    sal_c = col.get("salary") or col.get("cap_hit") or df.columns[3]
    term_c = col.get("contract") or col.get("term") or (df.columns[4] if len(df.columns) > 4 else None)
    y2_c = col.get("year2") or (df.columns[5] if len(df.columns) > 5 else None)
    y3_c = col.get("year3") or (df.columns[6] if len(df.columns) > 6 else None)
    y4_c = col.get("year4") or (df.columns[7] if len(df.columns) > 7 else None)

    for _, r in df.iterrows():
        mgr = str(r.get(mgr_c) or "").strip()
        pos = str(r.get(pos_c) or "").strip().upper()
        pname = str(r.get(name_c) or "").strip()
        if not mgr or not pname:
            continue
        if not pos:
            pos = "WR"

        salary = _parse_float(r.get(sal_c)) if sal_c else None
        term_raw = str(r.get(term_c) or "").strip() if term_c else ""
        years_rem, is_cut, na_2026 = parse_contract_term(term_raw)
        future = [
            _parse_float(r.get(y2_c)) if y2_c else None,
            _parse_float(r.get(y3_c)) if y3_c else None,
            _parse_float(r.get(y4_c)) if y4_c else None,
        ]

        if pos == "CUT" or (is_cut and pos not in _SKILL):
            pos = pos if pos in _SKILL else "WR"
            hit = _match_player(pname, pos, players_df)
            if not hit:
                unmatched.append(f"{mgr}: CUT {pname}")
                continue
            dead = salary if salary is not None else 0.0
            key = (mgr.lower(), hit["player_id"])
            if key in seen:
                duplicates.append(f"{mgr}: CUT {pname}")
                continue
            seen.add(key)
            contract = build_contract_from_roster_edit(rules, current_salary=dead, years_remaining=1)
            rows_out.append({
                **hit,
                "salary": dead,
                "contract_years": 1,
                "contract": contract,
                "roster_status": "cut_before_draft",
                "manager_team": mgr,
                "source": "sheet",
            })
            continue

        if pos not in _SKILL:
            continue
        if salary is None and not term_raw:
            continue

        hit = _match_player(pname, pos, players_df)
        if not hit:
            unmatched.append(f"{mgr}: {pname} ({pos})")
            continue

        key = (mgr.lower(), hit["player_id"])
        if key in seen:
            duplicates.append(f"{mgr}: {pname} ({pos})")
            continue
        seen.add(key)

        cap = float(salary if salary is not None else 1.0)
        contract = _build_schedule(cap, years_rem, future, rules=rules, na_2026=na_2026)
        status = "cut_before_draft" if is_cut else "active"
        rows_out.append({
            **hit,
            "salary": contract["current_salary"],
            "contract_years": contract["years_remaining"],
            "contract": contract,
            "roster_status": status,
            "manager_team": mgr,
            "source": "sheet",
        })

    teams = sorted({str(r["manager_team"]) for r in rows_out})
    return {
        "rows": rows_out,
        "teams_found": teams,
        "unmatched": unmatched,
        "duplicates": duplicates,
        "stats": {
            "matched": len(rows_out),
            "unmatched": len(unmatched),
            "duplicates": len(duplicates),
            "teams": len(teams),
        },
    }


def validate_cap_sheet_for_league(
    league_id: str,
    parsed: dict[str, Any],
    manager_map: dict[str, str],
    *,
    replace_existing: bool = True,
    contracts_only: bool = False,
) -> dict[str, Any]:
    """Dry-run cap sheet import — structured errors/warnings, no DB writes."""
    from src.draft_hub import storage

    errors: list[str] = []
    warnings: list[str] = []

    if not parsed.get("rows") and not parsed.get("unmatched"):
        errors.append("File is empty or has no parseable rows.")

    for item in parsed.get("unmatched") or []:
        errors.append(f"Unmatched player: {item}")

    for item in parsed.get("duplicates") or []:
        warnings.append(f"Duplicate row skipped: {item}")

    league = storage.get_league(league_id)
    if not league:
        errors.append("League not found.")
        return {"ok": False, "errors": errors, "warnings": warnings, "stats": parsed.get("stats") or {}}

    hub_teams = {str(t["name"]).lower(): t for t in storage.list_league_teams(league_id)}

    def _find_team(hub_name: str) -> dict[str, Any] | None:
        key = str(hub_name).lower()
        if key in hub_teams:
            return hub_teams[key]
        for name, team in hub_teams.items():
            if key in name or name in key:
                return team
        return None

    unmapped: list[str] = []
    for mgr in parsed.get("teams_found") or []:
        hub_name = manager_map.get(mgr) or manager_map.get(str(mgr).strip())
        if not hub_name:
            unmapped.append(mgr)
            continue
        if not _find_team(hub_name):
            errors.append(f"Manager {mgr} maps to '{hub_name}' but no matching hub team exists.")

    for mgr in unmapped:
        warnings.append(f"Manager not in manager_team_map.yaml: {mgr}")

    if replace_existing and not contracts_only:
        warnings.append("Replace mode will wipe all league rosters before import.")

    ws_id = storage.roster_workspace_for_league(league)
    current_roster = storage.list_league_roster(ws_id) if ws_id else []
    sheet_ids = {str(r.get("player_id")) for r in parsed.get("rows") or [] if r.get("player_id")}
    overlap = sum(1 for slot in current_roster if str(slot.get("player_id")) in sheet_ids)

    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "stats": parsed.get("stats") or {},
        "teams_found": parsed.get("teams_found") or [],
        "would_replace": bool(replace_existing and not contracts_only),
        "current_roster_count": len(current_roster),
        "sheet_player_overlap": overlap,
    }


def import_cap_sheet_to_league(
    league_id: str,
    parsed: dict[str, Any],
    manager_map: dict[str, str],
    *,
    replace_existing: bool = True,
) -> dict[str, Any]:
    """Apply parsed cap sheet rows to a league workspace."""
    from src.draft_hub import storage

    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    ws_id = storage.roster_workspace_for_league(league)
    hub_teams = {str(t["name"]).lower(): t for t in storage.list_league_teams(league_id)}

    def _find_team(hub_name: str) -> dict[str, Any] | None:
        key = str(hub_name).lower()
        if key in hub_teams:
            return hub_teams[key]
        for name, team in hub_teams.items():
            if key in name or name in key:
                return team
        return None

    if replace_existing:
        with storage.get_conn() as conn:
            conn.execute("DELETE FROM roster_slot WHERE workspace_id = ?", (ws_id,))

    by_team: dict[str, int] = {}
    skipped_mgr: list[str] = []
    for row in parsed.get("rows") or []:
        mgr = str(row.get("manager_team") or "")
        hub_name = manager_map.get(mgr) or manager_map.get(mgr.strip())
        if not hub_name:
            skipped_mgr.append(mgr)
            continue
        team = _find_team(hub_name)
        if not team:
            skipped_mgr.append(f"{mgr}->{hub_name}")
            continue
        payload = {k: v for k, v in row.items() if k != "manager_team"}
        storage.add_roster_slot(ws_id, payload, team_id=str(team["id"]))
        if payload.get("roster_status") and payload["roster_status"] != "active":
            storage.update_roster_slot(
                ws_id,
                payload["player_id"],
                team_id=str(team["id"]),
                roster_status=payload["roster_status"],
                any_team=True,
            )
        label = team["name"]
        by_team[label] = by_team.get(label, 0) + 1

    if not league.get("workspace_id"):
        storage.set_league_workspace_id(league_id, ws_id)

    return {
        "imported": sum(by_team.values()),
        "by_team": by_team,
        "skipped_managers": sorted(set(skipped_mgr)),
    }


def overlay_cap_sheet_contracts(
    league_id: str,
    parsed: dict[str, Any],
    manager_map: dict[str, str],
) -> dict[str, Any]:
    """Apply salaries/contracts from cap sheet without wiping rosters."""
    from src.draft_hub import storage

    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    ws_id = storage.roster_workspace_for_league(league)
    hub_teams = {str(t["name"]).lower(): t for t in storage.list_league_teams(league_id)}

    def _find_team(hub_name: str) -> dict[str, Any] | None:
        key = str(hub_name).lower()
        if key in hub_teams:
            return hub_teams[key]
        for name, team in hub_teams.items():
            if key in name or name in key:
                return team
        return None

    updated = 0
    added = 0
    moved = 0
    skipped_mgr: list[str] = []
    for row in parsed.get("rows") or []:
        mgr = str(row.get("manager_team") or "")
        hub_name = manager_map.get(mgr) or manager_map.get(mgr.strip())
        if not hub_name:
            skipped_mgr.append(mgr)
            continue
        team = _find_team(hub_name)
        if not team:
            skipped_mgr.append(f"{mgr}->{hub_name}")
            continue

        pid = str(row["player_id"])
        payload = {k: v for k, v in row.items() if k != "manager_team"}
        team_id = str(team["id"])
        existing = storage.get_roster_slot(ws_id, pid)
        if existing:
            if str(existing.get("team_id") or "") != team_id:
                storage.move_roster_player(ws_id, pid, team_id)
                moved += 1
            storage.update_roster_slot(
                ws_id,
                pid,
                salary=float(payload["salary"]),
                contract_years=int(payload.get("contract_years") or 1),
                contract=payload.get("contract"),
                roster_status=str(payload.get("roster_status") or "active"),
                any_team=True,
            )
            updated += 1
        else:
            storage.add_roster_slot(ws_id, payload, team_id=team_id)
            if payload.get("roster_status") and payload["roster_status"] != "active":
                storage.update_roster_slot(
                    ws_id,
                    pid,
                    team_id=team_id,
                    roster_status=payload["roster_status"],
                    any_team=True,
                )
            added += 1

    if not league.get("workspace_id"):
        storage.set_league_workspace_id(league_id, ws_id)

    return {
        "updated": updated,
        "added": added,
        "moved": moved,
        "skipped_managers": sorted(set(skipped_mgr)),
    }


def mark_waived_not_on_sleeper(league_id: str) -> dict[str, Any]:
    """Set roster_status=waived for active hub players no longer on any Sleeper roster."""
    from src.draft_hub import storage
    from src.draft_hub.league_sleeper_sync import fetch_all_linked_rosters, resolve_sleeper_league_id

    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    ws_id = storage.roster_workspace_for_league(league)
    sleeper_league_id = resolve_sleeper_league_id(league_id)
    if not sleeper_league_id:
        return {"waived": 0, "skipped": "no_sleeper_league"}

    snapshots = fetch_all_linked_rosters(str(sleeper_league_id))
    live_pids: set[str] = set()
    for snapshot in snapshots.values():
        for player in snapshot.get("players") or []:
            pid = str(player.get("player_id") or "")
            if pid:
                live_pids.add(pid)

    waived = 0
    for slot in storage.list_league_roster(ws_id):
        status = str(slot.get("roster_status") or "active")
        if status in {"cut_before_draft", "waived"}:
            continue
        pid = str(slot.get("player_id") or "")
        if pid and pid not in live_pids:
            storage.update_roster_slot(ws_id, pid, roster_status="waived", any_team=True)
            waived += 1
    return {"waived": waived, "live_sleeper_players": len(live_pids)}


def sync_league_rosters_and_contracts(
    league_id: str,
    parsed: dict[str, Any] | None,
    manager_map: dict[str, str] | None,
) -> dict[str, Any]:
    """
    1) Pull current Sleeper rosters (moves contracts on trades).
    2) Overlay cap-sheet salaries/contracts by player id.
    3) Waive hub players no longer on Sleeper.
    """
    from src.draft_hub.league_sleeper_sync import ensure_sleeper_team_links

    sleeper = ensure_sleeper_team_links(league_id)
    contracts: dict[str, Any] = {}
    if parsed and manager_map is not None:
        contracts = overlay_cap_sheet_contracts(league_id, parsed, manager_map)
    waived = mark_waived_not_on_sleeper(league_id)
    return {"sleeper": sleeper, "contracts": contracts, "waived": waived}
