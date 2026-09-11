# Game center room and projection repair

The September 11, 2026 selected B concept is implemented on `/hub/game`: featured jersey duel, starter comparison, separate Bench and League views, and a details rail. Each team’s uploaded banner is fetched through the existing authenticated media loader, honors its crop, and fades into the scoreboard center. Account atmosphere stays outside the page.

My team’s scoreboard opens Game center with `matchupWeek` and `matchupTeam`. It is a native keyboard-accessible link. Public shared rooms omit it, and opening the destination never writes league focus.

## Projection diagnosis

Read-only checks of production’s 2026 Week 1 forecast artifacts found forecasts for all eight named starters in the supplied screenshot. Seven live-scoring players had `sleeper-*` identifiers, while the artifacts used NFL GSIS IDs. Kelce’s GSIS ID already matched, explaining why only his forecast appeared. The live-scoring enrichment now reuses the weekly board’s guarded name/team resolver, including team aliases, and resolves bench players too. Existing player IDs are retained.

My team freezes a separate pregame baseline. A player first resolved after kickoff cannot acquire a retrospective pregame baseline: the room now explains “Pregame projection not saved.” Empty K/DEF slots still have no player forecast. No production writes, forecast recomputation, or deployment were performed during diagnosis.

## Verification

- 58 backend/product checks passed: live scoring, room snapshots/auth, and product constitution.
- Focused frontend presentation/navigation/registry tests passed.
- Production frontend build passed (existing chunk-size warning).
- Full frontend run: 755 passed, 5 failed. The same five failures reproduced on unchanged develop: draft availability source assertion; draft award contract label; two roster-format assertions; accuracy missing-value copy.
- Production components with deterministic API fixtures: Game center and My team audited at 1280 and 390, all layout rules passed. Exercised position selection, both player details, Bench, League, week changes, lineup navigation, empty/error/loading/pregame/final states, missing art, authenticated banner loading, selected-team orientation, and private/public room navigation.
- Visual checks use fixtures rather than a logged-in production browser. Other full destinations that consume the shared loading skeleton (Home, Draft, Trades, Vibes, Roster management) were not individually audited; the existing skeleton styles were moved outside the phone-only media query without changing their phone appearance.

Reproduce: run Vite on port 5178, then `node scripts/dev/game_center_browser.mjs` (Edge/Playwright). `GAME_CENTER_PREVIEW_URL` overrides the preview origin. Screenshots and audit output are saved under `outputs/game-center/`.
