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
**Account menu (not top-level):** Model accuracy · Admin · Account.  
**Account session (not top-level):** Sign in · Create account (`/login`, `/register`). Mobile-first session pages. Google is the lead social option; email is secondary. Do not wrap these in Fantasy experience chrome.  
**Public legal (not top-level):** Terms · Privacy · Draft alert texts (`/sms-alerts`). The SMS card is content for A2P consent, not a new product area.

### Fantasy destinations

Source of truth: `frontend/src/DraftHub/HubSubnav.jsx`.

| Label | Internal id | Purpose |
|-------|-------------|---------|
| Home | `home` | Phase-aware next actions |
| Strategy | `value` | Auction targets and prices |
| Draft | `room` | Idle entry + live room. Email and text invite links open here. Members mark **current and future** draft-night times on one calendar (opens 31 days before the first NFL game, closes the day before). Commissioners lock a promising overlap as draft night. |
| This Week | `week` | Lineup decisions; Hub-only leagues set start/sit here |
| Vibes | `vibes` | Swipe your roster; front card is the matchup; info arrow opens bio and latest news; Vibe ranking on the rail; VA-projections (vibe-adjusted) as the table |
| Game center | `game` | Your matchup live, league scoreboard, week trophies |
| My team | `roster` | Personal contracts |
| Free agents | `available` | Add / bid / locked by calendar |
| Rosters | `rosters` | League-wide roster reference |
| Cap | `planner` | Cap and cuts |
| Trades | `trades` | Propose and accept |
| Rules | `rules` | League model (read for members, edit for staff) |
| Roster management | `office` | Staff-only contracts, sheets, members, access |
| Insights | `insights` | League history and awards |

Groups in the subnav: **Draft** (Strategy, Draft) · **Team** (This Week through Trades, including Vibes) · **League** (Rules, Roster management, Insights).

If you add or rename a Fantasy destination, update `HubSubnav.jsx`, `appNavigation.js` subtitles, routes, `frontend/src/livingSurfaces.js`, this table, and tests in the same change.

### Roster management panes

Source of truth: `frontend/src/DraftHub/hubOfficeTabs.js`.

Contracts · Salary sheets · Members · Access & imports.

Members is where staff add or remove a franchise before the next auction. Existing contracts stay on their clubs; the new seat starts empty with a full cap.

Chat is **not** a pane here. Chat is `FantasyChatDock` on shared Fantasy pages: a viewport-fixed edge launcher (not locked to the bottom of the page). Opening fills a centered conversation. Closing returns to the launcher. The launcher can be hidden for the session.

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
| Healthy / saved | teal (`--tone-positive`) | Active, success, legal |
| Attention | amber (`--tone-caution`) | Warnings, unsaved, bids |
| Destructive | red (`--danger`) | Errors, cuts, blocking validation |
| Gold accent | `--experience-gold` | Awards and featured callouts only |

Rules:

- Prefer tokens in `frontend/src/styles/tokens.css` and `product-hierarchy.css`. Do not invent a new hue for a new page.
- Hierarchy comes from surface lift, type size/weight, and spacing — not outlines on every box.
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

**Use this chrome for:** Rules, Draft (idle/lobby), This Week, Vibes, Cap, Insights, DFS, and new decision pages.

**Do not use this chrome for:** the live draft board (board-first, existing live-room layout), **Projections** (board-first table), or other dense data tables that are not a decision surface.

### Projections board

Weekly and Season projections are a **board**, not a Fantasy decision page.

- Four slate/season signals sit above a full-width ranking table.
- Injuries and analyst context are disclosures under the board (phone: existing panel tabs).
- Clicking a player opens the **player inspector**: floor / P50 / ceiling, range read, method, and this-week notes. Desktop is a right-hand drawer; phones keep the bottom sheet.
- **Weekly compare** is a mode. Enter Compare, then tap a row (not the name) to add them. The name still opens the inspector. Never show always-on compare checkboxes.
- Weekly board rows match across positions (QB / RB / WR/TE). Opportunity, role-up, and commentary live in the inspector, not as extra table chips or columns.
- One injury mark per weekly row: the compact Q / D / P chip. Do not add a second status pill under the name.
- **This-week notes** are one Sleeper locker or practice sentence plus an optional projection-delta line. Do not bake YouTube show descriptions as current-week narrative. Sentiment stays a research candidate until a raw snippet passes the Latest usefulness filter.
- Copy for signals, board reads, and inspector tiles lives in `frontend/src/projectionsPresentation.js`.

On laptop widths (~1024px), move the summary below the hero or into a compact sticky footer. Do not squeeze the form into multi-line control rows. Do not destroy desktop hierarchy to fake a phone layout.

### Phone chrome

On phone, the header is the current destination. Destination switching uses one picker, not a scrolling tab strip. Tapping a destination — including the one already open — closes the picker so the page is not left inert. Account lives in More. Do not stack ScoreSense, a context label, section tabs, and page tabs. Filters stay as one icon when the board has filters. Live draft stays board-first. League chat is an edge launcher, not a header control and not a control locked to the bottom of the page.

On phone, weekly and season boards are **dense ranking rows** (rank, face, name, P50). Compare is one toolbar control. Never a Compare checkbox on every card. Signals stay a compact strip, not a second page of chrome.

---

## Copy

Put user-facing strings in `*Presentation.js` (or an existing copy module). Keep JSX for structure.

Voice:

- Name the **user goal**, not the system.
- Explain **consequence**, not implementation.
- Short labels. Specific support text.
- No unexplained abbreviations on configuration pages.
- No vague verbs (“Manage”) when a destination already has a name.

| Prefer | Avoid |
|--------|--------|
| Maximum extension | Max yrs |
| Annual salary step-up | Step |
| Keep rookie salary static | Static rookies |
| Roster management | Commissioner |
| Save rules | Submit |
| Commissioner managed | You do not have permission |
| Bid / Add / Locked | “FA lottery” in player-facing buttons |

Hero pattern: eyebrow (`League rules`) + sentence heading (`Rules everyone can plan around.`) + one support line. See `RulesWizard.jsx` and `dfsToolPresentation.js`.

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
- Chat: viewport-fixed edge launcher unless dismissed; opening fills the center of the screen. `aria-expanded` / `aria-controls`, Escape and backdrop close the conversation, focus returns to the launcher.
- Draft availability shows current and future times only. Commissioners lock a promising overlap as the official night.
- Transactional SMS (draft alerts) is opt-in only. The checkbox starts empty. Phone lives on the account. SMS is never a league invite. The public opt-in card is `/sms-alerts` (also on Account). Privacy and Terms must name the SMS vendor, say mobile numbers are not shared for marketing, note message frequency, and include “message and data rates may apply.”

---

## League rules features must respect

Do not invent a parallel rules model. Canonical merge/validate/preview: `frontend/src/DraftHub/rulesPresentation.js`. Backend remains authoritative for eligibility and materialized contracts.

- Policy changes apply to **new contracts only** unless a separate migration exists. Say so near the control.
- Static rookies stay flat; veterans and extensions use the configured step-up.
- Veteran extensions follow the league toggle on both client and server.
- Players-tab adds follow the acquisition calendar (`acquisitionWindow.js`): locked pre-draft and in-season off-window; FAAB bid post-draft / waivers; instant add after waivers; offseason trades only for contracts that survive the next draft.
- ScoreSense-only leagues persist weekly lineups on This Week and score the week with Hub PPR (nflverse). Linked Sleeper leagues still set and score lineups in Sleeper; Game center reads Sleeper.
- Staff edits in Roster management may override; Players-tab adds never do.
- Headshots: mock boards, nominee cards, and rails use the same photos as rosters.

Contract-type playbook for imports and keepers: [CONTRACT_SCENARIOS.md](./CONTRACT_SCENARIOS.md).

---

## When you ship a new feature

1. Place it in Projections, Fantasy, or Tools. Reuse a destination if one already owns the job.
2. Use existing chrome, tokens, and presentation helpers. New CSS only for a new interaction, not a new aesthetic.
3. Match copy to the tables in this file.
4. Cover empty, loading, error, readonly, and unsaved states.
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
| Nav source | `frontend/src/appNavigation.js`, `DraftHub/HubSubnav.jsx` |
| Living page to match | `frontend/src/livingSurfaces.js` |
| Cloud Agent runtime | `.cursor/environment.json` |
