# BDB Companion: Target Quality

**Data source:** `pbp_proxy`

## Files
- `target_quality_scores.csv` — weekly receiver target quality
- `target_quality_leaders.csv` — season leaders
- `ngs_tracking_features.csv` — NGS-only features (when raw tracking present)

## NGS setup
Place BDB 2026 tracking CSVs/parquet in `data/raw/ngs/` then run:
```bash
python -m bdb_companion.target_quality
```
