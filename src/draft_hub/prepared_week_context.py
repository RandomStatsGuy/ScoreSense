"""Durable shared weekly player context; HTTP readers never prepare it.

Only public player data is materialized here. Rosters, lineups, ownership and
league rules are joined from SQLite on each request. A worker atomically replaces
one complete context; readers can use the previous context during a refresh.
"""
from __future__ import annotations

from src.ops.job_diagnostics import observe_job, annotate_job

from collections import OrderedDict
from copy import deepcopy
from datetime import datetime, timezone
from functools import lru_cache
import json
import logging
import os
from pathlib import Path
import re
import tempfile

from src.config import FANTASY_WEEK_CONTEXT_DIR, WEEKLY_PREDICTIONS_DIR
from src.jobs.refresh_lock import RefreshBusy, refresh_lock

SCHEMA_VERSION = "fantasy-week-context-v1"
CADENCE_SECONDS = 30
logger = logging.getLogger(__name__)
_STEM = re.compile(r"^(\d{4})_w(\d{1,2})_inj([01])$")
_WEEKLY = re.compile(r"^(\d{4})_w(\d{1,2})_(?:qb|rb|wr)(_no_inj)?\.meta\.json$")


def context_path(season: int, week: int, apply_injury: bool) -> Path:
    if not 2000 <= int(season) <= 2100 or not 1 <= int(week) <= 18:
        raise ValueError("Unsupported Fantasy week context")
    return FANTASY_WEEK_CONTEXT_DIR / f"{int(season)}_w{int(week)}_inj{int(bool(apply_injury))}.json"


def source_revision(season: int, week: int, apply_injury: bool) -> str:
    from src.draft_hub.weekly_command_center import _weekly_context_revision
    return json.dumps([SCHEMA_VERSION, _weekly_context_revision(season, week, apply_injury)], separators=(",", ":"))


def _pack(index: dict, meta: dict, facts: dict) -> dict:
    # References preserve aliases and ambiguous name candidates without storing
    # each player several times in the JSON file.
    players, references = [], {}
    def ref(entry):
        identity = id(entry)
        if identity not in references:
            references[identity] = len(players)
            players.append(entry)
        return references[identity]
    lookups = {}
    for key, values in meta.items():
        if key in ("_by_name_team",):
            lookups[key] = {name: ref(entry) for name, entry in values.items()}
        elif key in ("_by_name", "_by_roster_name"):
            lookups[key] = {name: [ref(entry) for entry in entries] for name, entries in values.items()}
    return {"players": players, "index": {key: ref(entry) for key, entry in index.items()},
            "lookups": lookups, "meta": {key: value for key, value in meta.items() if key not in lookups},
            "facts": {**facts, "def_vs_pos": [[*key, value] for key, value in facts["def_vs_pos"].items()]}}


def _unpack(payload: dict) -> tuple[dict, dict, dict]:
    players = payload["players"]
    if not isinstance(players, list) or not all(isinstance(entry, dict) for entry in players):
        raise ValueError("Invalid player context")
    if any(not isinstance(value, (str, int, float, bool, type(None))) for entry in players for value in entry.values()):
        raise ValueError("Player context fields must be scalars")
    def entry(reference):
        if type(reference) is not int or not 0 <= reference < len(players):
            raise ValueError("Invalid player reference")
        return players[reference]
    index = {key: entry(reference) for key, reference in payload["index"].items()}
    meta = dict(payload["meta"])
    for key, values in payload["lookups"].items():
        if key == "_by_name_team":
            meta[key] = {name: entry(reference) for name, reference in values.items()}
        elif key in ("_by_name", "_by_roster_name"):
            meta[key] = {name: [entry(reference) for reference in refs] for name, refs in values.items()}
    facts = dict(payload["facts"])
    if any(not isinstance(facts.get(key), dict) for key in ("prior_ppg", "vegas")):
        raise ValueError("Invalid weekly facts")
    if any(not isinstance(value, dict) for value in facts["vegas"].values()):
        raise ValueError("Invalid schedule facts")
    for key in ("by_id", "by_name_team"):
        if key in facts["prior_ppg"] and not isinstance(facts["prior_ppg"][key], dict):
            raise ValueError("Invalid prior PPG lookup")
    facts["def_vs_pos"] = {(pos, opponent): value for pos, opponent, value in facts["def_vs_pos"]}
    if any(not isinstance(value, dict) for value in facts["def_vs_pos"].values()):
        raise ValueError("Invalid defense facts")
    return index, meta, facts


@lru_cache(maxsize=12)
def _read_snapshot(path: str, mtime: int, size: int) -> dict | None:
    try:
        saved = json.loads(Path(path).read_text(encoding="utf-8"))
        if (saved["schema"] != SCHEMA_VERSION or not isinstance(saved.get("revision"), str)
                or not isinstance(saved.get("built_at"), str) or not isinstance(saved.get("context"), list)):
            return None
        saved["context_data"] = _unpack(saved["payload"])
        return saved
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def _snapshot(path: Path, context: tuple) -> dict | None:
    try:
        stat = path.stat()
        saved = _read_snapshot(str(path), stat.st_mtime_ns, stat.st_size)
        return saved if saved and saved["context"] == list(context) else None
    except (OSError, KeyError):
        return None


def request_context(season: int, week: int, apply_injury: bool) -> None:
    """Coalesce a cheap durable hint; no executor or computation in HTTP handlers."""
    path = context_path(season, week, apply_injury).with_suffix(".request")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x", encoding="utf-8"):
            pass
    except FileExistsError:
        pass
    except OSError:
        logger.warning("Could not queue Fantasy week context", exc_info=True)


def _copy_context(data: tuple) -> tuple[dict, dict, dict]:
    index, meta, facts = data
    copies = {}
    def entry_copy(entry):
        identity = id(entry)
        if identity not in copies:
            copies[identity] = dict(entry)  # prepared player fields are scalars
        return copies[identity]
    copied_index = {key: entry_copy(entry) for key, entry in index.items()}
    copied_meta = {key: deepcopy(value) for key, value in meta.items() if not key.startswith("_by_")}
    copied_meta["_by_name_team"] = {key: entry_copy(entry) for key, entry in meta.get("_by_name_team", {}).items()}
    for key in ("_by_name", "_by_roster_name"):
        copied_meta[key] = {name: [entry_copy(entry) for entry in entries] for name, entries in meta.get(key, {}).items()}
    # PPG lookup values are numbers. Copy their dictionaries directly rather
    # than recursively visiting thousands of immutable keys on every request.
    copied_facts = {"prior_ppg": {key: dict(value) if isinstance(value, dict) else value
                                  for key, value in facts.get("prior_ppg", {}).items()},
                    "def_vs_pos": {key: dict(value) for key, value in facts.get("def_vs_pos", {}).items()},
                    "vegas": deepcopy(facts.get("vegas", {}))}
    return copied_index, copied_meta, copied_facts


def load_week_context(season: int, week: int, apply_injury: bool = True) -> tuple[dict, dict, dict]:
    """Read the exact week's last complete snapshot, without waiting for a builder."""
    context = (int(season), int(week), bool(apply_injury))
    path = context_path(*context)
    saved = _snapshot(path, context)
    current = source_revision(*context)
    if saved is None or saved["revision"] != current:
        request_context(*context)
    if saved is None:
        return {}, {"available": False, "available_positions": [], "missing_positions": ["qb", "rb", "wr"],
                    "projections_built_at": None, "context_status": "warming", "context_built_at": None}, {}
    index, meta, facts = _copy_context(saved["context_data"])
    meta.update(context_status="ready" if saved["revision"] == current else "refreshing",
                context_built_at=saved["built_at"])
    return index, meta, facts


@observe_job("fantasy_context.prepare")
def prepare_week_context(season: int, week: int, apply_injury: bool = True) -> dict:
    """Worker/job entry point. Publish only a complete, stable source revision."""
    from src.draft_hub import weekly_command_center as wc
    from src.draft_hub.prepared_k_def_context import prepare_k_def_context
    # Also prepares the week-independent public specialist lookup at startup,
    # ticker passes and explicit projection/data rebuilds. Subsequent contexts
    # perform only a cheap revision check; no duplicate catalog preparation.
    try:
        specialists = prepare_k_def_context()
        if specialists["status"] not in ("current", "prepared"):
            logger.warning("Fantasy specialist context unavailable: %s", specialists["status"])
    except Exception:
        # A specialist-source failure must not stop unrelated weekly preparation.
        logger.exception("Fantasy specialist context preparation failed")
    context = (int(season), int(week), bool(apply_injury))
    path = context_path(*context)
    try:
        with refresh_lock(path.with_suffix(".lock")):
            revision = source_revision(*context)
            annotate_job(season=int(season), week=int(week), apply_injury=bool(apply_injury), input_revision=revision)
            previous = _snapshot(path, context)
            if previous and previous["revision"] == revision:
                path.with_suffix(".request").unlink(missing_ok=True)
                return {"status": "current"}
            index, meta = wc._build_projection_index(season, week, apply_injury_adjustments=apply_injury)
            wc._VEGAS_CACHE.pop((int(season), int(week)), None)
            facts = {"prior_ppg": wc._load_prior_ppg_index(season),
                     "def_vs_pos": wc._load_def_vs_pos(season, week),
                     "vegas": wc._load_vegas_teams(season, week)}
            # Keep the previous complete snapshot if an upstream refresh is in
            # progress or temporarily removed one of its positional artifacts.
            previous_positions = set(previous["context_data"][1].get("available_positions", [])) if previous else set()
            if revision != source_revision(*context) or previous_positions - set(meta["available_positions"]):
                request_context(*context)
                return {"status": "sources_changing"}
            record = {"schema": SCHEMA_VERSION, "context": list(context), "revision": revision,
                      "built_at": datetime.now(timezone.utc).isoformat(), "payload": _pack(index, meta, facts)}
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
                    temporary = Path(handle.name)
                    json.dump(record, handle, allow_nan=False, separators=(",", ":"))
                os.replace(temporary, path)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
            path.with_suffix(".request").unlink(missing_ok=True)
            return {"status": "prepared", "players": len(record["payload"]["players"])}
    except RefreshBusy:
        return {"status": "busy"}


def discover_contexts(*, current_only: bool = False) -> list[tuple[int, int, bool]]:
    """Current league seasons first, then pending, published and historical weeks."""
    from src.draft_hub import storage
    from src.draft_hub.weekly_command_center import resolve_week_context
    contexts = OrderedDict()
    def add(season, week, injury):
        if not 2000 <= int(season) <= 2100 or not 1 <= int(week) <= 18:
            return
        context_path(season, week, injury)
        contexts[(int(season), int(week), bool(injury))] = None
    season, week = resolve_week_context(None, None)
    for injury in (True, False):
        add(season, week, injury)
    with storage.get_conn() as conn:
        seasons = [row[0] for row in conn.execute("SELECT DISTINCT season FROM league WHERE season BETWEEN 2000 AND 2100")]
    for hub_season in seasons:
        season, week = resolve_week_context(None, None, hub_season=hub_season)
        for injury in (True, False):
            add(season, week, injury)
    if not current_only:
        for path in sorted(FANTASY_WEEK_CONTEXT_DIR.glob("*"), key=lambda path: path.suffix != ".request"):
            match = _STEM.match(path.stem) if path.suffix in (".json", ".request") else None
            if match:
                add(int(match[1]), int(match[2]), match[3] == "1")
        for path in WEEKLY_PREDICTIONS_DIR.glob("*.meta.json"):
            match = _WEEKLY.match(path.name)
            if match:
                add(int(match[1]), int(match[2]), not bool(match[3]))
    return list(contexts)


@observe_job("fantasy_context.batch", cadence_s=CADENCE_SECONDS)
def refresh_week_contexts(*, current_only: bool = False, max_preparations: int | None = 2) -> dict:
    results = {}
    preparations = 0
    for season, week, injury in discover_contexts(current_only=current_only):
        key = f"{season}:w{week}:inj{int(injury)}"
        try:
            results[key] = prepare_week_context(season, week, injury)
        except Exception:
            logger.exception("Fantasy week context preparation failed for %s", key)
            results[key] = {"status": "error"}
        if results[key]["status"] != "current":
            preparations += 1
        # The application's one CPU worker also owns native scoring and refresh
        # jobs. Yield after a small batch rather than monopolizing it on startup
        # migrations or a source replacement affecting many historical weeks.
        if max_preparations is not None and preparations >= max_preparations:
            break
    annotate_job(checked=len(results), current=sum(item.get("status") == "current" for item in results.values()),
                 prepared=sum(item.get("status") == "prepared" for item in results.values()),
                 failed=sum(item.get("status") == "error" for item in results.values()))
    return results


def prewarm_week_context(season: int, week: int) -> dict:
    return {f"inj{int(injury)}": prepare_week_context(season, week, injury) for injury in (True, False)}
