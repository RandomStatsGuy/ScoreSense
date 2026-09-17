# Fantasy hub UX audit — September 16, 2026

Scope: the authenticated `/hub` experience after the lineup picker work. This is a focused product review of the largest gaps against the interaction patterns users expect from mature fantasy apps: a clear job per screen, progressive disclosure, phone-first actions, explicit saves for consequential changes, and fast paths to the next decision.

## Major offenders

### 1. Salary sheets — `/hub/roster-management/sheets`

**Severity: high**

The page exposes a commissioner-grade spreadsheet as one long consumer UI. It combines season totals, team switching, missing-player audits, roster matrices, and several editable contract fields. Some fields save on blur while other changes use explicit actions, so it is difficult to predict when a change becomes permanent. On a phone, the number of values and edit modes makes the primary job unclear.

Recommended direction:

- Start with a team directory and a compact cap summary, then open one team sheet at a time.
- Put edits into a single review tray with **Save changes** and **Discard**.
- Move league totals and missing-player reconciliation into separate disclosures.
- Keep the phone view to one player per row with a single **Edit contract** action.

### 2. League rules — `/hub/rules`

**Severity: high**

The rules center is a continuous form spanning scoring, league foundation, contracts, roster limits, and draft behavior. The summary rail, sticky save area, and repeated save controls compete for attention. Templates appear after the form and use danger styling even though applying a template is reversible until save. The result feels closer to an administration console than the guided settings flows used by established fantasy products.

Recommended direction:

- Use a category index with one editable section open at a time.
- Keep one persistent save bar that shows the number of changed fields.
- Put templates at the start as neutral shortcuts with a preview of affected categories.
- Show contract and auction sections only when the selected league format uses them.

### 3. League insights — `/hub/insights/overview`

**Severity: medium-high**

Insights mixes awards, records, scoring races, optional charts, standings, cap efficiency, and player ownership history across a large workbench. Several controls change chart visibility rather than answer a fantasy question. The page has useful data, but the hierarchy asks users to explore the interface before they know what is actionable.

Recommended direction:

- Lead with three short stories: title race, hottest team, and biggest weekly mover.
- Give each story a direct path to the relevant matchup, roster, or standings view.
- Keep tables and chart controls in a secondary **Explore league data** area.
- Remove cap efficiency entirely for leagues without salaries and keep ownership history in its own destination.

### 4. Access & imports — `/hub/roster-management/access`

**Severity: medium**

Invites, Sleeper roster connections, workbook imports, synchronization, and league deletion share one destination even though they have different audiences, frequency, and risk. Connection status is especially hard to interpret because imported data and an actively linked league are separate states.

Recommended direction:

- Make **Connections** the default view with explicit states: not connected, imported snapshot, linked, syncing, and attention needed.
- Separate member invitations from data imports.
- Put workbook import in a guided flow with preview and validation before applying changes.
- Isolate league deletion in a clearly labeled danger area at the bottom.

## Pages closest to the expected standard

- `/hub/week` now uses a position-first player picker, clear eligibility, a swap preview, and an explicit confirmation before writing.
- `/hub/free-agents` has familiar search, filters, and player detail behavior.
- `/hub/roster` and `/hub/rosters` keep the browsing task clear and adapt salary details to league capabilities.
- `/hub/game` has a recognizable matchup structure and keeps secondary data behind focused views.

## Suggested order

1. Salary sheets
2. League rules
3. Access & imports
4. League insights

These should be separate PRs. Salary sheets and rules contain consequential writes, so changing both interaction models in the lineup picker PR would make review and rollback harder.
