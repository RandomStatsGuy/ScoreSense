---
name: verify-fantasy-ui
description: Verify a Fantasy or Tools UI change in the running app. Use after changing Draft Hub pages, chrome, copy, routes, or living surfaces, or when the user asks to click through Fantasy.
---

# Verify Fantasy UI

Do this after the product code change. A screenshot of one render is not enough. Do not run this on the HTML mock pass (`.cursor/skills/fast-ui-mock/SKILL.md`).

## 1. Name the living surface

Follow `.cursor/skills/match-living-surface/SKILL.md`. Lead with **Matching:** `{id}` · `{page}`. Open that route:

| id | URL |
|----|-----|
| `hub.home` | `/hub/home` |
| `hub.value` | `/hub/strategy` |
| `hub.available` | `/hub/free-agents` |
| `hub.room` | `/hub/draft` |
| `hub.week` | `/hub/week` |
| `hub.vibes` | `/hub/vibes` |
| `hub.game` | `/hub/game` |
| `hub.roster` | `/hub/roster` |
| `hub.rosters` | `/hub/rosters` |
| `hub.planner` | `/hub/cap` |
| `hub.trades` | `/hub/trades` |
| `hub.rules` | `/hub/rules` |
| `hub.office` | `/hub/roster-management/contracts` |
| `hub.office.historic` | `/hub/roster-management/sheets` |
| `hub.office.members` | `/hub/roster-management/members` |
| `hub.office.access` | `/hub/roster-management/access` |
| `hub.insights` | `/hub/insights` |
| `hub.setup` | `/hub/setup` |
| `tools.dfs` | `/tools/dfs` |
| `tools.mock-draft` | `/tools/mock-draft` |
| `tools.best-ball` | `/tools/best-ball` |
| `projections.weekly` | `/projections/weekly` |
| `projections.season` | `/projections/season` |
| `account.model` | `/model` |
| `account.admin` | `/admin` |
| `account.account` | `/account` |
| `account.report` | `/report` |
| `account.login` | `/login` |
| `account.register` | `/register` |

## 2. App up

API `http://127.0.0.1:8000`, Vite `http://127.0.0.1:5173` (proxies `/api`). If neither is running, follow `.cursor/skills/start-local-app/SKILL.md`.

Need real rosters / cap / trades? `.cursor/skills/mirror-prod-league/SKILL.md` (room `0BBESQ`). Confirm the open league is that snapshot room (My Auction), not a leftover sandbox.

## 3. Click the change

- Exercise the control you touched (click, type, save, navigate). Confirm behavior, not only paint.
- Open every other destination that reads the same state. Cap, My team, and Rules are the usual trio.
- Hit empty, loading, error, readonly, and unsaved when the change can see those states.
- Laptop 1024 / 1280 if layout moved. No horizontal page scroll. Mobile only when the change is responsive.

## 4. If you cannot use a browser

Curl the route and the API the page calls. Say what you could not click. Do not claim visual verification.
