# ScoreSense product constitution

> Approved October 5 Insights tabs: use A Spotlight on desktop and B Comparison on phone for Contracts, Scoring and Spend. Desktop shows featured contracts, a scoring leader with aligned supporting awards, and committed spending beside position allocation. Phone shows a Best/Worst contract switch, a compact scoring podium and spending comparisons first. Keep detailed tables and charts in disclosures; charts load only when opened. Tabs have balanced label insets and desktop scoring ranks share column tracks. Overview keeps the approved B season story.

> Approved October 5 Insights Overview B: a championship story card with a two-column phone timeline, Best record and Most points highlights, and compact desktop manager rows. Career identities lead with the mapped manager; season team names remain attached.

> Approved October 4 Insights mobile refinement: keep the period and quiet refresh icon on one row, championship years as year / manager / team rows, and Record / Points beside Open scoring. Historical contract ranks may resolve exact saved names or unambiguous initials using saved season identities; malformed salary imports remain excluded with one clear coverage note.

> Approved September 29 My team scoring: use the saved team banner and crop in the roster summary, team name first and owner smaller. Center season Points / PPG / position rank beside each name. Details show newest games first, actual points and saved pregame projection deltas (teal up, amber down), with only “vs projection” as supporting copy. Missing values are dashes; played zero games count toward PPG, byes/inactive weeks do not. Mobile locker details span beneath the pair without moving the selected jersey.

> **Read this before designing or building any user-facing work.**
> Explicit user-approved designs take priority; update this file and the living-surface registry to record approved changes. Otherwise, if another doc disagrees with this file, this file wins. Update this file in the same change when you add a destination, name, token, or interaction pattern.

Agents: `.cursor/rules/scoresense-core.mdc` injects these rules on every turn. Do not wait for the user to restate them.

---

## Manager names

Rules has a commissioner-only **Manager names** category. Commissioners link imported labels and saved Sleeper managers to registered accounts that have joined the league. Links keep the mapped real manager name (for example Josh C) for trophies, contract returns, and history; the linked account handle (for example jdcarter40) identifies the account and does not replace that name. Commissioners can set the display name, including for Sleeper links; an all-season link may have a specific-year override. Historical team names, recorded results, franchise ownership, and access remain intact. Multiple imported labels may point to one account. Remove a link to restore the original label. Normal reads use local saved data; saves invalidate downstream names without contacting Sleeper. Scoring and Spend put one compact season menu beside the shared Insights refresh, avoiding nested filter cards and duplicate refresh actions on phone.

## Product

**ScoreSense** is a fantasy football product from **4th Down Labs**.

It helps people make decisions, not maintain a database:

1. **Projections** — weekly and season outlooks with floor–ceiling ranges.
2. **Fantasy** — run a salary-cap (or pick) league: draft, contracts, cap, waivers, trades, rules. Native scoring is ScoreSense PPR; linked Sleeper leagues keep Sleeper as the scoring host.
3. **Tools** — DFS lineups, mock drafts, and the best ball board.

Non-salary leagues never show salary, cap, contract, dead-cap, or points-per-dollar concepts. Their Fantasy screens use roster space, roster limits, and positional impact instead.

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

Fun comes from consequence and control. The approved optional Appearance themes add recognizable cats, falling snow, and autumn leaves as a personal atmosphere; functional content remains clear and predictable.

---

## Information architecture

### Top-level

`Projections` · `Fantasy` · `Tools`

Do not add a fourth top-level item. Do not rename Fantasy to League.

**Projections:** Weekly · Season (Preseason outlook / Live season).
**Tools:** DFS · Mock draft · Best ball. DFS classic and season-long: Vegas games are the board. Pick one or more high-total games to stack. Choosing a game does not lock a player. Pin the stack you want, or let Build take a stack from those games. Highest is a corner tag, not a reason by itself. Captain modes stay one-game CPT / MVP. Mock draft field size follows the linked league when matching that league's rules. Recent mocks live on the launch rail. A practice room has no Drop or Trade. Simulate uses the same bot pricing as the live auction, shows N of the remaining pool, and never disables Discard. Never say Available players — the rail eyebrow is Player pool.
**Account menu (not top-level):** Model accuracy · Admin · Account · Report a bug.
Admin tabs: Overview · Server · Jobs · Sessions · Settings · Activity · Users · Leagues. Overview leads with what needs attention (failed jobs, missing caches, disk, recent server errors). Jobs schedules are Pacific wall-clock and editable in place; a running job is never started twice. Sessions shows last seen and Sign out everywhere only. Settings apply without a deploy and write to Activity; the server environment panel shows set/not set, never secret values. Admin → Leagues leads with Assign accounts to teams: pick a known league, registered account, and open franchise to restore access without changing its roster or contracts. Account email remains a fallback. Occupied teams must be unlinked in league details before assigning another account.
**Account session (not top-level):** Sign in · Create account (`/login`, `/register`). Mobile-first session pages. Google is the lead social option; email is secondary. Do not wrap these in Fantasy experience chrome.
**Report a bug** (`/report`) is a side option in the account / More menu. Signed-in filing and SCORE labels live in [ONBOARDING.md](./ONBOARDING.md). Do not add it to top-level nav.
**Public legal (not top-level):** Terms · Privacy · Draft alert texts (`/sms-alerts`). The SMS card is content for A2P consent, not a new product area.

### Fantasy destinations

Source of truth: `frontend/src/DraftHub/hubSubnav.js`.

| Label | Internal id | Purpose |
|-------|-------------|---------|
| Home | `home` | Phase-aware Home. Use a compact phase stepper; desktop Settings sits on its right. Pre-draft keeps the next-action deck and draft leftover. In-season Home omits draft-leftover/cap context; records sit with matchup identities. In-season Home leads with the matchup and has no next-action section or routine lineup reminder. On phone, league chat and standings precede Needs attention, which appears only for actionable unresolved issues. Starting Wednesday (Eastern), the matchup shows the approaching week's opponent and labeled projections. The pre-draft deck action is the only page primary. Chat Send is ghost. |
| Strategy | `value` | Full-page pairwise face-off from a league-context site board, same position only. View my rankings opens site vs mine. Optionally write that order into the draft queue. A Fantasy destination without a `HubExperienceHero` band — a deliberate board-first exception, not a missing chrome pass. |
| Draft | `room` | Idle entry + live room. Email and text invite links open here. Members mark **current and future** draft-night times on one calendar (opens 31 days before the first NFL game, closes the day before). Commissioners lock any shown overlap as draft night. Idle Draft is that calendar plus a compact room strip — do not stack a second date/time card and a Who is in list on the same scroll. When the calendar is Closed and no night is locked, the off-calendar lock is the card's primary — do not leave "Mark yours" on a closed board. Start live draft stays secondary until a night is locked or every seat is filled. Start offline draft is ghost — no clocks, same award path. Owner entry records draft wins on Draft, not Free agents Add, and does not flip Home to live draft. CSV export/import is commissioner-only and previews unmatched rows first. The seating pill is amber below a full room and teal only at 12/12. Home's "Not scheduled" links here. Setup shows draft-night status only. Live auction theater lives on the block card: a 150ms bid pulse, a draining clock ring on the headshot (amber under 10s, red under 5s), and a ~1s SOLD hold before the next nominee. High bid is blue while you are winning and primary text otherwise — never gold. Hide empty fantasy narrative; a real line is the tagline under the name. Bots use locker marks and named personalities, not identical emoji robots. Simulate pins the block-card layout and uses live-bot pricing. Recap awards are gold trophy tiles; the page leads with the viewer's grade. Empty nomination keeps leftover, slots, and the viewer's queue on a right rail beside Player pool. Do not hide Nominate when paused — disable it. The command bar leads with the job; connection is a quiet mark. |

| This Week | `week` | For league teams, approved mobile option A leads with a prominent matchup total and Lineup / Matchup / League views. Keep the full matchup name readable in the banner; Around the league names may truncate with full accessible labels. Pregame player headlines show current forecasts with saved pregame projections; games in progress show actual points, and final players show differences from saved projections. Game arrows browse the selected week, and league rows open that same matchup view without changing ownership or enabling other-team edits. Keep routine kickoff notices muted below the content. Lineup opens first. One week selector controls lineup and matchup reads; show the lineup-call count once beside it. Starter and bench rows both have square position controls that open the existing confirmed move picker. Bench is a disclosure. Place Manage in Sleeper below the player board, never in the header; the picker also explains that linked edits happen in Sleeper. Native scoring controls final status, including delayed slates. Matchup forecasts reuse the lineup board's kicker and defense estimates and label their season-based source. Full-name suffix matching requires one compatible player identity. Missing starter forecasts prevent a favored claim. Lineup saves refresh matchup data. Corrections opens the selected week for native commissioners. Game center URLs resolve here. Solo mode retains the existing board. Lineup decisions on one slate (editorial row per slot). On the solo board, the hero lede is the call count (`N lineup calls on the board`) or, when there is no swap and nobody is out, **No bye. Nobody flagged out.** Start opens the Ticket sheet — the week-pts delta is the poster; sit and start stay side by side on phone; facts are Vegas, prior PPG, def vs pos, and kickoff. Keep closes. ScoreSense-only leagues apply the swap from the Ticket Start; linked Sleeper leagues open the platform. On the solo board, decision count lives in the hero once. Refresh projections sits on the freshness line. Call heat is amber Sit/Start pills; quiet rows stay unmarked. The Ticket Start is amber, not a second blue. Wide range is a quiet marker, never a row-wide amber border or primary blue. Empty slots say Empty (or Find {slot} to Free agents). Empty K/DEF with no bench specialist still say Find K / Find DEF into Free agents. Reserve the Start slot so P50s share a baseline. Bench uses the same slate rows and spans under the rail. Week uses the Projections stepper. Calls use the board number, not vibe week. Name the Vibes / VA-projections number so the two pages do not silently disagree. Week 1 prior PPG is last season; a rookie stays empty. |
| Vibes | `vibes` | Approved October 4 C is a portrait-led stacked player deck. Rate each roster player once a day: swipe left for Lower, right for Higher, or use equal circular controls. Undo sits by the progress count. Player details opens within the card. Desktop keeps the card left and Vibe ranking plus Vibes-adjusted points on the right; phone discloses the ranking below. The card compares model and Vibes-adjusted points beneath the portrait. Current and next portraits load; roster reads reuse the current weekly snapshot. Vibes-adjusted projections are research and do not drive This Week lineup calls. |
| Game center (compatibility URL) | `game` | Opens the combined This Week page; no separate navigation item. Your matchup live, league scoreboard, week trophies. The hero names the job: empty lineup consequence pre-kickoff, the score line once live. One empty message — draft night plus when scores start — and Open draft room. Standings share Home's last-season records and stay unranked until a game is played. Do not play last year's Sleeper week as this week's scores. Gold marks a claimed week trophy. |

| My team | `roster` | Immersive team room; Manage roster for contracts and cap in auction leagues, or Player details in snake and linear leagues |
| Free agents | `available` | Approved September 29 option A: a single scouting list with compact headshots, projected per-game pace, season median, and a common-scale floor–ceiling graphic with text values. Use the compact phone header; desktop league picker stays left. Pos / Sort / Search lead the list; extra filters are disclosed. A player opens an outlook and acquisition sheet, bottom on phone and right on desktop. Add / claim / bid / locked follows the real calendar; never hardcode mock deadlines. Pick-draft leagues keep ordered priority claims and conditional drops; salary leagues keep bid, local walk-away, and cap checks. Money and contract history are absent in non-salary leagues. Rows always show the current action; locked rows retain draft stars and a disabled Add. How adds work belongs in the acquisition banner. Desktop virtualizes on page scroll; phone progressively reveals the list. |
| Rosters | `rosters` | Contract values stays a table-first league comparison with manager/player/position/value filters and eight-row pagination. Team rosters is team-first: choose a manager from a searchable directory, then see that team's full active roster and cap summary without pagination or value exclusions. Keep the compact title/actions; no hero band or tall manager rail. Contract details open only after a player is explicitly selected, never by falling back to the first result. Returning from Trade/History may restore that explicit choice. Salary, estimated value, and difference stay adjacent. Non-salary leagues open directly in Team rosters and show every active player, with no cap figures, salary comparisons, or salary sorting. Contract details and history appear only when the league supports contracts. |
| Cap | `planner` | Approved mobile B: Available Cap and season filters above the cap sheet; move calculator alongside on desktop and below on phone. Extension year choices collapse to an editable/revertible label; season filters show impact. Around the league uses two team banner cards per row with nickname, owner and Available Cap; visiting another team is planning only and never changes focus or enables roster writes. Existing cut/undo/queue and contract history stay available to owners. Server cap and contract math owns totals and schedules. |
| Trades | `trades` | Team discovery is the landing view: two wide saved-image banner cards per row, team name first and owner below, searchable by team, manager or player. Each card compares projected Starter and Bench positional strength across the league and shows Available Cap only in salary leagues. Tapping a team opens both rosters with square selection controls. A live 2×2 grid shows remaining-season points, contract-life points, starter/bench changes and points per dollar; pick leagues omit contract life and points per dollar. The same grid sits in the mobile bottom-sheet Review. Missing forecasts stay unavailable. Rank uses an optimal eligible projected lineup, not salary or player counts. Forecasts are PPR research; future contract years use an explicitly labeled same-pace estimate, not a dynasty model. Use a compact title/actions without an experience hero. Multi-team routing, cuts and dead-cap assignment stay in disclosures. Auto-check each package and gate Propose on a pass; verdict sits beside the primary. Inbox and Ideas remain secondary. Trades cap is current active roster salary including expiring contracts, distinct from My team draft-surviving committed salary. |
| Rules | `rules` | League model (read for members, edit for staff) |
| Roster management | `office` | Staff-only members and access. Contracts and Salary sheets appear only when the league uses contracts; leagues without them get **Roster moves** instead. |
| Insights | `insights` | Approved October 4 B record book. Desktop title and saved freshness precede Overview, Contracts, Spend, Scoring, History. On phone, show all tabs in one row, then period and icon refresh; keep the title accessible without a repeated hero. Overview combines manager records and career points in one record book, with championship years wrapping on phone. Manager names persist across seasons; nicknames are secondary. Overview and Contracts share All time, single year, Last 3 years, and custom range, aggregated locally from saved season summaries. Contracts rank actual season fantasy points per saved annual salary, sum points and salary before division, exclude missing production, and keep unresolved renewal terms as annual entries. Contracts and Spend are hidden in non-salary leagues. Normal entry reads SQLite, including stale snapshots, without contacting Sleeper or running ML. Explicit Refresh history and league sync update saved history. Spend, Scoring, and History retain their own detailed season controls. |

In-season Fantasy phone navigation is League, This Week, My team, and Free agents for both salary and non-salary leagues. League is first in Fantasy’s phone picker, with Home first within League. League contains Rosters, Trades, Vibes, Rules, Insights, and permission-gated Roster management; Cap appears only for salary leagues and is also reachable from My team. Hide Strategy and Draft once the selected league’s draft is complete. Before the draft, Home, Draft and Strategy remain prominent; solo practice retains draft tools. Keep old URLs working.

If you add or rename a Fantasy destination, update `hubSubnav.js`, `appNavigation.js` subtitles, routes, `frontend/src/livingSurfaces.js`, this table, and tests in the same change.

### Roster management panes

Source of truth: `frontend/src/DraftHub/hubOfficeTabs.js`.

Contracts · Salary sheets · Corrections · Members · Access & imports. A league with no contracts shows **Roster moves** in place of Contracts, and no Salary sheets. Corrections stays available so staff can repair native weekly lineups.

Corrections repairs native current-week and historical-week rosters and starters through a reasoned preview and audited save. Save corrected lineups works before the slate ends without statistics, preserves kickoff locks, and allows subsequent scoring refreshes. Publish corrected results remains separate and requires complete games and statistics; finalized weeks require this action. Past ownership is not inferred from today's roster. Corrected results use the week's scoring snapshot and actual statistics; missing statistics block publication. Current rosters and later lineups remain unchanged. The approved A correction editor works on one manager’s historical lineup at a time, searches by player name, and keeps raw IDs under Advanced player details. Always render every starter slot required by the league rules, including repeated positions and FLEX, with a Fill action for empty slots. Filling an occupied slot moves its previous player to the bench. Empty display slots never create fake player records. Current-roster players are offered in the historical bench as explicitly labeled suggestions; only commissioner selection adds them to that week, never viewing the week. Accept both native singleton slot names and indexed correction names; draft-record and current-roster repairs are separate workflows, not implied by publishing a weekly correction.

Roster moves is the no-contract pane. It is the same staff roster editor as Contracts with the money off: no Type, salary, Yrs, Schedule, committed, dead cap, or free. Staff assign a player to a team and drop one; there is no salary to set and no cap to bust. Drops write immediately before or after the draft, with a simple roster-removal confirmation. Legacy salary and years fields never hide players or reduce their counts. It never appears beside Contracts — a league has one or the other. Do not call it Rosters; that is the league-wide destination.

The pane switcher uses pane pills only. Do not inline group labels with the pills.

Members is where staff expand or shrink the seat count. A seat is the slot; a manager is the person. Do not say club, franchise, or team for that object. Members shows league capacity, created teams, and claimed managers separately. The league-size picker offers every integer from 6 through 14; existing legacy sizes remain readable. Saving changes unassigned capacity only and never deletes a team. Add team uses an open seat first and expands capacity when full. Remove team previews the resulting size and consequences before confirming. Draft owns the invite link. New-league and mock-draft size pickers also offer 6–14. Access & imports assigns a named email to one seat; it does not copy the Draft invite link. Commissioners download the league workbook and start a delete here. Every commissioner must type the league name and agree; the last confirm erases the room. Members download that same workbook on Rosters.

Sleeper: Access & imports is the one link. The league strip's Sync league is the one manual sync. Every other "Sync Sleeper" / "League settings" / "Import Sleeper" control deep-links to those. When a league is linked and roster sync is live, the server also reconciles rosters hourly: trades move the existing contract, adds and waiver claims create the imported acquisition contract, and drops become non-roster waived history rather than being deleted. Paused roster sync never writes roster or contract state. The sync confirm names what it overwrites. Collapse the Sleeper league ID form once the league is linked. A re-import on Contracts is secondary and names that it overwrites staff edits.

Sleeper roster sync can be paused per league in Access & imports. Paused means nothing from Sleeper writes rosters, contracts, or team membership: Sync league refreshes scoring only and says rosters stayed as they are, Sleeper re-import buttons are hidden, and unlink keeps every player. Sleeper scoring, lineups and team names keep flowing. Sleeper-linked contract leagues that existed before the pause shipped start paused; new leagues start with sync on. Turning sync back on does not sync by itself.

Mark draft complete lives on Contracts as a red confirm. It burns one year on every contract and cannot be undone. It also ends a leftover live room and moves the league in-season. Setup shows the status only. After that, Roster management is After draft — not live-auction chrome, and not keepers. After-draft leftover matches Rosters: live contracts occupy cap; Yrs-0 expirees do not. Staff Drop and field edits write immediately. Add records an Auction or FA lottery winning bid.

Commissioner Drop on Contracts and My team removes a player with no dead cap so staff can add them to another team before the draft. After draft it writes immediately — no pending tray. Cut is the penalty path. After draft, owners Cut on My team and commissioners Cut on Roster management · Contracts; those writes are immediate. Dead cap hits only the season the player is cut — later years of a multi-year deal free in full. Dead cap floors to the lower dollar: a $1 cut is $0 dead, and a $7 cut is $3 dead at 50%. A player may be active on two rosters only if one row is a cut. Adding them does not remove that dead cap. Undo cut only if they are not active on any team.

Contracts also lets staff **Record dead cap** directly for the current season, including retired or unlisted players entered by name. Record the actual whole-dollar obligation in the team's cut ledger without inventing an original salary or active roster spot. This audited entry writes immediately, cannot be undone into an active player, survives Sleeper sync, and expires when the league advances its season. Remove dead cap confirms a correction to an erroneous entry. Current owner labels use the current league season; an older nickname mapping must not replace them.

Chat is **not** a pane or a Fantasy destination. The full thread lives on **Home** as a locker rail. Do not show the floating launcher on Home. Other Fantasy pages keep `FantasyChatDock`: a detached bottom-right bubble above the tab bar, safe area, and any fixed page action. The approved October 1 **A** design opens a centered floating conversation with League, Direct, and commissioner-only Staff tabs. A click opens chat; holding the bubble for 600ms reveals its X. The X removes the entire launcher for the session; restore it in Notification settings. Escape and the minimize control close the conversation. Managers can @mention people in the conversation, add or remove reactions, and privately message claimed league members. Owner names lead message identities. Normal league messages increment the red unread badge without an alert by default. The header bell opens on-site notifications; settings control trade offers/responses, direct messages, @mentions, and optional league-message alerts. Preferences persist per account. Reading a thread clears its unread count and message alerts. Live draft rooms retain integrated chat and stay board-first. Clear chat is primary-commissioner-only, red, and confirms.

### Manager labels

Fantasy single-season views lead with the **season team name** and attach the mapped real manager name underneath or after a middot. Cross-season Insights lead with the **mapped manager name**, with season team nicknames secondary. Never replace the mapped name with an account handle or omit a known manager. Position choices use QB, RB, WR, TE, K, DEF; kicker and defense always come last, with defense last by default.

---

## Visual language

### Approved guided-focus league administration — September 16, 2026

Salary sheets, League rules, Access & imports, and the Insights overview follow the selected option A system. Each page leads with one clear choice before exposing dense controls. Salary sheets start with a manager and keep league totals collapsed. Rules provide a persistent category index and one save surface. Access & imports leads with the live connection state, separates one-time imports, and places manager assignments behind a disclosure. Insights opens with three factual league stories that link into the existing scoring views. Salary-sheet field edits stay staged until Review & publish. Completed corrections are saved individually; cancelled or failed edits remain staged. Historical salary corrections retain their reason and preview gates. CSV selection requires explicit confirmation; salary workbooks retain their matching preview. Consequential writes retain their existing confirmation and permission gates.

### Approved Cap contract workbench — September 16, 2026

Cap follows the selected option B: keep the experience hero, lead the desktop main column with the contract sheet, and place the cut/bid preview above the current-cap summary in the right rail. Phone shows the preview before dense contract rows. Extensions, saved cuts, and spending details remain below the sheet. Use existing experience components and tokens.

Say current cap room versus room after the preview. Selecting a contract and entering a possible bid never saves a cut or places a bid. The cut action still confirms. Label the selected player's penalty “Dead-cap charge for this player,” not total dead cap after the cut. Future-season previews include the cut but do not assume a new contract for the entered bid. Years left includes the current season. Keep saved extension and cut controls separate from the unsaved calculator.

Dark and light modes. Matte, editorial, layered. Sports-product energy without casino chrome.

Classic light mode follows the approved soft-canvas B concept: pale neutral canvas, white surfaces, navy text, green current context, and teal healthy states. Classic dark mode keeps its blue accent. A sun/moon control beside the desktop account menu and a labeled switch in phone More change modes immediately. Account Appearance offers System, Light, and Dark. Dark remains the first-visit default; color mode persists per browser and applies before first paint. System follows device changes.

The approved September 30 Appearance themes are Classic, Cozy den, Snowfall, Autumn, and the existing Footballs preset. Each has coordinated light and dark palettes across Projections, Fantasy, Tools, and Account: navigation, cards, boards, menus, sheets, and room surfaces share the selected palette. Cozy den uses peach and plum, falling yarn and mouse toys, and two ragdolls supported on cushioned cat trees; Snowfall uses icy blue, falling snow, and a mitten-waving snowman; Autumn uses copper and rust, tumbling leaves, and a squirrel on a stump. Footballs keeps its game-day palette and falling footballs, with the approved Marshawn-inspired #24 companion, Skittles, and a static Henny bottle on his side table. Keep their vibrance and recognizable artwork. Uploaded team banners, jerseys, and semantic success, warning, and danger colors retain their meaning.

Themes are account preferences, independent of browser color mode. Falling decorations, Companions, and Playful reactions are independently saved switches. Companions react only when their own prop is moved, never to general page pointer movement. Props move within an invisible 100-unit square; never draw the movement boundary. Release uses gravity, a damped hanging tether or ground bounce and friction, then stops at rest. Eyes follow the prop relative to the actual face, including mirrored cats. Provide 44px pointer/touch targets and arrow-key, Enter, and Space controls. Companions off removes habitats and ground; falling off removes particles; both off keeps only the palette. Existing Atmosphere/Motion-off preferences retain their quieter behavior. Reduced motion always wins. Existing pile, wash, and intensity options remain available under More scene options. Scenes sit behind functional content with a dedicated ground area and one continuous base across wide screens; draft workspaces remain clear. Ground scenes wait for the active page's initial loading and layout to finish. Hidden cached panes and completed empty or error states do not hold them back. Load preferences once in the shared app shell, cache appearance before first paint, and restore the previous preference with a visible error after failed saves. Themes never change scoring, contracts, page destinations, or saved league focus.

| Role | Token / value | Use |
|------|----------------|-----|
| Page canvas | `--experience-canvas` / `--bg-base` (`#09111d` / `#070d17`) | Page background |
| Surface | `--experience-surface` / `--bg-elevated` | Cards and sections |
| Primary action / current context | `--experience-blue` / `--accent` | One cool blue. Reserved for *now* and *next* |
| Healthy / saved | teal (`--tone-positive`) | Healthy states and below-estimate contract salaries; always pair value color with text |
| Attention | amber (`--tone-caution`) | Warnings, unsaved, bids, incomplete seating, info that needs a move. Never a positive or best-in-set highlight. |
| Destructive | red (`--danger`) | Errors, cuts, blocking validation, league-wide destructive actions — never a projection delta except the user-approved Trades loss meter (muted `--tone-negative` with a signed value and direction). Other exceptions: the live auction clock under 5s, and muted `--tone-negative` coral for above-estimate contract salaries (with text, never a row-wide warning). |
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

Account settings, Report a bug, and Draft alert texts use a centered `StandaloneFormContent` column capped at `--form-content-max` (35rem), with left-aligned titles, headings, labels, field text, help, and actions. Field pairs use `StandaloneFormRow` and `--form-field-min` (14rem) for equal widths and control heights, stacking on phone. Session forms keep their existing narrower column. Terms and Privacy keep their reading width and left-aligned prose. Account legal links and standalone return navigation share a centered footer. Consent checkboxes sit beside the first line of their copy; SMS disclosures stay in one compact group. Team appearance keeps its header, tabs, and Save visible while the editor body scrolls. Preset selection replaces an uploaded image in the unsaved preview. Appearance and confirmation dialogs trap keyboard focus, make the background inert, and restore focus on dismissal; a nested discard confirmation owns Escape until dismissed.

Editorial Fantasy and Tools pages use the shared experience stack:

`HubPage` + `hub-experience-page`
`HubExperienceHero` — eyebrow, heading, one support sentence, status chip
`HubExperienceLayout` — main column + sticky summary rail
`HubExperienceSummary` — “At a glance” facts + primary action

Fantasy destinations share one `HubExperienceHero` (eyebrow + heading + band). Home is the exception: the page hero is eyebrow + a centered phase stepper, Settings in the chip slot, and the heading stays in the Pre-draft card. Strategy, Rosters, Trades and Cap are also exceptions: no hero band. Rosters uses a compact title and toolbar with a table/details layout; its CSS may define that approved layout without changing unrelated experience pages. Tools keep the display H1 + eyebrow pattern. Hero heading and padding use `--experience-hero-heading` and `--experience-hero-pad`. Status chips are not the page primary — do not put “You can edit” or “Need a partner” where Save belongs. Tab strips sit below the hero band. The shared league strip (and Needs attention) shows on Home and idle Draft; live rooms stay board-first. The app shell is one `<main id="main-content">` with a skip link.

Reuse `frontend/src/DraftHub/HubUILayout.jsx`. Do not fork a second hero/summary system.

Which file to open for a given destination: `frontend/src/livingSurfaces.js`. Resolve the row, then match its `page` and `copy`. That registry is the living style guide — keep it current when you add or retarget a screen.

**Use this chrome for:** every row whose chrome is `experience` in `frontend/src/livingSurfaces.js` — the registry decides, not a list here.

Empty This Week / My team / Game center boards share one empty-state block, branched on league state: native pre-draft → Lock a night (Draft); Sleeper not linked → Link Sleeper (Access & imports); linked but stale → the strip's Sync league. Do not send those boards to Setup. Game center pre-draft is one sentence to Open draft room — not Link Sleeper and not a kickoff wait. "Live" on Game center renders only inside a game window.

**Do not use this chrome for:** the live draft board (board-first, existing live-room layout), **Projections** (board-first table), **Rosters** (the approved table/details layout), **Strategy** (a Fantasy destination without a hero band — full-page face-off; View my rankings is site vs mine), or other dense data tables that are not a decision surface. Do not add `HubExperienceHero` to Strategy to “match” the other 13.

### Automatic forecast refresh

Weekly forecasts update automatically hourly in season, sooner when checked inputs change. Season outlook and live season forecasts update daily. The existing shared CPU worker and process-owned refresh lock serialize inference; no browser visit starts ETL or model training. Open pages observe publication through the existing refresh-status endpoint, pause checks while hidden, and keep saved forecasts usable during normal rebuilds. Projection attention warnings mean a failed or overdue refresh, not a routine fingerprint mismatch. Live scores keep their separate minute-level game-window cadence; league roster reconciliation stays hourly.

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

At desktop widths, keep the league switcher left-aligned with its context row and page content.

The approved September 29 Home preview is the reference for mobile spacing and controls: `docs/mockups/fantasy-mobile-home-a.html`. Reusable mock parameters and primitives live in `docs/mockups/mobile-foundation.css`; the starter is `_mobile-starter.html`. `.cursor/rules/fantasy-mobile.mdc` defines the workflow and measurable defaults. These are design references; migrate the product's shared primitives when implementing an approved page.

Center concise card headings, matchups, and standalone key figures. Navigation, messages, player lists, forms, and actionable issues remain left-aligned; table numbers remain right-aligned. Disclosures use a small icon and clear plus/minus state with a full touch target. Reduce copy and phase-irrelevant information; a page needs no primary action when there is no meaningful next step. Preserve visible blockers beside affected actions.

Entering Fantasy from another area lands on Home. Projections and Tools return to the last destination you used in that area. Tapping the already-selected Projections, Fantasy, or Tools tab reopens that area’s destination picker on phone, or scrolls the destination strip into view on desktop.

On phone, the header is the current destination. Destination switching uses one picker, not a scrolling tab strip. Tapping a destination — including the one already open — closes the picker so the page is not left inert. Account lives in More. Do not stack ScoreSense, a context label, section tabs, and page tabs. The phone destination picker mirrors desktop primary destinations plus League; secondary pages such as Vibes stay under League with the same permission filters. More lives only in the bottom navigation. On Home, the left-anchored destination and quieter league switcher share one compact phone header row with an internal text inset; do not stack two centered pills or a separate league strip. New Fantasy phone mocks reuse this compact header by default, preserving each living surface's approved structure. Existing Fantasy pages retain the one-row league strip below the picker until their mobile pass. New league and Sync league live in the league picker. Needs attention is one line on that strip — do not restack a second league card in the destination overflow. Weekly phone chrome is the destination header plus one sticky bar (position, filter, result count). Attention and other movement filters live in that filter sheet. Live draft stays board-first. League chat is a detached bubble above the tab bar; opening centers the floating conversation and holding reveals its hide control. Idle Draft and Mock use one seat component so the live room inherits it.

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
- Chat: viewport-fixed detached bubble unless dismissed; opening is a centered floating conversation. `aria-expanded` / `aria-controls`, Escape and backdrop close it, focus returns to the launcher. Hold reveals the launcher X; Delete/Backspace provides the keyboard equivalent. Notification settings restores the fully hidden launcher.
- Draft availability shows current and future times only. Commissioners lock any shown overlap as the official night. Idle Draft shows that calendar as the one featured job; while the calendar is open the date/time form stays a collapsed fallback — when it is closed and no night is locked, that form is the card's primary and Start live draft drops to secondary.
- Suggested bid columns name the scoring and risk posture from Rules (`PPR · Balanced`). Never show "Hub" in user copy. League context is `<league name> · <scoring>`.
- Count nouns use one helper: `1 manager`, `1 seat`, `1 team` — never `1 managers`.
- Transactional SMS (draft alerts) is opt-in only. The checkbox starts empty. Phone lives on the account. SMS is never a league invite. The public opt-in card is `/sms-alerts` (also on Account). Privacy and Terms must name the SMS vendor, say mobile numbers are not shared for marketing, note message frequency, and include “message and data rates may apply.”

---

## League rules features must respect

Native lineups carry saved selections into the next week and allow managers to review them before kickoff. A missing lineup may initialize before the first game, using eligible current-roster players. Once any game starts, missing historical starters are never inferred from today’s roster or re-ranked from projections. An explicitly saved empty lineup remains empty. Historical recovery uses Corrections.

Do not invent a parallel rules model. Canonical merge/validate/preview: `frontend/src/DraftHub/rulesPresentation.js`. Backend remains authoritative for eligibility and materialized contracts.

- Policy changes apply to **new contracts only**. Say that once, next to Save. Do not mention a migration unless a control exists on the page.
- Rules Save writes the league on the form, not the last-focused league in the header. A late save response must not yank the UI to a different league.
- Applying a league template confirms, names what changes, and fills the form. It does not save. Offer undo until the next edit. Style those triggers as destructive, not ghost chips.
- Contract types shown to users are **Rookie deal**, **Vet deal**, and **Extension**. Never “Rookie Extension” or “Veteran Deal”.
- Static rookie deals and vet deals stay flat for the first term. The configured step-up starts on an **Extension**. Rules shows **Keep vet deals flat** and **Allow vet deal extensions** as their own toggles.
- Final-year rookie deals may take one extension when **Allow rookie deal extensions** is on. Final-year vet deals may take one when **Allow vet deal extensions** is on. An extension cannot be extended again.
- Players-tab adds follow the acquisition calendar (`acquisitionWindow.js`): locked pre-draft and in-season off-window; **priority claims** during waivers in pick-draft leagues (FAAB bid in auction leagues); instant add after waivers; offseason trades stay open in pick-draft leagues and are limited to surviving contracts in auction leagues.
- League capabilities (`uses_salaries`, `uses_contracts`, `acquisition_mode`) come from `draft_type`, not leftover salary fields. Auction leagues are salary-cap + bid. Snake and linear leagues are no-money + priority claims. Legacy salary / years / cap numbers have no effect when `uses_salaries` is false.
- ScoreSense-only leagues persist weekly lineups on This Week and score weeks with configurable ScoreSense PPR (full PPR by default) (nflverse; internal id `hub_ppr` — the string "Hub PPR" never reaches UI). After the draft, Game center refreshes native week scores when weekly stats are available. Before the saved schedule's first kickoff, show neutral upcoming copy and skip actual-stat downloads. Once games start, missing statistics remain an actionable refresh failure; an unknown schedule must not hide that failure. A calculate after the slate ends locks that week's lineups. Linked Sleeper leagues still set and score lineups in Sleeper; Game center reads Sleeper.
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
| Nav source | `frontend/src/appNavigation.js`, `DraftHub/hubSubnav.js` |
| Living page to match | `frontend/src/livingSurfaces.js` |
| Redesign / first-design options | [mockups/](./mockups/) · `.cursor/skills/fast-ui-mock/SKILL.md` |
| Cloud Agent runtime | `.cursor/environment.json` |

## Approved Fantasy header — September 10, 2026

Phone headers across Projections, Fantasy, and Tools share one rounded shell (`--radius-lg`), symmetric insets, `--text-xl` bold destination titles, the same disclosure chevron, and 44px controls. Fantasy’s compact league picker stays quieter than the destination within that shell. Never flatten the Fantasy phone header into a square strip or add a second destination divider.

Match the approved compact header mockup: three continuous desktop rows for product navigation, Fantasy destinations, and league context; no rounded outer panel containers. League name is the picker label (no SWITCH LEAGUE prefix); New league lives inside its footer. Put phase beside the league, and Your team, team identity, role, and Sync league on the right. Keep mobile destination navigation and permissions. At narrow laptop widths the destination links may scroll horizontally while League stays reachable; do not shrink text. Dropdowns support keyboard dismissal/focus return and paint above page content.

Projections and Tools share the same flat product-navigation row and destination treatment. Weekly/Season and DFS/Mock draft/Best ball use `ProductSubnav`, with the same selected-tab border, readable labels, and spacing as Fantasy. These areas have two header rows; the league-context row belongs to Fantasy. Keep projection filters and Season modes in their existing locations, preserve remembered destinations and native link behavior, and retain the phone destination sheets. Do not restore rounded desktop header containers or separate boxed destination controls in these areas.

## Approved My team room — September 10, 2026

My team defaults to Room for league teams. The approved curved locker-room concepts supersede the experience hero, featured-player wall, and decoration restrictions on this view. Keep a physical room, detailed jerseys, owner Account atmosphere, the selected team banner as the upper-room backdrop, weekly starters together, Bench access, and a locker that expands in place. Texture, material lighting, team colors, and artwork dimensions are intentional exceptions to flat-card/token-only artwork rules; functional controls retain readable type, focus, and touch targets. At phone widths the room reflows into a browsable locker grid without horizontal page scroll. Reduced motion disables drawer animation.

My team’s Room uses the selected team banner as the upper-room backdrop. Matchup information stays in Game center; My team keeps only a compact link there. Manage roster follows approved September 29 option A: one compact team/cap summary above the full-width roster at every width, no empty desktop sidebar. Use the saved team banner and crop in that summary. Position chips carry counts, search opens on demand, and one full player row opens contract details (phone bottom sheet / desktop side sheet). Keep the team name first and owner smaller on the left, the desktop cap figure centered, and committed/dead cap right; stack the quiet facts below on phone. Trades, appearance, and Contract rules sit below the players. Room and Manage roster are the two local view controls. Preserve cut, extension, history, and staff-only remove controls in details.

My team labels remaining cap **Available Cap** after the draft and **Leftover for draft** before it; hide cap amounts in non-salary leagues.

Manage roster is a separate local tab preserving contracts, cap, cuts, extensions, and appearance editing. Room opening and visiting another team never change saved league focus. Members may visit other rooms. Only the owner may edit nicknames or opt into a public, revocable `/team-room/:token` link. The public payload contains the room presentation only, not salary, contracts, owner account IDs, or league rules. Visitors see the owner's theme. Sleeper nicknames are used when provider metadata exposes them; local overrides can be reset. Historical projection differences require a pregame capture; never backfill them with an in-game projection. An unknown score remains a dash, not zero, and live state is not inferred from a zero score.

## Approved DFS portfolio workspace — September 11, 2026

Single-game Captain comparison is a separate read-only diagnostic inside the existing
workspace. It compares complete lineups with the selected objective, locks, skips,
salary range and team limit. Explain before running that portfolio count/exposures,
minimum differences and randomness do not apply. Keep the current build intact;
clear comparison results when inputs change and discard late responses. Show all
Captain statuses, mark incomplete comparisons, and label scores as sums of player
projection inputs. No payout claims. Candidate rosters open in existing disclosures.


The user selected option A in `docs/mockups/dfs-gpp-a.html`, with the shared Results dashboard. This supersedes the DFS experience hero/summary, five-format-card grid and full-page Vegas board. Keep the compact title, slate bar, three-column settings/pool/selected-lineup workspace, paginated player table, separate Captain and total exposure, and two export paths. Account backgrounds remain in Account settings. Single-game Minimum differences offers Captain change only: the same six athletes may recur with a different Captain, but exact lineups stay unique and exposure limits still apply. Returning to Classic or season-long restores at least one changed athlete. The Results tab tracks imported cash fees and actual payouts, preserves entry IDs, shows import completeness and links entries to immutable build-time inputs. Unknown financial values stay unknown; ROI uses total net divided by total fees, excludes unsettled/void entries and is unavailable when required settled financial data is missing. Results are descriptive, not proof of a strategy. Do not invent ownership, simulation win rates, or payout estimates. CSV imports preview before saving; reserved-entry exports preserve site metadata and require an explicit assignment review. Results CSVs accept up to 100 MB and 250,000 entries, parse off the main browser thread, and save in bounded batches with progress. Interrupted saves retain the preview and report confirmed progress; re-import updates the same account/site/contest/entry keys without duplicates. Paginate saved entries instead of rendering the entire ledger. DraftKings full-standings CSV/ZIP exports detect contest IDs from the archive or member filename and ignore the separate ownership table. Anyone using Results can enter their own DraftKings username, including multi-entry name suffixes; a blank username matches only previously imported site/contest/entry IDs. Never default to saving the whole field as personal results. Standings provide scores and ranks, not fees or payouts.


## Approved Game center room — September 11, 2026

The selected B player spotlight concept takes priority for Game center: compact heading/week controls, a matchup scoreboard, selectable position duels with detailed jerseys, every starter below, and a secondary details/league rail. Bench scoring is separate from starter scoring; standings and weekly awards are disclosed on demand. Shared navy/brass material tokens (`--team-room-light`, `--team-room-tint`) extend the My team artwork exception to this matchup surface. Brass frames are material, not win probabilities or awards. Do not restore an experience hero or an uncalibrated win-probability bar above the duel. The approved September 28 weekly-first consolidation reuses this room inside This Week, with Lineup / Matchup / League views and a factual projected-margin strip. Vibes and advanced scoring controls are secondary.

Each scoreboard half uses its own team's saved banner through the authenticated media loader and saved crop, faded into the active room surface. Missing artwork falls back to the current theme surface. Account background themes remain controlled by Account. My team uses only the selected team's banner as its room backdrop and provides a keyboard-accessible link carrying the selected team and week to Game center; opening it never writes league focus. Public shared rooms omit the private Game center link.

Game center labels current forecasts separately from the pregame baselines frozen in My team. Missing pregame captures remain missing after kickoff; do not backfill them from a later forecast. Resolve Sleeper IDs against cached NFL forecasts using the weekly board's guarded name/team lookup, including team aliases.


### Refresh behavior

Projection reads recover missing or invalidated artifacts automatically through the shared background worker. Retain the last successful forecast for the exact requested season, week, and injury mode while replacements rebuild, show attention only for failed or overdue refreshes, and retry failed updates. Never reuse another week's DFS forecast or turn missing forecasts into zero. Shared weekly, season, and rest-of-season forecasts retain all NFL rostered skill players, including injured players and modeled bench profiles. Players without individual history use the existing labeled Roster estimate profile; inactive status remains separate from forecast coverage. NFL and Sleeper identity changes invalidate the shared artifacts. Trades warms rest-of-season forecasts alongside weekly forecasts and uses the existing labeled K/DEF rank-curve estimates for specialists. DFS skill coverage does not depend on successful specialty-model refreshes.

Online document navigation fetches the current app shell; the saved shell is an offline fallback only. A failed page's Reload page and Go to Fantasy home actions open a fresh shell outside older service workers' navigation caches, then restore the intended URL before the app starts. Recovery keeps sign-in, preferences and league data. Automatic deployment recovery remains bounded and waits while a live draft, editable page, dialog or save is active.

An interrupted projection refresh is a persisted failure, not a permanent running marker. Admins can Retry refresh directly from the shared status banner in any product area. Retry uses the existing no-retrain pipeline and preserves the last successful data timestamp until completion; it does not deploy or change league state.

Weekly's notes chip starts a background notes refresh. If its weekly artifacts are missing or stale, the worker repairs them with the existing models before rebuilding notes; it does not run ETL, retrain models, or backfill transcripts. The chip stays refreshing until that job finishes, then reloads the board and notes. Season's Refresh starts a background rebuild without retraining models or backfilling transcripts. Show the current step and keep browsing available. A failed attempt retains the last successful data timestamp.

Open pages check refresh status periodically and on returning to the app. Completed rebuilds update projection boards and Best ball, and invalidate Fantasy projection caches without remounting its workspace. DFS offers Update player pool explicitly: it clears the current unsaved build, preserves user settings/imported estimates, and leaves saved build snapshots unchanged. Do not silently replace an active DFS build after a background refresh.


#Linked Sleeper leagues execute player trades in Sleeper. ScoreSense proposals record agreed cap terms and wait for unanimous acceptance and matching synced player destinations before applying them; they never push player moves to Sleeper. Player moves first detected during a Sleeper sync create a cap review, grouped by that sync rather than presumed to be a single Sleeper transaction. Participating managers or the commissioner can propose the missing dead-cap terms for all affected teams to accept; the commissioner can explicitly confirm that no dead-cap terms were agreed. ScoreSense must never infer a dead-cap side agreement from a player move. Existing dead cap can move wholly or partially in whole dollars, independently of player ownership, preserving its source player, original team, season, amount and transfer history. Each transfer conserves the total obligation, applies atomically, obeys the receiving team's cap, and expires when the league advances beyond the cut season. Transferred obligations cannot be cleared through Undo cut; changes go through another trade.

## League scoring ownership

Rules identifies the scoring and lineup host. Native leagues save validated points-per-stat weights inside LeagueRules, defaulting to full PPR for existing leagues. Native recorded scores support offense, two-point conversions, return touchdowns, kickers, defense/special teams, and exclusive yardage bonuses. Projection and Strategy estimates remain PPR-based and must be labeled separately from configurable recorded scores.

Game center gives native commissioners Calculate week / Recalculate week recovery controls after the draft. In-progress calculation saves provisional results and leaves unstarted players editable. Final calculations require a confirmed finished NFL slate and complete starter stats, save player/team totals, locked lineups and a scoring-rules snapshot atomically, and update standings. Recalculation confirms that it replaces the selected week's totals using current saved rules. Saving scoring settings alone never rewrites results; Game center flags an older rules snapshot.

Native scoring rules are commissioner-editable in Rules: offense, two-point conversions, player return touchdowns, kicker makes by distance and misses, defense/special teams events and points-allowed bands, and optional exclusive yardage bonuses. Members may read them; linked Sleeper leagues edit scoring in Sleeper. Saved changes do not rewrite past results. Specialist scoring requires complete actual statistics for enabled rules.

Native scoring uses a shared raw-stat refresh every 60 seconds while games are active, and every five minutes between games, with confirmed game status, covering Thursday, weekend, Monday, and rescheduled games. The host applies each league's saved weights, rather than another provider's fantasy totals. Finalization waits for confirmed game completion and stable, complete statistics. Live scores are provisional and do not finalize standings or lock players whose games have not started. Delayed statistics retry automatically; unavailable starter statistics or missing historical lineup snapshots block official results and show a failure. Automatic scoring preserves already finalized weeks and commissioner corrections; later official stat corrections use explicit recalculation.

Native lineup writes enforce kickoff for both outgoing and incoming players, preserve started rows across roster moves, and carry saved selections forward instead of re-optimizing each week. Unknown kickoff data blocks the affected edit. Matchups render every configured starting slot, including empty slots, K and DEF. Saved empty team/week snapshots permit legitimate zero-point teams without fabricating missing history.

Native acquisitions use verified cached player identities and revalidate ownership across player ID aliases, roster size, positional maximums, salary capacity or priority claim eligibility at award time inside the roster transaction. Submitted player details cannot change the player's position or kickoff eligibility. In-season waiver claims are private and cannot be processed before their window closes. Pick-draft leagues retain priority claims and do not acquire salary obligations. Auction leagues use bids; tied bids use submission order. Native schedules rotate all opponents before repeating; opt-in playoffs seed from finalized regular-season records, support byes, optional reseeding and a third-place game, and advance the higher seed on a tie. Seeded playoff settings are locked for the season.

Insights Overview shows current-season official W/L/T, points for and against, scoring leaders, and championships where available for either host. Native records require published scoring runs; saved regular-season and playoff matchup types preserve historical records when later seasons change their schedule. Sleeper roster records include host median-game results and custom scores; incomplete matchup coverage is disclosed. Scoring presents recorded player contributions by season where lineup snapshots exist. Non-salary leagues omit Spend and contract-history views. Cached legacy history is identified until an explicit refresh; page reads do not silently request remote history.

Sleeper-linked leagues use Sleeper's rules, lineups, live points and corrections. Rules shows this ownership instead of editable native scoring fields, and Game center links to Sleeper without offering local calculation controls. Backend writes reject scoring-rule changes for linked leagues. ScoreSense contract, cap and draft tools remain local. League templates preserve scoring settings; old clients that omit scoring preserve the saved weights.


### Approved lineup position picker (September 16)

This Week uses approved option A for manual lineup changes: tap a starter position and choose an eligible bench player, or tap a bench position and choose an eligible starter slot, review who moves to Bench and who fills the slot, then confirm Start. Desktop uses a right-side picker; phone uses a bottom sheet. Show headshots, position/team, kickoff, projected points and the signed lineup delta. Missing projections never become zero. Locked players are visibly unavailable; the backend remains authoritative at save. Empty slots use the same preview before filling. Cancel and Escape dismiss without saving, focus returns to the originating position, and successful saves announce the move. Linked Sleeper leagues preview locally and open Sleeper for the edit. Manual position moves use blue for the next action; suggested Ticket calls retain amber. Never apply a move by clicking a roster row.

### DFS live refresh

The live DFS pool checks every five minutes while visible and idle. Background updates preserve original built/saved lineups and imported estimates; rebuild to use changed inputs. Missing estimates require all three finite inputs and stay excluded. Server refresh failures/overdue projections are identified separately from a successful player-pool fetch. Uploaded catalogs remain frozen. See [DFS projection coverage and refresh](DFS_PROJECTION_FRESHNESS.md) for source and model limitations.

### Approved DFS coverage UI — September 28, 2026

The user selected option A in [the coverage mockup](mockups/dfs-inputs-a.html). Put coverage beside the pool: available players, unavailable players, and players needing estimates are separate groups. The available filter is the default; make missing identities/reasons and projection import reachable inline. Show source labels on every player and source counts for available players. Distinguish the player-pool check from the server projection refresh; unknown, overdue, failed, historical and uploaded states must stay explicit. Original builds remain frozen.

This layout supports Classic and season-long as well as single-game formats. Keep the Classic/season-long matchup board in the right rail with team graphics, implied points, current totals/spreads, line movement against the first observed line, and stack weighting. Missing line history stays blank. Captain controls and comparison belong only to single-game formats. Keep game graphics legible at phone width and in both themes.

### DFS estimate provenance

DFS labels historical kicking ranges as **Historical estimate** and profiles for players without individual history as **Roster estimate**. Neither counts as a modeled player in coverage. Confirmed unavailable players remain visible without invented zero forecasts. Missing estimates and unresolved feed identities stay excluded until complete inputs are supplied. Refreshing a pool does not imply upstream scoring history is current.
