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
| POST | `/api/hub/contract/extend` | Extend contract (Phase C) |
| POST | `/api/hub/sleeper/import` | Sleeper roster snapshot (read-only) |

## Roadmap

- **Phase A** — Solo prep MVP (complete)
- **Phase B** — Multi-manager auction room with WebSocket broadcast
- **Phase C** — Mid-draft cuts, extensions, multi-year cap planner, Sleeper import
