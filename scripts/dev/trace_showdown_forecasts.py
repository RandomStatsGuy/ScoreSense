"""Read-only account-safe artifact trace. Never computes or refreshes forecasts.

Case-player names are CLI test subjects, never production projection rules.
Archive rows from other contexts cannot reproduce the requested slate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import pandas as pd


def trace_forecast_archives(root: Path, *, season: int, week: int, player_names: list[str]):
    requested = {name.casefold(): name for name in player_names}
    forecasts = root / "artifacts" / "weekly_predictions"
    archives, players, failures = [], {name: [] for name in player_names}, []
    for metadata_path in sorted(forecasts.glob("*.meta.json")):
        parquet_path = metadata_path.with_name(metadata_path.name.removesuffix(".meta.json") + ".parquet")
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            context = {"season": metadata.get("season"), "week": metadata.get("week"), "position": metadata.get("position"),
                       "injury_adjustments": metadata.get("apply_injury_adjustments")}
            descriptor = {"path": metadata_path.relative_to(root).as_posix(), "context": context,
                          "built_at": metadata.get("built_at"), "rows_declared": metadata.get("rows"),
                          "requested_context": context["season"] == season and context["week"] == week,
                          "metadata_sha256": hashlib.sha256(metadata_path.read_bytes()).hexdigest(),
                          "parquet_present": parquet_path.exists()}
            archives.append(descriptor)
            if not parquet_path.exists():
                continue
            frame = pd.read_parquet(parquet_path)
            descriptor["rows_actual"] = len(frame)
            descriptor["parquet_sha256"] = hashlib.sha256(parquet_path.read_bytes()).hexdigest()
            if "Player" not in frame:
                continue
            for raw in frame.to_dict("records"):
                name = requested.get(str(raw.get("Player", "")).casefold())
                if name is None:
                    continue
                def finite(key):
                    try:
                        value = float(raw.get(key))
                        return value if pd.notna(value) and abs(value) != float("inf") else None
                    except (ValueError, TypeError):
                        return None
                def text(key):
                    value = raw.get(key)
                    return str(value) if value is not None and pd.notna(value) else None
                players[name].append({"artifact": descriptor["path"], "context": context,
                    "requested_context": descriptor["requested_context"], "forecast_at": metadata.get("built_at"),
                    "canonical_id": text("player_id"), "provider_id": text("provider_id"), "slate_id": text("dfs_id"),
                    "team": text("Team"), "position": text("Position"), "source_type": text("projection_source"),
                    "model_version_recorded": text("projection_model"),
                    "raw_flex_inputs": {"p10": finite("Low (P10)"), "projection": finite("Projected Points"), "p90": finite("High (P90)")},
                    "status_at_archive": text("Injury Status"), "status_known_at": text("availability_updated_at"),
                    "opportunity_fraction": finite("Opportunity Adjustment"), "injury_snapshot_id": text("injury_snapshot_id"),
                    "active_conditioning_recorded": text("availability_conditioning"),
                    "observed_period_recorded": text("observed_period"),
                    "exact_suspect_build_reproduced": False})
        except (OSError, ValueError, TypeError) as exc:
            failures.append({"path": metadata_path.relative_to(root).as_posix(), "error": type(exc).__name__})
    requested_archives = [archive for archive in archives if archive["requested_context"] and archive["parquet_present"]]
    return {"schema_version": "showdown_archive_trace_v1", "requested_context": {"season": season, "week": week},
            "read_only": True, "original_twenty_lineup_audit_reproduced": False,
            "requested_weekly_archives_present": len(requested_archives),
            "requested_deep_dfs_pool_present": any((root / "artifacts" / "dfs_predictions" / f"{season}_w{week}_{suffix}.parquet").exists() for suffix in ("inj", "raw")),
            "original_build_manifest_supplied": False, "salary_slate_supplied": False,
            "archive_coverage": archives, "player_traces": [{"player_name": name, "archive_rows": rows,
                "requested_context_rows": sum(row["requested_context"] for row in rows),
                "eligibility_exclusion_and_solver_coefficient": "unavailable_without_original_slate_and_build"} for name, rows in players.items()],
            "unresolved": ["Original 20-lineup artifact, salary slate, frozen options and build manifest absent.",
                           "Other-week forecasts cannot verify suspect current inputs, exclusions, caps or exact exposures.",
                           "Unrecorded timestamps, model versions, role components and injury drivers remain unknown.",
                           "Installed model artifacts do not establish which model produced an old forecast."],
            "read_failures": failures}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--player-name", action="append", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = trace_forecast_archives(args.root.resolve(), season=args.season, week=args.week, player_names=args.player_name)
    encoded = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    else:
        print(encoded)


if __name__ == "__main__":
    main()
