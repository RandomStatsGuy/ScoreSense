# Injury return estimates

ScoreSense shows **heuristic** return windows in the Injuries sidebar. These are not official team timelines.

## Data sources

- Sleeper: `injury_status`, `injury_body_part`, `injury_notes`, `practice_participation`
- Rules: [`data/injury/return_heuristics.yaml`](../data/injury/return_heuristics.yaml)
- Logic: [`src/integrations/injury_timeline.py`](../src/integrations/injury_timeline.py)

## API

`GET /api/injuries` includes `return_estimate` on each player:

```json
{
  "label": "2-4 weeks",
  "weeks_min": 2,
  "weeks_max": 4,
  "confidence": "low",
  "rationale": "Shoulder injury pattern",
  "is_estimate": true
}
```

## Tuning

Edit `return_heuristics.yaml` to adjust status defaults, body-part patterns, and note patterns (e.g. `surgery`, `sprain`).

Future: manual overrides in `data/injury/overrides.yaml`, nflverse spell calibration, sentiment snippet parsing.
