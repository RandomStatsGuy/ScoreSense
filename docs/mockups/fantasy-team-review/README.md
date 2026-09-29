# My team mobile options

Static previews for `hub.roster` / Manage roster. Option A, including the full-width desktop summary, was approved on September 29, 2026. Room keeps its approved design.

- [A — Roster list](../fantasy-team-a.html): position filters, search on demand, aligned salary and term.
- [B — By position](../fantasy-team-b.html): expandable position groups, visible search.

Both use the approved shared mobile header and desktop league alignment. Player details open a contract sheet; Cut and eligible pre-draft Extension show previews only. These mocks do not read or write league data.

Remaining cap is labeled **Available Cap** after draft and **Leftover for draft** before draft. Standard leagues omit the cap summary.

The team/cap summary spans the roster width above the filters. On desktop it is a compact horizontal row, removing the mostly empty side column in both options. The shared layout audit checks this relationship.

## Verification — September 29, 2026

| Option | 390 phone | 1280 desktop | 320 long labels |
|---|---|---|---|
| A | PASS | PASS | PASS |
| B | PASS | PASS | PASS |

Screenshot inspection and `audit.json` cover layout, touch targets, typography, and horizontal overflow. Exercised search, position filters/disclosures, keyboard open/close, focus return, contract/cut/extension previews, standard leagues without salary information, and empty rosters. All page-error checks passed. The existing in-app preview was reloaded after the compact summary and search changes.

Production league mutations, provider handoffs, and the existing Room are outside this static mock pass.
