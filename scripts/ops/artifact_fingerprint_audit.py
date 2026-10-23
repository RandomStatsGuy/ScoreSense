#!/usr/bin/env python3
"""Audit fingerprints and source coverage without relabeling saved predictions."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq

from src.config import DRAFT_POOL_DIR, ROS_PREDICTIONS_DIR, WEEKLY_PREDICTIONS_DIR
from src.draft_hub.draft_pool_cache import pool_fingerprint
from src.projections.artifact_store import METADATA_ATTR
from src.projections.weekly_cache import weekly_fingerprint
from src.projections.ros_cache import ros_fingerprint


def _inspect(directory: Path, fingerprint: str, label: str) -> list[dict[str, Any]]:
    results = []
    names = {path.name for path in directory.glob("*.meta.json")}
    names.update(f"{path.stem}.meta.json" for path in directory.glob("*.parquet"))
    for name in sorted(names):
        meta_path = directory / name
        data_path = meta_path.with_name(meta_path.name.replace(".meta.json", ".parquet"))
        item: dict[str, Any] = {"kind": label, "artifact": meta_path.name,
                                "current_fingerprint": fingerprint}
        try:
            footer = pq.read_schema(data_path).metadata or {}
            attrs = json.loads(footer.get(b"PANDAS_ATTRS", b"{}"))
            if not isinstance(attrs, dict):
                raise ValueError("artifact_metadata_invalid")
            embedded = attrs.get(METADATA_ATTR)
            if isinstance(embedded, dict):
                meta = embedded
                item["metadata_source"] = "embedded"
                try:
                    sidecar = json.loads(meta_path.read_text(encoding="utf-8"))
                    item["sidecar_status"] = "matching" if sidecar == embedded else "out_of_date"
                except FileNotFoundError:
                    item["sidecar_status"] = "missing"
                except (OSError, ValueError):
                    item["sidecar_status"] = "invalid"
            else:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                item["metadata_source"] = "legacy_sidecar"
            if not isinstance(meta, dict) or not isinstance(meta.get("fingerprint"), str):
                raise ValueError("artifact_metadata_invalid")
            item.update(status="matching" if meta["fingerprint"] == fingerprint else "stale",
                        artifact_fingerprint=meta["fingerprint"], season=meta.get("season"),
                        week=meta.get("week"), built_at=meta.get("built_at"),
                        feature_source_cutoff=meta.get("feature_source_cutoff"))
        except FileNotFoundError:
            item.update(status="invalid", reason="artifact_data_missing")
        except (OSError, ValueError, TypeError, KeyError) as exc:
            item.update(status="invalid", reason=str(exc) if str(exc).startswith("artifact_") else "artifact_unreadable")
        results.append(item)
    return results


def audit_artifact_fingerprints(*, kinds=("weekly", "draft_pool", "ros"),
                                include_integrity: bool = True,
                                season: int | None = None, week: int | None = None) -> dict[str, Any]:
    """Inspect saved versions; matching mtime fingerprints do not prove freshness."""
    groups = {"weekly": (WEEKLY_PREDICTIONS_DIR, weekly_fingerprint),
              "draft_pool": (DRAFT_POOL_DIR, pool_fingerprint),
              "ros": (ROS_PREDICTIONS_DIR, ros_fingerprint)}
    results = []
    for kind in kinds:
        directory, fingerprint = groups[kind]
        results.extend(_inspect(directory, fingerprint(), kind))
    report: dict[str, Any] = {"read_only": True, "artifacts": results,
        "message": "Fingerprints were not rewritten. A real refresh is required for stale inputs; matching fingerprints do not prove source completeness."}
    if include_integrity:
        if season is None or week is None:
            # Old artifacts must not set the reporting period for their own
            # freshness check. Resolve today's board from local calendar caches.
            from src.core.projection_read_scope import projection_read_scope
            from src.projections.projection_meta import get_projection_meta
            try:
                with projection_read_scope(anonymous=True):
                    current = get_projection_meta("qb")
                season, week = int(current["default_season"]), int(current["default_week"])
            except (OSError, ValueError, KeyError, TypeError):
                season, week = None, None
        if season is not None and week is not None:
            from src.projections.data_integrity import audit_projection_integrity
            try:
                report["integrity"] = audit_projection_integrity(season=season, week=week)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                report["integrity"] = {"status": "failed", "reason": "source_integrity_unavailable", "error_type": type(exc).__name__}
        else:
            report["integrity"] = {"status": "warning", "reason": "current_projection_context_unavailable"}
    integrity_status = (report.get("integrity") or {}).get("status")
    if any(r["status"] == "invalid" for r in results) or integrity_status == "failed":
        report["status"] = "failed"
    elif not results or any(r["status"] != "matching" or r.get("sidecar_status") in {"invalid", "out_of_date", "missing"} for r in results) or integrity_status == "warning":
        report["status"] = "warning"
    else:
        report["status"] = "passed"
    return report


def main(argv: list[str] | None = None, *, kinds=("weekly", "draft_pool", "ros")) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int)
    parser.add_argument("--week", type=int)
    parser.add_argument("--fingerprints-only", action="store_true", help="skip the existing source coverage audit")
    args = parser.parse_args(argv)
    if (args.season is None) != (args.week is None):
        parser.error("--season and --week must be provided together")
    report = audit_artifact_fingerprints(kinds=kinds, include_integrity=not args.fingerprints_only,
                                         season=args.season, week=args.week)
    print(json.dumps(report, indent=2, default=str, allow_nan=False))
    return int(report["status"] != "passed")


if __name__ == "__main__":
    raise SystemExit(main())
