---
name: verify-fantasy-ui
description: Verify a Fantasy or Tools UI change in the running app. Use after changing Draft Hub pages, chrome, copy, routes, or living surfaces, or when the user asks to click through Fantasy.
---

# Verify Fantasy UI

Do this after the code change. A screenshot of one render is not enough.

## 1. Name the living surface

Follow `.cursor/skills/match-living-surface/SKILL.md`. Lead with **Matching:** `{id}` · `{page}`. Open that route:

| id | URL |
|----|-----|
| `hub.home` | `/hub/home` |
| `hub.value` | `/hub/strategy` |
| `hub.available` | `/hub/free-agents` |
| `hub.room` | `/hub/draft` |
| `hub.week` | `/hub/week` |
| `hub.game` | `/hub/game` |
| `hub.roster` | `/hub/roster` |
| `hub.rosters` | `/hub/rosters` |
| `hub.planner` | `/hub/cap` |
| `hub.trades` | `/hub/trades` |
| `hub.rules` | `/hub/rules` |
| `hub.office` | `/hub/office/current` |
| `hub.insights` | `/hub/insights` |
| `tools.dfs` | `/tools/dfs` |
| `tools.mock-draft` | `/tools/mock-draft` |
| `tools.best-ball` | `/tools/best-ball` |
| `projections.weekly` | `/projections/weekly` |
| `projections.season` | `/projections/season` |

## 2. App up

API `http://127.0.0.1:8000`, Vite `http://127.0.0.1:5173` (proxies `/api`). If neither is running:

```bash
PYTHONPATH=. .venv/bin/python -m uvicorn app.api:app --reload --port 8000
# other terminal: cd frontend && npm run dev
```

Need real rosters / cap / trades? `.cursor/skills/mirror-prod-league/SKILL.md` (room `0BBESQ`).

## 3. Click the change

- Exercise the control you touched (click, type, save, navigate). Confirm behavior, not only paint.
- Open every other destination that reads the same state. Cap, My team, and Rules are the usual trio.
- Hit empty, loading, error, readonly, and unsaved when the change can see those states.
- Laptop 1024 / 1280 if layout moved. No horizontal page scroll. Mobile only when the change is responsive.

## 4. If you cannot use a browser

Curl the route and the API the page calls. Say what you could not click. Do not claim visual verification.
