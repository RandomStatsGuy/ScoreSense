# ScoreSense — Design Notes

Design reference for the frontend. Source of truth for tokens is
`frontend/src/styles/tokens.css`; the shared shell and component styles live in
`frontend/src/styles.css`. This document describes the *intended* design
language so future work stays cohesive — when in doubt, the token file wins.

---

## 1. Cohesive design language (whole app)

**Direction.** Technical, dense, dark-first "analyst terminal." ScoreSense is a
fantasy-football data tool, not a marketing site. The design earns its keep by
being instantly readable at high information density, not by being spacious or
decorative. `color-scheme: dark` is hard-set on `:root` — there is no light
mode.

### Color

Three structural roles plus meaning-only semantics. Do not introduce new hues.

- **Surfaces** — a single slate ramp (`--slate-950 #0b1220` base →
  `--slate-800 #1e293b` elevated). Panels are translucent layers
  (`--bg-elevated`, `--bg-subtle`) over the base, with low-contrast borders
  (`--border` at ~65% alpha, `--border-strong` for emphasis).
- **One accent** — cool blue (`--accent #3b82f6`, hover `--accent-muted
  #60a5fa`, wash `--accent-soft`, focus `--accent-glow`). It carries every
  interactive state: active tabs, links, focus rings, avatars, quantile bars.
  Nothing else competes with it.
- **Semantic tones (meaning only)** — green `--tone-positive`, red
  `--tone-negative`, amber `--tone-caution`, orange `--tone-mixed`, neutral
  `--tone-neutral`, each with a `-soft` fill and some with `-border`/`-text`.
  Reserved for sentiment, injury, and status — never decoration. Deliberately
  muted ("not neon").
- **Empty / no-data** — `--state-empty-*` is a separate neutral gray so
  "no data yet" (common in the offseason) never reads as a warning.
- **Danger** — `--danger #ef4444` with `-soft`/`-border`, for destructive
  actions only (revoke access, delete).

### Typography

- **One family:** the system UI stack (`system-ui, -apple-system, "Segoe UI",
  Roboto, sans-serif`). No web font — a deliberate performance/native choice.
- **Weight-driven hierarchy:** normal `500`, medium `600`, bold `700`.
- **Compact scale:** `--text-xs .72rem` → `--text-2xl 1.75rem`.
- **Line height:** headings tight (`--line-tight 1.15`), body relaxed
  (`--line-normal 1.45`). Narrative/prose surfaces go a touch looser (~1.55).
- Uppercase micro-labels with letter-spacing for field labels and badges.

### Shape & depth

- Radii: `--radius-sm 8px` (structural), `--radius-md 12px`, `--radius-lg 16px`,
  `--radius-pill 999px` for controls, tabs, chips, and badges.
- Panels use an inset top highlight + soft drop shadow (`--shadow-panel`) for a
  "raised glass" feel. Popovers/sheets go heavier (`--shadow-popover`) with a
  `backdrop-filter: blur`.

### Spacing & sizing

- Spacing scale `--space-xs .35rem` → `--space-xl 1.75rem`.
- Controls: `--control-height 2.25rem` (`-sm 1.85rem`); mobile tap targets
  respect `--touch-target 2.75rem`.

### Motion

- Fast and physical: `--duration-fast .12s`, `--duration-normal .2s`,
  `--duration-slow .32s`; standard easing `cubic-bezier(0.4, 0, 0.2, 1)`.
- Tabs/controls use a springier curve with a `translateY(-1px)` hover-lift and
  `scale(0.98)` press, gated to `hover: hover` pointers so touch stays crisp.

### Layout & responsive

- Centered `1280px` max column, mobile-first.
- Hard fork at `768px` (`--bp-mobile-shell`): desktop shows a pill nav bar +
  inline filter toolbar in a sticky glass header; mobile swaps to `MobileShell`
  with bottom nav and bottom-sheet filters/menus.
- **Z-index is a documented scale** (one source of truth) so overlays never
  trap each other: `--z-base 1` < `--z-sticky 20` < `--z-dropdown 60` <
  `--z-bottom-nav 1100` < `--z-invite 1200` < `--z-sheet 1300` <
  `--z-confirm 1400` < `--z-tooltip 100001`.

### Shared building blocks

- **Sticky glass filter bar** — position segment, week stepper, team filter,
  search. Reused across Projections and Tools.
- **Dense sortable tables** with inline range bars (`QuantileBarShared`) and
  sentiment/injury badges.
- **`PlayerCardModal`** — one canonical player detail overlay, opened from any
  row.
- **`HubTabIntro` / page intro** — title + one-line purpose statement at the top
  of each hub tab.
- **`StandalonePageShell`** — quieter chrome for account/auth/legal pages.

---

## 2. Page-by-page notes

### Projections — Weekly & Season
`WeeklyTable`, `SeasonTable`
The flagship surface and default landing page. Sticky glass filter bar over a
dense sortable table; quantile range bars use the blue accent to visualize
floor / median / ceiling. Sentiment and injury badges ride inline. Row click
opens the shared `PlayerCardModal`. This page sets the table + filter grammar
every other data page follows.

### Draft Hub `/hub/*`
`HubUILayout` and children
The most feature-dense area. A scrollable, grouped subnav (Prep · Season ·
League, split by section dividers) sits under the header. Each tab opens with a
`HubTabIntro`. Green "claimed / live" pill badges signal league-connection
state. Includes `DraftRoom` (live auction), `ValueSheetTable`, `CapPlanner`, and
`LeagueOffice`. Reuses the app-wide table/pill/filter patterns at higher
density.

### League Office `/hub/office/*`
`LeagueOffice`
Role-aware. Filter-chip tabs reveal **Chat** (all members) vs
**Current / Historic / Members** (commissioners only). Utilitarian and
form-heavy: editorial tables for rosters/contracts, invite forms, Sleeper
mapping, and the co-commissioner grant toggle (destructive revoke uses
`--danger`). Same pill controls as the rest of the hub.

### Tools — DFS / Props / Best-Ball / Lineup Optimizer `/tools/*`
`LineupOptimizer` and siblings
Tab-switched tools that reuse the exact table + filter grammar from
Projections, so users move between them without relearning the layout.

### Model / Accuracy `/model`
`AccuracyChart`
The one chart-forward page. Explains model quality with the blue accent on
plots and more narrative prose (looser line-height). Communicates trust rather
than day-to-day lookups.

### Account / Admin / Auth / Legal
`AccountSettingsPage`, `AdminPortal`, `AuthPages`, `Terms`, `Privacy`
Quieter standalone shells (`StandalonePageShell`). Single-column forms, muted
uppercase labels, accent reserved for primary buttons and links. Intentionally
plain — these are settings and legal surfaces, not product showcases.

---

## 3. Working rules

- Use tokens, never one-off hex values. The slate ramp and semantic tones exist
  specifically to replace scattered `#hex` in `styles.css`.
- Keep to the one-accent rule. If something needs to stand out, it's blue; if it
  carries meaning, it's a semantic tone; otherwise it's slate.
- New overlays must slot into the documented `--z-*` scale — don't invent
  arbitrary large z-index values.
- Respect the `768px` fork: verify both the desktop header and the
  `MobileShell` bottom-nav layout when touching shared chrome.
