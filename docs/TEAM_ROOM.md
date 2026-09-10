# My team room

The September 10, 2026 approved concepts make the team room the default My team view for league teams. The implementation uses a continuous locker wall, detailed NFL-colored jerseys, a matchup scoreboard, in-place player details, and the owner's Account atmosphere. All nine starters fit together at desktop widths; smaller screens reflow to three or two columns. Manage roster preserves the existing contract, cap, extension, cut, and appearance tools. Solo mode retains its existing view.

The artwork exception is scoped to this room in PRODUCT.md, the living-surface registry, and the core/frontend rules. Functional text and controls still follow the existing readability, focus, and touch-target requirements. There is no camera animation; reduced-motion users also receive static drawer transitions.

## Data and permissions

- Authenticated league members can visit teams without changing their saved league or team focus. Only the team owner can edit nicknames or sharing settings.
- Room scores use the existing cached weekly scoring service. Visible rooms refresh every 60 seconds; hidden tabs pause requests. This is week-level scoring, not a play-by-play feed. The existing schedule helper determines completion from the slate's final kickoff plus four hours; delayed games and later scoring corrections remain a provider limitation.
- Pregame values come from existing projections; no model inference is introduced. The room captures a player's projection when read before kickoff and freezes it afterward. If nobody opens the room before kickoff, that player's comparison is unavailable. Historical visits never backfill a projection with a newer estimate, and historical benches use the historical lineup.
- Missing scores remain dashes; actual zero remains zero. Projection differences appear in final recaps only. Historical players no longer on the roster have no contract or nickname controls.
- Sleeper nickname metadata is optional and best effort. The public provider contract does not guarantee it, and live import has not been confirmed. Local overrides work independently; Reset removes the local override.
- Account atmosphere is read from the owner's stored preferences. The room does not change focus or write another viewer's preferences.

## Sharing

Sharing is off until the owner chooses Create share link. A random 256-bit URL token grants read-only access to the room, scores, player names/nicknames, team image, and theme. The public response excludes salaries, contract terms, rules, account identifiers, and the league team picker. Nicknames and team images should therefore be considered shared when the owner enables a link.

Turning sharing off invalidates the token; enabling it again creates a different token. Public room and image requests revalidate the token and return no-store/noindex headers. The public image route serves only the image currently attached to that team. Nickname and sharing mutations remain authenticated and owner-scoped; public URLs have no write endpoints.

Analytics initialization and page views skip shared-room URLs; payload construction also redacts room tokens. The shared view's return link suppresses its referrer.

Endpoints:

- GET `/api/hub/league/{league_id}/teams/{team_id}/room`
- PATCH the same path plus `/nicknames/{player_id}` or `/share`
- GET `/api/hub/shared-room/{token}` and `/photo`
- Browser route `/team-room/:token`

SQLite lazily initializes `team_room_settings` and `team_room_projection`. There is no destructive migration.

## Artwork

The locker interior was generated with the built-in image generation tool, then compressed to a 31,896-byte WebP. The shipped asset is `frontend/public/art/team-room/locker-interior.webp`. Player jerseys, numbers, names, scores, controls, and NFL marks remain separate rendered elements.

Source output: `exec-7b26cd56-e9a0-409e-98b1-694298c340cb.png` from the September 10 concept session. Final generation prompt:

> Use case product-mockup. Create a production game UI BACKGROUND TEXTURE asset: one single empty premium American football locker interior, frontal orthographic camera, portrait 2:3. Extremely detailed photoreal dark walnut and charcoal metal materials with slim warm brass edge lighting, perforated vents at top, empty thin metal hanging rail across upper portion, empty dark backing for a jersey that will be rendered separately by code. Bottom 18% has polished equipment shelf, understated black cleats pair at bottom left, unbranded water bottle at bottom right. Entire middle 70% intentionally EMPTY for dynamic jersey overlay. No jersey, no hanger, no shirt, no text, no names, no number, no logos, no plaques, no surrounding room. Full bleed straight rectangular single locker, minimal perspective, evenly centered. Rich fine grain tactile material, soft realistic overhead spotlight, almost black corners, warm rim highlights. Useful as repeated narrow locker cubicle background behind functional web controls. Not a screenshot.

## Verification

`tests/test_team_room.py` covers owner access, cross-league denial, public link revocation, nickname validation, public payload filtering, optional provider metadata, and frozen projection history. The existing live-scoring and league-atmosphere suites exercise shared backend behavior using isolated databases and mocked providers.

`scripts/dev/team_room_browser.mjs` exercises production React components through deterministic fixture API responses. It checks room/contract navigation, nickname persistence, Escape focus return, sharing/revocation, guest controls, empty/error states, and pregame/live/final layouts at 1536, 1280, 1024, and 390 pixels. The layout audit passes at 1280 and 390 pixels.

Production league synchronization, live Sleeper nickname metadata, and a deployed public link have not been verified. The complete frontend test run has two existing failures in draftAvailabilityPresentation and accuracyPresentation; the room, roster presentation, and living-surface tests pass.
