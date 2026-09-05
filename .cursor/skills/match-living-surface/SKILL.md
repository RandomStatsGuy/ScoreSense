---
name: match-living-surface
description: Look up the shipped page and copy module for a ScoreSense screen and match them. Use before any user-facing UI, layout, chrome, or copy change, or when the user says match this page, looks like Home, or names a Fantasy/Projections/Tools destination.
---

# Match the living surface

Triggered by `.cursor/rules/scoresense-core.mdc` (Matching checkpoint) before UI work. The living file beats a prose description.

## 1. Resolve the destination

Use `frontend/src/livingSurfaces.js`. Prefer the first hit:

1. Nav ids you already know — `resolveLivingSurface({ section, hubView, toolsTab, projectionsTab, officeTab, draftLive, inspector })`
2. The user’s words — `resolveLivingSurfaceFromText(prompt)` (longest alias wins; `cap` does not match `capture`)
3. A file already in play — `surfacesForFile("frontend/src/...")`

If that returns nothing, ask **Need a surface?** Do not invent a layout.

Live draft / live mock: set `draftLive: true` (or use `hub.room.live` / `tools.mock-draft.live`). Player drawer/sheet: `projections.inspector`.

## 2. Open the living files first

From the row, read:

- `page` (required)
- `copy` when present
- `also` when present
- `SHARED.primitives` and `SHARED.tokens` from the same module
- `SHARED.media` / `SHARED.ownerLabel` when the screen shows players or people

Then reply **Matching:** `{id}` · `{page}` before you edit. That line is the checkpoint. If it is wrong, the user can override it in one sentence.

If this is a redesign or first design and they have not picked an option, follow `.cursor/skills/fast-ui-mock/SKILL.md` and **stop**. Do not edit product React on that pass.

## 3. Change by extending, not replacing

- Keep `chrome`. `experience` uses `HubExperienceHero` / `Layout` / `Summary`. `board` stays a projections board. `draft-live` stays board-first. `action-center` stays the Home deck.
- Put new user-visible strings in the existing `copy` module. Do not add a parallel `*Presentation.js`.
- Tokens only. No new accent.
- Honor `doNot` on the row.

## 4. Keep the registry alive

In the **same change** when you:

- Add or rename a destination, tab, or office pane
- Move a screen to a different `page` / `copy`
- The user says this screen should look like another living surface

Update `LIVING_SURFACES` (and `SURFACE_ALIASES` if they used a new name). Also update `docs/PRODUCT.md` and nav when the change is user-facing.

A chrome correction is a living-surface edit, not a new essay. If you are also running capture-correction: persist `always` / `never` by changing the row; do not clone it into `learned-rules.mdc`.

## 5. Wrong Matching: line

When the user rejects the checkpoint (“not the lobby, the live room”, “Strategy, not Free agents”):

1. Resolve the **right** id. Keep working there this turn.
2. On the **second** miss for the same screen in this conversation, take the distinctive phrase they used (or the phrase that sent you to the wrong row). Add it to `SURFACE_ALIASES` pointing at the right id. Longer, specific phrases beat short ones (`nominee card` not `draft` if they meant live). Add a one-line test in `frontend/src/livingSurfaces.test.js` for that phrase. Reply **Captured:** `always` · `fantasy-ui` · `{phrase}` → `{id}`.

Do not grow `SURFACE_ALIASES` on the first miss. A one-off wrong pick is not a durable alias.
