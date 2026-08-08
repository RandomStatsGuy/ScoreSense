"""Build Historic year sheets from Sleeper week-1 or pre-draft rosters."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import requests

from src.draft_hub import storage
from src.draft_hub.contract_history_audit import _expected_active_cap, _int_year, _name_key
from src.draft_hub.legacy_contract_import import _is_summary_label
from src.draft_hub.legacy_contract_reconcile import SLEEPER_API, fetch_sleeper_transactions
from src.draft_hub.player_name_match import names_likely_same
from src.draft_hub.rules_engine import normalize_position
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.sleeper_acquisition_hints import (
    build_sleeper_roster_owner_map,
    sleeper_league_id_for_season,
)
from src.integrations.sleeper import load_sleeper_players
from src.integrations.sleeper_league import fetch_league_rosters

SOURCE_KIND = "week1_sleeper"
PRE_DRAFT_SOURCE_KIND = "pre_draft_sleeper"
# Preferred Sleeper bases for year sheets (week-1 beats pre-draft when both exist).
SLEEPER_SHEET_SOURCE_KINDS = (SOURCE_KIND, PRE_DRAFT_SOURCE_KIND)


def _week1_kickoff_utc(season_year: int) -> datetime:
    """Earliest regular-season week-1 kickoff; fallback early September."""
    try:
        from zoneinfo import ZoneInfo

        import pandas as pd

        from src.core.schedule_utils import REGULAR_SEASON_MAX_WEEK, _load_schedules

        et = ZoneInfo("America/New_York")
        schedules = _load_schedules([int(season_year)])
        games = schedules[
            (schedules["season"] == int(season_year))
            & (schedules["week"] == 1)
            & (schedules["week"] <= REGULAR_SEASON_MAX_WEEK)
        ]
        earliest: datetime | None = None
        for _, row in games.iterrows():
            day = pd.Timestamp(row["gameday"])
            if pd.isna(day):
                continue
            if day.tzinfo is not None:
                date_et = day.tz_convert(et).date()
            else:
                date_et = day.date()
            text = str(row.get("gametime") or "20:20")
            try:
                hh_s, mm_s = text.split(":", 1)
                hh, mm = int(hh_s), int(mm_s)
            except (TypeError, ValueError):
                hh, mm = 20, 20
            kick = datetime(date_et.year, date_et.month, date_et.day, hh, mm, tzinfo=et)
            kick_utc = kick.astimezone(timezone.utc)
            if earliest is None or kick_utc < earliest:
                earliest = kick_utc
        if earliest is not None:
            return earliest
    except Exception:
        pass
    return datetime(int(season_year), 9, 5, 17, 0, tzinfo=timezone.utc)


def fetch_week1_matchups(sleeper_league_id: str) -> list[dict[str, Any]]:
    resp = requests.get(
        f"{SLEEPER_API}/league/{sleeper_league_id}/matchups/1",
        timeout=30,
    )
    resp.raise_for_status()
    return list(resp.json() or [])


def _abbrev_sheet_name(full_name: str) -> str:
    parts = str(full_name or "").strip().split()
    if len(parts) >= 2:
        return f"{parts[0][0]}. {' '.join(parts[1:])}"
    return str(full_name or "").strip()


def _player_meta(sid: str, raw: dict[str, Any]) -> dict[str, Any]:
    info = raw.get(str(sid)) or {}
    full = str(info.get("full_name") or "").strip()
    pos = normalize_position(str(info.get("position") or info.get("fantasy_positions") or ""))
    # Team DEF ids are often the team abbrev (e.g. DET).
    if not full and len(str(sid)) <= 4 and str(sid).isalpha():
        full = str(sid).upper()
        pos = pos or "DEF"
    if isinstance(info.get("fantasy_positions"), list) and not pos:
        for p in info["fantasy_positions"]:
            np = normalize_position(str(p))
            if np:
                pos = np
                break
    return {
        "sleeper_player_id": str(sid),
        "player_name": full or f"Sleeper {sid}",
        "sheet_name": _abbrev_sheet_name(full) if full else f"Sleeper {sid}",
        "position": pos or "WR",
    }


def fetch_week1_roster_by_owner(
    league_id: str,
    sleeper_league_id: str,
    *,
    season_year: int,
) -> dict[str, list[dict[str, Any]]]:
    """owner_label -> list of player metas from week-1 matchups."""
    lid = sleeper_league_id_for_season(sleeper_league_id, season_year) or sleeper_league_id
    roster_map = build_sleeper_roster_owner_map(league_id, lid, season_year=season_year)
    if not roster_map:
        return {}
    matchups = fetch_week1_matchups(lid)
    raw = load_sleeper_players()
    by_owner: dict[str, list[dict[str, Any]]] = {}
    for row in matchups:
        rid = int(row.get("roster_id") or 0)
        owner = roster_map.get(rid)
        if not owner:
            continue
        players = row.get("players") or []
        seen: set[str] = set()
        bucket = by_owner.setdefault(owner, [])
        for pid in players:
            sid = str(pid)
            if not sid or sid in seen:
                continue
            seen.add(sid)
            bucket.append(_player_meta(sid, raw))
    return by_owner


def fetch_current_roster_by_owner(
    league_id: str,
    sleeper_league_id: str,
    *,
    season_year: int,
) -> dict[str, list[dict[str, Any]]]:
    """owner_label -> player metas from live/pre-draft Sleeper rosters."""
    lid = sleeper_league_id_for_season(sleeper_league_id, season_year) or sleeper_league_id
    roster_map = build_sleeper_roster_owner_map(league_id, lid, season_year=season_year)
    if not roster_map:
        return {}
    try:
        rosters = fetch_league_rosters(lid)
    except Exception:
        return {}
    raw = load_sleeper_players()
    by_owner: dict[str, list[dict[str, Any]]] = {}
    for roster in rosters:
        rid = int(roster.get("roster_id") or 0)
        owner = roster_map.get(rid)
        if not owner:
            continue
        players = roster.get("players") or []
        seen: set[str] = set()
        bucket = by_owner.setdefault(owner, [])
        for pid in players:
            sid = str(pid)
            if not sid or sid in seen:
                continue
            seen.add(sid)
            bucket.append(_player_meta(sid, raw))
    return by_owner


def partition_pre_week1_transactions(
    sleeper_league_id: str,
    *,
    season_year: int,
) -> dict[str, list[dict[str, Any]]]:
    """Split completed TX into pre_week1 vs from_week1 by kickoff time."""
    kickoff = _week1_kickoff_utc(season_year)
    pre: list[dict[str, Any]] = []
    post: list[dict[str, Any]] = []
    for tx in fetch_sleeper_transactions(sleeper_league_id, include_round_zero=True):
        if str(tx.get("status") or "").lower() not in ("complete", "approved"):
            continue
        created_ms = tx.get("created")
        try:
            created = datetime.fromtimestamp(int(created_ms) / 1000, tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            post.append(tx)
            continue
        if created < kickoff:
            pre.append(tx)
        else:
            post.append(tx)
    return {"pre_week1": pre, "from_week1": post, "kickoff_utc": kickoff.isoformat()}


def _find_row_by_name(
    rows: list[dict[str, Any]],
    *,
    player_name: str,
    position: str | None = None,
    owner: str | None = None,
    active_only: bool = False,
) -> dict[str, Any] | None:
    pk = _name_key(player_name)
    hits: list[dict[str, Any]] = []
    for row in rows:
        if owner and str(row.get("owner_label") or "") != owner:
            continue
        if active_only and str(row.get("roster_status") or "active") == "cut":
            continue
        rname = str(row.get("player_name") or "")
        if _name_key(rname) == pk or names_likely_same(
            player_name, rname, position=position, pos_b=row.get("position")
        ):
            hits.append(row)
    if not hits:
        return None
    hits.sort(
        key=lambda r: (
            0 if str(r.get("roster_status") or "active") != "cut" else 1,
            0 if str(r.get("source_kind") or "") == "manual" else 1,
            -(float(r.get("cap_hit") or r.get("base_salary") or 0)),
        )
    )
    return hits[0]


def _salary_seed_sources(league_id: str, season_year: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Y and Y-1 rows for salary seeding (Excel + DB, excluding prior week1 rebuild noise ok)."""
    from src.draft_hub.contract_rows_merged import load_commissioner_rows_by_season

    file_by = load_commissioner_rows_by_season()
    y_rows = list(file_by.get(int(season_year)) or [])
    y1_rows = list(file_by.get(int(season_year) - 1) or [])
    for r in storage.list_league_contract_rows(league_id, season_year=int(season_year)):
        if str(r.get("source_kind") or "") in SLEEPER_SHEET_SOURCE_KINDS:
            continue
        y_rows.append(r)
    for r in storage.list_league_contract_rows(league_id, season_year=int(season_year) - 1):
        y1_rows.append(r)
    return y_rows, y1_rows


def _seed_salary_for_player(
    *,
    owner: str,
    meta: dict[str, Any],
    y_rows: list[dict[str, Any]],
    y1_rows: list[dict[str, Any]],
    rules: LeagueRules,
    season_year: int,
) -> tuple[dict[str, Any], str]:
    """Return partial row fields + seed_source label."""
    name = str(meta.get("sheet_name") or meta.get("player_name") or "")
    pos = str(meta.get("position") or "")
    full = str(meta.get("player_name") or name)

    same_owner = _find_row_by_name(
        y_rows, player_name=full, position=pos, owner=owner, active_only=False
    )
    if same_owner is None:
        same_owner = _find_row_by_name(
            y_rows, player_name=name, position=pos, owner=owner, active_only=False
        )
    if same_owner is not None and str(same_owner.get("roster_status") or "active") != "cut":
        hit = same_owner.get("cap_hit")
        if hit is None:
            hit = same_owner.get("base_salary")
        return {
            "player_name": same_owner.get("player_name") or name,
            "position": same_owner.get("position") or pos,
            "cap_hit": hit,
            "base_salary": same_owner.get("base_salary", hit),
            "prior_salary": same_owner.get("prior_salary"),
            "acquisition_type": same_owner.get("acquisition_type"),
            "contract_phase": same_owner.get("contract_phase"),
            "original_draft_year": _int_year(same_owner.get("original_draft_year")),
            "status_note": same_owner.get("status_note"),
            "needs_review": bool(same_owner.get("needs_review")) or hit is None,
            "review_reason": same_owner.get("review_reason")
            or ("Missing salary" if hit is None else None),
        }, "same_owner_y"

    other = _find_row_by_name(y_rows, player_name=full, position=pos, active_only=True)
    if other is None:
        other = _find_row_by_name(y_rows, player_name=name, position=pos, active_only=True)
    if other is not None and str(other.get("owner_label") or "") != owner:
        hit = other.get("cap_hit")
        if hit is None:
            hit = other.get("base_salary")
        return {
            "player_name": other.get("player_name") or name,
            "position": other.get("position") or pos,
            "cap_hit": hit,
            "base_salary": other.get("base_salary", hit),
            "prior_salary": other.get("prior_salary") or hit,
            "acquisition_type": "trade",
            "contract_phase": other.get("contract_phase"),
            "original_draft_year": _int_year(other.get("original_draft_year")),
            "status_note": f"Pre-W1 / sheet owner was {other.get('owner_label')}",
            "needs_review": True,
            "review_reason": f"Salary from {other.get('owner_label')} Y sheet (pre-W1 trade?)",
        }, "other_owner_y"

    prior = _find_row_by_name(y1_rows, player_name=full, position=pos, active_only=True)
    if prior is None:
        prior = _find_row_by_name(y1_rows, player_name=name, position=pos, active_only=True)
    if prior is not None:
        from src.draft_hub.acquisition_semantics import is_fa_contract

        # FA contracts expire before draft — never renew into the next year sheet.
        if is_fa_contract(prior):
            return {
                "player_name": prior.get("player_name") or name,
                "position": prior.get("position") or pos,
                "cap_hit": None,
                "base_salary": None,
                "prior_salary": prior.get("cap_hit") if prior.get("cap_hit") is not None else prior.get("base_salary"),
                "acquisition_type": None,
                "contract_phase": None,
                "original_draft_year": _int_year(prior.get("original_draft_year")),
                "status_note": None,
                "needs_review": True,
                "review_reason": "Prior year was FA contract ($1) — expires before draft",
            }, "needs_salary"

        expected = _expected_active_cap(prior, season_year=season_year, rules=rules.contracts)
        prior_hit = prior.get("cap_hit")
        if prior_hit is None:
            prior_hit = prior.get("base_salary")
        return {
            "player_name": prior.get("player_name") or name,
            "position": prior.get("position") or pos,
            "cap_hit": expected,
            "base_salary": expected,
            "prior_salary": prior_hit,
            "acquisition_type": None,
            "contract_phase": prior.get("contract_phase") or "post_2024_base",
            "original_draft_year": _int_year(prior.get("original_draft_year")),
            "status_note": None,
            "needs_review": expected is None,
            "review_reason": "Could not renew prior salary" if expected is None else None,
        }, "prior_year_renewal"

    return {
        "player_name": name,
        "position": pos or "WR",
        "cap_hit": None,
        "base_salary": None,
        "prior_salary": None,
        "acquisition_type": None,
        "contract_phase": None,
        "original_draft_year": None,
        "status_note": None,
        "needs_review": True,
        "review_reason": "Missing salary — set $ on the year sheet",
    }, "needs_salary"


def _prior_year_fa_contract_row(
    y1_rows: list[dict[str, Any]],
    *,
    meta: dict[str, Any],
) -> dict[str, Any] | None:
    """Prior-season FA contract ($1, expires before draft) — not a keeper for Y."""
    from src.draft_hub.acquisition_semantics import is_fa_contract

    name = str(meta.get("sheet_name") or meta.get("player_name") or "")
    full = str(meta.get("player_name") or name)
    pos = str(meta.get("position") or "")
    for candidate in (full, name):
        if not candidate:
            continue
        prior = _find_row_by_name(y1_rows, player_name=candidate, position=pos, active_only=True)
        if prior is not None and is_fa_contract(prior):
            return prior
    return None


def _build_roster_contract_rows(
    league_id: str,
    *,
    season_year: int,
    by_owner: dict[str, list[dict[str, Any]]],
    source_kind: str,
    season_lid: str,
    keep_y_cuts: bool = True,
    skip_prior_fa_contracts: bool = False,
    trade_flag_note: str | None = " · pre-W1 trade flagged",
    pre_trades: list[dict[str, Any]] | None = None,
    extra_report: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    league = storage.get_league(league_id) or {}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    y_rows, y1_rows = _salary_seed_sources(league_id, int(season_year))
    pre_trades = list(pre_trades or [])

    rows: list[dict[str, Any]] = []
    report: dict[str, Any] = {
        "season_year": int(season_year),
        "sleeper_league_id": season_lid,
        "source_kind": source_kind,
        "owners": len(by_owner),
        "active_players": 0,
        "salary_seeded": 0,
        "needs_salary": 0,
        "cuts_kept": 0,
        "skipped_fa_contract": 0,
        "pre_week1_trades": len(pre_trades),
        "pre_week1_trade_ids": [str(t.get("transaction_id") or "") for t in pre_trades[:20]],
        "seed_breakdown": {
            "same_owner_y": 0,
            "other_owner_y": 0,
            "prior_year_renewal": 0,
            "needs_salary": 0,
            "skipped_fa_contract": 0,
        },
        "unmatched_sleeper": [],
        "skipped_fa_contract_players": [],
    }
    if extra_report:
        report.update(extra_report)

    roster_keys: set[tuple[str, str]] = set()
    for owner, players in sorted(by_owner.items()):
        hub_team = storage.resolve_hub_team_name(league_id, int(season_year), owner)
        for meta in players:
            if skip_prior_fa_contracts:
                expired = _prior_year_fa_contract_row(y1_rows, meta=meta)
                if expired is not None:
                    report["skipped_fa_contract"] += 1
                    report["seed_breakdown"]["skipped_fa_contract"] = (
                        report["seed_breakdown"].get("skipped_fa_contract", 0) + 1
                    )
                    report["skipped_fa_contract_players"].append(
                        {
                            "owner_label": owner,
                            "player_name": expired.get("player_name")
                            or meta.get("player_name"),
                            "prior_owner": expired.get("owner_label"),
                        }
                    )
                    continue

            seeded, source = _seed_salary_for_player(
                owner=owner,
                meta=meta,
                y_rows=y_rows,
                y1_rows=y1_rows,
                rules=rules,
                season_year=int(season_year),
            )
            report["seed_breakdown"][source] = report["seed_breakdown"].get(source, 0) + 1
            if source == "needs_salary" or seeded.get("cap_hit") is None:
                report["needs_salary"] += 1
                report["unmatched_sleeper"].append(
                    {"owner_label": owner, "player_name": seeded.get("player_name")}
                )
            else:
                report["salary_seeded"] += 1

            note = seeded.get("status_note")
            if pre_trades and source == "other_owner_y" and trade_flag_note:
                note = (note or "") + trade_flag_note

            row = {
                "owner_label": owner,
                "hub_team_name": hub_team,
                "player_name": seeded["player_name"],
                "player_id": meta.get("sleeper_player_id"),
                "position": seeded.get("position") or meta.get("position"),
                "base_salary": seeded.get("base_salary"),
                "cap_hit": seeded.get("cap_hit"),
                "prior_salary": seeded.get("prior_salary"),
                "original_draft_year": seeded.get("original_draft_year"),
                "roster_status": "active",
                "contract_phase": seeded.get("contract_phase"),
                "acquisition_type": seeded.get("acquisition_type"),
                "status_note": note,
                "source_kind": source_kind,
                "confidence": source_kind,
                "needs_review": bool(seeded.get("needs_review")),
                "review_reason": seeded.get("review_reason"),
                "sleeper_verified": True,
            }
            rows.append(row)
            report["active_players"] += 1
            roster_keys.add((owner, _name_key(row["player_name"])))
            roster_keys.add((owner, _name_key(meta.get("player_name") or "")))

    if keep_y_cuts:
        for cut in y_rows:
            if str(cut.get("roster_status") or "active") != "cut":
                continue
            owner = str(cut.get("owner_label") or "").strip()
            pk = _name_key(cut.get("player_name") or "")
            if not owner or not pk:
                continue
            if (owner, pk) in roster_keys:
                continue
            if any(k[1] == pk for k in roster_keys):
                continue
            rows.append(
                {
                    "owner_label": owner,
                    "hub_team_name": cut.get("hub_team_name")
                    or storage.resolve_hub_team_name(league_id, int(season_year), owner),
                    "player_name": cut.get("player_name"),
                    "player_id": cut.get("player_id"),
                    "position": cut.get("position"),
                    "base_salary": cut.get("base_salary")
                    if cut.get("base_salary") is not None
                    else cut.get("cap_hit"),
                    "cap_hit": cut.get("cap_hit") if cut.get("cap_hit") is not None else 0.0,
                    "prior_salary": cut.get("prior_salary"),
                    "original_draft_year": _int_year(cut.get("original_draft_year")),
                    "roster_status": "cut",
                    "contract_phase": cut.get("contract_phase"),
                    "acquisition_type": cut.get("acquisition_type"),
                    "status_note": cut.get("status_note") or "CUT",
                    "source_kind": source_kind,
                    "confidence": source_kind,
                    "needs_review": False,
                    "review_reason": None,
                    "sleeper_verified": False,
                }
            )
            report["cuts_kept"] += 1

    report["row_count"] = len(rows)
    report["unmatched_sleeper"] = report["unmatched_sleeper"][:40]
    return rows, report


def build_week1_contract_rows(
    league_id: str,
    *,
    season_year: int,
    sleeper_league_id: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Build year-sheet rows from week-1 matchups + salary seed order."""
    sleeper_lid = str(
        sleeper_league_id
        or (storage.get_league(league_id) or {}).get("sleeper_league_id")
        or ""
    ).strip()
    if not sleeper_lid:
        raise ValueError("League is not linked to Sleeper")

    season_lid = sleeper_league_id_for_season(sleeper_lid, season_year) or sleeper_lid
    by_owner = fetch_week1_roster_by_owner(
        league_id, sleeper_lid, season_year=int(season_year)
    )
    if not by_owner:
        raise ValueError(
            f"No week-1 matchup rosters for {season_year} (Sleeper league {season_lid}). "
            "Confirm the season has started and the league id chain resolves. "
            "Before kickoff, use Build pre-draft sheet instead."
        )

    tx_parts = partition_pre_week1_transactions(season_lid, season_year=int(season_year))
    pre_trades = [
        tx for tx in tx_parts["pre_week1"] if str(tx.get("type") or "").lower() == "trade"
    ]
    return _build_roster_contract_rows(
        league_id,
        season_year=int(season_year),
        by_owner=by_owner,
        source_kind=SOURCE_KIND,
        season_lid=season_lid,
        keep_y_cuts=True,
        trade_flag_note=" · pre-W1 trade flagged",
        pre_trades=pre_trades,
        extra_report={"kickoff_utc": tx_parts.get("kickoff_utc")},
    )


def _ensure_owner_map_copied_from_prior(league_id: str, season_year: int) -> None:
    """If season Y has no owner map yet, copy from Y-1 so hub team names resolve."""
    yr = int(season_year)
    if storage.list_owner_season_map(league_id, season_year=yr):
        return
    prior = storage.list_owner_season_map(league_id, season_year=yr - 1)
    for row in prior:
        owner = str(row.get("owner_label") or "").strip()
        team = str(row.get("hub_team_name") or "").strip()
        if not owner or not team:
            continue
        storage.upsert_owner_season_map(
            league_id,
            yr,
            owner,
            team,
            sleeper_user_id=row.get("sleeper_user_id"),
            source_kind="prior_season_copy",
        )


def build_pre_draft_contract_rows(
    league_id: str,
    *,
    season_year: int,
    sleeper_league_id: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Build year-sheet rows from current/pre-draft Sleeper rosters + prior-year $.

    Starting state for the upcoming draft: keepers on Sleeper, salaries renewed from
    Y-1 (or Y sheet if present). Auction / FA lottery fills in later.
    """
    sleeper_lid = str(
        sleeper_league_id
        or (storage.get_league(league_id) or {}).get("sleeper_league_id")
        or ""
    ).strip()
    if not sleeper_lid:
        raise ValueError("League is not linked to Sleeper")

    _ensure_owner_map_copied_from_prior(league_id, int(season_year))
    season_lid = sleeper_league_id_for_season(sleeper_lid, season_year) or sleeper_lid
    by_owner = fetch_current_roster_by_owner(
        league_id, sleeper_lid, season_year=int(season_year)
    )
    if not by_owner:
        raise ValueError(
            f"No Sleeper rosters for {season_year} (league {season_lid}). "
            "Confirm the league is linked and the season id chain resolves."
        )

    rows, report = _build_roster_contract_rows(
        league_id,
        season_year=int(season_year),
        by_owner=by_owner,
        source_kind=PRE_DRAFT_SOURCE_KIND,
        season_lid=season_lid,
        # Fresh year sheet: don't invent Y cut lines when Y usually has no rows yet.
        keep_y_cuts=False,
        # Prior-year FA contracts ($1) expire before draft — still on Sleeper, not keepers.
        skip_prior_fa_contracts=True,
        trade_flag_note=" · owner changed vs prior sheet",
        pre_trades=[],
        extra_report={"roster_mode": "pre_draft"},
    )
    report["skipped_fa_contract_players"] = (report.get("skipped_fa_contract_players") or [])[:40]
    return rows, report


def persist_week1_contract_rows(
    league_id: str,
    season_year: int,
    rows: list[dict[str, Any]],
    *,
    imported_by_sub: str | None = None,
) -> dict[str, Any]:
    """Replace week1_sleeper rows for one season; leave manual/import intact."""
    count = storage.replace_league_contract_season_source(
        league_id,
        int(season_year),
        rows,
        source_kind=SOURCE_KIND,
    )
    storage.record_legacy_import(
        league_id,
        int(season_year),
        source_kind=SOURCE_KIND,
        source_path=f"sleeper:week1:{season_year}",
        imported_by_sub=imported_by_sub,
        row_count=count,
    )
    return {"replaced": count, "source_kind": SOURCE_KIND, "season_year": int(season_year)}


def persist_pre_draft_contract_rows(
    league_id: str,
    season_year: int,
    rows: list[dict[str, Any]],
    *,
    imported_by_sub: str | None = None,
) -> dict[str, Any]:
    """Replace pre_draft_sleeper rows for one season; leave manual/import/week1 intact."""
    count = storage.replace_league_contract_season_source(
        league_id,
        int(season_year),
        rows,
        source_kind=PRE_DRAFT_SOURCE_KIND,
    )
    storage.record_legacy_import(
        league_id,
        int(season_year),
        source_kind=PRE_DRAFT_SOURCE_KIND,
        source_path=f"sleeper:pre_draft:{season_year}",
        imported_by_sub=imported_by_sub,
        row_count=count,
    )
    return {
        "replaced": count,
        "source_kind": PRE_DRAFT_SOURCE_KIND,
        "season_year": int(season_year),
    }


def build_and_persist_week1_sheet(
    league_id: str,
    *,
    season_year: int,
    imported_by_sub: str | None = None,
) -> dict[str, Any]:
    rows, report = build_week1_contract_rows(league_id, season_year=int(season_year))
    persist = persist_week1_contract_rows(
        league_id,
        int(season_year),
        rows,
        imported_by_sub=imported_by_sub,
    )
    return {**report, **persist}


def build_and_persist_pre_draft_sheet(
    league_id: str,
    *,
    season_year: int,
    imported_by_sub: str | None = None,
) -> dict[str, Any]:
    rows, report = build_pre_draft_contract_rows(league_id, season_year=int(season_year))
    persist = persist_pre_draft_contract_rows(
        league_id,
        int(season_year),
        rows,
        imported_by_sub=imported_by_sub,
    )
    return {**report, **persist}
