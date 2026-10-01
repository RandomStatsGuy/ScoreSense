# Appearance review

Approved September 30 themes: Classic, Cozy den, Snowfall, Autumn, and the existing Footballs preset. Account Appearance combines a browser-local System/Light/Dark choice with account-saved palettes and independent falling decorations, companions, and playful reactions. See the [implemented companion review](../companion-review/README.md).

## Screenshots

| Surface | Desktop, 1280 | Phone, 390 |
| --- | --- | --- |
| Appearance settings, dark | [Desktop](account-1280.webp) | [Phone](account-390.webp) |
| Cozy den, dark desktop / light phone | [Desktop](cozy-1280.webp) | [Phone](cozy-390.webp) |
| Snowfall, dark desktop / light phone | [Desktop](snow-1280.webp) | [Phone](snow-390.webp) |
| Autumn, dark desktop / light phone | [Desktop](leaves-1280.webp) | [Phone](leaves-390.webp) |

The ground scene follows ready page content and uses one continuous base. Falling particles remain behind surfaces. Reduced motion stops particles and playful reactions. Companion reactions require moving their own toy; general page pointer movement leaves them alone.

## Validation

| Check | Result |
| --- | --- |
| Production build | PASS |
| Focused atmosphere, physics, preferences, and layout unit checks | 46 passed |
| Preference API, persistence, living surfaces, product contracts | 55 passed |
| Existing app layout gates, 34 routes at 1280 and 390 | PASS |
| Production theme layout gates | 152 passed: 34 routes in light/dark at both widths, plus four themed settings palettes |
| Final settings and phone scroll placement | 16 passed |
| Palette text and primary-action contrast | PASS, at least 4.5:1 |
| System/device changes, explicit mode, keyboard radio navigation | PASS |
| Reload, cross-tab sync, stale-load protection | PASS |
| Independent layers, reduced motion, toy-only companions | PASS |
| Failed save rollback, failed load/retry, no per-destination preferences fetch | PASS |
| Full frontend suite | 934 passed; the same 3 pre-existing failures remain |

The frontend baseline failures concern contract labels, model accuracy copy, and a stale My team layout assertion. The full backend suite was not rerun for this narrow preference change.

Browser checks serve the production build through the existing local app port. A temporary signed-in identity and preference responses are intercepted; league reads use the existing local API. No saved account preferences or league focus are written. The season route redirects to preseason, and signed-in Login/Register redirect to Weekly.

Admin-only content, signed-out authentication screens, public owner-room sharing, and active live draft/game workflows were not exercised. Draft and mock workspaces retain the palette with decorative atmosphere suppressed.

Run:

```powershell
npm --prefix frontend run build
node scripts/dev/appearance_browser.mjs --all
# Faster controls, settings, and scene review:
node scripts/dev/appearance_browser.mjs --settings-only
```

The reports are [all routes](report.json) and [final settings](settings-report.json). Layout gates are type, selects, collisions, and grids, plus horizontal page overflow.
