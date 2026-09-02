---
name: add-fantasy-destination
description: Add or rename a Fantasy, Tools, or Projections tab without missing nav, routes, or living surfaces. Use when adding a destination, renaming a tab, or the user says new Fantasy page, new Tools tab, or move a screen.
---

# Add or rename a destination

Do not add a fourth top-level area. Place the work under Projections, Fantasy, or Tools. Follow `.cursor/skills/match-living-surface/SKILL.md` first.

## Same-change checklist

1. **Nav** — `frontend/src/DraftHub/HubSubnav.jsx` (`HUB_SUBVIEWS`) and/or `frontend/src/appNavigation.js` (`TOOLS_TABS` / `PROJECTIONS_TABS` / `SECTION_SUBTITLES`). User-facing **label** from `docs/PRODUCT.md`. Keep the internal `id`.
2. **Routes** — `frontend/src/routes.js` (`HUB_SLUG_TO_ID` + `HUB_ID_TO_SLUG`, or tools/projections parsers). Add a round-trip in `frontend/src/routes.test.js`. Old URLs redirect; do not break bookmarks.
3. **Living surface** — row + aliases in `frontend/src/livingSurfaces.js`. `page` / `copy` must exist. Chrome from the existing enum. Test in `frontend/src/livingSurfaces.test.js` and `tests/test_living_surfaces.py`.
4. **Constitution** — `docs/PRODUCT.md` destination table (and roster panes if office). `tests/test_product_constitution.py` labels must match.
5. **Page** — implement by extending the living `page`, not a new chrome system. Copy in a `*Presentation.js` (`.cursor/skills/add-ui-copy/SKILL.md`).
6. **Chat / office** — Chat is `FantasyChatDock` (edge launcher, centered conversation), not a Roster management pane.

## After

`.cursor/skills/run-tests/SKILL.md` for constitution + routes + living-surface tests. `.cursor/skills/verify-fantasy-ui/SKILL.md` for the new URL.

If you only moved a screen, update the living-surface `page` / `copy` and skip a new nav id.
