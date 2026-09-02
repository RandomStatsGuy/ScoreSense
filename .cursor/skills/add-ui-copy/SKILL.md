---
name: add-ui-copy
description: Put user-visible strings in the living Presentation module and test them. Use when changing UI copy, buttons, empty states, errors, or when the user asks to rename a label.
---

# Add UI copy

## Where the string goes

1. Resolve the surface (`.cursor/skills/match-living-surface/SKILL.md`).
2. Write the string in that row’s `copy` module. If `copy` is missing, add a `*Presentation.js` next to the page and point the living-surface row at it — do not leave a new sentence in the JSX except as a call into that module.
3. Existing modules: `rulesPresentation.js`, `leagueHomePresentation.js`, `gameCenterPresentation.js`, `insightsPresentation.js`, `leagueAccessCopy.js`, `dfsToolPresentation.js`, `bestBallPresentation.js`, `projectionsPresentation.js`, `acquisitionWindow.js`, `vibeRankingsPresentation.js`.

## Voice

Goal + consequence. No “Submit”. No “You do not have permission” — use “Commissioner managed”. Labels from `docs/PRODUCT.md` (Fantasy, Strategy, Free agents, My team, Roster management). Never “Draft Hub” in UI copy.

## Test

Add a `node:test` case next to the module (`*.test.js`), same style as `leagueHomePresentation.test.js` or `rulesPresentation.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { THE_COPY } from "./thatPresentation.js";

test("empty state tells the owner what happens next", () => {
  assert.match(THE_COPY.empty, /cap|roster|bid/i);
  assert.doesNotMatch(THE_COPY.empty, /Submit|Draft Hub|permission/i);
});
```

Run `node --test frontend/src/path/to/thatPresentation.test.js`.

If you renamed a destination label, also update `docs/PRODUCT.md` and `tests/test_product_constitution.py` (`.cursor/skills/add-fantasy-destination/SKILL.md`).
