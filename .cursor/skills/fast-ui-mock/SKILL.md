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
2. Read that `page` / `copy`, `docs/mockups/mockup-shared.css`, and `docs/mockups/_starter.html`.
3. Copy the starter into `docs/mockups/{slug}-a.html` and `{slug}-b.html`. Add `-c` only when the third fork is a real layout, not decoration.
4. Keep mock chrome (header, subnav, hero). Tokens from `mockup-shared.css` only. Each option must change a decision or a layout beat. Mock pages must pass `layout_audit` too — otherwise the picked option ships the same bar / table / header bugs.
5. Add a chooser row on `docs/mockups/index.html` (and a `{slug}.html` chooser if A/B/C need a sentence each).
6. Start `bash scripts/dev/serve_mockups.sh`. Local: give `http://127.0.0.1:5174/{slug}.html`. Cloud: give the `docs/mockups/{slug}-*.html` paths on the branch — a web viewer cannot open `127.0.0.1`.
7. Screenshot each option at 1280 (hero plus the unique layout beat). One image per letter. No design essay.
8. **Stop.** One line per option. Wait for the pick.

## After they pick

If the pick adds an overlay, sheet, or popup that was not in the chosen option, mock that surface and screenshot it first. Then wait.

Implement on the living `page` / `copy`. Then `.cursor/skills/verify-fantasy-ui/SKILL.md`.
