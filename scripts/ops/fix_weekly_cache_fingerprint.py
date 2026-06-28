#!/usr/bin/env python3
"""Align weekly prediction meta fingerprints so cached parquet is used (no model reload)."""
from __future__ import annotations

import json
from pathlib import Path

from src.config import WEEKLY_PREDICTIONS_DIR
from src.projections.weekly_cache import weekly_fingerprint


def main() -> int:
    fp = weekly_fingerprint()
    updated = 0
    for meta_path in sorted(WEEKLY_PREDICTIONS_DIR.glob("*.meta.json")):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        old = meta.get("fingerprint")
        if old == fp:
            print(f"ok  {meta_path.name} ({fp})")
            continue
        meta["fingerprint"] = fp
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        print(f"fix {meta_path.name}: {old} -> {fp}")
        updated += 1

    # Verify load
    from src.projections.projection_meta import get_projection_meta
    from src.projections.weekly_cache import load_weekly_prediction

    m = get_projection_meta("qb")
    df = load_weekly_prediction("qb", season=m["default_season"], week=m["default_week"])
    print(f"verify qb rows={len(df)} season={m['default_season']} week={m['default_week']}")
    return 0 if len(df) else 1


if __name__ == "__main__":
    raise SystemExit(main())
