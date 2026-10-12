# DFS flow options

Design previews requested alongside the phase-5 build. These HTML/CSS/JS files make no app API requests, generate no real lineups and perform no uploads or submissions. Every player and number is fictional. This is a layout choice, not a model-performance comparison.

**Approved: A — Guided flow**, selected by the user on October 12, 2026. Production implementation and its separate verification are recorded in the [shared-outcomes review](../../reviews/dfs-shared-outcomes/README.md). The checks below apply only to these static previews.

- [A: Guided flow](../dfs-flow-a.html): quick build first, with player choices and advanced rules disclosed on demand.
- [B: Compact workspace](../dfs-flow-b.html): player table and settings side by side, followed by Lineups and Entries.
- [C: Games first](../dfs-flow-c.html): a compact game board before player choices and settings.

All options retain player locks/skips, individual/global appearance limits, stacks and game weights, saved plans, comparisons, research, backup/recovery, and separate My Lineups / reserved-entry downloads. Secondary tools use explanatory preview feedback; this is not their full production implementation. This preview uses a fixed 20-lineup sample and resets temporary settings between stages. The production tool's 1–150 count and other formats remain existing features outside this Classic layout preview.

The flow shows Build → Review → Download. Review uses named counts after a sample build; detailed duplicate/batch/shortfall information stays in Build details. Missing data and file-creation blockers remain beside the affected action.

## Actual checks

| Option | 1280 layout | 390 layout | 320 overflow | Build / review / entry checks | Keyboard |
| --- | --- | --- | --- | --- | --- |
| A | PASS | PASS | PASS | PASS | PASS |
| B | PASS | PASS | PASS | PASS | PASS |
| C | PASS | PASS | PASS | PASS | PASS |

`layout-audit.json` contains the six actual all-rule audit reports. `interaction-report.json` contains nine actual browser sessions (three options × 1280/390/320), each checking dark/light overflow, one main landmark, exclusive Lock/Skip, search, build/review, entry-file preview, disabled download until the start-time check, mock-only download feedback, and bottom-navigation clearance. Menu/disclosure keyboard interactions were exercised. Screenshots at 390 and 1280 were inspected in both themes; 320 review screenshots are also retained.

At 320, expanded advanced disclosures and a long destination label also pass the overflow checks. The browser harness permits only local mock URLs and blocks app API and remote requests; no unexpected request or page error occurred.

Reproduce with the local mock server serving this branch's `docs/mockups` on port 5174:

```powershell
$env:LAYOUT_AUDIT_BASE='http://127.0.0.1:5174'
node scripts/dev/layout_audit.mjs /dfs-flow-a.html --width 1280
node scripts/dev/layout_audit.mjs /dfs-flow-a.html --width 390
# Repeat for B/C.
node scripts/dev/verify_dfs_flow_mocks.mjs
```

No shared mock foundation, product palette, app navigation or production primitive was modified. These checks cover the preview, not a completed production redesign or accessibility certification.
