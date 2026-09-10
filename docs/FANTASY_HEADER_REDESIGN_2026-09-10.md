# Approved Fantasy header — September 10, 2026

The user-approved mockup takes priority over the former grouped desktop navigation. Keep three continuous rows: product navigation, Fantasy destinations, then league context. Use flat borders, readable labels, a selected destination, and a quiet team/role cluster.

League contains Rules, commissioner-only Roster management, and Insights. New league is a separate action inside the league picker. Existing routes, membership switching, sync actions, and phone destination navigation remain intact.

Implementation: shared DesktopPrimaryHeader, HubSubnav, HeaderDisclosure, LeagueSwitcher, LeagueContextBanner, and fantasy-header.css. PRODUCT.md and the applicable Cursor rules now record these decisions.

Verification uses frontend/test-fixtures/header.html with production components and mocked API data. Run scripts/dev/header_browser.mjs with PLAYWRIGHT_MODULE and optional PLAYWRIGHT_CHANNEL. It checks desktop menu layering, keyboard dismissal, commissioner visibility, league switching and creation, phone navigation, long labels, and header rendering across all Fantasy destinations. Layout audits cover 1440, 1280, 1024, and 390 pixels. Generated screenshots and audit reports are in outputs/.

This verifies the shared chrome, not each destination's live page content. Production authentication, real league switching and syncing, and complete live-page regression checks remain unchecked. The production build passes. The full frontend test run retains two existing failures in draftAvailabilityPresentation.test.js and accuracyPresentation.test.js.

## Projections and Tools follow-up

The same flat product row now applies to Projections and Tools. Their destination links use the shared ProductSubnav component and the Fantasy tab styles, retaining Weekly/Season mode URLs, Tools destinations, account controls, and mobile destination sheets. Projection filters remain in place. Account-only pages keep their existing header treatment.

`scripts/dev/product_header_browser.mjs` uses `frontend/test-fixtures/product-header.html` to exercise the production navigation components. Coverage includes Weekly, Season Preseason outlook/Live season, DFS, Mock draft, and Best ball at 1440, 1280, 1024, and 390 pixels; account-menu layering and Escape; destination selection; guest sign-in; native destination URLs; and layout audits at 1280/390. Run with PLAYWRIGHT_MODULE and optional PLAYWRIGHT_CHANNEL as above. The original Fantasy header browser checks are retained as a regression check.

These fixtures verify navigation and header presentation, not live projection results, tool workflows, authentication, or the page bodies on Cap/Rules/My team. Screenshots and audit reports are written to outputs/ and are not bundled with the application.
