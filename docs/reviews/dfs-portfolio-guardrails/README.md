# DFS portfolio guardrails review

October 11, 2026. These screenshots use the production workspace components with explicitly synthetic players and local API responses. They do not show an original incident, live account, paid source data or an accepted platform upload. The browser labels its selection response as a synthetic guardrail fixture. Real-engine enforcement is tested separately.

| Task + measured layout | 390 | 768 | 1280 | 1440 |
|---|---|---|---|---|
| Dark | PASS | PASS | PASS | PASS |
| Light | PASS | PASS | PASS | PASS |

[Compact results](responsive-results.json) contain outcomes without entry, plan or backup input files. The tasks verify:

- Empty/duplicate combinations, contradictory bounds blocked before an API request, percent/count conversion, and actual pair appearances across slots.
- Minimum, maximum, exact, optional and forbidden stack choices; explicitly selected receiving RBs; locked players counting toward the requested structure; original-build attachment/opponent histograms.
- Named-plan preview/cancel and atomic replacement of prior locks, skips, game weights and strategy controls. Applying a plan does not build lineups. Changed inputs disable Build with an associated explanation; changing display units preserves its match. Keyboard Enter on Apply and Cancel returns focus to the visible Import trigger at all four widths/both themes.
- Stale controls and changed context cannot apply an old preview. Null native rules can be imported and built safely; the first native edit invalidates that plan. Unsupported global plans containing legacy stack choices are rejected by focused helper tests.
- Original collected batches remain unchanged. Applied-plan manifests survive portfolio backup and local-draft reload with no regeneration.
- Independently checked group bounds and native stack counts in the exported audit, downloaded CSV bytes matching their SHA-256 seal, and an unrelated entry remaining unchanged.

The final extra desktop regression also confirms Captain comparison sends its own one-lineup request when the unused portfolio count is invalid. That fixture returns an explicitly empty/incomplete comparison; it proves request/control independence, not Captain solver quality. Extra checks also confirm FanDuel/seasonal retain legacy stack controls and valid difference choices, a same-slate plan shrinking six groups to one reveals the remaining bound immediately, and a legacy require-stack plan with count zero is rejected before preview.

Final frontend checks: **178/178 DFS tests passed**; broader frontend **1,124 passed / 3 confirmed baseline failures** out of 1,127 (13.504s). Production build passed in 10.76s with the existing bundle-size warning above 500 kB.

Foundation browser tasks passed at all four widths/both themes, including fresh authorization rejection and an account change during a delayed save. Existing portfolio browser tasks passed at 390/1280, including exact-byte local recovery versus synchronized downloads, a 150-entry export/reload with an unrelated row, and a 140-lineup/700-player backup containing 588,363 JSON values with no regeneration.

All six scoped dark-theme screenshots were visually inspected. Total image size is approximately 79 KB. Light theme is included in the task/layout checks above.

| State | Phone | Desktop |
|---|---|---|
| Pair/core bounds and actual usage | [390](groups-390.png) | [1280](groups-1280.png) |
| Named-plan replacement preview | [390](plan-390.png) | [1280](plan-1280.png) |
| Original-build stack and FLEX structure | [390](structure-390.png) | [1280](structure-1280.png) |

The extended task run found the stack histogram reading an incorrect audit field and showing unknown counts. The implementation was corrected, then all eight cases passed. Controls fit their visible panels and there is no page horizontal overflow. Shared geometry checks cover tables, collisions, target sizes, typography and gutters. This is scoped task/visual evidence, not a full accessibility certification; other Fantasy/Projections contexts were not exercised.

The affected Python suite passed **279 tests in 35.71s**. The real synthetic engine pipeline selected **150 unique lineups from 278 candidates in 15.141s**, with QB target/actual 60 and pair target/actual 30 within hard 15–45 bounds. It recorded 23 group-omission generation attempts and passed the exact-one attachment audit for every selected lineup. Independent export/CSV/backup replay passed; platform acceptance remains unconfirmed. Runtime describes this engineering fixture, not forecasting performance or a production guarantee. The whole backend gate finished: **2,880 passed, 2 skipped, 1 warning in 1854.05s**. [The tracker](../../DFS_REBUILD_IMPLEMENTATION.md) retains the exact command and scope.

Run from the repository root, sequentially because the scripts share a temporary bundle:

```powershell
node scripts/dev/dfs_rebuild_browser.mjs --guardrails-only
node scripts/dev/dfs_rebuild_browser.mjs
node scripts/dev/dfs_portfolio_browser.mjs
```

The helper bundles the isolated checkout and fulfills browser fixture requests locally. It does not replace another checkout's server or send live API traffic.

Scope limits: pair/core minimum/target/maximum bounds apply to each requested global build, using that build's requested count. Collected batches retain their own rules. Their accumulated audit currently covers player/QB usage; combined collection pair/core counts and bounds are pending. Accumulated collection counts do not silently reinterpret those bounds as one newly selected global portfolio. Explicit receiving-RB IDs declare eligibility rather than infer a validated football role. Unknown/contradictory team relationships remain unknown, and required native constraints cannot silently pass them. Scenario/shared-assumption concentration, broader portfolio replacement, compact content-reference backups, statistical stages 4–7 and accepted-entry late swap remain in the [full matrix](../../DFS_REBUILD_RULE_MATRIX.json).
