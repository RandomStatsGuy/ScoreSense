# Fantasy (internal: Draft Hub)

Salary-cap and pick-draft league tooling. **Users see this as Fantasy**, not “Draft Hub.” Names, chrome, and copy: [PRODUCT.md](./PRODUCT.md). Contract cases: [CONTRACT_SCENARIOS.md](./CONTRACT_SCENARIOS.md).

This file is the **API and storage** map. Do not add user-facing destinations here without updating `HubSubnav.jsx` and `PRODUCT.md`.

Shipped: solo prep, live auction / snake / linear rooms, contracts, cap planner, Sleeper import, trades, Rules, Roster management, Insights, persistent league chat.

## Product split

| Area | Purpose |
|-----|---------|
| **Projections · Season** | Season totals and floor–ceiling (`GET /api/draft/{position}` and season caches) |
| **Fantasy** | Home, Strategy, Draft, This Week, My team, Free agents, Rosters, Cap, Trades, Rules, Roster management, Insights |

## Storage

SQLite database at `data/draft_hub/draft_hub.db` (`DRAFT_HUB_DB` in `src/config.py`), scoped by JWT `sub` from Patreon auth.

## Rules preset

Default preset: `data/draft_hub/presets/salary_cap_auction_v1.yaml`

- $200 salary cap
- QB/RB/WR/TE min/max roster limits
- 1–3 year contracts, 50% cut refund (configurable)
- Auction timers (nomination / bid)

## Contract scenarios (roster → UI)

Real-world cases → Contract type / Years left / Cap Planner badges: [CONTRACT_SCENARIOS.md](./CONTRACT_SCENARIOS.md).

## Trades (propose / accept)

- **Rosters** tab: browse any team (cap, position spend, fp/$, good/bad contracts) → **Trade for** / **Add to trade**.
- **Trades** tab: Builder (multi-team, drops, dead-cap assignee), Inbox (accept/reject), Ideas (load suggested packages).
- Every party must **Accept**; commissioner can **Force apply**. Cap + position max are hard-validated before execute.
- Dropped players free salary for the cutter; dead money (`cut_refund_pct`) can be **fully assigned** to another party (player moves as `cut_before_draft` onto that roster).
- APIs: `GET/POST /api/hub/league/{id}/trades`, `.../respond`, `.../force`, `.../cancel`. `GET .../rosters` is member-readable.

## Roster management (internal id `office`)

Staff-only. UI label is **Roster management**, not Office.

- Panes: **Contracts**, **Salary sheets**, **Members**, **Access & imports** (`hubOfficeTabs.js`).
- **Chat** is `FantasyChatDock` on shared Fantasy pages: viewport-fixed edge launcher, centered conversation when open (league channel for members; staff channel for primary + co-commissioners). Not a Roster management tab.
- **Contracts**: live multi-team contract edit (same store as My team / Cap).
- **Salary sheets**: season-gated (prefer Sleeper week-1, else pre-draft rosters, else Excel; $ seeded from prior year). Commissioner **Build pre-draft sheet** (`POST .../build-pre-draft?season=Y`) before the draft; **Build week-1 sheet** (`POST .../build-week1?season=Y`) once week-1 matchups exist. **FA lottery** = post-draft FA win (real $); **FA contract** = always $1 and expires before the next draft (skipped as keepers on pre-draft seed). Contract-history row audit under Advanced.
- **Members**: claim vs Sleeper link status, add/remove franchise (pre-draft only), invites with optional co-commissioner, promote/demote co-commish (primary only). Franchise resize: `POST/DELETE /api/hub/league/{id}/franchises`. See [LEAGUE_RESIZE.md](./LEAGUE_RESIZE.md).
- Co-commissioners share operational powers with the primary except transfer ownership / demote other staff.

## Salary range CSV

Columns (flexible headers):

| Column | Aliases |
|--------|---------|
| Player name | `Name`, `player_name`, `Player` |
| Min salary | `min`, `min_sal`, `floor` |
| Max salary | `max`, `max_sal`, `ceiling` |
| Optional | `team`, `position`, `player_id` |

Import via **Fantasy → Roster management → Access & imports** (or Setup salary ranges). Unmatched players can get model-derived tiers via **Generate model tiers**.

## Sleeper team link

Link your Sleeper league once in **Fantasy → Home / Setup → Sleeper team link**:

1. Paste your **Sleeper league ID** (from the league URL)
2. Click **Load teams** and pick **which team is yours**
3. Click **Link my team**

Once linked, Fantasy:

- Marks your Sleeper players on the **value sheet** (`sleeper` / `mine` status)
- Highlights them in **My roster** and **Cap sheet**
- Lets you **Refresh from Sleeper** or **Sync + import to roster**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/hub/sleeper/league/{id}/teams` | List teams for picker |
| GET/PUT/DELETE | `/api/hub/sleeper/link` | Read / save / clear link |
| GET | `/api/hub/sleeper/roster` | Live Sleeper roster snapshot |
| POST | `/api/hub/sleeper/sync` | Refresh cached player ids (+ optional hub import) |

Player IDs are mapped via Sleeper `gsis_id` → ScoreSense `player_id` when available.

## API (all require patron when `AUTH_REQUIRED=true`)

| Method | Path | Description |
|--------|------|-------------|
| GET/PUT | `/api/hub/workspace` | Solo workspace + rules |
| GET | `/api/hub/presets` | Rule presets |
| GET | `/api/hub/value-sheet` | Projections + ranges + bid hints |
| POST | `/api/hub/salary-ranges/import` | CSV upload |
| POST | `/api/hub/salary-ranges/generate` | Model tiers |
| GET/POST/DELETE | `/api/hub/roster` | Manual roster |
| GET | `/api/hub/cap-sheet` | Cap summary + validation |
| POST | `/api/hub/league` | Create live league (Phase B) |
| POST | `/api/hub/league/join` | Join by room code (also claims an unclaimed team of the same name) |
| GET | `/api/hub/claim/{token}` | Public preview of the text invite / claim link |
| POST | `/api/hub/claim/{token}` | Sign-in required: claim a team from that link |
| POST | `/api/hub/league/{id}/claim-link/rotate` | Commissioner: retire the old invite URL |
| GET/PUT | `/api/hub/league/{id}/availability` | Shared draft-night calendar (opens 31 days before week 1) |
| GET | `/api/hub/league/{id}` | Room state |
| WS | `/api/hub/ws/{league_id}` | Realtime updates |
| POST | `/api/hub/contract/rookie-extend` | Manager rookie extension (server-calculated; aliases: `/extend`, `/renew`) |
| POST | `/api/hub/sleeper/import` | Sleeper roster snapshot (read-only) |
| GET/PUT | `/api/hub/league/{id}/lineup` | Hub weekly lineup (ScoreSense-only leagues) |
| POST | `/api/hub/league/{id}/lineup/swap` | Swap a starter with a bench player |
| GET | `/api/hub/league/{id}/schedule` | Persist / read rotating H2H schedule |
| POST | `/api/hub/league/{id}/score-week` | Apply Hub PPR from nflverse weekly stats |

Hub-only leagues persist start/sit on **This Week** and score weeks with standard PPR (`FANTASY_SCORING`). Linked Sleeper leagues keep inferred (advice-only) starters on This Week; lineup writes and `score-week` return 409. Game center still reads Sleeper matchups.

## Roadmap (historical)

Phase A (solo prep), B (live room), and C (contracts, cap, Sleeper) are **shipped**. New Fantasy work follows [PRODUCT.md](./PRODUCT.md), not a new phase letter.
