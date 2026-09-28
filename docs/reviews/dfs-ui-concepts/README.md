# DFS input coverage design options

Static interactive concepts on `codex/dfs-ui-concepts`. No product React or CSS changes.

- A: coverage in context, with expandable missing-player details beside the pool.
- B: a larger coverage review ahead of the pool, with separate missing/estimated tabs.

Open `http://127.0.0.1:5175/dfs-inputs.html` locally. Port 5174 already serves a different checkout; it was left running. The dedicated Python preview is bound to loopback only.

Players, projections, timestamps, saved builds and comparison results are illustrative. Controls demonstrate local UI behavior only. Both options keep the existing Tools chrome and slate bar, one primary build action, separate Captain/total exposure, source labels, frozen saved inputs, and separate lineup/entry exports.

Both options passed all layout-audit rules at 1280 and 390. Playwright also checked position/search filters, player locks, lineup-count selection, inline missing-player review, estimate-source tabs, Captain comparison, and stale/fresh state previews. Desktop and phone screenshots were inspected. Product pages, live account data and production were not exercised for this mockup task.
