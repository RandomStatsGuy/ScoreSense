---
name: add-hub-route
description: Add or change a Fantasy /hub API route with the right auth, storage, and cache rules. Use when adding an endpoint under /api/hub, changing hub_routes.py, or wiring a new Fantasy fetch.
---

# Add a hub route

## Where

- Route: `app/hub_routes.py` (prefix `/api/hub`).
- Logic: `src/draft_hub/`. The handler stays thin.
- Config: `src/config.py`. No raw `os.environ` in the route.
- Client: `apiFetch` from `frontend/src/auth.js`.

## Auth

Use `Depends(require_hub_user)` from `app/auth.py` for Fantasy. That is a real account, not the shared patron fallback.

`require_patron` is for non-hub product routes. Do not mix them.

## Data and CPU

- Roster / cap / league state: SQLite via `src/draft_hub/storage.py`. No live Sleeper on the read path. One-off live pull is already `GET /api/hub/roster?live_sleeper=1`.
- Values: `build_draft_pool_payload()` then `build_value_overlay()` in `src/draft_hub/value_sheet.py`. Do not recompute the pool per request. Do not call `predict_*` on a hub hot path.
- CPU-heavy work: `app.process_pool.get_process_executor()`. Do not start a per-route pool.
- Rules on the server: `LeagueRules` in `src/draft_hub/schemas.py` and `src/draft_hub/rules_engine.py`. Backend stays authoritative.

## Tests

Add or extend `tests/test_draft_hub_api.py` (storage) and/or `tests/test_hub_perf.py` (no live ML / overlay). Use the existing `hub_db` tmp-path fixture. Follow `.cursor/skills/run-tests/SKILL.md`.

If the first Fantasy visit would go cold after a model change, `.cursor/skills/refresh-draft-pool/SKILL.md`.
