# Tools roadmap (DFS, mock draft, later modes)

Shipped **Tools** tabs: **DFS**, **Mock draft**, and **Best ball**. Product names and chrome: [PRODUCT.md](./PRODUCT.md).

DFS today: **season-long PPR**, **classic** (DraftKings / FanDuel), and **single-game captain modes** (DK Showdown CPT, FD Single game MVP) with salary CSV / slate import, cap constraints, QB stacks (+1/+2) with bring-backs, team limits, minimum spend, multi-lineup runs up to 150 with exposure caps and randomness, a Vegas board (spread / total / implied totals), and site-ready upload CSV exports. Do not describe those as unbuilt.

Props are backlog — not top-level nav. Do not add them as a fourth product area.

## Current

| Mode | Roster | Salary | Objectives |
|------|--------|--------|------------|
| Season-long PPR | 1 QB · 2 RB · 2 WR · 1 TE · 1 FLEX | None | Proj / floor / ceiling |
| DraftKings Classic | 9 (incl. DST) | $50,000 default | + value (pts/$1k) |
| FanDuel Classic | 9 (incl. DST) | $60,000 default | + value (pts/$1k) |
| DraftKings Showdown | CPT (1.5× pts, 1.5× salary) + 5 FLEX | $50,000 | same |
| FanDuel Single game | MVP (1.5× pts, 1.5× salary) + 5 FLEX | $60,000 | same |

**Salary workflow:** live slate load, or export slate CSV from DK/FD → **Import CSV fallback** on the DFS tab → match to ScoreSense `player_id` via name + team → optimize under cap. Showdown CSVs keep both CPT and FLEX rows (`Roster Position`); live showdown slates pair rows at the 1.5× salary ratio.

**Construction controls:** QB stack Off / +1 / +2, bring-back, team limit, minimum spend, lineup counts 1–150, max overlap, max exposure (locks exempt), randomness jitter.

**Exports:** DraftKings upload CSV (`Name (ID)` cells), FanDuel upload CSV (`Id:Name` cells), captain-mode variants (CPT/MVP column first), plus a detail CSV. Rows paste over the placeholder players in each site's entries template.

**Vegas board:** `/api/lineup/vegas` reads cached nflverse schedules — spread, total, moneylines, implied team totals; implied totals also annotate the player pool.

**DST note:** DST rows come from the salary file with a fixed 7-point projection placeholder until we add a defensive model. Kickers stay unmodeled — showdown lineups fill from QB/RB/WR/TE/DST.

---

## Phase 2 — DFS depth

### Multi-lineup generation — SHIPPED
- N diverse lineups (1–150) with max overlap, exposure caps (locks exempt), and a randomness dial (seeded projection jitter in `optimize_multiple_lineups`).

### Showdown / single-game slates — SHIPPED
- `draftkings_showdown` and `fanduel_single` site configs; captain MILP gives every player CPT and FLEX variables (1.5× points at 1.5× salary), enforces one player from each team.
- Captain rows from salary export `Roster Position` column or the live 1.5× salary pairing.

### Ownership & leverage
- Ingest projected ownership (manual CSV or third-party).
- Objectives: max ceiling at &lt;X% cumulative ownership, or GPP leverage score.

### Live slate API (optional)
- Poll DK/FD salary endpoints where licensed; cache under `data/cache/dfs/`.
- Requires compliance review — CSV import stays the default.

---

## Phase 3 — Season-long league tools

### Roster import
- Sleeper / ESPN / Yahoo league sync (reuse Sleeper integration patterns).
- Lock roster players; optimize remaining flex + waiver adds.

### Bye & schedule constraints
- Block players on bye for selected week. — SHIPPED
- Spread / total / implied team totals are visible (Vegas board + pool column). “Playable %” or game-script hints derived from them remain future work.

### ROS-aware decisions
- Tie into `predict_rest_of_season` for trade/waiver priority, not just weekly start/sit.

---

## Phase 4 — Best ball

Best ball is a different optimization problem: **draft capital allocation** over 18+ rounds, not a weekly lineup.

| Component | Approach |
|-----------|----------|
| Rankings | ScoreSense ROS + draft (`predict_draft_season`) as custom ECR |
| Value vs ADP | Compare model rank to live ADP (FantasyPros ECR cache, Underdog CSV) |
| Portfolio | Exposure limits by player/team; stack preferences (QB+WR same team) |
| Simulation | Monte Carlo season outcomes from weekly projection distributions |

**MVP — SHIPPED:** “Best ball” Tools tab (`/tools/best-ball`, `BestBallBoard.jsx`) — model rank vs ADP edge with position filters, bye weeks, and a rankings CSV export. Backed by `/api/bestball/board`.

**Later:** stack tags, bye concentration warnings for a drafted roster, Monte Carlo sims, and a draft assistant that recommends next pick given roster construction rules (max 3 QB, etc.).

---

## Phase 5 — Prop betting

Props need **market lines** plus **projection tails**, not median weekly points.

| Prop type | Model source | Edge metric |
|-----------|--------------|-------------|
| Passing yards / TDs | QB weekly dist (P10–P90) | P(actual &gt; line) from fitted distribution |
| Rush / rec yards | RB/WR quantile model | Same |
| Anytime TD | Derived from red-zone / TD rate features | Poisson or logistic on TD probability |

**Data:** odds API (The Odds API, etc.) or manual line CSV; store under `data/cache/props/`.

**MVP:** “Prop scan” table — player, market line, model fair line (P50 or derived), edge %, flag when P90 &gt; line for overs.

**Guardrails:** informational only; no auto-bet; clear disclaimer in UI.

---

## Architecture notes

```
lineup_optimizer.py     # MILP core — roster/salary/stack/exposure + captain mode
dfs_config.py           # Site roster templates (classic + showdown/single game)
dfs_salaries.py         # CSV parse + pool join + captain-row collapse
vegas_lines.py          # Vegas board from cached nflverse schedules
bestball_board.py       # Best ball board — model rank vs ADP + bye weeks
integrations/dfs_slates.py  # live slate fetchers (DK public, FD token)
integrations/odds_*.py  # (future) prop lines
frontend/src/dfsExport.js   # DK/FD upload CSV builders
```

New competition modes should add a **site config** + **objective function** + **data adapter**, reusing the same MILP or simulation shell where possible.

---

## Suggested priority

1. ~~DFS multi-lineup + stacks~~ — shipped (exposure, randomness, bring-backs, captain modes).
2. ~~Bye-week blocking~~ — shipped.
3. ~~Best ball board~~ — shipped as a Tools tab; sims and stack tags remain.
4. **Ownership & leverage** — needs an ownership source; next DFS differentiator.
5. **Prop scan** — needs odds data partnership; build after FP/salary pipelines stabilize.
