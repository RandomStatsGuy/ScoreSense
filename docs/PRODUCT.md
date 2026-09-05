# ScoreSense product constitution

> **Read this before designing or building any user-facing work.**
> If another doc disagrees with this file, this file wins. Update this file in the same change when you add a destination, name, token, or interaction pattern.

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
**Tools:** DFS · Mock draft · Best ball.
**Account menu (not top-level):** Model accuracy · Admin · Account · Report a bug.
**Account session (not top-level):** Sign in · Create account (`/login`, `/register`). Mobile-first session pages. Google is the lead social option; email is secondary. Do not wrap these in Fantasy experience chrome.
**Report a bug** (`/report`) is a side option in the account / More menu. Signed-in filing and SCORE labels live in [ONBOARDING.md](./ONBOARDING.md). Do not add it to top-level nav.
**Public legal (not top-level):** Terms · Privacy · Draft alert texts (`/sms-alerts`). The SMS card is content for A2P consent, not a new product area.

### Fantasy destinations

Source of truth: `frontend/src/DraftHub/HubSubnav.jsx`.

| Label | Internal id | Purpose |
|-------|-------------|---------|
| Home | `home` | Phase-aware next actions |
| Strategy | `value` | Full-page pairwise face-off from a league-context site board, same position only. View my rankings opens site vs mine. Optionally write that order into the draft queue. |
| Draft | `room` | Idle entry + live room. Email and text invite links open here. Members mark **current and future** draft-night times on one calendar (opens 31 days before the first NFL game, closes the day before). Commissioners lock any shown overlap as draft night. Idle Draft is that calendar plus a compact room strip — do not stack a second date/time card and a Who is in list on the same scroll. When the calendar is Closed and no night is locked, the off-calendar lock is the card's primary — do not leave "Mark yours" on a closed board. Start live draft stays secondary until a night is locked or every seat is filled. The seating pill is amber below a full room and teal only at 12/12. Home's "Not scheduled" links here. Setup shows draft-night status only. |
| This Week | `week` | Lineup decisions; ScoreSense-only leagues set start/sit here |
| Vibes | `vibes` | Swipe each roster player once a day; front card is the matchup; info arrow opens bio and latest news; lean Vibe ranking rail; VA-projections (vibe-adjusted week, including K and DEF) as the table |
| Game center | `game` | Your matchup live, league scoreboard, week trophies |
| My team | `roster` | Personal contracts |
| Free agents | `available` | Add / bid / locked by calendar |
| Rosters | `rosters` | League-wide roster reference |
| Cap | `planner` | Cap leftover after a cut or bid. The move input sits above the fold; hero and At a glance keep the current leftover. |
| Trades | `trades` | Propose and accept. Experience hero names the cap-bust cost. Rosters franchise headers deep-link here with the partner preselected. Zero partners → Invite managers on Members. |
| Rules | `rules` | League model (read for members, edit for staff) |
| Roster management | `office` | Staff-only contracts, sheets, members, access |
| Insights | `insights` | League history and awards |

Groups in the subnav: **Draft** (Strategy, Draft) · **Team** (This Week through Trades, including Vibes) · **League** (Rules, Roster management, Insights).

If you add or rename a Fantasy destination, update `HubSubnav.jsx`, `appNavigation.js` subtitles, routes, `frontend/src/livingSurfaces.js`, this table, and tests in the same change.

### Roster management panes

Source of truth: `frontend/src/DraftHub/hubOfficeTabs.js`.

Contracts · Salary sheets · Members · Access & imports.

Members is where staff expand or shrink the seat count. A seat is the slot; a manager is the person. Do not say club, franchise, or team for that object. Add a seat only when expanding past the current seat count — empty seats are claimed from Draft's invite link. Access & imports assigns a named email to one seat; it does not copy the Draft invite link.

Sleeper: Access & imports is the one link. The league strip's Sync league is the one sync. Every other "Sync Sleeper" / "League settings" / "Import Sleeper" control deep-links to those. The sync confirm names what it overwrites.

Mark draft complete lives on Contracts as a red confirm. It burns one year on every contract and cannot be undone. Setup shows the status only.

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
| Healthy / saved | teal (`--tone-positive`) | Only when the state is actually healthy: 12/12 seated, synced, or saved |
| Attention | amber (`--tone-caution`) | Warnings, unsaved, bids, incomplete seating, info that needs a move. Never a positive or best-in-set highlight. |
| Destructive | red (`--danger`) | Errors, cuts, blocking validation, league-wide destructive actions — never a projection delta |
| Gold accent | `--experience-gold` | Awards only |

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

Reuse `frontend/src/DraftHub/HubUILayout.jsx`. Do not fork a second hero/summary system.

Which file to open for a given destination: `frontend/src/livingSurfaces.js`. Resolve the row, then match its `page` and `copy`. That registry is the living style guide — keep it current when you add or retarget a screen.

**Use this chrome for:** every row whose chrome is `experience` in `frontend/src/livingSurfaces.js` — the registry decides, not a list here.

Empty This Week / My team / Game center boards share one empty-state block, branched on league state: native pre-draft → Lock a night (Draft); Sleeper not linked → Link Sleeper (Access & imports); linked but stale → the strip's Sync league. Do not send those boards to Setup. "Live" on Game center renders only inside a game window.

**Do not use this chrome for:** the live draft board (board-first, existing live-room layout), **Projections** (board-first table), **Strategy** (full-page face-off; View my rankings is site vs mine), or other dense data tables that are not a decision surface.

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
- Movement chips (All / Movers / Risers / Fallers / Attention) live in the filter sheet, not the page body. The sheet owns Position, What changed, and Search; the page keeps an active-filter summary. The sheet has Apply, Reset, a live result count, and Scoring in the footer so it is not clipped.
- A stale freshness chip is the refresh action and shows a relative time. Do not leave “Context snapshot stale” as dead text.

On laptop widths (~1024px), move the summary below the hero or into a compact sticky footer. Do not squeeze the form into multi-line control rows. Do not destroy desktop hierarchy to fake a phone layout.

### Phone chrome

On phone, the header is the current destination. Destination switching uses one picker, not a scrolling tab strip. Tapping a destination — including the one already open — closes the picker so the page is not left inert. Account lives in More. Do not stack ScoreSense, a context label, section tabs, and page tabs. A one-row league strip (name + caret) sits under the picker so heroes stay above the fold; New league and Sync league live in that caret. Needs attention is one line on that strip — do not restack a second league card in the destination overflow. Weekly phone chrome is the destination header plus one sticky bar (position, filter, result count). Attention and other movement filters live in that filter sheet. Live draft stays board-first. League chat is an edge launcher that defaults to the bottom-right above the tab bar; drag still parks it on a new edge. Idle Draft and Mock use one seat component so the live room inherits it.

On phone, weekly and season boards are **dense ranking rows** (rank, face, name, P50). Compare is one toolbar control. Never a Compare checkbox on every card. Signals stay a compact swipeable strip, not a second page of chrome. Why and Details are equal-width, sentence case. The bottom nav uses the full word **Projections** and carries `env(safe-area-inset-bottom)` on the nav itself. Mobile type never drops below 12px (`--text-xs`).

Fantasy phone (≤768px) shares one floor with Projections: type never drops below `--text-xs` (11.52–11.84px). Filter, tab, and sort bars use the Insights sticky strip (`.hub-page-sticky`). Experience summary labels stack above their values. The chat dismiss control sits on the bubble, not off the right edge. Chat parks above the tab bar and any fixed page action (Vibes Sit/Undo/Start, Rules save). Loading states use skeletons, not unlabeled “Loading…” copy. Roster management’s public path is `/hub/roster-management`; `/hub/office` redirects.

---

## Copy

Put user-facing strings in `*Presentation.js` (or an existing copy module). Keep JSX for structure.

Voice:

- Name the **decision** this page is for, not the system.
- Name the **cost of getting it wrong**, not a slogan.
- Short labels. Specific support text.
- No slogan that could sit on another sports app (“own the week,” “stay ahead,” “smarter way”).
- No unexplained abbreviations on configuration pages.
- No vague verbs (“Manage”) when a destination already has a name.

| Prefer | Avoid |
|--------|--------|
| Sit the wrong RB and you leave points on the bench | Own the week / stay ahead of the board |
| Can you afford this bid after the cut? | See the next three seasons before you spend |
| Maximum extension | Max yrs |
| Annual salary step-up | Step |
| Keep rookie salary static | Static rookies |
| Roster management | Commissioner |
| Save rules | Submit |
| Commissioner managed | You do not have permission |
| Bid / Add / Locked | “FA lottery” in player-facing buttons |

Hero pattern: eyebrow (`League rules`) + sentence heading that is the job (`What a new contract will cost.`) + one support line that is the consequence. See `RulesWizard.jsx` and `dfsToolPresentation.js`.

Home names the manager’s roster hole over a commissioner invite when both are due. Gate hero copy on load: skeleton or “Checking what is due…” until the payload lands — never a confident headline over unresolved data. After 3s of a long load, say the sync is still working. This Week hero copy comes from board state (loading / error / empty pre-draft) — never “No swap worth making” over an error. Empty starter slots say **Empty**; “Waiting on roster” is the unresolved-roster rail, not a loading chip. Game center’s unscored placeholder says **No scores yet**, not Waiting. Cap and My team read one dead-cap story from `rosterFormat.js`. Needs attention says **Cap**, not Cap planner. Draft seating chips count claimed teams. Locked draft night renders in the viewer’s timezone with an abbreviation; Draft setup names league time once.

---

## Interaction and accessibility

- Primary action stays visible (summary rail or sticky footer).
- Disable a button only with a reason next to it.
- Validate before save. Failed saves keep edits.
- Unsaved changes warn before navigation.
- Success is a contained confirmation, not a modal.
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

- Policy changes apply to **new contracts only** unless a separate migration exists. Say so near the control.
- Static rookies stay flat; veterans and extensions use the configured step-up.
- Veteran extensions follow the league toggle on both client and server.
- Players-tab adds follow the acquisition calendar (`acquisitionWindow.js`): locked pre-draft and in-season off-window; FAAB bid post-draft / waivers; instant add after waivers; offseason trades only for contracts that survive the next draft.
- ScoreSense-only leagues persist weekly lineups on This Week and score the week with ScoreSense PPR (nflverse; internal id `hub_ppr` — the string "Hub PPR" never reaches UI). Linked Sleeper leagues still set and score lineups in Sleeper; Game center reads Sleeper.
- Staff edits in Roster management may override; Players-tab adds never do.
- Headshots: mock boards, nominee cards, and rails use the same photos as rosters.

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
| Rules Center layout spec | [design.md](./design.md) |
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
