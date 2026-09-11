# ScoreSense product constitution

> **Read this before designing or building any user-facing work.**
> Explicit user-approved designs take priority; update this file and the living-surface registry to record approved changes. Otherwise, if another doc disagrees with this file, this file wins. Update this file in the same change when you add a destination, name, token, or interaction pattern.

Agents: `.cursor/rules/scoresense-core.mdc` injects these rules on every turn. Do not wait for the user to restate them.

---

## Product

**ScoreSense** is a fantasy football product from **4th Down Labs**.

It helps people make decisions, not maintain a database:

1. **Projections** — weekly and season outlooks with floor–ceiling ranges.
2. **Fantasy** — run a salary-cap (or pick) league: draft, contracts, cap, waivers, trades, rules.
3. **Tools** — DFS lineups, mock drafts, and the best ball board.

Internal code may still say “Draft Hub.” **Users never should.** The product area is **Fantasy**.

### What this is not

- A research notebook or “React dashboard.”
- A neon terminal / Bloomberg toy.
- A casino, sportsbook, or auto-bettor. Projections and DFS tools are entertainment and research.
- A fourth top-level product area. New work goes under Projections, Fantasy, or Tools.

---

## Brand

| Use | Do not use |
|-----|------------|
| ScoreSense (product) | Score Sense, scoresense in UI copy |
| 4th Down Labs (studio) | FourthDown, FDL in UI |
| Fantasy | League, Draft Hub, Hub (as a product name) |
| Roster management | Office, Commissioner (as a destination) |
| Strategy | Value sheet |
| Free agents | Available players |
| My team | My roster (as the tab name) |
| This Week | Weekly command center (as the tab name) |
| Vibes | Vibe rankings, aura farm (as the tab name) |
| Model accuracy | Accuracy tab (as the page title) |
| Tools · DFS / Mock draft / Best ball | Lineup tab, Props (those are not shipped nav) |

Code identifiers (`hub`, `office`, `value`, `DraftHub`) may stay. User-facing labels must use the table above.

---

## Experience priorities

In this order:

1. **Fun and inviting** — satisfying interaction, useful previews, visual rhythm. Not decoration.
2. **Easy to use** — one obvious next action.
3. **Clear about what matters now** — phase, money, and risk before secondary data.
4. **Selective** — hide advanced controls until needed.
5. **Respectful** — talk to an experienced fantasy player. No tutorial voice, no “you do not have permission” theatrics.

Fun comes from consequence and control, not animation, confetti, or mascots.

---

## Information architecture

### Top-level

`Projections` · `Fantasy` · `Tools`

Do not add a fourth top-level item. Do not rename Fantasy to League.

**Projections:** Weekly · Season (Preseason outlook / Live season).
**Tools:** DFS · Mock draft · Best ball. DFS classic and season-long: Vegas games are the board. Pick one or more high-total games to stack. Choosing a game does not lock a player. Pin the stack you want, or let Build take a stack from those games. Highest is a corner tag, not a reason by itself. Captain modes stay one-game CPT / MVP. Mock draft field size follows the linked league when matching that league's rules. Recent mocks live on the launch rail. A practice room has no Drop or Trade. Simulate uses the same bot pricing as the live auction, shows N of the remaining pool, and never disables Discard. Never say Available players — the rail eyebrow is Player pool.
**Account menu (not top-level):** Model accuracy · Admin · Account · Report a bug.
**Account session (not top-level):** Sign in · Create account (`/login`, `/register`). Mobile-first session pages. Google is the lead social option; email is secondary. Do not wrap these in Fantasy experience chrome.
**Report a bug** (`/report`) is a side option in the account / More menu. Signed-in filing and SCORE labels live in [ONBOARDING.md](./ONBOARDING.md). Do not add it to top-level nav.
**Public legal (not top-level):** Terms · Privacy · Draft alert texts (`/sms-alerts`). The SMS card is content for A2P consent, not a new product area.

### Fantasy destinations

Source of truth: `frontend/src/DraftHub/HubSubnav.jsx`.

| Label | Internal id | Purpose |
|-------|-------------|---------|
| Home | `home` | Phase-aware next actions. The hero band is eyebrow + a centered phase stepper; Settings sits in the chip slot (top-right). The deck action is the only page primary. Chat Send is ghost. |
| Strategy | `value` | Full-page pairwise face-off from a league-context site board, same position only. View my rankings opens site vs mine. Optionally write that order into the draft queue. A Fantasy destination without a `HubExperienceHero` band — a deliberate board-first exception, not a missing chrome pass. |
| Draft | `room` | Idle entry + live room. Email and text invite links open here. Members mark **current and future** draft-night times on one calendar (opens 31 days before the first NFL game, closes the day before). Commissioners lock any shown overlap as draft night. Idle Draft is that calendar plus a compact room strip — do not stack a second date/time card and a Who is in list on the same scroll. When the calendar is Closed and no night is locked, the off-calendar lock is the card's primary — do not leave "Mark yours" on a closed board. Start live draft stays secondary until a night is locked or every seat is filled. Start offline draft is ghost — no clocks, same award path. Owner entry records draft wins on Draft, not Free agents Add, and does not flip Home to live draft. CSV export/import is commissioner-only and previews unmatched rows first. The seating pill is amber below a full room and teal only at 12/12. Home's "Not scheduled" links here. Setup shows draft-night status only. Live auction theater lives on the block card: a 150ms bid pulse, a draining clock ring on the headshot (amber under 10s, red under 5s), and a ~1s SOLD hold before the next nominee. High bid is blue while you are winning and primary text otherwise — never gold. Hide empty fantasy narrative; a real line is the tagline under the name. Bots use locker marks and named personalities, not identical emoji robots. Simulate pins the block-card layout and uses live-bot pricing. Recap awards are gold trophy tiles; the page leads with the viewer's grade. Empty nomination keeps leftover, slots, and the viewer's queue on a right rail beside Player pool. Do not hide Nominate when paused — disable it. The command bar leads with the job; connection is a quiet mark. |

| This Week | `week` | Lineup decisions on one slate (editorial row per slot). The hero lede is the call count (`N lineup calls on the board`) or, when there is no swap and nobody is out, **No bye. Nobody flagged out.** Start opens the Ticket sheet — the week-pts delta is the poster; sit and start stay side by side on phone; facts are Vegas, prior PPG, def vs pos, and kickoff. Keep closes. ScoreSense-only leagues apply the swap from the Ticket Start; linked Sleeper leagues open the platform. Decision count lives in the hero once. Refresh projections sits on the freshness line. Call heat is amber Sit/Start pills; quiet rows stay unmarked. The Ticket Start is amber, not a second blue. Wide range is a quiet marker, never a row-wide amber border or primary blue. Empty slots say Empty (or Find {slot} to Free agents). Empty K/DEF with no bench specialist still say Find K / Find DEF into Free agents. Reserve the Start slot so P50s share a baseline. Bench uses the same slate rows and spans under the rail. Week uses the Projections stepper. Calls use the board number, not vibe week. Name the Vibes / VA-projections number so the two pages do not silently disagree. Week 1 prior PPG is last season; a rookie stays empty. |
| Vibes | `vibes` | Rate each roster player once a day (swipe on phone, Sit/Start on desktop). Desktop keeps the card left and Vibe ranking plus VA-projections in view on the right. Front card is week-vs-vibe; Bio opens the latest note. VA-projections are vibe-scaled research and do not drive This Week lineup calls. |
| Game center | `game` | Your matchup live, league scoreboard, week trophies. The hero names the job: empty lineup consequence pre-kickoff, the score line once live. One empty message — draft night plus when scores start — and Open draft room. Standings share Home's last-season records and stay unranked until a game is played. Do not play last year's Sleeper week as this week's scores. Gold marks a claimed week trophy. |

| My team | `roster` | Immersive team room; Manage roster for contracts and cap |
| Free agents | `available` | Add / bid / locked by calendar. Rows always show Bid or Add; when locked, disable with Adds open after the draft. Hide Vs cost until a contract cost exists. Desktop virtualizes on page scroll. Season pts use a number plus text range. How adds work lives in the acquisition banner. |
| Rosters | `rosters` | Table-first league contract comparison, matching the approved September 10 mockup. Compact title/actions, Contract values and Team rosters tabs, searchable manager picker, player/position/value filters, eight-row pagination, and a selected-player details panel. No hero band, At a glance card, tall manager rail, or repeated row actions. Salary, estimated value, and difference sit side by side. |
| Cap | `planner` | Cap leftover after a cut or bid. The move input sits above the fold and shows leftover after the move next to the controls. Hero and At a glance keep the current leftover. Every figure names what it counts; leftover plus against-cap (salary + dead) equals the cap. The rail primary is leftover / open the room. Undo cut and Undo extension are ghost. Roster counts say on this sheet vs keep past this draft. Roster-min needs are one sentence and one Free agents CTA. Expiring uses amber; extend-to-keep uses blue. |
| Trades | `trades` | Propose and accept. Experience hero names the cap-bust cost. Rosters franchise headers deep-link here with the partner preselected. Zero partners → Invite managers on Members. Continue (or Propose on the last step) is the only primary; Accept and Load into builder are ghost. Cap line is **current roster** salary (active contracts this season, including expiring). My team **{season} committed** is draft-surviving salary — same $200 cap, different base; do not use one word for both. Auto-check every package change and gate Propose on a pass. The verdict is a colored live status banner next to the primary, not grey chart-note. Ideas need chips mark starter-thin positions only — a 6-RB roster is extra depth, not a need. |
| Rules | `rules` | League model (read for members, edit for staff) |
| Roster management | `office` | Staff-only contracts, sheets, members, access |
| Insights | `insights` | League history and awards. Overview is a dynasty plaque, championship years, records, and career scoring — not Spend. Rank bars share a fixed track and start near the field (or show the gap from first). Career lists show every manager by the name that persists; team nicknames sit underneath — never as the only label. Award names are a Roster management control. The tab strip stays live; skeleton the plaque and boards. |

Desktop Fantasy navigation is one readable row from Home through Trades, followed by a League dropdown containing Rules, Roster management (commissioners only), and Insights. Do not restore Draft/Team/League overlines or vertical group dividers. Phone destination sheets retain their useful grouping.

If you add or rename a Fantasy destination, update `HubSubnav.jsx`, `appNavigation.js` subtitles, routes, `frontend/src/livingSurfaces.js`, this table, and tests in the same change.

### Roster management panes

Source of truth: `frontend/src/DraftHub/hubOfficeTabs.js`.

Contracts · Salary sheets · Members · Access & imports.

The pane switcher is the four pane pills only. Do not inline group labels with the pills.

Members is where staff expand or shrink the seat count. A seat is the slot; a manager is the person. Do not say club, franchise, or team for that object. Add a seat only when expanding past the current seat count — empty seats are claimed from Draft's invite link. Access & imports assigns a named email to one seat; it does not copy the Draft invite link. Commissioners download the league workbook and start a delete here. Every commissioner must type the league name and agree; the last confirm erases the room. Members download that same workbook on Rosters.

Sleeper: Access & imports is the one link. The league strip's Sync league is the one sync. Every other "Sync Sleeper" / "League settings" / "Import Sleeper" control deep-links to those. The sync confirm names what it overwrites. Collapse the Sleeper league ID form once the league is linked. A re-import on Contracts is secondary and names that it overwrites staff edits.

Mark draft complete lives on Contracts as a red confirm. It burns one year on every contract and cannot be undone. It also ends a leftover live room and moves the league in-season. Setup shows the status only. After that, Roster management is After draft — not live-auction chrome, and not keepers. After-draft leftover matches Rosters: live contracts occupy cap; Yrs-0 expirees do not. Staff Drop and field edits write immediately. Add records an Auction or FA lottery winning bid.

Commissioner Drop on Contracts and My team removes a player with no dead cap so staff can add them to another team before the draft. After draft it writes immediately — no pending tray. Cut is the penalty path. After draft, owners Cut on My team and commissioners Cut on Roster management · Contracts; those writes are immediate. Dead cap hits only the season the player is cut — later years of a multi-year deal free in full. Dead cap floors to the lower dollar: a $1 cut is $0 dead, and a $7 cut is $3 dead at 50%. A player may be active on two rosters only if one row is a cut. Adding them does not remove that dead cap. Undo cut only if they are not active on any team.

Chat is **not** a pane or a Fantasy destination. The full thread lives on **Home** as a locker rail. Do not show the edge launcher on Home. Other Fantasy pages keep `FantasyChatDock`: a flush edge launcher (parked on an edge, expands on hover) you can drag to a new edge (horizontal type, not rotated, not hide-only). Opening is a side drawer. On phone the launcher defaults to the bottom-right above the tab bar with a safe-area inset — never mid-viewport over hero copy or lineup slots. Live draft rooms that already have integrated chat stay board-first. Clear chat is staff-only, red, and confirms.

### Manager labels

Fantasy lists people by **owner name**. A team nickname may sit underneath or after a middot. Never show a team nickname as the only identity when an owner is known.

---

## Visual language

Dark mode only. Matte, editorial, layered. Sports-product energy without casino chrome.

| Role | Token / value | Use |
|------|----------------|-----|
| Page canvas | `--experience-canvas` / `--bg-base` (`#09111d` / `#070d17`) | Page background |
| Surface | `--experience-surface` / `--bg-elevated` | Cards and sections |
| Primary action / current context | `--experience-blue` / `--accent` | One cool blue. Reserved for *now* and *next* |
| Healthy / saved | teal (`--tone-positive`) | Healthy states and below-estimate contract salaries; always pair value color with text |
| Attention | amber (`--tone-caution`) | Warnings, unsaved, bids, incomplete seating, info that needs a move. Never a positive or best-in-set highlight. |
| Destructive | red (`--danger`) | Errors, cuts, blocking validation, league-wide destructive actions — never a projection delta. Exceptions: the live auction clock under 5s, and muted `--tone-negative` coral for above-estimate contract salaries (with text, never a row-wide warning). |
| Gold accent | `--experience-gold` | Awards only. Never the live high-bid figure. |

Rules:

- Prefer tokens in `frontend/src/styles/tokens.css`, `product-hierarchy.css`, `product-rhythm.css`, and `fantasy-phone.css`. Do not invent a new hue for a new page.
- Hierarchy comes from surface lift, type size/weight, and spacing — not outlines on every box.
- Every destination, mobile and desktop, uses the same spacing rhythm (`--inset-chip`, `--inset-tile`, `--inset-section`, `--gutter`). Text is never flush against a border, rule, or chip edge. Type never drops below `--text-xs`. Use `--text-*` and `--font-weight-*` — no intermediate weights like 750.
- Medium-to-large radii (`--radius-md` / `--radius-lg`). Soft shadows on sticky or floating chrome only.
- No neon glow on ordinary cards. No all-caps except sparse eyebrows.
- Blue is not “make this pretty.” If everything is blue, nothing is.

---

## Page chrome

Editorial Fantasy and Tools pages use the shared experience stack:

`HubPage` + `hub-experience-page`
`HubExperienceHero` — eyebrow, heading, one support sentence, status chip
`HubExperienceLayout` — main column + sticky summary rail
`HubExperienceSummary` — “At a glance” facts + primary action

Fantasy destinations share one `HubExperienceHero` (eyebrow + heading + band). Home is the exception: the page hero is eyebrow + a centered phase stepper, Settings in the chip slot, and the heading stays in the Pre-draft card. Strategy and Rosters are also exceptions: no hero band. Strategy is the only Fantasy destination without a `HubExperienceHero` band. Rosters uses a compact title and toolbar with a table/details layout; its CSS may define that approved layout without changing unrelated experience pages. Tools keep the display H1 + eyebrow pattern. Hero heading and padding use `--experience-hero-heading` and `--experience-hero-pad`. Status chips are not the page primary — do not put “You can edit” or “Need a partner” where Save belongs. Tab strips sit below the hero band. The shared league strip (and Needs attention) shows on Home and idle Draft; live rooms stay board-first. The app shell is one `<main id="main-content">` with a skip link.

Reuse `frontend/src/DraftHub/HubUILayout.jsx`. Do not fork a second hero/summary system.

Which file to open for a given destination: `frontend/src/livingSurfaces.js`. Resolve the row, then match its `page` and `copy`. That registry is the living style guide — keep it current when you add or retarget a screen.

**Use this chrome for:** every row whose chrome is `experience` in `frontend/src/livingSurfaces.js` — the registry decides, not a list here.

Empty This Week / My team / Game center boards share one empty-state block, branched on league state: native pre-draft → Lock a night (Draft); Sleeper not linked → Link Sleeper (Access & imports); linked but stale → the strip's Sync league. Do not send those boards to Setup. Game center pre-draft is one sentence to Open draft room — not Link Sleeper and not a kickoff wait. "Live" on Game center renders only inside a game window.

**Do not use this chrome for:** the live draft board (board-first, existing live-room layout), **Projections** (board-first table), **Rosters** (the approved table/details layout), **Strategy** (a Fantasy destination without a hero band — full-page face-off; View my rankings is site vs mine), or other dense data tables that are not a decision surface. Do not add `HubExperienceHero` to Strategy to “match” the other 13.

### Projections board

Weekly and Season projections are a **board**, not a Fantasy decision page.

- Four slate/season signals sit above a full-width ranking table; each tile filters the board to the rows it counts, and a missing prior rank renders as New, never 0. On phone, those signals are one swipeable row (or the existing disclosure) — not a 2×2 above the fold. Signal names wrap two lines or use the last name; do not ellipsize the payload.
- Injuries and analyst context are disclosures under the board (phone: existing panel tabs).
- Clicking a player opens the **player inspector**: a hero P50 with floor–ceiling inline, one range/role read, method pills, and a compact this-week card. Desktop is a right-hand drawer; phones keep the bottom sheet.
- **Weekly compare** is a mode. Enter Compare, then tap a row (not the name) to add them. The name still opens the inspector. Never show always-on compare checkboxes.
- Weekly board rows match across positions (QB / RB / WR/TE). Opportunity, role-up, and commentary live in the inspector, not as extra table chips or columns.
- One injury mark per weekly row: the compact Q / D / P chip. Do not add a second status pill under the name.
- **This-week notes** are one Sleeper locker or practice sentence plus an optional projection-delta line. Do not bake YouTube show descriptions as current-week narrative. Sentiment stays a research candidate until a raw snippet passes the Latest usefulness filter.
- Copy for signals, board reads, and inspector tiles lives in `frontend/src/projectionsPresentation.js`.
- Phone weekly: one compact sticky bar under the header — position, filter, result count, and the floor–ceiling range stated once. Do not repeat Floor–Ceiling on every card. Hide the collapsed range while a card is open. Reserve the rank-delta slot so card heights stay even.
- Phone weekly lists are windowed. Do not mount every row.
- Desktop Free agents and Weekly virtualize against page scroll. Rosters uses bounded pagination instead. Do not nest a table scroller.
- Movement chips (All / Movers / Risers / Fallers / Attention) live in the filter sheet, not the page body. The sheet owns Position, What changed, and Search; the page keeps an active-filter summary. The sheet has Apply, Reset, a live result count, and Scoring in the footer so it is not clipped.
- A stale or missing-notes freshness chip is the refresh action and shows a relative time when one exists. Do not hide the chip when the notes artifact is missing, and do not add a header Refresh on Weekly. The chip rebuilds this-week notes from cached projections — it does not start the weekly ETL pipeline.

On laptop widths (~1024px), move the summary below the hero or into a compact sticky footer. Do not squeeze the form into multi-line control rows. Do not destroy desktop hierarchy to fake a phone layout.

### Tools · Best ball

Best ball is an experience page (`HubExperience*`) with a ranking table.

- Pos rank is **within position**. The leftmost `#` is monotonic in the current list. On Pos rank + All, group rows under position headers (QB, RB, WR/TE).
- Missing FantasyPros rank is the job of the page. Render **No ECR** as a chip and an ECR filter, never an em-dash that looks like missing data.
- Edge is Pos ECR minus Pos rank. The hero names which sign is good. A legend states the ±10 threshold. Discount uses teal; reach uses `--tone-negative`. Do not encode reach with amber.
- Pos / ECR / Sort are labeled menus, the same pattern as Free agents. Do not mix filter and sort in one unlabeled chip row.
- The summary rail leads with Export CSV and keeps **With ECR** — do not restating Pos, Sort, or the player count already in the hero.
- Window the table against page scroll. Do not nest a `.table-wrap` scroller.
- Pos ECR is FantasyPros consensus. Do not put a roadmap note ("until a real ADP feed exists") in user-facing copy.
- Show **Scoring: PPR**. The board uses the same season model as Projections.

Player boards (Free agents and Best ball) use labeled Pos / Sort menus. Pick one control pattern per product, not two.

### Phone chrome

Switching Projections, Fantasy, or Tools returns you to the last destination you used in that area. Tapping the already-selected Projections, Fantasy, or Tools tab reopens that area’s destination picker on phone, or scrolls the destination strip into view on desktop.

On phone, the header is the current destination. Destination switching uses one picker, not a scrolling tab strip. Tapping a destination — including the one already open — closes the picker so the page is not left inert. Account lives in More. Do not stack ScoreSense, a context label, section tabs, and page tabs. A one-row league strip (name + caret) sits under the picker so heroes stay above the fold; New league and Sync league live in that caret. Needs attention is one line on that strip — do not restack a second league card in the destination overflow. Weekly phone chrome is the destination header plus one sticky bar (position, filter, result count). Attention and other movement filters live in that filter sheet. Live draft stays board-first. League chat is an edge launcher that defaults to the bottom-right above the tab bar; drag still parks it on a new edge. Idle Draft and Mock use one seat component so the live room inherits it.

On phone, weekly and season boards are **dense ranking rows** (rank, face, name, P50). Compare is one toolbar control. Never a Compare checkbox on every card. Signals stay a compact swipeable strip, not a second page of chrome. Why and Details are equal-width, sentence case. The bottom nav uses the full word **Projections** and carries `env(safe-area-inset-bottom)` on the nav itself. Mobile type never drops below 12px (`--text-xs`). Ten managers is a picker, not a swipe strip.

Fantasy phone (≤768px) shares one floor with Projections: type never drops below `--text-xs` (12px computed). `--text-xs` itself must compute to at least 12px — a sub-12 token does not satisfy “never below `--text-xs`.” Filter, tab, and sort bars use the Insights sticky strip (`.hub-page-sticky`). Experience summary labels stack above their values. The chat dismiss control sits on the bubble, not off the right edge. Chat parks above the tab bar and any fixed page action (Vibes Sit/Undo/Start, Rules save). Loading states use skeletons, not unlabeled “Loading…” copy. Roster management’s public path is `/hub/roster-management`; `/hub/office` redirects.

---

## Copy

Put user-facing strings in `*Presentation.js` (or an existing copy module). Keep JSX for structure.

Voice:

- Name the **decision** this page is for, not the system.
- Explain the action and its actual effect. The cost of getting it wrong is confusion, not drama. Do not invent consequences or scold the user.
- Short labels. Specific support text.
- No slogan that could sit on another sports app (“own the week,” “stay ahead,” “smarter way”).
- No unexplained abbreviations on configuration or data-dense pages.
- No vague verbs (“Manage”) when a destination already has a name.

| Prefer | Avoid |
|--------|--------|
| Compare starters with higher-projected bench players | Own the week / stay ahead of the board |
| Can you afford this bid after the cut? | See the next three seasons before you spend |
| Maximum extension | Max yrs |
| Annual salary step-up | Step |
| Keep rookie salary static | Static rookies |
| Keep vet deals flat | Static vets |
| Allow vet deal extensions | Vet extensions |
| Roster management | Commissioner |
| Save rules | Submit |
| Commissioner managed | You do not have permission |
| Bid / Add / Locked | “FA lottery” in player-facing buttons |

Hero pattern: eyebrow (`League rules`) + sentence heading that is the job (`What a new contract will cost.`) + one support line that is the consequence. See `RulesWizard.jsx` and `dfsToolPresentation.js`. The heading sells the tab you are on. Hero chips are status only (saved, locked, caution) — season counts and other facts are meta text, not chips.

Home names the manager’s roster hole over a commissioner invite when both are due. Gate hero copy on load: skeleton or “Checking what is due…” until the payload lands — never a confident headline over unresolved data. After 3s of a long load, say the sync is still working. This Week hero copy comes from board state (loading / error / empty pre-draft) — never “No swap worth making” or “No bye. Nobody flagged out.” over an error. Empty starter slots say **Empty**; the CTA is **Find {POS}** on Free agents. Cap construction holes keep **Need N more**. “Waiting on roster” is the unresolved-roster rail, not a loading chip. This Week lineup calls use the board number; VA-projections are vibe-scaled research. Game center’s unscored placeholder says **No scores yet**, not Waiting. Cap, Rosters, My team, and after-draft Roster management read one leftover story: auction leftover (what you can still bid). A 1-year keeper who expires at the draft is not committed. Yrs-0 expirees after Mark draft complete are not committed. Against this cap is salary plus dead cap. Dead-cap copy comes from `rosterFormat.js`. Needs attention says **Cap**, not Cap planner. A nomination queue stays on that manager's board only. Draft seating chips count claimed teams. Locked draft night renders in the viewer’s timezone with an abbreviation; Draft setup names league time once.


---

## Interaction and accessibility

- League-strip option menus (Switch league, Sync league) paint above the Fantasy page below the strip. Atmosphere pins `.draft-hub` siblings at the same z-index so the wash stays behind content — raise the strip to `--z-dropdown` or portal the menu. Do not treat Needs attention as the covering layer; the later `.hub-page` card is.
- Opening a Fantasy page, reading another room, or polling chat/freshness does not change the saved league. Only Switch league, or joining/creating a live league, writes focus. Practice rooms never become the strip focus.
- Primary action stays visible (summary rail or sticky footer).
- Disable a button only with a reason next to it. Free agents rows always show Bid or Add; when the window is locked, disable the control with Adds open after the draft — do not omit the action.
- Hide Vs cost until a contract cost exists.
- Fantasy tables label the projection scale (Season pts vs Week pts) and use a number plus text range on decision boards.
- Validate before save. Failed saves keep edits. Trades re-check the package on every send or cut and keep Propose gated until cap and roster pass. The verdict sits next to that primary with `aria-live`.
- Skip to content lands in `<main>`. The page heading is the destination job (`HubExperienceHero`), not the ScoreSense wordmark. Fantasy destination buttons use the tab label as the accessible name — never the hint.
- Unsaved changes warn before navigation.
- Success is a contained confirmation, not a modal.
- Roster management · Contracts accumulates pre-draft edits in a pending-changes tray (Save / Discard). Commissioner Drop removes the player with no dead cap so staff can add them to another team before the draft; it executes on save. After draft, leftover matches Rosters, Drop, Cut, and field edits write immediately, and Add records Auction or FA lottery bids. Cut is the penalty path. Dead cap is this season only. Cap inputs validate against remaining room and show the resulting free / dead figures.
- Contract-state chips: Extend to keep is teal, Expiring is amber, Cut is red. Never one green for all three. Final-year Rookie deals and Vet deals use Extend to keep when extensions are on. One-year expirees that cannot extend (already an Extension, or extensions off) use **Expiring** — never **Expires — FA**. They enter the draft pool; after the draft is marked complete, undrafted names become free agents.
- Motion: 120–200ms, `--ease-standard`. Honor `prefers-reduced-motion`.
- No sound except live-draft audio, and only as an opt-in.
- Labels on every field. Errors associated with controls. WCAG AA contrast.
- Touch targets ≥ 44px where a laptop or phone can tap them (`--touch-target`).
- One document `<main id="main-content">` plus a skip link. Pages do not nest a second `<main>`.
- Exclusive choice groups use `role="radiogroup"` and `role="radio"` with `aria-checked`, the same pattern as Rules risk posture. Do not use `aria-pressed` for mutually exclusive options.
- After a build or validity verdict, announce with `aria-live` and move focus or scroll the result into view.
- `details > summary` stays `list-item` so the disclosure marker shows. Do not set `display: flex` or `inline-flex` on `summary`.
- Destination subnavs mark the current item with `aria-selected` (Fantasy already does; Tools and Projections must too).
- Legal and compliance lines stay at 13px or larger (`--text-sm`). Amber never marks a positive or best-in-set highlight.
- Dense pool tables let the page own vertical scroll and stick the column header. Do not trap the wheel in an inner box.
- Chat: viewport-fixed flush edge launcher unless dismissed; opening is a side drawer. `aria-expanded` / `aria-controls`, Escape and backdrop close the drawer, focus returns to the launcher.
- Draft availability shows current and future times only. Commissioners lock any shown overlap as the official night. Idle Draft shows that calendar as the one featured job; while the calendar is open the date/time form stays a collapsed fallback — when it is closed and no night is locked, that form is the card's primary and Start live draft drops to secondary.
- Suggested bid columns name the scoring and risk posture from Rules (`PPR · Balanced`). Never show "Hub" in user copy. League context is `<league name> · <scoring>`.
- Count nouns use one helper: `1 manager`, `1 seat`, `1 team` — never `1 managers`.
- Transactional SMS (draft alerts) is opt-in only. The checkbox starts empty. Phone lives on the account. SMS is never a league invite. The public opt-in card is `/sms-alerts` (also on Account). Privacy and Terms must name the SMS vendor, say mobile numbers are not shared for marketing, note message frequency, and include “message and data rates may apply.”

---

## League rules features must respect

Do not invent a parallel rules model. Canonical merge/validate/preview: `frontend/src/DraftHub/rulesPresentation.js`. Backend remains authoritative for eligibility and materialized contracts.

- Policy changes apply to **new contracts only**. Say that once, next to Save. Do not mention a migration unless a control exists on the page.
- Rules Save writes the league on the form, not the last-focused league in the header. A late save response must not yank the UI to a different league.
- Applying a league template confirms, names what changes, and fills the form. It does not save. Offer undo until the next edit. Style those triggers as destructive, not ghost chips.
- Contract types shown to users are **Rookie deal**, **Vet deal**, and **Extension**. Never “Rookie Extension” or “Veteran Deal”.
- Static rookie deals and vet deals stay flat for the first term. The configured step-up starts on an **Extension**. Rules shows **Keep vet deals flat** and **Allow vet deal extensions** as their own toggles.
- Final-year rookie deals may take one extension when **Allow rookie deal extensions** is on. Final-year vet deals may take one when **Allow vet deal extensions** is on. An extension cannot be extended again.
- Players-tab adds follow the acquisition calendar (`acquisitionWindow.js`): locked pre-draft and in-season off-window; FAAB bid post-draft / waivers; instant add after waivers; offseason trades only for contracts that survive the next draft.
- ScoreSense-only leagues persist weekly lineups on This Week and score the week with ScoreSense PPR (nflverse; internal id `hub_ppr` — the string "Hub PPR" never reaches UI). Linked Sleeper leagues still set and score lineups in Sleeper; Game center reads Sleeper.
- Staff edits in Roster management may override; Players-tab adds never do.
- Headshots: mock boards, nominee cards, and rails use the same photos as rosters. Hub media and remote photos request the size they paint (`?w=48` / `96` / `256`); do not ship the studio original on every page.

Contract-type playbook for imports and keepers: [CONTRACT_SCENARIOS.md](./CONTRACT_SCENARIOS.md).

---

## When you ship a new feature

1. Place it in Projections, Fantasy, or Tools. Reuse a destination if one already owns the job.
2. Use existing chrome, tokens, and presentation helpers. New CSS only for a new interaction, not a new aesthetic.
3. Match copy to the tables in this file.
4. Cover empty, loading, error, readonly, disabled, and unsaved states; each says why and links the destination that clears it (Draft, Members, Roster management · Access & imports) — never a label like League settings that is not a destination.
5. If you introduce a user-facing name or destination, update this file, the nav/source module, and `frontend/src/livingSurfaces.js` in the same change.
6. Verify the other surfaces that read the same state. Do not ship a page that looks right in isolation and lies on Cap, My team, or Rules.

---

## Where the details live

| Need | Read |
|------|------|
| This constitution | `docs/PRODUCT.md` (this file) |
| Layout craft (measurable) | `.cursor/rules/frontend-craft.mdc` · `scripts/dev/layout_audit.mjs` |
| Rules Center layout spec (historical) | [specs/rules-center-2026-08.md](./specs/rules-center-2026-08.md) |
| Contract type / years-left cases | [CONTRACT_SCENARIOS.md](./CONTRACT_SCENARIOS.md) |
| Auth / invites / legal | [ONBOARDING.md](./ONBOARDING.md) |
| Text invite → claim → draft nights | [INVITE_FLOW.md](./INVITE_FLOW.md) |
| Hub API and storage | [DRAFT_HUB.md](./DRAFT_HUB.md) |
| DFS / mock backlog | [LINEUP_ROADMAP.md](./LINEUP_ROADMAP.md) |
| Tokens | `frontend/src/styles/tokens.css` |
| Experience CSS | `frontend/src/styles/product-hierarchy.css` |
| Spacing rhythm | `frontend/src/styles/product-rhythm.css` |
| Fantasy phone | `frontend/src/styles/fantasy-phone.css` |
| Nav source | `frontend/src/appNavigation.js`, `DraftHub/HubSubnav.jsx` |
| Living page to match | `frontend/src/livingSurfaces.js` |
| Redesign / first-design options | [mockups/](./mockups/) · `.cursor/skills/fast-ui-mock/SKILL.md` |
| Cloud Agent runtime | `.cursor/environment.json` |

## Approved Fantasy header — September 10, 2026

Match the approved compact header mockup: three continuous desktop rows for product navigation, Fantasy destinations, and league context; no rounded outer panel containers. League name is the picker label (no SWITCH LEAGUE prefix); New league lives inside its footer. Put phase beside the league, and Your team, team identity, role, and Sync league on the right. Keep mobile destination navigation and permissions. At narrow laptop widths the destination links may scroll horizontally while League stays reachable; do not shrink text. Dropdowns support keyboard dismissal/focus return and paint above page content.

Projections and Tools share the same flat product-navigation row and destination treatment. Weekly/Season and DFS/Mock draft/Best ball use `ProductSubnav`, with the same selected-tab border, readable labels, and spacing as Fantasy. These areas have two header rows; the league-context row belongs to Fantasy. Keep projection filters and Season modes in their existing locations, preserve remembered destinations and native link behavior, and retain the phone destination sheets. Do not restore rounded desktop header containers or separate boxed destination controls in these areas.

## Approved My team room — September 10, 2026

My team defaults to Room for league teams. The approved curved locker-room concepts supersede the experience hero, featured-player wall, and decoration restrictions on this view. Keep a physical room, detailed jerseys, owner Account atmosphere, integrated matchup scoreboard, weekly starters together, Bench access, and a locker that expands in place. Texture, material lighting, team colors, and artwork dimensions are intentional exceptions to flat-card/token-only artwork rules; functional controls retain readable type, focus, and touch targets. At phone widths the room reflows into a browsable locker grid without horizontal page scroll. Reduced motion disables drawer animation.

Manage roster is a separate local tab preserving contracts, cap, cuts, extensions, and appearance editing. Room opening and visiting another team never change saved league focus. Members may visit other rooms. Only the owner may edit nicknames or opt into a public, revocable `/team-room/:token` link. The public payload contains the room presentation only, not salary, contracts, owner account IDs, or league rules. Visitors see the owner's theme. Sleeper nicknames are used when provider metadata exposes them; local overrides can be reset. Historical projection differences require a pregame capture; never backfill them with an in-game projection. An unknown score remains a dash, not zero, and live state is not inferred from a zero score.

## Approved DFS portfolio workspace — September 11, 2026

The user selected option A in `docs/mockups/dfs-gpp-a.html`, with the shared Results dashboard. This supersedes the DFS experience hero/summary, five-format-card grid and full-page Vegas board. Keep the compact title, slate bar, three-column settings/pool/selected-lineup workspace, paginated player table, separate Captain and total exposure, and two export paths. Account backgrounds remain in Account settings. The Results tab tracks imported cash fees and actual payouts, preserves entry IDs, shows import completeness and links entries to immutable build-time inputs. Unknown financial values stay unknown; ROI uses total net divided by total fees, excludes unsettled/void entries and is unavailable when required settled financial data is missing. Results are descriptive, not proof of a strategy. Do not invent ownership, simulation win rates, or payout estimates. CSV imports preview before saving; reserved-entry exports preserve site metadata and require an explicit assignment review.


## Approved Game center room — September 11, 2026

The selected B player spotlight concept takes priority for Game center: compact heading/week controls, a matchup scoreboard, selectable position duels with detailed jerseys, every starter below, and a secondary details/league rail. Bench scoring is separate from starter scoring; standings and weekly awards are disclosed on demand. Shared navy/brass material tokens (`--team-room-light`, `--team-room-tint`) extend the My team artwork exception to this matchup surface. Brass frames are material, not win probabilities or awards. Do not restore an experience hero or an uncalibrated win-probability bar above the duel.

Each scoreboard half uses its own team's saved banner through the authenticated media loader and saved crop, faded into the navy center. Missing artwork falls back to navy. Account background themes remain controlled by Account. My team's matchup banner is a keyboard-accessible link carrying the selected team and week to Game center; opening it never writes league focus. Public shared rooms omit the private Game center link.

Game center labels current forecasts separately from the pregame baselines frozen in My team. Missing pregame captures remain missing after kickoff; do not backfill them from a later forecast. Resolve Sleeper IDs against cached NFL forecasts using the weekly board's guarded name/team lookup, including team aliases.
