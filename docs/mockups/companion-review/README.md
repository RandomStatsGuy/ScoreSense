# Companion implementation review

These are screenshots of the React app's production build, with account preference writes intercepted. The app uses the approved A artwork and interactions. The existing local API provides read-only league data.

Each theme was checked in light and dark mode at 1280, 390, and 2501 pixels. The browser harness exercises all four drag corners with invisible movement limits, gaze relative to the face (including the mirrored cat), keyboard controls, release physics, touch dragging, resting motion, independent layers, reduced motion cancellation, failed-save rollback, persistence, and the continuous ground assertion. The separate loading harness checks initial loaders, hidden cached content, route changes, empty responses, and error responses.

| Theme | Desktop | Phone | Wide |
|---|---|---|---|
| Cozy den | [Scene](cozy-page-1280-dark.webp) | [Scene](cozy-page-390-dark.webp) | [Scene](cozy-page-2501-dark.webp) |
| Snowfall | [Scene](snow-page-1280-dark.webp) | [Scene](snow-page-390-dark.webp) | [Scene](snow-page-2501-dark.webp) |
| Autumn | [Scene](leaves-page-1280-dark.webp) | [Scene](leaves-page-390-dark.webp) | [Scene](leaves-page-2501-dark.webp) |
| Footballs | [Scene](footballs-page-1280-dark.webp) | [Scene](footballs-page-390-dark.webp) | [Scene](footballs-page-2501-dark.webp) |

The matching `*-light.webp` files show light mode. `*-preview-*.webp` shows each Account preview. [Interaction and layout report](report.json). The app-wide layout report is in [appearance-review/report.json](../appearance-review/report.json); loading results are in [appearance-loading-review/report.json](../appearance-loading-review/report.json).

Run after building the frontend:

```powershell
node scripts/dev/companion_browser.mjs
node scripts/dev/appearance_browser.mjs --all
node scripts/dev/appearance_readiness_browser.mjs
```

Live draft interactions, real account writes, and production deployment were not exercised. Draft workspaces were checked for absence of the global scene. Browser checks use the repository's CI layout gates plus the new ground, companion-target, and invisible movement-boundary assertions.
