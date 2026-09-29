---
name: fast-ui-mock
description: Write 2-3 static HTML design options, then stop for a pick. Use when a page needs a fix, redesign, or first design and the user has not chosen an option yet.
---

# Fast UI mock

Triggered by `.cursor/rules/scoresense-core.mdc` (Matching checkpoint) when the job is a **redesign or first design** and there is no picked option.

This pass is for **options**. It is not documentation and not a ship.

## Skip (do the living-surface edit instead)

- One control, copy line, token, or known bug
- The user already picked (“do A”, “like Home”, a screenshot of the target)
- Backend-only work

## Do not (mock pass)

- Write a design essay
- Open the product app or computerUse to “document” options
- Use Vercel, v0, or Figma file creation
- Call GenerateImage (wrong tokens; tables lie)
- Edit product React / CSS until they pick a letter

## Do

1. Resolve the living surface (`.cursor/skills/match-living-surface/SKILL.md`). Reply **Matching:** `{id}` · `{page}`.
2. Read that `page` / `copy` and `docs/mockups/mockup-shared.css`. For mobile work, also read `.cursor/rules/fantasy-mobile.mdc` and the approved `fantasy-mobile-home-a.html` reference. Use the shared controls and spacing; preserve the destination's own board/table/room structure.
3. Desktop-only: copy `docs/mockups/_starter.html`. Mobile: generate A/B shells from `_mobile-starter.html` with the command below; replace sample body content and match desktop navigation to the living page. Add C only for a real layout alternative.
4. Mobile options share `mobile-foundation.css` and `mobile-mock.js`; keep page-specific content/styles separate. Preview labels and scenario controls stay outside app chrome. Change a meaningful layout/content decision between options, keeping the approved shell stable. Use existing tokens only.
5. Add a chooser row on `docs/mockups/index.html` (and a `{slug}.html` chooser if A/B/C need a sentence each). After every CSS/JS edit, run the asset-version command below for affected pages, including choosers. Link shared CSS directly so each dependency gets its own version.
6. Reuse the mock server at port 5174; start it with `scripts/dev/serve_mockups.sh` if needed. On Windows, start Python's `http.server` on 5174 with `Start-Process -WindowStyle Hidden`, binding to 127.0.0.1 and serving `docs/mockups` from the repo; redirect logs and confirm the URL responds. Keep the server alive after the turn. Local: give `http://127.0.0.1:5174/{slug}.html`. Cloud: give the `docs/mockups/{slug}-*.html` paths on the branch — a web viewer cannot open `127.0.0.1`.
7. Mobile: audit and inspect screenshots at **390 and 1280**; inspect long destination/league names at 320. Exercise disclosure click/keyboard behavior, preview navigation, relevant states, and fixed-nav clearance. Use `LAYOUT_AUDIT_BASE=http://127.0.0.1:5174` with `scripts/dev/layout_audit.mjs`. Desktop-only: screenshot each at 1280. Reload the existing user preview tab when available and verify styles there too; a fresh screenshot session can miss stale cached CSS. Include one phone image per mobile option (desktop on request). No design essay.
8. **Stop.** One line per option. Wait for the pick.

## Mobile shell and asset versions

From the repo root with `PYTHONPATH=.` (PowerShell: `$env:PYTHONPATH='.'`):

```text
python scripts/dev/mobile_mock.py create fantasy-week-a --destination "This Week" --league "Bottom to Top" --title "This Week · A"
python scripts/dev/mobile_mock.py create fantasy-week-b --destination "This Week" --league "Bottom to Top" --title "This Week · B"
python scripts/dev/mobile_mock.py stamp docs/mockups/fantasy-week-a.html docs/mockups/fantasy-week-b.html
```

The generator safely fills names, preserves existing files, and versions each local CSS/JS link. The starter contains sample body sections to replace. Shared dimensions are CSS variables in `mobile-foundation.css`; change those once rather than copying declarations into each mock. Home phase rules stay in Home's files. Keep SVG `width="20" height="20"` attributes as well as CSS sizing.

## After they pick

If the pick adds an overlay, sheet, or popup that was not in the chosen option, mock that surface and screenshot it first. Then wait.

Implement on the living `page` / `copy`. Then `.cursor/skills/verify-fantasy-ui/SKILL.md`.
