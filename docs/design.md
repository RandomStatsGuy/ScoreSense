# ScoreSense Fantasy Rules Center and League Administration Redesign

> **Product constitution:** [PRODUCT.md](./PRODUCT.md) wins if this spec and the live app disagree.  
> This file is the Rules Center / Fantasy admin **implementation spec** (layout, states, acceptance).  
> Visual language, IA, and copy rules are summarized in `PRODUCT.md` so new features do not need this whole document.

## Design and implementation specification

### Project context

- Repository: `https://github.com/RandomStatsGuy/ScoreSense.git`
- Target branch: `develop`
- Reference implementation: draft PR `#193`, `agent/ui/fantasy-rules-center`
- Initial viewport scope: desktop and laptop
- Required theme: dark mode

This document defines the intended product experience. Preserve existing business rules and API compatibility unless this specification explicitly changes them.

---

## 1. Product vision

Make league setup feel like designing a league, not editing a database.

A commissioner should be able to understand the league's financial and roster model at a glance, confidently change a rule, and immediately see what that rule means in practice. A manager should be able to inspect the same rules without needing commissioner access or decoding internal terminology.

The experience should be, in this order:

1. Fun and inviting.
2. Easy to use.
3. Clear about what matters now.
4. Selective about how much information appears at once.
5. Respectful of an experienced fantasy player's intelligence.

“Fun” should come from satisfying interaction, useful previews, strong visual rhythm, and the feeling of running a real league. Do not add decorative noise, excessive animation, or patronizing tutorial copy.

---

## 2. Problems to solve

The existing commissioner area combines unrelated jobs—chat, contracts, salary sheets, membership, access, imports, and rules—inside one administrative page. This causes three core UX problems:

1. **The information architecture reflects implementation boundaries instead of user goals.** A commissioner thinks “change our contract rules” or “manage a roster,” not “open the commissioner tool and search through tabs.”
2. **Priority is visually flat.** Rules, explanations, alerts, and rare administrative actions receive similar weight, so the user must parse the entire page before acting.
3. **Configuration lacks consequence and context.** A raw number such as `5` does not clearly communicate “a $10 extension becomes $10 / $15 / $20.” Users need immediate examples without being over-explained.

The redesign must separate policy, roster operations, analysis, and conversation into distinct product roles.

---

## 3. Information architecture

### Global navigation

Rename the three primary product areas to:

1. **Projections**
2. **Fantasy**
3. **Tools**

Use **Fantasy** as the umbrella for connected leagues, league play, roster management, cap work, and commissioner configuration. Do not use “League” as the global product-area label, because it describes an object rather than the complete fantasy-management experience.

### Fantasy navigation

Organize the Fantasy navigation around user intent:

| Destination | Purpose | Audience |
|---|---|---|
| Home | Current league state and next actions | Everyone |
| Players | League-aware player exploration | Everyone |
| Draft | Live and pre-draft work | Everyone |
| This Week | Weekly decisions | Everyone |
| My Team | Personal roster decisions | Everyone |
| Rosters | League-wide roster reference | Everyone |
| Cap | Personal and league cap planning | Everyone |
| Trades | Trade construction and review | Everyone |
| Rules | Read or edit the league model | Everyone; edit for commissioners |
| Roster management | Contracts, salary sheets, membership, access, and imports | Commissioners and co-commissioners |
| Insights | League-level analysis | Everyone, subject to existing permissions |

Replace the old **Commissioner** destination with three clearer concepts:

- **Rules**: league policy and configuration.
- **Roster management**: operational and administrative work.
- **Insights**: analysis and decision support.

Rules should remain visible to ordinary managers in read-only form. Hiding rules from non-commissioners makes the league harder to understand and forces commissioners to explain settings elsewhere.

Roster management should only appear for users with commissioner or co-commissioner permission. If a non-commissioner opens an old or direct roster-management URL, redirect them to Rules or a safe Fantasy landing page.

### Backward-compatible routes

- Keep old URLs functional where practical.
- Redirect the old Commissioner landing route to the primary Roster management tab.
- Redirect the old full-page chat route to a useful Fantasy destination because chat is now persistent.
- Preserve API endpoint names when renaming would break existing clients; update user-facing language independently.

---

## 4. Rules Center: page purpose

The Rules Center is the canonical place to understand how the league works.

It must answer four questions without requiring the user to open multiple panels:

1. What kind of league is this?
2. How do contracts grow and expire?
3. How must rosters be built?
4. What will change if I save these settings?

### Commissioner mode

Commissioners can edit, validate, and save rules.

### Member mode

Members see the same layout and examples, but all controls are read-only. Use a calm label such as **Commissioner managed** rather than an error-like warning. Do not show disabled controls without explanation.

### Change semantics

Contract-policy changes apply to **new contracts only** unless the product explicitly offers a separate migration flow.

This rule must be visible near the contract controls and in the save summary:

> Changes shape new contracts. Existing signed deals keep their current schedules unless a commissioner performs a separate roster edit or migration.

Never silently rewrite existing contract schedules when a global rule changes.

---

## 5. Rules Center: desktop layout

Use a two-column editorial layout rather than a full-width settings form.

### Main column

The main column contains four focused sections:

1. League foundation
2. Contract lifecycle
3. Roster construction
4. Draft behavior

### Summary rail

The right rail is sticky within the viewport and contains:

- league format
- salary cap
- rookie contract summary
- veteran contract summary
- extension policy
- roster size
- validation state
- primary Save action

At laptop widths where a fixed rail makes the content cramped, move the summary below the hero or use a compact sticky footer. Do not squeeze the main form into narrow, multi-line control rows.

### Hero

Recommended structure:

- Eyebrow: `League rules`
- Heading: `Rules everyone can plan around.`
- Supporting copy: `Set the financial and roster model once, then let every manager see exactly how the league works.`
- Status chip: `Editing` or `Commissioner managed`

The hero should establish confidence and purpose. Avoid generic headings such as “Settings” or “Configuration.”

---

## 6. Section specifications

### 6.1 League foundation

Show common, high-impact settings first.

Controls:

- League name
- Season
- Salary cap
- Draft format
- Risk or bidding behavior, when applicable

Interaction guidance:

- Use direct labels, short support text, and visible units.
- Render currency inputs with a `$` prefix.
- Do not use a select when there are only two or three mutually exclusive choices and cards or segmented controls make the distinction clearer.
- When draft format changes, update dependent summaries immediately.

### 6.2 Contract lifecycle

This is the centerpiece of the page.

Required controls:

| Rule | Recommended control | Meaning |
|---|---|---|
| Maximum extension length | Stepper or compact select | Longest extension a manager may choose |
| Annual salary step-up | Currency input | Amount added in each later contract year |
| Rookie contract length | Stepper or compact select | Default number of years for new rookie deals |
| Average/default veteran contract length | Stepper or compact select | Default number of years for new veteran deals |
| Rookie salary behavior | Toggle | Static each year or increases by the league step-up |
| Rookie extensions | Toggle | Whether a final-year rookie may receive one extension |
| Veteran extensions | Toggle | Whether an eligible veteran may be extended |
| Cut refund | Percentage input | Salary relief when a player is cut |

Use policy toggles with a title and one sentence of consequence. Do not place bare checkboxes next to internal field names.

Example toggle copy:

- **Keep rookie salary static** — `A rookie keeps the same cap hit in every year of the initial deal.`
- **Allow one rookie extension** — `A final-year rookie may move onto one extension before free agency.`
- **Allow veteran extensions** — `Eligible final-year veteran deals may be extended under the same term limit and step-up.`

#### Live contract preview

Always show a simple schedule preview using a clearly labeled sample starting salary, such as `$10`.

Example with a three-year term and a `$5` step-up:

| Contract | Year 1 | Year 2 | Year 3 |
|---|---:|---:|---:|
| Static rookie | $10 | $10 | $10 |
| Stepped rookie | $10 | $15 | $20 |
| Veteran | $10 | $15 | $20 |

Update the preview as the user changes term length, step-up, or rookie salary policy. The preview should explain consequences more effectively than another paragraph of help text.

Label the sample clearly so it is not mistaken for a mandatory rookie salary.

### 6.3 Roster construction

Show:

- Maximum roster size
- Position minimums
- Position maximums

Positions should include all supported league positions, including QB, RB, WR, TE, K, and DEF when applicable.

Use a compact position matrix with one row per position and aligned Min/Max controls. Keep the player-position label visually dominant. Do not turn this into a dense spreadsheet.

Validation rules:

- Minimum cannot be negative.
- Maximum cannot be lower than minimum.
- Sum of position minimums cannot exceed roster size.
- A position maximum cannot exceed roster size.
- Roster size must remain within backend-supported bounds.

Show validation near the affected section and summarize the blocking issue near Save. Do not wait for a failed API request to explain an obvious conflict.

### 6.4 Draft behavior

Treat detailed draft/bot behavior as advanced configuration.

- Place it after the core league, contract, and roster model.
- Keep it collapsed by default unless it contains an error or has unsaved changes.
- Use a disclosure label such as **Draft behavior** with a short summary of the current configuration.
- Preserve existing settings and APIs.

Progressive disclosure should reduce initial cognitive load without making advanced controls hard to find.

---

## 7. Save behavior and state design

### Save action

- Use one primary action: **Save rules**.
- Keep it visible in the summary rail or a laptop-safe sticky footer.
- Disable it while saving or when blocking validation errors exist.
- Do not disable it without saying why.

### Unsaved changes

- Mark the page as having unsaved changes after the first real edit.
- Keep a concise summary of what changed when practical.
- Warn before navigating away if changes would be lost.

### Success

Use a contained confirmation such as:

> Rules saved. New contracts and future league actions will use this model.

Do not use a disruptive modal for normal success.

### Failure

- Preserve the user's edits.
- Show a specific error near Save.
- Also associate field-level errors with the relevant controls.
- Never reset the form after a failed request.

### Preset reset

Resetting to a preset can overwrite multiple choices. Put it behind a disclosure or secondary action and explain exactly what will reset before applying it.

---

## 8. Persistent Fantasy chat

Chat should be a persistent utility, not a commissioner page.

### Placement

- Show a compact **League chat** trigger at the bottom-right of shared Fantasy pages.
- Open chat in a right-side drawer above the current page.
- Keep the drawer mounted while users move among Fantasy destinations so conversation feels continuous.

### Visibility

- Show only when a real shared league is selected.
- Hide for solo or unconnected contexts.
- Hide in a live draft room if that room already has an integrated chat surface; do not create two competing chat interfaces.

### Drawer behavior

- Trigger exposes open/closed state with `aria-expanded`.
- Trigger points to the drawer with `aria-controls`.
- Drawer uses an accessible name.
- Escape closes the drawer.
- Closing returns focus to the trigger.
- The close button receives focus when the drawer opens.
- Preserve existing league/staff channel permissions.

Recommended copy:

- Overline: `League conversation`
- Title: selected league name or `League chat`
- Supporting text: `Stays with you while you move through Fantasy.`

Do not reserve an entire page-sized empty panel for chat.

---

## 9. Roster management workspace

Roster management is operational, not conversational and not analytical.

Recommended tabs:

1. **Contracts**
2. **Salary sheets**
3. **Members**
4. **Access & imports**

Remove Chat from this workspace. Keep day-to-day personal roster decisions in My Team and Cap. Use Roster management for league-wide actions that require elevated permission.

The landing tab should be Contracts, not an empty dashboard or chat room.

Use plain-language boundaries in the introduction:

> League-wide roster operations live here. Personal lineup, trade, and cap decisions stay in My Team, Trades, and Cap.

---

## 10. Visual design language

The site remains dark mode, but the redesign should move away from sharp, thin-line, neon-heavy “terminal” styling.

### Desired character

- Matte rather than glossy
- Editorial rather than technical
- Layered rather than outlined everywhere
- Confident rather than loud
- Sports-product energy without casino aesthetics

### Surfaces

- Use a deep navy page background.
- Build hierarchy through slightly lighter matte surfaces.
- Reserve borders for grouping and interactive state; do not outline every nested element equally.
- Use medium-to-large corner radii consistently.
- Use restrained, soft shadows to lift sticky or floating elements.

### Color

- Keep the site's blue as the primary action color.
- Use teal/green for healthy, active, or saved states.
- Use amber for attention and validation warnings.
- Use red only for destructive actions and blocking errors.
- Avoid neon glows on ordinary cards and controls.

### Typography

- Preserve the existing brand type system unless a broader typography project is authorized.
- Create hierarchy through size, weight, spacing, and contrast rather than all-caps labels everywhere.
- Use compact uppercase eyebrow labels sparingly.
- Keep explanatory text readable; do not reduce it to faint microcopy.

### Spacing

- Prefer fewer, larger groups over many small bordered boxes.
- Use consistent section padding and clear vertical rhythm.
- Keep labels close to their controls and explanatory copy subordinate but readable.

### Interaction

- Use subtle 120–200 ms transitions for drawers, toggles, hover lift, and schedule-preview updates.
- Respect `prefers-reduced-motion`.
- Do not add sound to settings or navigation. Audio may be appropriate in live draft experiences, but only as an explicit opt-in preference.

This visual language also applies to Fantasy **Draft** (idle entry), **This Week**, and **Cap**. Live draft rooms keep a board-first layout and do not inherit the two-column settings chrome.

---

## 11. Data model and behavior

The rules payload should support at least the following concepts:

```json
{
  "salary_cap": 200,
  "draft_type": "auction",
  "contracts": {
    "max_years": 3,
    "extension_step_up": 5,
    "rookie_years": 2,
    "veteran_years": 2,
    "rookie_salary_static": true,
    "one_renewal_after_rookie": true,
    "allow_veteran_renewal": false,
    "cut_refund_pct": 0
  },
  "roster_size_max": 27,
  "roster_min": {
    "QB": 2,
    "RB": 4,
    "WR": 4,
    "TE": 1,
    "K": 0,
    "DEF": 0
  },
  "roster_max": {
    "QB": 4,
    "RB": 8,
    "WR": 8,
    "TE": 3,
    "K": 2,
    "DEF": 2
  }
}
```

Use the repository's actual canonical field names if they differ. Do not create parallel aliases for the same rule unless required for backward compatibility.

### Backward compatibility

Older saved leagues will not contain every new field. Deep-merge defaults instead of replacing the full rules object.

Recommended defaults should preserve existing ScoreSense behavior:

- veteran contract length: existing default term
- rookie salary static: `true`
- veteran extensions: `false`
- rookie extension permission: preserve existing default

### Operational propagation

Rules must affect real league behavior, not only page copy.

Verify that the contract configuration is used by:

- new auction award contracts
- rookie and veteran classification
- roster creation and roster edits
- imports that materialize contracts
- cap planner schedule projections
- contract extension eligibility
- extension term validation
- contract preview and explanatory copy

If veteran extensions are disabled, both frontend and backend must block them. If enabled, both must allow eligible final-year veteran deals under the configured maximum term and step-up.

### Contract schedule behavior

- Static rookie: same salary in each initial rookie-contract year.
- Stepped rookie: initial salary plus the configured step-up in each later year.
- Veteran: initial salary plus the configured step-up in each later year.
- Extension: current or server-calculated starting salary, then configured step-up.

Do not “repair” an explicitly stepped rookie schedule back to flat during reads. Continue repairing only genuinely stale or malformed legacy schedules.

### Player acquisition windows

The Players tab is not a year-round add shortcut. League adds follow the calendar:

| Window | Add behavior | Trades |
|---|---|---|
| Pre-draft | Locked — use the draft | Currently rostered players |
| Live draft | Locked — use the draft room | Mid-draft trades |
| Post-draft FA (NFL preseason) | Highest-bid FAAB, same as auction leftovers | Active roster |
| In-season waivers (Tue 00:00 ET–Wed 10:00 ET) | Highest-bid FAAB, same process as post-draft FA | Active roster |
| In-season after waivers | Instant add | Active roster |
| Offseason | Locked | Only contracts that continue beyond the upcoming draft |

Commissioner Roster management may still staff-edit contracts. Players-tab adds never send that override.

---

## 12. Required states and edge cases

Design and test all of these states:

- Loading rules
- Commissioner editing
- Member read-only
- No connected league
- Unsaved changes
- Save in progress
- Save success
- Save failure
- Invalid contract terms
- Invalid position minimum/maximum pair
- Position minimum total exceeds roster size
- Missing newly introduced fields in a legacy league
- Auction, snake, and linear formats
- Shared league with persistent chat
- Solo league without persistent chat
- Live draft room with its own chat
- Direct navigation to a commissioner-only route by a non-commissioner
- Players tab locked / bid / instant-add windows
- Mock draft player photos matching roster photos

The page must degrade safely if a rule is missing. It must never crash because an older league lacks `veteran_years` or `rookie_salary_static`.

---

## 13. Accessibility requirements

- Every field has a programmatic label.
- Supporting text is connected with `aria-describedby` where useful.
- Errors are associated with affected controls.
- Toggle state is conveyed semantically, not by color alone.
- Read-only state is explicit.
- Keyboard order follows the visual flow.
- The sticky summary does not trap focus or cover controls.
- Chat focus moves predictably on open and close.
- Text and controls meet WCAG AA contrast.
- Touch targets remain at least 44 px where a control may be used on a touch laptop.
- Motion respects `prefers-reduced-motion`.

---

## 14. Desktop and laptop responsiveness

Validate at minimum:

- 1440 px wide desktop
- 1280 px wide laptop
- 1024 px wide laptop/tablet landscape

Requirements:

- No horizontal page scrolling.
- Main labels and values do not truncate at normal widths.
- Summary rail remains useful without narrowing the form excessively.
- Primary Save action remains visible or easy to reach.
- Persistent chat does not cover Save, validation, or critical navigation.
- Position matrix remains legible.
- Navigation labels remain understandable; use controlled overflow or a compact menu before compressing text into unreadable widths.

Mobile is a later phase. Do not compromise desktop hierarchy by prematurely forcing every control into a phone-like single column at all widths.

---

## 15. UX copy principles

- Name the user goal, not the internal system.
- Explain consequence, not implementation.
- Keep labels short and support text specific.
- Avoid talking down to experienced commissioners.
- Avoid unexplained abbreviations in configuration pages.
- Avoid vague verbs such as “Manage” when a more specific destination exists.

Preferred examples:

- `Maximum extension` instead of `Max yrs`
- `Annual salary step-up` instead of `Step`
- `Keep rookie salary static` instead of `Static rookies`
- `Roster management` instead of `Commissioner`
- `Save rules` instead of `Submit`
- `Commissioner managed` instead of `You do not have permission`

---

## 16. Analytics and observability

Update page titles and analytics grouping to use Fantasy terminology.

Track only meaningful product events, such as:

- Rules page viewed
- Rules save attempted/succeeded/failed
- Contract policy changed
- Advanced draft behavior expanded
- Persistent chat opened
- Roster management tab selected

Do not emit analytics for every numeric keypress.

Backend validation errors should be observable with enough context to diagnose the rule category, but logs must not expose private chat content or credentials.

---

## 17. Acceptance criteria

### Navigation

- Global navigation reads Projections, Fantasy, Tools.
- Commissioner is no longer a catch-all top-level Fantasy destination.
- Rules, Roster management, and Insights have distinct purposes.
- Rules are readable by non-commissioners.
- Roster management is restricted to authorized staff.
- Old routes redirect safely.

### Rules Center

- Commissioner can edit salary cap, contract lengths, step-up, rookie salary behavior, extension permissions, cut refund, roster size, and position bounds.
- Changes are validated before save.
- A live schedule preview updates as contract settings change.
- The page clearly states that policy changes affect new contracts rather than silently rewriting existing deals.
- The summary rail accurately reflects the form.
- Member mode is understandable and fully read-only.
- Advanced draft behavior does not dominate the landing view.

### Contract behavior

- New rookie and veteran contracts use configured lengths.
- Rookie contracts are flat or stepped according to policy.
- Extension length is bounded by the configured maximum.
- Veteran extension eligibility follows the league toggle in both frontend and backend.
- Cap previews match materialized contract schedules.
- Legacy league rules receive safe defaults.

### Chat

- League chat is available across shared Fantasy pages.
- Chat is not a full-page commissioner tab.
- Chat does not duplicate the live draft room's integrated chat.
- Drawer keyboard and focus behavior works correctly.

### Players, photos, and editorial pages

- Players-tab adds follow the acquisition window (bid during waivers / post-draft FA; instant add after waivers; locked in offseason and pre-draft).
- Offseason trades are limited to contracts that continue beyond the upcoming draft.
- Mock draft boards, nominee cards, and player rails show the same headshots as rosters.
- Draft (idle), This Week, and Cap use the editorial hero + sticky summary language from this document.

### Visual quality

- The page feels matte, layered, and design-forward in dark mode.
- Primary action and current state are obvious within a few seconds.
- The interface does not rely on a field of thin neon outlines.
- Normal desktop and laptop widths have no clipping or horizontal overflow.

---

## 18. Verification checklist

### Frontend tests

- Default merging for legacy rules
- Contract schedule preview for flat and stepped rookies
- Rules summary formatting
- Contract and roster validation
- Permission-based Fantasy navigation
- Rules and Roster management route round-trips
- Persistent chat visibility rules
- Chat open/close keyboard behavior
- Old Commissioner route redirect
- Players-tab add/bid/lock copy
- Mock-draft enrichment player hints

### Backend tests

- Schema defaults for new contract settings
- Preset serialization and load
- Auction contract term length
- Static rookie schedule
- Stepped rookie schedule
- Veteran contract schedule
- Rookie extension disabled/enabled
- Veteran extension disabled/enabled
- Configured maximum extension term
- Read-path preservation of explicitly stepped rookie contracts
- Acquisition windows and FAAB awards
- Offseason surviving-contract trade lock

### Build and visual QA

Run the repository's normal checks, including:

```text
PYTHONPATH=. python -m pytest tests/ -q
cd frontend && npm run build
```

Then visually inspect:

1. Commissioner Rules Center at 1440 px.
2. Commissioner Rules Center at 1024 px.
3. Member read-only Rules Center.
4. Flat rookie schedule preview.
5. Stepped rookie schedule preview.
6. Roster validation error.
7. Save success and failure.
8. Persistent chat open and closed on multiple Fantasy pages.
9. Roster management permissions and tabs.
10. Auction, snake, and linear league summaries.
11. Draft idle, This Week, and Cap editorial layout.
12. Players tab locked / bid / add states.
13. Mock draft player photos.

Use the live DOM to confirm labels, focus, disabled state, overflow, sticky behavior, and route transitions. Screenshots alone are not sufficient for interaction verification.

---

## 19. Implementation guidance

Prefer a small set of reusable, testable concepts:

- a pure helper that deep-merges league-rule defaults
- a pure validator for cross-field rule conflicts
- a pure contract-schedule preview helper
- a pure summary formatter
- one persistent Fantasy chat component
- centralized route/nav configuration for Rules and Roster management
- a shared experience hero + sticky summary for Draft, This Week, and Cap
- a pure acquisition-window helper for Players-tab add/bid/lock copy

Do not scatter permission checks, max-year constants, or `rookie_salary_static` fallbacks across many components. Derive them from canonical rules and pass them to presentation components.

Keep UI concerns separate from contract calculations. The backend remains authoritative for eligibility and materialized schedules; the frontend preview should mirror that logic and be covered by tests.

---

## 20. Definition of done

This redesign is complete when a commissioner can open Fantasy → Rules, understand the league model without prior instruction, adjust contract and roster policy with immediate examples, save valid settings confidently, and see those settings reflected in real contract behavior. A regular manager can inspect the same model without administrative access. Roster operations have a clear home, Insights remain analytical, and league chat follows the user without taking over the page.

Draft, This Week, and Cap should feel like the same product as Rules: editorial, matte, and consequence-first. Players-tab adds should follow the league calendar. Mock drafts should show the same player photos as rosters.

The result should feel like running a league—not maintaining a configuration file.
