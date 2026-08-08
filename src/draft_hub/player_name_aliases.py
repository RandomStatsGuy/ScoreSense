"""League-scoped player name aliases (e.g. Jeanty -> Ashton Jeanty)."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.draft_pool_cache import load_draft_pool
from src.draft_hub.player_name_match import (
    is_garbage_player_name,
    last_name_key,
    name_key,
    names_likely_same,
    norm_name,
)
from src.draft_hub.contract_rows_merged import (
    _display_team_name,
    load_commissioner_rows_by_season as _load_commissioner_rows_by_season,
)
from src.integrations.sleeper import player_by_sleeper_id, search_players


def load_alias_map(league_id: str) -> dict[str, str]:
    """Map normalized alias key -> canonical display name."""
    out: dict[str, str] = {}
    for row in storage.list_player_name_aliases(league_id):
        alias = str(row.get("alias_name") or "").strip()
        canonical = str(row.get("canonical_name") or "").strip()
        if alias and canonical:
            out[name_key(alias)] = canonical
    return out


def resolve_player_name(name: str, alias_map: dict[str, str]) -> str:
    """Return canonical name if aliased, else trimmed input."""
    raw = norm_name(name)
    if not raw:
        return raw
    return alias_map.get(name_key(raw), raw)


def league_name_key(name: str, alias_map: dict[str, str]) -> str:
    return name_key(resolve_player_name(name, alias_map))


def looks_like_abbrev(name: str) -> bool:
    """Cap-sheet shorthand: Jeanty, J. Williams, DK Metcalf, Bills DST."""
    parts = norm_name(name).split()
    if not parts:
        return False
    if len(parts) == 1:
        return True
    if len(parts) == 2:
        head = parts[0]
        tail = parts[1].upper()
        if tail in {"DST", "DEF", "D"}:
            return True
        if len(head) <= 2 and head.endswith("."):
            return True
        if len(head) == 2 and head.isalpha():
            return True
    return False


def alias_meta_by_name_key(league_id: str) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in storage.list_player_name_aliases(league_id):
        alias = str(row.get("alias_name") or "").strip()
        if not alias:
            continue
        out[name_key(alias)] = row
    return out


def alias_meta_by_sleeper_id(league_id: str) -> dict[str, dict[str, Any]]:
    """Map Sleeper player id → preferred alias row (first wins; stable for display)."""
    out: dict[str, dict[str, Any]] = {}
    for row in storage.list_player_name_aliases(league_id):
        sid = str(row.get("sleeper_player_id") or "").strip()
        if not sid or sid in out:
            continue
        out[sid] = row
    return out


def row_sleeper_id(row: dict[str, Any] | None) -> str:
    """Sleeper id from sheet/DB row (week-1 stores it as player_id)."""
    if not row:
        return ""
    for key in ("sleeper_player_id", "player_id"):
        sid = str(row.get(key) or "").strip()
        if sid:
            return sid
    return ""


def enrich_row_with_alias(
    row: dict[str, Any],
    meta_by_key: dict[str, dict[str, Any]],
    meta_by_sid: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    raw = str(row.get("player_name") or "").strip()
    sid = row_sleeper_id(row)
    meta = meta_by_key.get(name_key(raw)) if raw else None
    if not meta and sid and meta_by_sid:
        meta = meta_by_sid.get(sid)

    if not meta and not sid:
        return row

    if not meta and sid:
        info = player_by_sleeper_id(sid)
        if not info:
            return {**row, "sleeper_player_id": sid, "name_mapped": True}
        canonical = str(info.get("player_name") or "").strip()
        out: dict[str, Any] = {**row, "sleeper_player_id": sid, "name_mapped": True}
        if canonical and canonical != raw:
            out["canonical_player_name"] = canonical
        info_pos = str(info.get("position") or "").strip().upper()
        if info_pos in {"DST", "D"}:
            info_pos = "DEF"
        sheet_pos = str(row.get("position") or "").strip().upper()
        weak_sheet_pos = (
            not sheet_pos
            or sheet_pos in {"NAN", "NONE", "WC", "?"}
            or sheet_pos not in {"QB", "RB", "WR", "TE", "K", "DEF", "DST", "D"}
        )
        if info_pos and weak_sheet_pos:
            out["position"] = info_pos
        return out

    canonical = str((meta or {}).get("canonical_name") or "").strip()
    out = {**row, "name_mapped": True}
    meta_sid = str((meta or {}).get("sleeper_player_id") or "").strip() or sid
    if meta_sid:
        out["sleeper_player_id"] = meta_sid
        sid = meta_sid
    if canonical and canonical != raw:
        out["canonical_player_name"] = canonical
    alias_pos = str((meta or {}).get("position") or "").strip().upper()
    if alias_pos in {"DST", "D"}:
        alias_pos = "DEF"
    if sid and not alias_pos:
        info = player_by_sleeper_id(sid)
        if info and info.get("position"):
            alias_pos = str(info["position"]).upper()
            if alias_pos in {"DST", "D"}:
                alias_pos = "DEF"
    sheet_pos = str(row.get("position") or "").strip().upper()
    weak_sheet_pos = (
        not sheet_pos
        or sheet_pos in {"NAN", "NONE", "WC", "?"}
        or sheet_pos not in {"QB", "RB", "WR", "TE", "K", "DEF", "DST", "D"}
    )
    if alias_pos and weak_sheet_pos:
        out["position"] = alias_pos
    return out


def sleeper_id_for_name(name: str, alias_meta: dict[str, dict[str, Any]]) -> str | None:
    meta = alias_meta.get(name_key(name))
    if not meta:
        return None
    sid = str(meta.get("sleeper_player_id") or "").strip()
    return sid or None


def owner_sleeper_ids_on_sheet(
    owner: str,
    rows: list[dict[str, Any]],
    alias_meta: dict[str, dict[str, Any]],
) -> set[str]:
    out: set[str] = set()
    for row in rows:
        if str(row.get("owner_label") or "") != owner:
            continue
        if str(row.get("roster_status") or "active") != "active":
            continue
        sid = sleeper_id_for_name(str(row.get("player_name") or ""), alias_meta)
        if sid:
            out.add(sid)
    return out


def _draft_pool_boost_ids(season: int | None) -> set[str]:
    if not season:
        return set()
    try:
        pool = load_draft_pool(int(season), allow_compute=False)
    except Exception:
        return set()
    if pool.empty:
        return set()
    ids: set[str] = set()
    for col in ("player_id", "sleeper_player_id", "sleeper_id"):
        if col not in pool.columns:
            continue
        for val in pool[col].dropna().astype(str):
            v = val.strip()
            if v.startswith("sleeper-"):
                v = v.split("-", 1)[1]
            if v.isdigit():
                ids.add(v)
    return ids


def prepare_alias_upsert(
    alias_name: str,
    *,
    canonical_name: str | None = None,
    sleeper_player_id: str | None = None,
    position: str | None = None,
) -> dict[str, Any]:
    """Resolve Sleeper id + display fields for storage."""
    alias = str(alias_name or "").strip()
    if not alias:
        raise ValueError("alias_name is required")

    sid = str(sleeper_player_id or "").strip() or None
    canonical = norm_name(canonical_name or "")
    pos = str(position or "").strip().upper() or None
    if pos in {"DST", "D"}:
        pos = "DEF"

    if sid:
        info = player_by_sleeper_id(sid)
        if info:
            if not canonical:
                canonical = norm_name(info.get("player_name") or "")
            if not pos and info.get("position"):
                pos = str(info["position"]).upper()

    if not canonical:
        raise ValueError("Pick a Sleeper player or enter a full name")

    return {
        "alias_name": alias,
        "canonical_name": canonical,
        "sleeper_player_id": sid,
        "position": pos,
    }


def _owner_team_label(owner_label: str | None, team_name: str | None) -> str | None:
    owner = str(owner_label or "").strip()
    team = str(team_name or "").strip()
    if not owner:
        return team or None
    if team and team != owner:
        return f"{owner} · {team}"
    return owner


def _build_cap_sheet_name_refs(league_id: str) -> dict[str, list[dict[str, Any]]]:
    """Map normalized player name -> cap sheet appearances (active rows only)."""
    out: dict[str, list[dict[str, Any]]] = {}
    for season_year, rows in _load_commissioner_rows_by_season().items():
        yr = int(season_year)
        for row in rows:
            if str(row.get("roster_status") or "active") != "active":
                continue
            name = norm_name(row.get("player_name") or "")
            if not name or is_garbage_player_name(name):
                continue
            owner = str(row.get("owner_label") or "").strip()
            if not owner:
                continue
            pk = name_key(name)
            pos = str(row.get("position") or "").upper() or None
            team_name = _display_team_name(league_id, row, season_year=yr)
            out.setdefault(pk, []).append(
                {
                    "player_name": name,
                    "position": pos,
                    "season_year": yr,
                    "owner_label": owner,
                    "team_name": team_name,
                }
            )
    return out


def _prior_sheet_ref(
    refs: list[dict[str, Any]],
    season: int | None,
) -> dict[str, Any] | None:
    if not refs or season is None:
        return None
    prior = int(season) - 1
    for ref in refs:
        if int(ref.get("season_year") or 0) == prior:
            return ref
    older = [r for r in refs if int(r.get("season_year") or 0) < int(season)]
    if older:
        return max(older, key=lambda r: int(r.get("season_year") or 0))
    return None


def _prior_owner_fields(
    refs: list[dict[str, Any]],
    season: int | None,
) -> dict[str, Any]:
    ref = _prior_sheet_ref(refs, season)
    if not ref:
        return {
            "prior_season": None,
            "prior_owner_label": None,
            "prior_team_name": None,
            "prior_team_display": None,
        }
    owner = str(ref.get("owner_label") or "")
    team = str(ref.get("team_name") or "")
    return {
        "prior_season": ref.get("season_year"),
        "prior_owner_label": owner or None,
        "prior_team_name": team or None,
        "prior_team_display": _owner_team_label(owner, team),
    }


def enrich_alias_row(
    row: dict[str, Any],
    refs_by_pk: dict[str, list[dict[str, Any]]],
    *,
    season: int | None = None,
) -> dict[str, Any]:
    alias = str(row.get("alias_name") or "").strip()
    pk = name_key(alias)
    refs = refs_by_pk.get(pk, [])
    return {**row, **_prior_owner_fields(refs, season)}


def enrich_alias_rows(
    league_id: str,
    rows: list[dict[str, Any]],
    *,
    season: int | None = None,
) -> list[dict[str, Any]]:
    refs_by_pk = _build_cap_sheet_name_refs(league_id)
    return [enrich_alias_row(r, refs_by_pk, season=season) for r in rows]


def _collect_sheet_names() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for rows in _load_commissioner_rows_by_season().values():
        for row in rows:
            name = norm_name(row.get("player_name") or "")
            if not name or is_garbage_player_name(name):
                continue
            pk = name_key(name)
            if pk in seen:
                continue
            seen.add(pk)
            out.append(
                {
                    "player_name": name,
                    "position": str(row.get("position") or "").upper() or None,
                }
            )
    return out


def suggest_canonical_names(
    query: str,
    *,
    position: str | None = None,
    season: int | None = None,
    limit: int = 12,
    sleeper_only: bool = False,
) -> list[dict[str, Any]]:
    """Suggest Sleeper players first, then draft pool + commissioner sheets."""
    q = norm_name(query)
    if not q or is_garbage_player_name(q):
        return []

    pos = str(position or "").upper() or None
    if pos in {"DST", "D"}:
        pos = "DEF"

    if sleeper_only:
        return search_players(q, position=pos, limit=limit, boost_ids=set())[:limit]

    boost_ids = _draft_pool_boost_ids(season) if season else set()
    results = search_players(q, position=pos, limit=limit, boost_ids=boost_ids)

    candidates: dict[str, dict[str, Any]] = {}

    def merge(item: dict[str, Any], score: int) -> None:
        key = str(item.get("sleeper_player_id") or "") or name_key(str(item.get("player_name") or ""))
        if not key:
            return
        prev = candidates.get(key)
        if prev and int(prev.get("_score") or 0) >= score:
            return
        candidates[key] = {**item, "_score": score}

    for rank, row in enumerate(results):
        merge(row, 200 - rank)

    def add(name: str, source: str, src_pos: str | None = None, player_id: str | None = None) -> None:
        n = norm_name(name)
        if not n or is_garbage_player_name(n):
            return
        if pos and src_pos and src_pos != pos:
            return
        if name_key(n) == name_key(q):
            return
        ln = last_name_key(q)
        if ln and last_name_key(n) != ln and not names_likely_same(q, n, position=pos, pos_b=src_pos):
            return
        if not ln and not names_likely_same(q, n, position=pos, pos_b=src_pos):
            if q.lower() not in n.lower():
                return
        sid = None
        if player_id:
            pid = str(player_id)
            if pid.isdigit():
                sid = pid
            elif pid.startswith("sleeper-"):
                sid = pid.split("-", 1)[1]
        merge(
            {
                "player_name": n,
                "position": src_pos,
                "sleeper_player_id": sid,
                "source": source,
            },
            40 + len(n.split()) * 5,
        )

    if season:
        try:
            pool = load_draft_pool(int(season), allow_compute=False)
            if not pool.empty and "Player" in pool.columns:
                ln = last_name_key(q)
                for _, row in pool.iterrows():
                    pname = str(row.get("Player") or "")
                    if ln and last_name_key(pname) != ln and q.lower() not in pname.lower():
                        continue
                    ppos = str(row.get("Position") or row.get("position") or "").upper() or None
                    pid = str(row.get("player_id") or row.get("sleeper_player_id") or "") or None
                    add(pname, "draft_pool", ppos, pid)
        except Exception:
            pass

    if not candidates:
        for row in _collect_sheet_names():
            add(row["player_name"], "cap_sheet", row.get("position"))

    ranked = sorted(
        candidates.values(),
        key=lambda c: (-int(c.get("_score") or 0), c.get("player_name") or ""),
    )
    return [
        {k: v for k, v in item.items() if not k.startswith("_")}
        for item in ranked[:limit]
    ]


def find_unmapped_names(
    league_id: str,
    *,
    season: int | None = None,
) -> list[dict[str, Any]]:
    """Names on cap sheets that may be abbreviations (not yet aliased)."""
    alias_map = load_alias_map(league_id)
    refs_by_pk = _build_cap_sheet_name_refs(league_id)
    suggestions_by_key: dict[str, list] = {}
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    for pk, refs in refs_by_pk.items():
        if pk in seen or pk in alias_map:
            continue
        name = refs[0].get("player_name") or ""
        if not name:
            continue
        canonical = resolve_player_name(name, alias_map)
        if name_key(canonical) != pk:
            continue
        pos = str(refs[0].get("position") or "").upper() or None
        if pos in {"DST", "D"}:
            pos = "DEF"
        if not looks_like_abbrev(name):
            continue
        sug = suggestions_by_key.get(pk)
        if sug is None:
            boost_ids = _draft_pool_boost_ids(season)
            sug = search_players(
                name,
                position=pos,
                limit=5,
                boost_ids=boost_ids,
            )
            suggestions_by_key[pk] = sug
        if not sug:
            continue
        seen.add(pk)
        out.append(
            {
                "alias_name": name,
                "position": pos,
                "suggestions": sug,
                **_prior_owner_fields(refs, season),
            }
        )
    out.sort(key=lambda x: (x.get("alias_name") or "").lower())
    return out
