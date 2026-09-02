# Add or remove a franchise

Staff resize for salary-cap auction leagues. User-facing home is **Fantasy → Roster management → Members**. Internal module: `src/draft_hub/league_resize.py`.

This is not a fourth destination. It is not a new contract model. Keepers stay on their current clubs. Policy for the new seat is the same league rules as everyone else.

## What already existed (and still does)

| Action | What it does | What it does not do |
|--------|----------------|---------------------|
| Create league | Sets `league.team_count` (2–20) and creates the commissioner franchise | Cannot change seat count later |
| Room-code join | Adds a claimed team while `status=setup` and under the cap | Blocked once the draft starts; "League is full" at cap |
| Email invite | `get_or_create_league_team_by_name` — can stub a named seat | Does **not** bump `team_count` (seat cap can drift) |
| Cap sheet / Sleeper import | Same stub helper for missing manager names | Same drift |
| Release claim | Unlinks the account so you can re-invite | Leaves the franchise and contracts |
| Delete league | Wipes every team | Not contraction |

There is no expansion draft, dispersal draft, or mid-season fold.

## When staff may resize

Allowed only **before this season's auction is done**:

- League status is not `live`
- Draft session is not nominating / bidding / picking
- `draft_completed` is false

If this season is already drafted, **advance the year first**, then add or remove the franchise so the new club joins the **next** auction.

Blocked during a live room and after the draft clock is marked done.

## Add franchise

1. Staff opens Members and names the new club.
2. Preview: next team count, full cap, no keepers, Strategy prices will move, invite next.
3. Apply creates an **unclaimed** `team` row with `budget_remaining = salary_cap` and sets `league.team_count` to `max(configured+1, actual+1)` (2–20).
4. Nomination order picks up the new id if one is already stored.
5. H2H schedule rebuilds only when this season already has matchups and **no** week scores.
6. Staff invites the manager under **Access** with the same team name. Accept claims the existing seat.
7. If the league is Sleeper-linked, add and map the roster there separately. ScoreSense does not create Sleeper teams.

The expansion club drafts like everyone else: full cap, empty roster, same min bid and roster limits. Incumbents keep their surviving contracts; those dollars are already committed.

## Remove franchise

1. Staff must first clear **active** contracts on Contracts (cut or trade). Expired / already-cut rows do not block.
2. Preview lists pending trades, invites, and open FA bids that will cancel.
3. Blocked if: live/drafted season, primary commissioner franchise, fewer than two clubs would remain, active contracts remain, or the club has any week score (historic identity stays).
4. Apply cancels those pending trades / invites / FA bids, deletes current roster slots and the `team` row, and sets `team_count` to the remaining club count.
5. Sleeper is still separate.

Release claim is the right tool when the **person** leaves and the **franchise** stays.

## What this scaffold does not do

- Expansion / dispersal draft of incumbent keepers
- Mid-season fold with schedule rewiring after games have scored
- Auto-creating or deleting Sleeper rosters
- Changing cap, roster limits, or playoff spots as a side effect (playoff math follows remaining clubs)

## APIs

| Method | Path | Who |
|--------|------|-----|
| GET | `/api/hub/league/{id}/members` | Members list; staff also get `resize` preview |
| POST | `/api/hub/league/{id}/franchises` | `{ "name": "…" }` — add |
| DELETE | `/api/hub/league/{id}/franchises/{team_id}` | Remove empty franchise |
