"""Offline chronological accepted-play/role screen evaluation. Never trains models.

Public historical PBP is a corrected retrospective source, not archived pre-lock
evidence. Counts use one explicit partition; targets are never called routes.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from src.core.team_codes import normalize_team_for_match
from src.products.dfs_opportunity import PLAY_DEFINITION, build_opportunity_evidence, normalize_team_games

PBP_SOURCE = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.parquet"
LICENSE_SOURCE = "https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md"
DICTIONARY_SOURCE = "https://raw.githubusercontent.com/nflverse/nflreadr/main/data-raw/dictionary_pbp.csv"
_FLAGS = ("qb_dropback", "sack", "qb_scramble", "pass_attempt", "rush_attempt", "qb_kneel", "qb_spike", "two_point_attempt", "complete_pass")


def adapt_nflverse_pbp(frame, *, source_id="nflverse-pbp", season=None):
    """Transform actual accepted PBP rows without inferring participation/positions.

    First/last recorded UTC event timestamps bound a game for this retrospective
    study; they are not a platform lock or provider publication timestamp.
    """
    required = {"game_id", "play_id", "season", "week", "season_type", "home_team", "away_team", "posteam", "defteam",
                "play_type", "receiver_player_id", "rusher_player_id", "time_of_day", "qtr", *_FLAGS}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"PBP missing required count fields: {sorted(missing)}")
    data = frame[frame.season_type.eq("REG")].copy()
    if season is not None:
        data = data[data.season.eq(season)]
    if data.empty or data.duplicated(["game_id", "play_id"]).any():
        raise ValueError("Duplicate or empty PBP game/play identities.")
    eligible = data.play_type.isin(["pass", "run"]) & data.two_point_attempt.ne(1) & data.qb_kneel.ne(1) & data.qb_spike.ne(1)
    accepted = data.loc[eligible].copy()
    for flag in _FLAGS:
        if accepted[flag].isna().any() or not accepted[flag].isin([0, 1]).all():
            raise ValueError(f"Accepted PBP {flag} is missing or not a binary observation.")
    sacks, scrambles = accepted.sack.eq(1), accepted.qb_scramble.eq(1)
    thrown = accepted.pass_attempt.eq(1) & ~sacks & ~scrambles
    dropback = sacks | scrambles | thrown
    designed = accepted.rush_attempt.eq(1) & ~scrambles & ~dropback
    if (sacks & scrambles).any() or (dropback == designed).any() or not accepted.qb_dropback.eq(dropback.astype(int)).all():
        raise ValueError("Accepted PBP run/dropback/sack/scramble/throw partition contradicts raw flags.")
    accepted["designed_runs"] = designed.astype(int)
    accepted["dropbacks"] = dropback.astype(int)
    accepted["sacks"] = sacks.astype(int)
    accepted["scrambles"] = scrambles.astype(int)
    accepted["throws"] = thrown.astype(int)
    receiver = accepted.receiver_player_id.notna() & accepted.receiver_player_id.astype(str).str.strip().ne("")
    if (receiver & ~thrown).any() or (accepted.complete_pass.eq(1) & ~(receiver & thrown)).any():
        raise ValueError("Target/completion flags contradict the declared thrown-attempt partition.")
    accepted["targeted"] = (receiver & thrown).astype(int)
    accepted["untargeted"] = (thrown & ~receiver).astype(int)
    accepted["plays"] = 1
    timestamps = pd.to_datetime(data.time_of_day, utc=True, errors="coerce")
    ranges = data.assign(_timestamp=timestamps).groupby("game_id")._timestamp.agg(["min", "max"])
    team_rows, touches = [], Counter()
    count_cols = ["plays", "designed_runs", "dropbacks", "sacks", "scrambles", "throws", "targeted", "untargeted"]
    for (game_id, raw_team), group in accepted.groupby(["game_id", "posteam"], sort=True):
        teams = group[["home_team", "away_team", "defteam", "season", "week"]].drop_duplicates()
        if len(teams) != 1 or pd.isna(raw_team):
            raise ValueError("Accepted PBP has contradictory team-game identities.")
        first = teams.iloc[0]
        team, opponent = normalize_team_for_match(raw_team), normalize_team_for_match(first.defteam)
        home, away = normalize_team_for_match(first.home_team), normalize_team_for_match(first.away_team)
        start, end = ranges.loc[game_id, ["min", "max"]]
        if {team, opponent} != {home, away} or pd.isna(start) or pd.isna(end) or start >= end:
            raise ValueError("PBP requires exact teams and usable recorded event-time bounds.")
        row = {"game_id": str(game_id), "season": int(first.season), "week": int(first.week),
            "team": team, "opponent": opponent, "is_home": team == home, "source_id": source_id,
            "kickoff_at": start.isoformat(), "ended_at": end.isoformat(), "known_at": None,
            **{key: int(group[key].sum()) for key in count_cols}, "completions": int(group.complete_pass.sum())}
        team_rows.append(row)
        for event in group.to_dict("records"):
            if event["targeted"]:
                touches[(str(game_id), str(event["receiver_player_id"]), team, "targets")] += 1
            if event["designed_runs"] or event["scrambles"]:
                pid = event["rusher_player_id"]
                if pd.isna(pid) or not str(pid).strip():
                    raise ValueError("Accepted rushing opportunity is missing its canonical rusher ID.")
                touches[(str(game_id), str(pid), team, "carries")] += 1
    players = sorted({key[:3] for key in touches})
    player_rows = [{"game_id": game_id, "canonical_id": pid, "team": team,
        "targets": touches[(game_id, pid, team, "targets")], "carries": touches[(game_id, pid, team, "carries")],
        "source_id": source_id, "known_at": None} for game_id, pid, team in players]
    return {"team_games": normalize_team_games(team_rows), "player_games": player_rows,
        "audit": {"raw_rows": len(data), "accepted_plays": len(accepted), "excluded_rows": len(data)-len(accepted),
            "overtime_accepted_plays": int(accepted.qtr.gt(4).sum()),
            "raw_pass_attempt_including_sacks": int(accepted.pass_attempt.sum()), "partition_verified": True,
            "play_definition": PLAY_DEFINITION, "game_time_basis": "first/last recorded UTC PBP event; not official kickoff/end/publication",
            "positions": "unavailable in PBP; no RB/WR/route eligibility was inferred"}}


def _metrics(rows, predicted, actual):
    pairs = [(r[predicted], r[actual]) for r in rows if r.get(predicted) is not None]
    if not pairs:
        return {"rows": 0, "mae": None, "rmse": None, "bias": None}
    errors = np.array([p-a for p, a in pairs])
    return {"rows": len(pairs), "mae": float(np.abs(errors).mean()),
            "rmse": float(np.sqrt(np.square(errors).mean())), "bias": float(errors.mean())}


def _paired(rows, challenger, baseline, actual, repeats):
    blocks = defaultdict(list)
    for row in rows:
        if row.get(challenger) is not None and row.get(baseline) is not None:
            blocks[(row["season"], row["week"])].append(abs(row[challenger]-row[actual])-abs(row[baseline]-row[actual]))
    if not blocks:
        return {"rows": 0, "week_blocks": 0, "mae_delta": None, "ci95": None}
    groups = np.asarray([[sum(deltas), len(deltas)] for deltas in blocks.values()])
    rng = np.random.default_rng(20261012)
    sample = groups[rng.integers(0, len(groups), size=(repeats, len(groups)))]
    deltas = sample[:, :, 0].sum(axis=1) / sample[:, :, 1].sum(axis=1)
    return {"rows": int(groups[:, 1].sum()), "week_blocks": len(groups),
            "mae_delta": float(groups[:, 0].sum()/groups[:, 1].sum()),
            "ci95": np.quantile(deltas, [.025, .975]).tolist(), "bootstrap_repeats": repeats}


def evaluate_ledger(team_games, *, player_games=(), sources=(), tune_from_week=4, tune_through_week=9,
                    evaluate_from_week=10, prior_grid=(0, 2, 4, 8, 16), bootstrap_repeats=2000):
    """Tune venue pooling on earlier weeks, freeze it, then score later weeks.

    Repeated earlier-season histories are allowed; every forecast sees only
    weeks before its target. No later outcome selects a prior or cohort.
    """
    teams = normalize_team_games(team_games)
    if (type(tune_from_week) is not int or type(tune_through_week) is not int or type(evaluate_from_week) is not int or
            not 2 <= tune_from_week <= tune_through_week < evaluate_from_week <= 22 or
            not prior_grid or any(type(k) is not int or k < 0 or k > 100 for k in prior_grid) or
            type(bootstrap_repeats) is not int or not 1 <= bootstrap_repeats <= 10000):
        raise ValueError("Chronological evaluation needs disjoint earlier/later weeks and bounded declared prior choices.")
    if len({r["season"] for r in teams}) != 1:
        raise ValueError("Each chronological evaluation freezes one season; evaluate seasons separately.")
    lookup = {(r["game_id"], r["team"]): r for r in teams}
    touches = {}
    for row in player_games:
        key = row["game_id"], row["team"], row["canonical_id"]
        if key in touches or (key[0], key[1]) not in lookup:
            raise ValueError("Role observations need unique exact player/team-game identities.")
        if any(type(row.get(k)) is not int or row[k] < 0 for k in ("targets", "carries")):
            raise ValueError("Role observations need complete nonnegative whole target/carry counts.")
        touches[key] = row
    for row in teams:
        members = [p for (game, team, _), p in touches.items() if (game, team) == (row["game_id"], row["team"])]
        if sum(p["targets"] for p in members) > row["targeted"] or sum(p["carries"] for p in members) > row["designed_runs"]+row["scrambles"]:
            raise ValueError("Observed player opportunities exceed the reconciled team denominator.")
    predictions, role_rows = [], []
    prior_grid = sorted(set(prior_grid))
    tuning, selected_prior = [], None
    contexts = sorted({(r["season"], r["week"]) for r in teams})
    for season, week in contexts:
        if week < tune_from_week:
            continue
        if week >= evaluate_from_week and selected_prior is None:
            scored = [(k, _metrics(tuning, f"pooled_{k}", "actual_plays")) for k in prior_grid]
            valid = [(stats["mae"], -k, k) for k, stats in scored if stats["rows"]]
            if not valid:
                raise ValueError("No earlier tuning forecasts exist; a later result cannot select the prior.")
            selected_prior = min(valid)[2]
        current = [r for r in teams if r["season"] == season and r["week"] == week]
        history = [r for r in teams if r["season"] == season and r["week"] < week]
        if not history:
            continue
        decision = min(datetime.fromisoformat(r["kickoff_at"].replace("Z", "+00:00")) for r in current) - timedelta(seconds=1)
        games = [{"game_id": r["game_id"], "home": r["team"], "away": r["opponent"], "kickoff_at": r["kickoff_at"]}
                 for r in current if r["is_home"]]
        if len(games)*2 != len(current):
            raise ValueError("Evaluation requires both sides of every target game.")
        history_keys = {(r["game_id"], r["team"]) for r in history}
        common = dict(context={"site": "draftkings", "sport": "NFL", "format": "classic", "slate_id": f"research-{season}-{week}", "season": season, "week": week},
            decision_at=decision.isoformat(), games=games, players=[], team_games=history,
            player_games=[p for key, p in touches.items() if key[:2] in history_keys],
            sources=list(sources), evidence_scope="retrospective")
        base = build_opportunity_evidence(**common, venue_prior_games=4)
        available_history = base["observation_ledger"]["team_games"]
        available_touches = {(r["game_id"], r["team"], r["canonical_id"]): r
            for r in base["observation_ledger"]["player_games"] if r["denominator_compatible"]}
        # A declared but late/incompatible touch row is unknown, not a historical
        # zero. Remove that whole team-game from role denominators and cohorts.
        available_history_keys = {(r["game_id"], r["team"]) for r in available_history}
        unknown_touch_games = {key[:2] for key in touches if key[:2] in available_history_keys and key not in available_touches}
        role_history = [r for r in available_history if (r["game_id"], r["team"]) not in unknown_touch_games]
        by_team = {team: screen for game in base["games"] for team, screen in game["team_screens"].items()}
        # Only tuning weeks compare the grid. Later weeks use its frozen choice.
        active_priors = prior_grid if week <= tune_through_week else [selected_prior] if selected_prior is not None else [4]
        pooled = {k: {team: screen for game in build_opportunity_evidence(**common, venue_prior_games=k)["games"]
                     for team, screen in game["team_screens"].items()} for k in active_priors}
        for actual in current:
            screen = by_team[actual["team"]]
            row = {"game_id": actual["game_id"], "season": season, "week": week, "team": actual["team"],
                "phase": "tuning" if week <= tune_through_week else "evaluation" if week >= evaluate_from_week else "unused_gap",
                "decision_at": decision.isoformat(), "history_game_ids": screen["observed_game_ids"],
                "actual_plays": actual["plays"], "actual_dropbacks": actual["dropbacks"],
                "baseline_75_25": screen["plays_screen"], **{k: screen["alternatives"][k] for k in ("season_only", "venue_only")},
                "league_average": sum(r["plays"] for r in available_history)/len(available_history) if available_history else None,
                **{f"pooled_{k}": pooled[k][actual["team"]]["alternatives"]["pooled_venue"] for k in active_priors}}
            if selected_prior is not None:
                row["pooled_selected"] = row[f"pooled_{selected_prior}"]
            for model in ("baseline_75_25", "season_only", "venue_only", "league_average", "pooled_selected"):
                value = row.get(model)
                row[f"{model}_dropbacks"] = value*screen["dropback_rate"] if value is not None and screen["dropback_rate"] is not None else None
            predictions.append(row)
            if row["phase"] == "tuning": tuning.append(row)
            own = [r for r in role_history if r["team"] == actual["team"]]
            own_games = {r["game_id"] for r in own}
            known = sorted({pid for (game, team, pid) in available_touches if game in own_games and team == actual["team"]})
            recent = sorted(own, key=lambda r: (r["week"], r["game_id"]))[-4:]
            for pid in known:
                outcome = touches.get((actual["game_id"], actual["team"], pid), {"targets": 0, "carries": 0})
                role = {"game_id": actual["game_id"], "season": season, "week": week, "team": actual["team"],
                        "canonical_id": pid, "phase": row["phase"], "history_game_ids": sorted(own_games),
                        "actual_targets": outcome["targets"], "actual_carries": outcome["carries"]}
                for stat, denom in (("targets", "targeted"), ("carries", "carries")):
                    total = lambda records: sum(r["designed_runs"]+r["scrambles"] if denom == "carries" else r[denom] for r in records)
                    player_count = lambda records: sum(available_touches.get((r["game_id"], actual["team"], pid), {}).get(stat, 0) for r in records)
                    full_denominator = total(own)
                    team_screen = row["baseline_75_25"]*full_denominator/sum(r["plays"] for r in own) if row["baseline_75_25"] is not None else None
                    role[f"season_count_mean_{stat}"] = player_count(own)/len(own)
                    for label, records in (("season", own), ("recent4", recent)):
                        denominator = total(records)
                        role[f"touch_share_{label}_screen_{stat}"] = team_screen*player_count(records)/denominator if team_screen is not None and denominator else None
                role_rows.append(role)
    final = [r for r in predictions if r["phase"] == "evaluation"]
    if not final:
        raise ValueError("No untouched later evaluation block exists.")
    models = ("league_average", "season_only", "venue_only", "baseline_75_25", "pooled_selected")
    role_models = ("season_count_mean", "touch_share_season_screen", "touch_share_recent4_screen")
    evaluation_games = {(r["game_id"], r["team"]) for r in final}
    evaluation_roles = [r for r in role_rows if r["phase"] == "evaluation"]
    total_touches = {stat: sum(p[stat] for key, p in touches.items() if key[:2] in evaluation_games) for stat in ("targets", "carries")}
    cohort_touches = {stat: sum(r[f"actual_{stat}"] for r in evaluation_roles) for stat in ("targets", "carries")}
    return {"version": 1, "evidence_scope": "retrospective", "play_definition": PLAY_DEFINITION,
        "selection": {"tune_from_week": tune_from_week, "tune_through_week": tune_through_week, "evaluate_from_week": evaluate_from_week,
            "prior_grid": prior_grid, "selected_venue_prior_games": selected_prior,
            "criterion": "Earlier-block team-play MAE; ties prefer stronger pooling.",
            "tuning": {str(k): _metrics(tuning, f"pooled_{k}", "actual_plays") for k in prior_grid}},
        "team_metrics": {m: {"plays": _metrics(final, m, "actual_plays"), "dropbacks": _metrics(final, f"{m}_dropbacks", "actual_dropbacks")} for m in models},
        "paired_week_comparisons": {m: _paired(final, m, "baseline_75_25", "actual_plays", bootstrap_repeats) for m in models if m != "baseline_75_25"},
        "role_metrics": {m: {stat: _metrics([r for r in role_rows if r["phase"] == "evaluation"], f"{m}_{stat}", f"actual_{stat}") for stat in ("targets", "carries")} for m in role_models},
        "role_coverage": {"evaluation_team_games": len(final), "prior_touch_identity_rows": len(evaluation_roles),
            "observed_touches": total_touches, "prior_cohort_actual_touches": cohort_touches,
            "unseen_identity_residual_touches": {stat: total_touches[stat]-cohort_touches[stat] for stat in total_touches}},
        "team_predictions": predictions, "role_predictions": role_rows,
        "role_cohort": "Prior observed team/player touch identities, fixed before each target week; no-touch games count zero; roster/inactive membership is not reconstructed; unseen players remain residual.",
        "promotion": {"status": "research_only", "production_changed": False,
            "reason": "Later weeks were withheld from this parameter selection; historical source publication was not archived. No route, injury/availability, fantasy-point, joint-tail or tournament-return validation."},
        "sources": list(sources)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pbp", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--season", type=int, default=2024)
    parser.add_argument("--tune-from-week", type=int, default=4)
    parser.add_argument("--tune-through-week", type=int, default=9)
    parser.add_argument("--evaluate-from-week", type=int, default=10)
    parser.add_argument("--venue-prior-grid", type=int, nargs="+", default=[0, 2, 4, 8, 16])
    parser.add_argument("--retrieved-at", help="Actual download receipt time; defaults to this local read time.")
    args = parser.parse_args()
    payload = args.pbp.read_bytes()
    ledger = adapt_nflverse_pbp(pd.read_parquet(args.pbp), season=args.season)
    source = {"source_id": "nflverse-pbp", "provider": "nflverse/nflfastR public PBP",
        "uri": PBP_SOURCE.format(season=args.season), "content_sha256": hashlib.sha256(payload).hexdigest(),
        "period": {"season": args.season, "start_week": 1, "end_week": 18},
        "published_at": None, "known_at": None, "retrieved_at": args.retrieved_at or datetime.now(timezone.utc).isoformat(),
        "definition": PLAY_DEFINITION["id"], "evidence_scope": "retrospective",
        "rights": {"personal_analysis": True, "hosted_ingestion": None, "display": None, "redistribution": None, "training": None, "external_model": False},
        "revision": "Downloaded corrected historical release; not archived pre-lock data.",
        "counting_definition": "nflverse raw pass_attempt includes sacks; transformed throws exclude sacks/scrambles/spikes.",
        "units": "accepted plays and observed player touches"}
    report = evaluate_ledger(**{k: ledger[k] for k in ("team_games", "player_games")}, sources=[source],
        tune_from_week=args.tune_from_week, tune_through_week=args.tune_through_week,
        evaluate_from_week=args.evaluate_from_week, prior_grid=args.venue_prior_grid)
    report.update(adapter_audit=ledger["audit"], attribution={"provider": "nflverse/nflfastR",
        "license": "CC-BY-4.0", "license_source": LICENSE_SOURCE, "dictionary_source": DICTIONARY_SOURCE})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8", newline="\n")
    print(json.dumps({"output": str(args.output), "selection": report["selection"],
                      "team_metrics": report["team_metrics"], "role_metrics": report["role_metrics"],
                      "promotion": report["promotion"]}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
