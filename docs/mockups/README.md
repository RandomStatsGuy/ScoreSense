# Fantasy design review mockups

Static HTML options. Not product code. Agents: `.cursor/skills/fast-ui-mock/SKILL.md`.

Serve and click: `bash scripts/dev/serve_mockups.sh` → [http://127.0.0.1:5174/](http://127.0.0.1:5174/). Or open [index.html](./index.html).

## Strategy rank (Sep 2026)

Shipped pick is **B + C**: full-page face-off, then View my rankings. Living surface: `hub.value` → `StrategyBoard.jsx`. Logic: `frontend/src/DraftHub/strategyRank.js`.

| File | Shows |
|------|-------|
| `strategy-rank.html` | Chooser + how the board is built. |
| `strategy-rank-a.html` | **A · Board + pair.** Ranked list is the canvas. |
| `strategy-rank-b.html` | **B · Face-off.** Two profiles. Board on the rail. |
| `strategy-rank-c.html` | **C · Site vs mine.** Feed the queue or keep site ranks. |

Earlier leftover-first lanes: [strategy.html](./strategy.html). Reply A / B / C on the rank set.

## Strategy leftover lanes (parked)

| File | Shows |
|------|-------|
| `strategy.html` | Earlier leftover-first chooser. |
| `strategy-a.html` | Bid board lanes. |
| `strategy-b.html` | Night slate. |
| `strategy-c.html` | Spend map. |

## League chat (Sep 2026)

Open **[league-chat.html](./league-chat.html)** first. No new Fantasy destination — Home houses the thread.

| File | Shows |
|------|-------|
| `league-chat.html` | Chooser: stuck-today vs Home house vs drag-to-park. |
| `league-chat-a.html` | **A · Corner card.** Home deck card is the archive. Chip snaps to four corners. Overlay stays centered. |
| `league-chat-b.html` | **B · Locker rail.** Home right rail is the live table. Elsewhere a flush chip on the board opens a side drawer. |
| `league-chat-c.html` | **C · Table talk.** Home shout strip. Bubble drags anywhere and magnets to an edge. Bottom table with player chips. |

Recommendation in the chooser: ship C, keep B’s edge-park, use A’s card if the strip is too thin.

### Decisions to make (league chat)

- [ ] House + open pattern: A / B / C / hybrid?
- [ ] Launcher: corner snap, edge tab, or free magnetic drag?
- [ ] Player chips in messages jump to This Week / Free agents?

Copy [`_starter.html`](./_starter.html) for a new A/B pass. Do not screenshot the mock pass.

## Inventory (Aug–Sep 2026)

They reuse token values from `frontend/src/styles/tokens.css` but are **not product code**; nothing here ships.

| File | Shows |
|------|-------|
| `game-center.html` | **Proposed new destination: Game center** (Team group, between This Week and My team). Matchup billboard with live score + win probability, slot-by-slot starter duel vs your opponent, bench watch, league scoreboard rail, emote/trash-talk dock, and “After the whistle” week trophies (absorbs the This Week poll wall). Backend already exposes everything it needs via `GET /api/hub/league/{id}/live-scoring` (currently unconsumed) and the week-culture endpoints. |
| `my-team-v2.html` | **My team hero + locker room v2.** Banner gains yard-line texture, record/streak/next-opponent chips, and a cap bar. Locker room becomes a lit scene: team-color nameplates, hanging SVG jerseys with numbers, headshot medallions, position tags, bench + overhead light. One locker is shown “open” to illustrate the hover interaction (quick stats). Contract table below is unchanged. |
| `home-v2.html` | **Home v2 (in-season).** Keeps the phase track and priority card; adds a kickoff countdown, and a three-card deck — Your matchup (links Game center), League pulse (trades/bids/poll/chat activity), Standings mini — so the canvas earns its space during the season. |
| `atmosphere-demo.html` | **Working atmosphere v2 demo** (interactive). Hand-drawn inline SVG leaves / snowflakes / footballs on three parallax depth layers with independent fall + sway + tumble animation, wind control, cursor repulsion, click-to-pop footballs, and a “shipped renderer” comparison toggle. `?theme=snow|leaves|footballs` picks the theme on load. No PNG/SVG asset files required — everything is generated inline. |
| `vibe-rankings.html` | **Proposed Team destination: Vibes.** Tinder-style start/sit swipe (mouse, touch, arrows). Each vote raises or lowers personal **aura**, which scales the week projection and rebuilds a start slate live. Desktop/phone toggle. Interactive — open in a browser. Shipped in-app at `/hub/vibes`. |

## Draft waiting state (Sep 2026)

Open **[draft-lobby-waiting.html](./draft-lobby-waiting.html)** first. Same token chrome as the files above; not product code.

| File | Shows |
|------|-------|
| `draft-lobby-waiting.html` | Chooser: phase model (setup → hour → live) and the three concepts. |
| `draft-lobby-today.html` | Shipped Draft lobby — calendar, seats, invite rail. Baseline. |
| `draft-lobby-waiting-a.html` | **A · The Hour.** Countdown, presence, on-page chat, thin order, optional first-three noms, SMS rail. |
| `draft-lobby-waiting-b.html` | **B · War room.** Private nomination queue as the canvas; chat and presence on the rail. |
| `draft-lobby-waiting-c.html` | **C · Check-in.** “I’m here” as the next action; first-run SMS on the page. |
| `draft-alerts-sms.html` | Invites vs alerts, Draft opt-in card, Account phone, sample texts. |
| `draft-lobby-waiting.md` | Phase rules, invite/SMS constraints, recommendation. |

Recommendation in the chooser: ship A as the waiting page, keep B’s queue as a section, put C’s check-in + SMS in the rail. SMS is never an invite.

### Decisions to make (waiting state)

- [ ] Waiting surface: A / B / C / hybrid (A + B queue + C check-in)?
- [ ] Auto-open lobby at T–60 when a night is scheduled?
- [ ] SMS opt-in on Draft + Account (unchecked, account-linked number)?
- [ ] First SMS set: lobby open, T–15, draft live — hold “your nomination”?

## Decisions to make

- [ ] Game center: adopt as a new Fantasy destination? (nav id proposal: `game`, slug `/hub/game`)
- [ ] Game center: absorb This Week trophies/polls + victory emotes into “After the whistle”?
- [ ] My team: adopt hero v2 (record/streak chips + cap bar)?
- [ ] My team: adopt locker room v2 (jerseys, headshots, open-on-hover)? Which parts?
- [ ] Home: adopt in-season deck (matchup / pulse / standings)?
- [ ] Atmosphere: adopt SVG particle system (parallax + sway + tumble)? Cursor interaction on/off by default?
- [ ] Atmosphere: seasonal auto-theme default (leaves Sep–Nov, snow Dec–Feb) with per-user override?
- [ ] Vibes: keep as its own Team destination, or fold the deck into This Week?
- [ ] Vibes: persist aura server-side and apply the slate as a Hub lineup write?
