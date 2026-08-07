"""Load annual auction draft wins for contract history tagging."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd
import yaml

from src.config import (
    DRAFT_WINNER_ALIASES_PATH,
    LEAGUE_DRAFT_SOURCES_PATH,
    OLD_LEAGUE_FILES_DIR,
)
from src.draft_hub.legacy_contract_import import TEAM_OWNERS, _norm_name
from src.draft_hub.player_name_match import last_name_key, name_key, names_likely_same
from src.integrations.sleeper import fetch_sleeper_draft_picks

DraftWin = dict[str, Any]


def load_winner_aliases(path: Path | None = None) -> dict[str, str]:
    p = path or DRAFT_WINNER_ALIASES_PATH
    if not p.exists():
        return {}
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    return {str(k).strip(): str(v).strip() for k, v in raw.items()}


def load_draft_source_config(path: Path | None = None) -> dict[str, Any]:
    p = path or LEAGUE_DRAFT_SOURCES_PATH
    if not p.exists():
        return {}
    return yaml.safe_load(p.read_text(encoding="utf-8")) or {}


def resolve_winner_label(short_name: str, aliases: dict[str, str] | None = None) -> str | None:
    """Map spreadsheet/Sleeper short name to commissioner owner_label."""
    aliases = aliases if aliases is not None else load_winner_aliases()
    raw = str(short_name or "").strip()
    if not raw:
        return None
    if raw in aliases:
        return aliases[raw]
    if raw in TEAM_OWNERS:
        return raw
    for owner in TEAM_OWNERS:
        if owner.lower().startswith(raw.lower()) or raw.lower() == owner.split()[0].lower():
            return owner
        first = owner.split()[0].lower()
        if first.startswith(raw.lower()) and len(raw) >= 3:
            return owner
    return None


def parse_draft_excel(filepath: Path) -> dict[int, list[DraftWin]]:
    """Parse combined 2022-2025 draft workbook."""
    if not filepath.exists():
        return {}
    df = pd.read_excel(filepath, sheet_name=0)
    cols = {str(c).strip().lower(): c for c in df.columns}
    player_col = cols.get("player") or df.columns[0]
    price_col = cols.get("$") or cols.get("price") or df.columns[1]
    winner_col = cols.get("winner") or df.columns[2]
    year_col = cols.get("year") or df.columns[3]
    aliases = load_winner_aliases()
    by_season: dict[int, list[DraftWin]] = {}
    for _, row in df.iterrows():
        player = _norm_name(row.get(player_col, ""))
        if not player:
            continue
        try:
            season = int(row.get(year_col))
        except (TypeError, ValueError):
            continue
        owner = resolve_winner_label(str(row.get(winner_col, "")).strip(), aliases)
        if not owner:
            continue
        try:
            cap = float(row.get(price_col))
        except (TypeError, ValueError):
            cap = None
        by_season.setdefault(season, []).append(
            {
                "season_year": season,
                "player_name": player,
                "owner_label": owner,
                "cap_hit": cap,
                "source": "excel",
            }
        )
    return by_season


def _index_draft_wins(wins_by_season: dict[int, list[DraftWin]]) -> dict[int, dict[str, DraftWin]]:
    out: dict[int, dict[str, DraftWin]] = {}
    for season, wins in wins_by_season.items():
        bucket: dict[str, DraftWin] = {}
        for w in wins:
            bucket[name_key(w["player_name"])] = w
        out[int(season)] = bucket
    return out


def find_draft_win(
    season: int,
    player_name: str,
    owner_label: str | None,
    indexed: dict[int, dict[str, DraftWin]],
) -> DraftWin | None:
    season_wins = indexed.get(int(season), {})
    if not season_wins:
        return None
    nk = name_key(player_name)
    direct = season_wins.get(nk)
    if direct and (not owner_label or direct["owner_label"] == owner_label):
        return direct
    for win in season_wins.values():
        if owner_label and win["owner_label"] != owner_label:
            continue
        if names_likely_same(player_name, win["player_name"]):
            return win
    ln = last_name_key(player_name)
    if not ln:
        return None
    candidates = [
        w for w in season_wins.values()
        if last_name_key(w["player_name"]) == ln
        and (not owner_label or w["owner_label"] == owner_label)
    ]
    if len(candidates) == 1:
        return candidates[0]
    return None


def load_2021_draft_wins_from_pdf(base: Path) -> list[DraftWin]:
    """Fallback when inaugural Sleeper team names do not match hub map."""
    pdf = base / "2021 Fantasy Draft Results.pdf"
    if not pdf.exists():
        return []
    from src.draft_hub.legacy_contract_import import load_owner_team_map, parse_2021_pdf

    rows = parse_2021_pdf(pdf, load_owner_team_map())
    wins: list[DraftWin] = []
    for row in rows:
        wins.append(
            {
                "season_year": 2021,
                "player_name": row["player_name"],
                "owner_label": row["owner_label"],
                "cap_hit": row.get("cap_hit"),
                "source": "pdf",
            }
        )
    return wins


def draft_sources_meta_light() -> dict[str, Any]:
    """Fast metadata for API responses — no PDF/Excel parse on hot path."""
    cfg = load_draft_source_config()
    base = OLD_LEAGUE_FILES_DIR
    meta: dict[str, Any] = {"sources": {}, "total_wins": 0}
    if (base / "2021 Fantasy Draft Results.pdf").exists():
        meta["sources"]["2021"] = "pdf"
    excel_name = str(cfg.get("draft_excel") or "2022-2025 Drafts.xlsx")
    if (base / excel_name).exists():
        for yr in (2022, 2023, 2024, 2025):
            meta["sources"][str(yr)] = "excel"
    draft_id = str(cfg.get("inaugural_sleeper_draft_id") or "").strip()
    if draft_id and "2021" not in meta["sources"]:
        meta["sources"]["2021"] = "sleeper"
    meta["total_wins"] = sum(1 for v in meta["sources"].values() if v != "missing")
    return meta


def load_draft_wins_by_season(
    data_dir: Path | None = None,
    *,
    config: dict[str, Any] | None = None,
) -> tuple[dict[int, list[DraftWin]], dict[str, Any]]:
    """Load all draft wins from Sleeper (2021) + Excel (2022+)."""
    base = data_dir or OLD_LEAGUE_FILES_DIR
    cfg = config if config is not None else load_draft_source_config()
    meta: dict[str, Any] = {
        "sources": {},
        "total_wins": 0,
    }
    combined: dict[int, list[DraftWin]] = {}

    draft_id = str(cfg.get("inaugural_sleeper_draft_id") or "").strip()
    if draft_id:
        try:
            picks = fetch_sleeper_draft_picks(draft_id)
            if picks:
                season = int(picks[0]["season_year"])
                combined[season] = picks
                meta["sources"][str(season)] = "sleeper"
                meta["total_wins"] += len(picks)
        except Exception as exc:
            meta["sleeper_error"] = str(exc)

    if not combined.get(2021):
        pdf_wins = load_2021_draft_wins_from_pdf(base)
        if pdf_wins:
            combined[2021] = pdf_wins
            meta["sources"]["2021"] = "pdf"
            meta["total_wins"] += len(pdf_wins)

    excel_name = str(cfg.get("draft_excel") or "2022-2025 Drafts.xlsx")
    excel_path = base / excel_name
    if excel_path.exists():
        by_year = parse_draft_excel(excel_path)
        for yr, wins in by_year.items():
            combined.setdefault(int(yr), []).extend(wins)
            meta["sources"][str(yr)] = "excel"
            meta["total_wins"] += len(wins)

    return combined, meta


def apply_draft_tags_to_rows(
    rows: list[dict[str, Any]],
    wins_by_season: dict[int, list[DraftWin]],
) -> tuple[list[dict[str, Any]], int]:
    indexed = _index_draft_wins(wins_by_season)
    tagged = 0
    out: list[dict[str, Any]] = []
    for row in rows:
        r = dict(row)
        if str(r.get("roster_status") or "active") != "active":
            out.append(r)
            continue
        season = int(r.get("season_year") or 0)
        win = find_draft_win(season, r.get("player_name") or "", r.get("owner_label"), indexed)
        if not win:
            out.append(r)
            continue
        r["acquisition_type"] = "draft"
        if not r.get("contract_phase") or r.get("contract_phase") in ("unknown", "extension", "post_2024_base"):
            r["contract_phase"] = "initial"
        if r.get("original_draft_year") is None:
            r["original_draft_year"] = season
        if win.get("cap_hit") is not None and r.get("cap_hit") is None:
            r["cap_hit"] = win["cap_hit"]
            r["base_salary"] = win["cap_hit"]
        tagged += 1
        out.append(r)
    return out, tagged


def apply_draft_tags_to_dataframe(
    df: pd.DataFrame,
    wins_by_season: dict[int, list[DraftWin]],
) -> tuple[pd.DataFrame, int]:
    if df.empty:
        return df, 0
    records = df.to_dict(orient="records")
    tagged_rows, count = apply_draft_tags_to_rows(records, wins_by_season)
    return pd.DataFrame(tagged_rows), count


def draft_source_status(meta: dict[str, Any]) -> dict[str, str]:
    status: dict[str, str] = {}
    sources = meta.get("sources") or {}
    for yr in range(2021, 2026):
        key = str(yr)
        status[key] = sources.get(key, "missing")
    return status
