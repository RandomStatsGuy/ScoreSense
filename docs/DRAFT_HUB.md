# Draft Hub

Salary-cap auction league tooling for ScoreSense patrons. Phase A covers solo prep; Phase B adds a live auction room; Phase C adds contract lifecycle and Sleeper import.

## Product split

| Tab | Purpose |
|-----|---------|
| **Preseason board** | Read-only season projection cheat sheet (`GET /api/draft/{position}`) |
| **Draft Hub** | Rules, value sheet, roster/cap prep, live room, multi-year planner |

## Storage

SQLite database at `data/leagues/draft_hub.db`, scoped by JWT `sub` from Patreon auth.

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

## Office (league ops)

- Top-level **Office** tab (Insights stays Spend / Scoring / History only).
- **Chat**: League channel (all members) + Office channel (primary + co-commissioners).
- **Current**: live multi-team contract edit (same store as My team / Cap).
- **Historic**: season-gated salary sheets (prefer Sleeper week-1, else pre-draft rosters, else Excel; $ seeded from prior year). Commissioner **Build pre-draft sheet** (`POST .../build-pre-draft?season=Y`) before the draft; **Build week-1 sheet** (`POST .../build-week1?season=Y`) once week-1 matchups exist. **FA lottery** = post-draft FA win (real $); **FA contract** = always $1 and expires before the next draft (skipped as keepers on pre-draft seed). Contract-history row audit under Advanced.
- **Members**: claim vs Sleeper link status, invites with optional co-commissioner, promote/demote co-commish (primary only).
- Co-commissioners share operational powers with the primary except transfer ownership / demote other staff.

## Salary range CSV

Columns (flexible headers):

| Column | Aliases |
|--------|---------|
| Player name | `Name`, `player_name`, `Player` |
| Min salary | `min`, `min_sal`, `floor` |
| Max salary | `max`, `max_sal`, `ceiling` |
| Optional | `team`, `position`, `player_id` |

Import via **Draft Hub → Setup → Salary ranges**. Unmatched players can get model-derived tiers via **Generate model tiers**.

## Sleeper team link

Link your Sleeper league once in **Draft Hub → Setup → Sleeper team link**:

1. Paste your **Sleeper league ID** (from the league URL)
2. Click **Load teams** and pick **which team is yours**
3. Click **Link my team**

Once linked, Draft Hub:

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
| POST | `/api/hub/league/join` | Join by room code |
| GET | `/api/hub/league/{id}` | Room state |
| WS | `/api/hub/ws/{league_id}` | Realtime updates |
| POST | `/api/hub/contract/rookie-extend` | Manager rookie extension (server-calculated; aliases: `/extend`, `/renew`) |
| POST | `/api/hub/sleeper/import` | Sleeper roster snapshot (read-only) |

## Roadmap

- **Phase A** — Solo prep MVP (complete)
- **Phase B** — Multi-manager auction room with WebSocket broadcast
- **Phase C** — Mid-draft cuts, extensions, multi-year cap planner, Sleeper import
