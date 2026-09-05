---
name: verify-fantasy-ui
description: Verify a Fantasy or Tools UI change in the running app. Use after changing Draft Hub pages, chrome, copy, routes, or living surfaces, or when the user asks to click through Fantasy.
---

# Verify Fantasy UI

Do this after the product code change. A screenshot of one render is not enough. Do not run this on the HTML mock pass (`.cursor/skills/fast-ui-mock/SKILL.md`).

## 1. Name the living surface

Follow `.cursor/skills/match-living-surface/SKILL.md`. Lead with **Matching:** `{id}` · `{page}`. Open that row's `route` from `frontend/src/livingSurfaces.js` (`livingSurfaceRoutes()`). Do not keep a parallel URL table here.

## 2. App up

API `http://127.0.0.1:8000`, Vite `http://127.0.0.1:5173` (proxies `/api`). If neither is running, follow `.cursor/skills/start-local-app/SKILL.md`.

Need real rosters / cap / trades? `.cursor/skills/mirror-prod-league/SKILL.md` (room `0BBESQ`). Confirm the open league is that snapshot room (My Auction), not a leftover sandbox.

## 3. Measure, then click

1. Run `npm run audit:layout -- <route>` at 1280 and at 390 (from `frontend/`). Paste the PASS/FAIL table in the reply. A FAIL you did not cause is still yours if it is in a primitive you touched.
2. If you changed a shared class or component, run the audit on every route that uses it (`grep -rl "<class>" frontend/src` → map to routes via `surfacesForFile` / `livingSurfaceRoutes`).
3. Exercise the control you touched. Open every other destination that reads the same state (Cap, My team, Rules).
4. Hit empty, loading, error, readonly, unsaved when the change can see those states.
5. Screenshot 1280 and 390 of the changed surface and attach them. If you cannot screenshot, say **not visually verified** in the PR body — do not say verified.

Hero, strip, and bar changes are responsive. Always include the 390 pass for those.

## 4. Done means

- audit PASS on every affected route at both widths
- no new page-scoped override of a shared primitive
- the reply names the surfaces you did NOT check

Cloud agents cannot screenshot. They must run the audit and write **not visually verified** when they cannot attach 1280/390 shots.
