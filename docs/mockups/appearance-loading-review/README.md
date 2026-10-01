# Appearance ground scenes — loading regression checks

The shared app shell waits for the active content to finish loading and paint before mounting its ground scene. Falling decorations remain available during loading. Route changes reset readiness; hidden cached panes and closed disclosures do not block the active page. Finished error and empty states can show their ground scene.

`node scripts/dev/appearance_readiness_browser.mjs` holds initial code, preferences, metadata, and page data requests using the production bundle served through an isolated browser context against the existing local server. It never changes real account preferences or league data. Checks cover desktop 1280px and phone 390px and navigation from a completed page into a loading one. A temporary browser DOM fixture also exercises hidden cached placeholders and closed disclosures, then makes each visible to confirm that it blocks readiness. See [report.json](report.json).

The companion artwork and toy controls are now implemented in React; see [companion review](../companion-review/README.md).

| State | Desktop | Phone |
|---|---|---|
| Fantasy loading | [1280](fantasy-data-loading-1280.webp) | [390](fantasy-data-loading-390.webp) |
| Fantasy ready, scene below content | [1280](fantasy-data-ready-1280.webp) | [390](fantasy-data-ready-390.webp) |
| Weekly loading | [1280](weekly-data-loading-1280.webp) | [390](weekly-data-loading-390.webp) |
| Weekly ready, scene below content | [1280](weekly-data-ready-1280.webp) | [390](weekly-data-ready-390.webp) |

Shared appearance layout and state checks: `node scripts/dev/appearance_browser.mjs --all`; every registered route at both widths, light and dark, with [results](../appearance-review/report.json). Type, native selects, sibling collisions, grid height, and horizontal overflow are checked. Live-room and player-detail overlays were not visually checked; their layout is unchanged.
