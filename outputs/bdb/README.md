# BDB Companion: Target Quality

This folder supports a Big Data Bowl-style analytics project linked to ScoreSense.

## Concept
**Target Quality Score** combines air yards, CPOE, and expected YAC from nflverse
play-by-play as a proxy for the separation/throw-quality metrics available in
full NGS tracking data.

## Files
- `target_quality_scores.csv` — weekly receiver target quality
- `target_quality_leaders.csv` — season leaders (min 50 targets)

## Next steps with BDB 2026 NGS data
1. Replace proxy metrics with separation at throw and defender closing speed
2. Build broadcast visualization of predicted vs actual in-air movement
3. Feed `target_quality_avg` into the ScoreSense WR model as a feature

## Run
```bash
python -m bdb_companion.target_quality
```
