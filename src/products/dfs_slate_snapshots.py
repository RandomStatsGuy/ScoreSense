"""Account-scoped, immutable salary catalogs used by optimizer requests.

Catalog membership is distinct from verified scoring, freshness, or game locks.
Uploaded catalogs remain user-provided evidence, not provider certification.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import math
import re

import pandas as pd

from src.core.team_codes import normalize_team_for_match
from src.products.dfs_config import get_site_config
from src.products.dfs_salaries import collapse_captain_rows, _normalize_dfs_position
from src.products.dfs_snapshots import content_id
from src.products import dfs_results

SCHEMA = "dfs_salary_catalog_v1"
FIELDS = ("dfs_id", "player_name", "name_key", "position", "team", "salary", "site",
          "cpt_salary", "cpt_dfs_id", "game_info")


def _text(value):
    return "" if value is None or pd.isna(value) else str(value).strip()


def catalog_rows(frame):
    rows = []
    for original in frame.to_dict("records"):
        row = {key: _text(original.get(key)) for key in FIELDS}
        for key in ("salary", "cpt_salary"):
            value = original.get(key)
            if value is None or pd.isna(value):
                row[key] = None
            else:
                number = float(value)
                if not math.isfinite(number) or number <= 0 or not number.is_integer():
                    raise ValueError("Slate salaries must be positive whole numbers.")
                row[key] = int(number)
        row["team"] = normalize_team_for_match(row["team"])
        row["position"] = _normalize_dfs_position(row["position"])
        row["game_info"] = " ".join(row["game_info"].upper().split())
        if row["salary"] is None or not row["team"] or not row["position"] or not row["name_key"]:
            raise ValueError("Slate rows need a player, team, position and salary.")
        rows.append(row)
    return sorted(rows, key=lambda row: (row["name_key"], row["team"], row["position"], row["dfs_id"]))


def validate_catalog(frame, *, site, slate=None):
    config = get_site_config(site)
    provider = config.get("base_site")
    if not provider:
        raise ValueError("Salary snapshots require a DFS format.")
    captain = bool(config["roster"].get("cpt"))
    category = (slate or {}).get("category")
    if category and ((category == "showdown") != captain):
        raise ValueError("The selected slate does not match this lineup format. Choose a matching slate.")
    if not captain and "roster_position" in frame and frame["roster_position"].eq("CPT").any():
        raise ValueError("Captain salary rows require a single-game format.")
    # Check game labels before collapsing role rows, so contradictory CPT/FLEX
    # records cannot hide behind the surviving FLEX row.
    if captain and "game_info" in frame:
        games = {" ".join(_text(v).upper().split()) for v in frame["game_info"] if _text(v)}
        if len(games) > 1:
            raise ValueError("A single-game slate cannot contain multiple games.")
    collapsed = collapse_captain_rows(frame)
    rows = catalog_rows(collapsed)
    if not rows or len(rows) > 5000:
        raise ValueError("Load a salary catalog containing between 1 and 5,000 players.")
    entities = set()
    ids = {}
    for row in rows:
        if row["game_info"]:
            match = re.match(r"^([A-Z]{2,3})@([A-Z]{2,3})(?:\s|$)", row["game_info"])
            if not match or row["team"] not in {normalize_team_for_match(team) for team in match.groups()}:
                raise ValueError("A salary row does not match its listed game. Check Game Info and team.")
        if row["site"] and row["site"] != provider:
            raise ValueError("Salary rows belong to a different DFS site.")
        if not captain and row["cpt_dfs_id"]:
            raise ValueError("Captain salary rows require a single-game format.")
        entity = (row["name_key"], row["team"], row["position"])
        if entity in entities:
            raise ValueError("Salary rows ambiguously identify a player in this slate.")
        entities.add(entity)
        for role in ("dfs_id", "cpt_dfs_id"):
            identifier = row[role]
            if identifier and identifier in ids and ids[identifier] != entity:
                raise ValueError("A salary ID identifies multiple players in this slate.")
            if identifier:
                ids[identifier] = entity
        if provider == "draftkings" and row["dfs_id"] and row["dfs_id"] == row["cpt_dfs_id"]:
            raise ValueError("DraftKings Captain and FLEX require distinct salary IDs.")
    if captain and len({row["team"] for row in rows}) != 2:
        raise ValueError("A single-game salary catalog must contain exactly two teams.")
    return rows


def capture_salary_snapshot(owner, frame, *, site, source, slate=None):
    if source not in ("provider_catalog", "uploaded_csv"):
        raise ValueError("Unknown salary source.")
    rows = validate_catalog(frame, site=site, slate=slate)
    content = {"schema": SCHEMA, "site": site, "source": source,
               "slate_id": str((slate or {}).get("slate_id") or ""),
               "category": (slate or {}).get("category"), "rows": rows,
               "rules": get_site_config(site)}
    identifier = content_id(content)
    payload = {"id": identifier, "captured_at": datetime.now(timezone.utc).isoformat(), "content": content}
    serialized = json.dumps(payload, allow_nan=False)
    if len(serialized) > 2_000_000:
        raise ValueError("The salary catalog is too large to retain.")
    with dfs_results.connect() as db:
        db.execute("INSERT OR IGNORE INTO salary_snapshots VALUES (?,?,?)", (owner, identifier, serialized))
        saved = db.execute("SELECT payload FROM salary_snapshots WHERE owner=? AND id=?", (owner, identifier)).fetchone()
    return snapshot_summary(json.loads(saved[0]))


def snapshot_summary(record):
    content = record["content"]
    rows = content["rows"]
    return {"id": record["id"], "captured_at": record["captured_at"], "site": content["site"],
            "slate_id": content["slate_id"], "source": content["source"], "player_count": len(rows),
            "scope": "retained_salary_catalog", "game_metadata_complete": all(row["game_info"] for row in rows),
            "scoring_verified": False, "lock_state_verified": False}


def resolve_salary_snapshot(owner, identifier, *, site, slate_id=None, supplied_rows=None, salary_cap=None, max_per_team=None):
    with dfs_results.connect() as db:
        saved = db.execute("SELECT payload FROM salary_snapshots WHERE owner=? AND id=?", (owner, identifier)).fetchone()
    if not saved:
        raise ValueError("Salary snapshot not found for this account. Reload the slate or import salaries again.")
    record = json.loads(saved[0])
    content = record["content"]
    if content_id(content) != record["id"] or content.get("schema") != SCHEMA:
        raise ValueError("Salary snapshot failed its integrity check. Reload salaries.")
    if content["site"] != site or (slate_id and str(slate_id) != content["slate_id"]):
        raise ValueError("Salary snapshot belongs to a different slate or format. Reload salaries.")
    if content["rules"] != json.loads(json.dumps(get_site_config(site))):
        raise ValueError("Lineup rules changed after this salary snapshot. Reload salaries.")
    rules = content["rules"]
    if salary_cap is not None and (salary_cap <= 0 or salary_cap > rules["salary_cap"]):
        raise ValueError("The salary cap exceeds this format's limit or is not positive.")
    team_limit = rules.get("max_per_team_default")
    if team_limit and max_per_team and max_per_team > team_limit:
        raise ValueError(f"This format allows at most {team_limit} players from one team.")
    if supplied_rows is not None:
        supplied = catalog_rows(pd.DataFrame(supplied_rows))
        if supplied != content["rows"]:
            raise ValueError("Salary inputs changed since this slate was loaded. Reload salaries and rebuild.")
    return pd.DataFrame(content["rows"]), snapshot_summary(record)
