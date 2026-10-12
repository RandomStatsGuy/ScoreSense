"""Source-backed, descriptive Classic opportunity evidence.

This module never fetches a feed, fits a model, adjusts a forecast, or submits an
entry. The inherited play blend and same-universe dropback product are unfitted
screens. Historical target/carry shares are observations, not role forecasts.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re
from urllib.parse import urlsplit
from uuid import uuid4

from src.core.team_codes import normalize_team_for_match

SCHEMA_VERSION = "dfs_opportunity_evidence_v1"
MAX_BYTES = 20 * 1024 * 1024
MAX_ROWS = 50000
PLAY_DEFINITION = {
    "id": "accepted_scrimmage_v1",
    "description": "Accepted offensive scrimmage plays; exclude no-plays, kneels, spikes and two-point attempts; include overtime.",
    "identities": ["plays = designed_runs + dropbacks", "dropbacks = sacks + scrambles + throws",
                   "throws = targeted + untargeted"],
    "carries_denominator": "designed_runs + scrambles (excluding kneels)",
    "targets_denominator": "targeted throws, including residual/unselected receivers",
    "routes": "Unavailable without a separately verified route observation; targets are not routes.",
}
_COUNTS = ("plays", "designed_runs", "dropbacks", "sacks", "scrambles", "throws", "targeted", "untargeted")
_RIGHTS = ("personal_analysis", "hosted_ingestion", "display", "redistribution", "training", "external_model")


def _text(value, label, *, optional=False):
    if optional and value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 2048:
        raise ValueError(f"{label} must be a nonempty string.")
    return value.strip()


def _id(value, label):
    text = _text(value, label)
    if text != value:
        raise ValueError(f"{label} must be exact, without padding.")
    return text


def _time(value, label, *, optional=False):
    text = _text(value, label, optional=optional)
    if text is None:
        return None
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", text):
        raise ValueError(f"{label} needs an ISO timestamp with an explicit timezone.")
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"Invalid {label} timestamp.") from exc


def _count(value, label, *, optional=False, decimal=False):
    if optional and value in (None, ""):
        return None
    if isinstance(value, bool):
        raise ValueError(f"{label} needs a finite nonnegative count.")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{label} needs a finite nonnegative count.") from exc
    if not math.isfinite(number) or not 0 <= number <= 1000000 or (not decimal and not number.is_integer()):
        raise ValueError(f"{label} needs a finite nonnegative {'number' if decimal else 'whole count'}.")
    return number if decimal else int(number)


def _team(value):
    team = normalize_team_for_match(_text(value, "Team"))
    if not re.fullmatch(r"[A-Z]{2,3}", team) or team in {"NAN", "NON", "BYE"}:
        raise ValueError("Team identity is unavailable or invalid.")
    return team


def _rows(rows, label):
    if not isinstance(rows, (list, tuple)) or len(rows) > MAX_ROWS or not all(isinstance(r, dict) for r in rows):
        raise ValueError(f"{label} must be a bounded array of observations.")
    return rows


def normalize_evidence_context(context):
    if not isinstance(context, dict):
        raise ValueError("Evidence requires an exact slate context.")
    result = {key: _text(context.get(key), key) for key in ("site", "sport", "format", "slate_id")}
    result["slate_id"] = _id(context.get("slate_id"), "Slate ID")
    if result["sport"] != "NFL" or result["format"] != "classic" or result["site"] not in {"draftkings", "fanduel"}:
        raise ValueError("Opportunity evidence supports NFL Classic only.")
    result.update(season=_count(context.get("season"), "Season"), week=_count(context.get("week"), "Week"))
    if not 2000 <= result["season"] <= 2200 or not 1 <= result["week"] <= 22:
        raise ValueError("Evidence needs a supported season and week.")
    return result


def validate_source_receipt(source, *, evidence_scope="live"):
    """Retain explicit provenance and rights; unknown rights never become grants."""
    if not isinstance(source, dict):
        raise ValueError("Each evidence source needs a receipt.")
    result = {key: _text(source.get(key), key) for key in ("source_id", "provider", "uri", "content_sha256", "definition", "evidence_scope")}
    result["source_id"] = _id(source.get("source_id"), "Source ID")
    if not re.fullmatch(r"[a-f0-9]{64}", result["content_sha256"]):
        raise ValueError("Source content_sha256 must be a SHA-256 hex digest.")
    uri = urlsplit(result["uri"])
    if uri.username or uri.password or uri.query or uri.fragment:
        raise ValueError("Record a credential-free source URI; query strings are not retained.")
    if result["evidence_scope"] not in {"live", "retrospective", "synthetic"}:
        raise ValueError("Unknown source evidence scope.")
    if evidence_scope == "live" and result["evidence_scope"] != "live":
        raise ValueError("Live evidence requires verified source publication and known-at times.")
    period = source.get("period")
    if not isinstance(period, dict):
        raise ValueError("A source needs its observed period, not a guessed window.")
    result["period"] = {key: _count(period.get(key), f"Source period {key}") for key in ("season", "start_week", "end_week")}
    if not 1 <= result["period"]["start_week"] <= result["period"]["end_week"] <= 22:
        raise ValueError("Source period weeks contradict one another.")
    if "game_ids" in period:
        ids = period["game_ids"]
        if not isinstance(ids, list) or len(ids) > 1000:
            raise ValueError("Source period game IDs must be bounded.")
        result["period"]["game_ids"] = [_id(v, "Source game ID") for v in ids]
        if len(set(result["period"]["game_ids"])) != len(ids):
            raise ValueError("Source period contains duplicate game IDs.")
    times = {key: _time(source.get(key), key, optional=key != "retrieved_at") for key in ("published_at", "retrieved_at", "known_at")}
    if evidence_scope == "live" and (times["published_at"] is None or times["known_at"] is None):
        raise ValueError("Live evidence needs source publication and known-at times.")
    if times["published_at"] and times["known_at"] and times["known_at"] < times["published_at"]:
        raise ValueError("Source known-at cannot precede publication.")
    if times["known_at"] and times["retrieved_at"] < times["known_at"]:
        raise ValueError("Source retrieval cannot precede its known-at time.")
    result.update({key: source.get(key) for key in times})
    rights = source.get("rights", {})
    if not isinstance(rights, dict) or any(rights.get(k) is not None and type(rights[k]) is not bool for k in _RIGHTS):
        raise ValueError("Source rights require explicit true, false or unknown values.")
    result["rights"] = {key: rights.get(key) for key in _RIGHTS}
    for key in ("raw_filters", "revision", "units", "counting_definition"):
        if key in source:
            result[key] = _text(source[key], key, optional=True)
    return result


def normalize_team_games(team_games):
    """Validate a declared count partition; never infer missing sacks/routes."""
    result, seen = [], set()
    for original in _rows(team_games, "Team games"):
        row = {key: _id(original.get(key), key) for key in ("game_id", "source_id")}
        row.update(team=_team(original.get("team")), opponent=_team(original.get("opponent")),
                   season=_count(original.get("season"), "Season"), week=_count(original.get("week"), "Week"))
        if row["team"] == row["opponent"] or type(original.get("is_home")) is not bool:
            raise ValueError("Team-game opponent and venue must be explicit and consistent.")
        row["is_home"] = original["is_home"]
        for key in ("kickoff_at", "ended_at", "known_at"):
            _time(original.get(key), key, optional=key == "known_at")
            row[key] = original.get(key)
        if _time(row["ended_at"], "ended_at") <= _time(row["kickoff_at"], "kickoff_at"):
            raise ValueError("Observed game end must follow kickoff.")
        row.update({key: _count(original.get(key), key) for key in _COUNTS})
        if (row["plays"] != row["designed_runs"] + row["dropbacks"]
                or row["dropbacks"] != row["sacks"] + row["scrambles"] + row["throws"]
                or row["throws"] != row["targeted"] + row["untargeted"]):
            raise ValueError("Team count partition does not reconcile under the declared play definition.")
        if "completions" in original:
            row["completions"] = _count(original["completions"], "completions")
            if row["completions"] > row["targeted"]:
                raise ValueError("Completions cannot exceed targeted throws.")
        if "targets" in original:
            raise ValueError("Use targeted and untargeted throws in the team count partition.")
        key = row["game_id"], row["team"]
        if key in seen:
            raise ValueError("Duplicate team-game observations require an explicit resolved revision.")
        seen.add(key)
        result.append(row)
    lookup = {(r["game_id"], r["team"]): r for r in result}
    for row in result:
        peer = lookup.get((row["game_id"], row["opponent"]))
        if peer and (peer["opponent"] != row["team"] or peer["is_home"] == row["is_home"]
                     or any(peer[k] != row[k] for k in ("season", "week", "kickoff_at", "ended_at"))):
            raise ValueError("Opposing team-game records contradict their game identity or venue.")
    return result


def _ratio(numerator, denominator):
    return numerator / denominator if numerator is not None and denominator is not None and denominator > 0 else None


def parse_receiving_observations(csv_text, *, source, column_map):
    """Read ordered raw columns using caller-reviewed, distinct integer indices.

    Duplicate RECV headers are retained. The parser never guesses which is a
    grade or a route count, resolves provider IDs, or invents a team denominator.
    """
    if not isinstance(csv_text, str) or len(csv_text.encode("utf-8")) > MAX_BYTES:
        raise ValueError("Receiving observations exceed the 20 MiB input limit.")
    if not isinstance(source, dict):
        raise ValueError("Receiving observations require a source receipt.")
    receipt = validate_source_receipt(source, evidence_scope=source.get("evidence_scope", "live"))
    actual_hash = hashlib.sha256(csv_text.encode("utf-8")).hexdigest()
    if receipt["content_sha256"] != actual_hash:
        raise ValueError("Receiving source hash does not match the supplied file bytes.")
    table = []
    for raw in csv.reader(io.StringIO(csv_text.lstrip("\ufeff"))):
        if len(table) > MAX_ROWS:
            raise ValueError("Receiving observations exceed the row limit.")
        table.append(raw)
    if not table or len(table) > MAX_ROWS + 1 or len(table[0]) > 100:
        raise ValueError("Receiving observations need a bounded ordered header and rows.")
    supported = {"canonical_id", "team", "position", "games", "targets", "routes", "receiving_grade", "player_pass_snaps", "team_dropbacks"}
    if (not isinstance(column_map, dict) or not {"canonical_id", "targets"} <= set(column_map)
            or set(column_map) - supported or any(type(v) is not int or not 0 <= v < len(table[0]) for v in column_map.values())
            or len(set(column_map.values())) != len(column_map)):
        raise ValueError("Supply distinct explicit column indices for identity, targets, routes, grade and each denominator.")
    rows, warnings, seen = [], [], set()
    for number, raw in enumerate(table[1:], 2):
        if not any(cell.strip() for cell in raw):
            continue
        if len(raw) != len(table[0]):
            raise ValueError(f"Receiving row {number} does not match the ordered header.")
        row = {key: raw[index].strip() for key, index in column_map.items()}
        row["canonical_id"] = _id(raw[column_map["canonical_id"]], "Canonical player ID")
        if row["canonical_id"] in seen:
            raise ValueError("Duplicate receiving IDs require resolved periods/revisions.")
        seen.add(row["canonical_id"])
        if "team" in row:
            row["team"] = _team(row["team"])
        for key in supported - {"canonical_id", "team", "position"}:
            row[key] = _count(row.get(key), key, optional=True, decimal=key == "receiving_grade")
        if row["targets"] is None:
            raise ValueError("Receiving targets are missing; missing observations are not zero.")
        for denom in ("player_pass_snaps", "team_dropbacks"):
            if row["routes"] is not None and row[denom] is not None and row["routes"] > row[denom]:
                warnings.append(f"Row {number}: routes exceed {denom}; the source denominators need review.")
        if row["routes"] is not None and row["targets"] > row["routes"]:
            warnings.append(f"Row {number}: targets exceed routes; review source definitions.")
        period = receipt["period"]
        max_games = len(period.get("game_ids", [])) if period.get("game_ids") else period["end_week"] - period["start_week"] + 1
        if row["games"] is not None and row["games"] > max_games:
            warnings.append(f"Row {number}: observed games contradict the declared period; no window was repaired.")
        row["period_needs_review"] = row["games"] is not None and row["games"] > max_games
        def compatible_ratio(numerator, denominator):
            return _ratio(numerator, denominator) if numerator is not None and denominator is not None and numerator <= denominator else None
        row.update(targets_per_route=compatible_ratio(row["targets"], row["routes"]),
                   player_pass_snap_route_rate=compatible_ratio(row["routes"], row["player_pass_snaps"]),
                   team_dropback_route_participation=compatible_ratio(row["routes"], row["team_dropbacks"]),
                   source_id=receipt["source_id"], raw=list(raw))
        rows.append(row)
    return {"source": receipt, "headers": table[0], "column_map": dict(column_map), "rows": rows, "warnings": warnings}


def _mean(values):
    return sum(values) / len(values) if values else None


def _blend(season, venue, weight):
    return None if season is None else season if venue is None else (1 - weight) * season + weight * venue


def _average(a, b):
    return (a + b) / 2 if a is not None and b is not None else None


def build_opportunity_evidence(*, context, decision_at, games, players, team_games=(), player_games=(), sources=(),
                               evidence_scope="live", venue_weight=.25, venue_prior_games=4, receiving_reports=()):
    """Create a detached, hash-addressed ledger from explicit local observations."""
    context = normalize_evidence_context(context)
    decision = _time(decision_at, "decision_at")
    if evidence_scope not in {"live", "retrospective", "synthetic"}:
        raise ValueError("Unknown evidence scope.")
    if isinstance(venue_weight, bool) or not isinstance(venue_weight, (float, int)) or not math.isfinite(venue_weight) or not 0 <= venue_weight <= 1:
        raise ValueError("Venue weight must be between zero and one.")
    prior = _count(venue_prior_games, "Venue prior games")
    receipts = [validate_source_receipt(s, evidence_scope=evidence_scope) for s in _rows(sources, "Sources")]
    by_source = {s["source_id"]: s for s in receipts}
    if len(by_source) != len(receipts):
        raise ValueError("Duplicate source IDs require an explicit resolved revision.")
    warnings = []
    if evidence_scope == "retrospective":
        warnings.append("Retrospective research: historical publication/lock archives are not established; this is not live-reproducible validation.")
    if evidence_scope == "synthetic":
        warnings.append("Synthetic fixtures demonstrate software behavior, not model performance or a live recommendation.")

    parsed_reports = []
    for report in _rows(receiving_reports, "Receiving reports"):
        receipt = by_source.get(report.get("source_id"))
        if receipt is None:
            raise ValueError("Receiving reports must reference a supplied source receipt.")
        parsed = parse_receiving_observations(report.get("csv_text"), source=receipt, column_map=report.get("column_map"))
        warnings.extend(parsed["warnings"])
        period = receipt["period"]
        known = _time(receipt["known_at"], "Source known_at", optional=True)
        if period["season"] != context["season"] or period["end_week"] >= context["week"] or (known and known > decision):
            warnings.append(f"Receiving report {receipt['source_id']} period or known-at is not before the decision; excluded.")
            continue
        parsed_reports.append(parsed)

    def receipt_for(row):
        source = by_source.get(row.get("source_id"))
        if source is None:
            raise ValueError("Every observation must reference a supplied source receipt.")
        return source

    def available(row, *, team_row=None):
        receipt = receipt_for(row)
        reference = team_row or row
        period = receipt["period"]
        if (reference["season"] != period["season"] or not period["start_week"] <= reference["week"] <= period["end_week"]
                or (period.get("game_ids") and reference["game_id"] not in period["game_ids"])):
            warnings.append(f"Observation {reference['game_id']} contradicts source {receipt['source_id']} period; excluded.")
            return False
        known = _time(row.get("known_at"), "Observation known_at", optional=True)
        source_known = _time(receipt["known_at"], "Source known_at", optional=True)
        if (known and known > decision) or (source_known and source_known > decision):
            warnings.append(f"Source/observation {receipt['source_id']} was known after the decision; excluded.")
            return False
        if reference["season"] != context["season"] or reference["week"] >= context["week"]:
            return False
        if _time(reference["ended_at"], "ended_at") >= decision:
            warnings.append(f"Game {reference['game_id']} was not completed before the decision; excluded.")
            return False
        ended = _time(reference["ended_at"], "ended_at")
        if (known and known < ended) or (source_known and source_known < ended):
            raise ValueError("Final observed counts cannot be known before their game end.")
        return True

    all_teams = normalize_team_games(team_games)
    team_lookup = {(r["game_id"], r["team"]): r for r in all_teams}
    eligible_teams = [r for r in all_teams if available(r)]
    eligible_lookup = {(r["game_id"], r["team"]): r for r in eligible_teams}
    for row in eligible_teams:
        if receipt_for(row)["definition"] != PLAY_DEFINITION["id"]:
            raise ValueError("Team count screens require the declared accepted_scrimmage_v1 definition.")

    normalized_players, identities = [], set()
    for row in _rows(players, "Players"):
        player = {"canonical_id": _id(row.get("canonical_id"), "Canonical player ID"),
                  "team": _team(row.get("team")), "position": _text(row.get("position"), "Position").upper()}
        if player["canonical_id"] in identities or player["position"] not in {"QB", "RB", "WR", "TE", "DST", "K"}:
            raise ValueError("Duplicate or unsupported canonical player identities.")
        identities.add(player["canonical_id"])
        normalized_players.append(player)

    observed, seen_player_games = [], set()
    for original in _rows(player_games, "Player games"):
        row = {key: _id(original.get(key), key) for key in ("canonical_id", "game_id", "source_id")}
        row.update(team=_team(original.get("team")), targets=_count(original.get("targets"), "targets", optional=True),
                   carries=_count(original.get("carries"), "carries", optional=True), known_at=original.get("known_at"))
        key = row["canonical_id"], row["game_id"]
        if key in seen_player_games:
            raise ValueError("Duplicate player-game observations require a resolved revision.")
        seen_player_games.add(key)
        receipt_for(row)
        team_row = team_lookup.get((row["game_id"], row["team"]))
        if team_row is None:
            warnings.append(f"Player {row['canonical_id']} game {row['game_id']} lacks a verified team denominator; excluded.")
            continue
        if available(row, team_row=team_row) and (row["game_id"], row["team"]) in eligible_lookup:
            row["denominator_compatible"] = receipt_for(row)["definition"] == receipt_for(team_row)["definition"]
            if row["denominator_compatible"]:
                if row["targets"] is not None and row["targets"] > team_row["targeted"]:
                    raise ValueError("Player targets exceed their full-offense denominator.")
                if row["carries"] is not None and row["carries"] > team_row["designed_runs"] + team_row["scrambles"]:
                    raise ValueError("Player carries exceed their full-offense denominator.")
            observed.append(row)
    for team_row in eligible_teams:
        members = [r for r in observed if r["game_id"] == team_row["game_id"] and r["team"] == team_row["team"] and r["denominator_compatible"]]
        for field, denom in (("targets", team_row["targeted"]), ("carries", team_row["designed_runs"] + team_row["scrambles"])):
            if sum(r[field] or 0 for r in members) > denom:
                raise ValueError(f"Observed player {field} exceed full-offense counts; residual allocation cannot be negative.")

    output_games, game_ids, game_teams = [], set(), set()
    for game in _rows(games, "Games"):
        item = {"game_id": _id(game.get("game_id"), "Game ID"), "kickoff_at": _text(game.get("kickoff_at"), "kickoff_at")}
        kickoff = _time(item["kickoff_at"], "Game kickoff")
        if evidence_scope == "live" and decision >= kickoff:
            raise ValueError("Live opportunity evidence is pre-lock only: its decision cutoff must precede every selected game's kickoff.")
        item.update(home=_team(game.get("home")), away=_team(game.get("away")))
        if item["game_id"] in game_ids or item["home"] == item["away"] or {item["home"], item["away"]} & game_teams:
            raise ValueError("Slate games contain duplicate or contradictory identities.")
        game_ids.add(item["game_id"])
        game_teams.update((item["home"], item["away"]))
        summaries = {}
        for team, home in ((item["home"], True), (item["away"], False)):
            history = [r for r in eligible_teams if r["team"] == team]
            venue = [r for r in history if r["is_home"] == home]
            against = [(r, eligible_lookup.get((r["game_id"], r["opponent"]))) for r in history]
            against = [(r, peer) for r, peer in against if peer is not None]
            against_venue = [(r, peer) for r, peer in against if r["is_home"] == home]
            sf, vf = _mean([r["plays"] for r in history]), _mean([r["plays"] for r in venue])
            sa, va = _mean([peer["plays"] for _, peer in against]), _mean([peer["plays"] for _, peer in against_venue])
            summaries[team] = {"season_games": len(history), "venue_games": len(venue),
                               "season_against_games": len(against), "venue_against_games": len(against_venue),
                               "season_for": sf, "season_against": sa, "venue_for": vf, "venue_against": va,
                               "adjusted_for": _blend(sf, vf, venue_weight), "adjusted_against": _blend(sa, va, venue_weight),
                               "pooled_for": _blend(sf, vf, len(venue)/(len(venue)+prior) if len(venue)+prior else 0),
                               "pooled_against": _blend(sa, va, len(against_venue)/(len(against_venue)+prior) if len(against_venue)+prior else 0),
                               "dropback_rate": _ratio(sum(r["dropbacks"] for r in history), sum(r["plays"] for r in history)),
                               "venue_fallback": vf is None or va is None,
                               "source_ids": sorted({r["source_id"] for r in history} | {peer["source_id"] for _, peer in against}),
                               "observed_game_ids": [r["game_id"] for r in history],
                               "observed_through": max((r["ended_at"] for r in history), key=lambda value: _time(value, "ended_at"), default=None)}
        for team, opponent in ((item["home"], item["away"]), (item["away"], item["home"])):
            own, other = summaries[team], summaries[opponent]
            own["plays_screen"] = _average(own["adjusted_for"], other["adjusted_against"])
            own["dropbacks_screen"] = own["plays_screen"] * own["dropback_rate"] if own["plays_screen"] is not None and own["dropback_rate"] is not None else None
            own["screen_kind"] = "unfitted_volume_screen"
            own["dropbacks_kind"] = "rough_same_universe_screen_not_calibrated_projection"
            own["fallback_reason"] = "Missing venue sample: season value used for that term." if own["venue_fallback"] else None
            own["alternatives"] = {"season_only": _average(own["season_for"], other["season_against"]),
                                   "venue_only": _average(own["venue_for"], other["venue_against"]),
                                   "pooled_venue": _average(own["pooled_for"], other["pooled_against"])}
        item.update(team_screens=summaries,
                    combined_play_screen=sum(s["plays_screen"] for s in summaries.values()) if all(s["plays_screen"] is not None for s in summaries.values()) else None)
        output_games.append(item)
    if any(p["team"] not in game_teams for p in normalized_players):
        raise ValueError("An evidence player is outside the exact supplied slate games.")
    output_players = []
    for player in normalized_players:
        history = [r for r in observed if r["canonical_id"] == player["canonical_id"] and r["team"] == player["team"]]
        def totals(field, denominator):
            rows = [r for r in history if r[field] is not None]
            value = sum(r[field] for r in rows) if rows else None
            compatible = rows and all(r["denominator_compatible"] for r in rows)
            denom = sum(denominator(eligible_lookup[(r["game_id"], r["team"])] ) for r in rows) if compatible else None
            return value, denom, _ratio(value, denom)
        targets, team_targets, target_share = totals("targets", lambda r: r["targeted"])
        carries, team_carries, carry_share = totals("carries", lambda r: r["designed_runs"] + r["scrambles"])
        reason = ("Historical observed counts and full-offense denominators; routes unavailable."
                  if history and all(r["denominator_compatible"] for r in history) else
                  "Missing or incompatible source/count denominator; no role forecast or routes were invented.")
        route_observations = []
        for report in parsed_reports:
            for row in report["rows"]:
                if row["canonical_id"] != player["canonical_id"]:
                    continue
                if row.get("team") and row["team"] != player["team"] or row.get("position") and row["position"].upper() != player["position"]:
                    raise ValueError("A receiving report contradicts the reviewed canonical player team/position.")
                route_observations.append({**row, "period": report["source"]["period"]})
        valid_routes = [r for r in route_observations if r["routes"] is not None and not r["period_needs_review"]]
        single_route = valid_routes[0] if len(valid_routes) == 1 else None
        if len(valid_routes) > 1:
            warnings.append(f"Player {player['canonical_id']} has multiple route windows; retained separately without averaging or subtraction.")
        if single_route:
            reason = "Historical weekly counts and separately dated source-reported routes; no forward role forecast or cross-window multiplication."
        count_history = [r for r in history if r["targets"] is not None or r["carries"] is not None]
        output_players.append({**player, "observed_games": len(count_history), "observed_game_ids": [r["game_id"] for r in count_history],
                               "targets": targets, "carries": carries, "team_targets": team_targets, "team_carries": team_carries,
                               "target_share": target_share, "carry_share": carry_share,
                               "routes": single_route["routes"] if single_route else None,
                               "route_participation": single_route["team_dropback_route_participation"] if single_route else None,
                               "route_observations": route_observations,
                               "routes_semantics": "source_reported_routes_not_forward_role_forecast",
                               "source_ids": sorted({r["source_id"] for r in history} | {r["source_id"] for r in route_observations}),
                               "fallback": "historical_target_carry_share", "reason": reason,
                               "semantics": "historical_observation_not_forward_role_forecast"})
    volume = any(g["combined_play_screen"] is not None for g in output_games)
    rights = all(s["rights"]["hosted_ingestion"] is True and s["rights"]["display"] is True for s in receipts)
    times_checked = evidence_scope == "live" and bool(receipts) and all(
        _time(s["known_at"], "Source known_at") <= decision for s in receipts)
    evidence = {"schema_version": SCHEMA_VERSION, "status": "available", "reason": None,
                "context": context, "decision_at": decision_at,
                "evidence_scope": evidence_scope, "sources": receipts, "play_definition": PLAY_DEFINITION,
                "screen_parameters": {"venue_weight": venue_weight, "venue_prior_games": prior,
                                      "pooled_venue_status": "declared_unfitted_comparison_not_fitted_improvement"},
                "observation_ledger": {"team_games": eligible_teams, "player_games": observed, "receiving_reports": parsed_reports},
                "games": output_games, "players": output_players,
                "capabilities": {"team_volume_evidence": volume,
                                 "historical_role_evidence": any(r["targets"] is not None or r["carries"] is not None for r in observed),
                                 "route_evidence": any(p["routes"] is not None for p in output_players),
                                 "forward_role_model": False, "joint_outcomes": False,
                                 "contest_ev": False, "prelock_source_verified": False,
                                 "asof_source_times_checked": times_checked,
                                 "hosted_display_allowed": bool(receipts) and rights},
                "warnings": list(dict.fromkeys(warnings))}
    evidence["content_id"] = _digest(evidence)
    return json.loads(_json(evidence))


def _json(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError, RecursionError) as exc:
        raise ValueError("Evidence must contain bounded finite JSON values.") from exc


def _digest(value):
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def _artifact_path(context, directory):
    if directory is None:
        from src.config import DFS_EVIDENCE_DIR
        directory = DFS_EVIDENCE_DIR
    return Path(directory) / f"{_digest(normalize_evidence_context(context))}.json"


def prepare_opportunity_artifact(payload, *, directory=None):
    """Explicit offline preparation; validate everything before atomic publication."""
    if not isinstance(payload, dict) or len(_json(payload).encode("utf-8")) > MAX_BYTES:
        raise ValueError("Evidence preparation needs a bounded JSON input.")
    result = build_opportunity_evidence(**payload)
    path = _artifact_path(result["context"], directory)
    serialized = _json(result)
    if len(serialized.encode("utf-8")) > MAX_BYTES:
        raise ValueError("Prepared evidence exceeds the artifact size limit.")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_text(serialized, encoding="utf-8", newline="\n")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return result


def read_opportunity_artifact(context, *, directory=None, now=None):
    """Cache-only read: missing remains missing, without ETL, inference or fetch."""
    expected = normalize_evidence_context(context)
    path = _artifact_path(expected, directory)
    if not path.is_file():
        return {"schema_version": SCHEMA_VERSION, "status": "unavailable",
                "reason": "No prepared opportunity evidence exists for this exact slate. Existing projection-guided builds remain available.",
                "content_id": None, "context": expected, "decision_at": None, "evidence_scope": None,
                "sources": [], "play_definition": PLAY_DEFINITION, "games": [], "players": [], "warnings": [],
                "capabilities": {"team_volume_evidence": False, "historical_role_evidence": False,
                                 "route_evidence": False, "forward_role_model": False, "joint_outcomes": False,
                                 "contest_ev": False, "prelock_source_verified": False,
                                 "asof_source_times_checked": False, "hosted_display_allowed": False}}
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("Evidence artifact exceeds the size limit.")
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
        identifier = result.get("content_id")
        if (result.get("schema_version") != SCHEMA_VERSION or result.get("context") != expected
                or identifier != _digest({k: v for k, v in result.items() if k != "content_id"})):
            raise ValueError("Evidence artifact integrity or exact slate context check failed.")
    except (json.JSONDecodeError, AttributeError, TypeError, RecursionError) as exc:
        raise ValueError("Evidence artifact integrity check failed.") from exc
    read_time = datetime.now(timezone.utc) if now is None else _time(now, "Read time")
    if _time(result.get("decision_at"), "Artifact decision_at") > read_time:
        raise ValueError("Evidence artifact decision cutoff is in the future; no future information can be displayed.")
    # An integrity hash detects changed bytes; it grants no source rights or
    # account authority. The hosting route must enforce source rights separately.
    return result


def main():
    parser = argparse.ArgumentParser(description="Prepare descriptive DFS evidence from explicit local JSON; no fetch or model training.")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    if args.input.stat().st_size > MAX_BYTES:
        parser.error("Input exceeds 20 MiB.")
    evidence = prepare_opportunity_artifact(json.loads(args.input.read_text(encoding="utf-8-sig")), directory=args.output_dir)
    print(_json({"content_id": evidence["content_id"], "games": len(evidence["games"]),
                 "players": len(evidence["players"]), "evidence_scope": evidence["evidence_scope"],
                 "capabilities": evidence["capabilities"], "warnings": evidence["warnings"]}))


if __name__ == "__main__":
    main()
