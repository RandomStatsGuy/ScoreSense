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

### Fantasy destinations

Source of truth: `frontend/src/DraftHub/HubSubnav.jsx`.

| Label | Internal id | Purpose |
|-------|-------------|---------|
| Home | `home` | Phase-aware next actions |
| Strategy | `value` | Auction targets and prices |
| Draft | `room` | Idle entry + live room |
| This Week | `week` | Lineup decisions |
| Game center | `game` | Your matchup live, league scoreboard, week trophies |
| My team | `roster` | Personal contracts |
| Free agents | `available` | Add / bid / locked by calendar |
| Rosters | `rosters` | League-wide roster reference |
| Cap | `planner` | Cap and cuts |
| Trades | `trades` | Propose and accept |
| Rules | `rules` | League model (read for members, edit for staff) |
| Roster management | `office` | Staff-only contracts, sheets, members, access |
| Insights | `insights` | League history and awards |

Groups in the subnav: **Draft** (Strategy, Draft) · **Team** (This Week through Trades) · **League** (Rules, Roster management, Insights).

If you add or rename a Fantasy destination, update `HubSubnav.jsx`, `appNavigation.js` subtitles, routes, this table, and tests in the same change.

### Roster management panes

Source of truth: `frontend/src/DraftHub/hubOfficeTabs.js`.

Contracts · Salary sheets · Members · Access & imports.

Chat is **not** a pane here. Chat is `FantasyChatDock` on shared Fantasy pages.

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

**Use this chrome for:** Rules, Draft (idle/lobby), This Week, Cap, Insights, DFS, and new decision pages.

**Do not use this chrome for:** the live draft board (board-first, existing live-room layout) or dense data tables that are not a decision surface.

On laptop widths (~1024px), move the summary below the hero or into a compact sticky footer. Do not squeeze the form into multi-line control rows. Mobile is a later pass for new chrome; do not destroy desktop hierarchy to fake a phone layout.

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
- Chat: `aria-expanded` / `aria-controls`, Escape closes, focus returns to the trigger.

---

## League rules features must respect

Do not invent a parallel rules model. Canonical merge/validate/preview: `frontend/src/DraftHub/rulesPresentation.js`. Backend remains authoritative for eligibility and materialized contracts.

- Policy changes apply to **new contracts only** unless a separate migration exists. Say so near the control.
- Static rookies stay flat; veterans and extensions use the configured step-up.
- Veteran extensions follow the league toggle on both client and server.
- Players-tab adds follow the acquisition calendar (`acquisitionWindow.js`): locked pre-draft and in-season off-window; FAAB bid post-draft / waivers; instant add after waivers; offseason trades only for contracts that survive the next draft.
- Staff edits in Roster management may override; Players-tab adds never do.
- Headshots: mock boards, nominee cards, and rails use the same photos as rosters.

Contract-type playbook for imports and keepers: [CONTRACT_SCENARIOS.md](./CONTRACT_SCENARIOS.md).

---

## When you ship a new feature

1. Place it in Projections, Fantasy, or Tools. Reuse a destination if one already owns the job.
2. Use existing chrome, tokens, and presentation helpers. New CSS only for a new interaction, not a new aesthetic.
3. Match copy to the tables in this file.
4. Cover empty, loading, error, readonly, and unsaved states.
5. If you introduce a user-facing name or destination, update this file and the nav/source module in the same change.
6. Verify the other surfaces that read the same state. Do not ship a page that looks right in isolation and lies on Cap, My team, or Rules.

---

## Where the details live

| Need | Read |
|------|------|
| This constitution | `docs/PRODUCT.md` (this file) |
| Rules Center layout spec | [design.md](./design.md) |
| Contract type / years-left cases | [CONTRACT_SCENARIOS.md](./CONTRACT_SCENARIOS.md) |
| Auth / invites / legal | [ONBOARDING.md](./ONBOARDING.md) |
| Hub API and storage | [DRAFT_HUB.md](./DRAFT_HUB.md) |
| DFS / mock backlog | [LINEUP_ROADMAP.md](./LINEUP_ROADMAP.md) |
| Tokens | `frontend/src/styles/tokens.css` |
| Experience CSS | `frontend/src/styles/product-hierarchy.css` |
| Nav source | `frontend/src/appNavigation.js`, `DraftHub/HubSubnav.jsx` |
