# Approved Fantasy header — September 10, 2026

The user-approved mockup takes priority over the former grouped desktop navigation. Keep three continuous rows: product navigation, Fantasy destinations, then league context. Use flat borders, readable labels, a selected destination, and a quiet team/role cluster.

League contains Rules, commissioner-only Roster management, and Insights. New league is a separate action inside the league picker. Existing routes, membership switching, sync actions, and phone destination navigation remain intact.

Implementation: shared DesktopPrimaryHeader, HubSubnav, HeaderDisclosure, LeagueSwitcher, LeagueContextBanner, and fantasy-header.css. PRODUCT.md and the applicable Cursor rules now record these decisions.

Verification uses frontend/test-fixtures/header.html with production components and mocked API data. Run scripts/dev/header_browser.mjs with PLAYWRIGHT_MODULE and optional PLAYWRIGHT_CHANNEL. It checks desktop menu layering, keyboard dismissal, commissioner visibility, league switching and creation, phone navigation, long labels, and header rendering across all Fantasy destinations. Layout audits cover 1440, 1280, 1024, and 390 pixels. Generated screenshots and audit reports are in outputs/.

This verifies the shared chrome, not each destination's live page content. Production authentication, real league switching and syncing, and complete live-page regression checks remain unchecked. The production build passes. The full frontend test run retains two existing failures in draftAvailabilityPresentation.test.js and accuracyPresentation.test.js.
