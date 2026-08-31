# Fantasy design review mockups (Aug 2026)

Static, self-contained HTML mockups from the Fantasy section design review. Open any file
directly in a browser — no build step. They reuse the token values from
`frontend/src/styles/tokens.css` but are **not product code**; nothing here ships.

| File | Shows |
|------|-------|
| `game-center.html` | **Proposed new destination: Game center** (Team group, between This Week and My team). Matchup billboard with live score + win probability, slot-by-slot starter duel vs your opponent, bench watch, league scoreboard rail, emote/trash-talk dock, and “After the whistle” week trophies (absorbs the This Week poll wall). Backend already exposes everything it needs via `GET /api/hub/league/{id}/live-scoring` (currently unconsumed) and the week-culture endpoints. |
| `my-team-v2.html` | **My team hero + locker room v2.** Banner gains yard-line texture, record/streak/next-opponent chips, and a cap bar. Locker room becomes a lit scene: team-color nameplates, hanging SVG jerseys with numbers, headshot medallions, position tags, bench + overhead light. One locker is shown “open” to illustrate the hover interaction (quick stats). Contract table below is unchanged. |
| `home-v2.html` | **Home v2 (in-season).** Keeps the phase track and priority card; adds a kickoff countdown, and a three-card deck — Your matchup (links Game center), League pulse (trades/bids/poll/chat activity), Standings mini — so the canvas earns its space during the season. |
| `atmosphere-demo.html` | **Working atmosphere v2 demo** (interactive). Hand-drawn inline SVG leaves / snowflakes / footballs on three parallax depth layers with independent fall + sway + tumble animation, wind control, cursor repulsion, click-to-pop footballs, and a “shipped renderer” comparison toggle. `?theme=snow|leaves|footballs` picks the theme on load. No PNG/SVG asset files required — everything is generated inline. |

## Decisions to make

- [ ] Game center: adopt as a new Fantasy destination? (nav id proposal: `game`, slug `/hub/game`)
- [ ] Game center: absorb This Week trophies/polls + victory emotes into “After the whistle”?
- [ ] My team: adopt hero v2 (record/streak chips + cap bar)?
- [ ] My team: adopt locker room v2 (jerseys, headshots, open-on-hover)? Which parts?
- [ ] Home: adopt in-season deck (matchup / pulse / standings)?
- [ ] Atmosphere: adopt SVG particle system (parallax + sway + tumble)? Cursor interaction on/off by default?
- [ ] Atmosphere: seasonal auto-theme default (leaves Sep–Nov, snow Dec–Feb) with per-user override?
