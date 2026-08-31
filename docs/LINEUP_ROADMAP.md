# Tools roadmap (DFS, mock draft, later modes)

Shipped **Tools** tabs: **DFS** and **Mock draft**. Product names and chrome: [PRODUCT.md](./PRODUCT.md).

DFS today: **season-long PPR** and **classic** (DraftKings / FanDuel) with salary CSV / slate import, cap constraints, stacks, multi-lineup counts, and Showdown categories in the UI. Do not describe those as unbuilt.

Props and best ball are backlog — not top-level nav. Do not add them as a fourth product area.

## Current (v1)

| Mode | Roster | Salary | Objectives |
|------|--------|--------|------------|
| Season-long PPR | 1 QB · 2 RB · 2 WR · 1 TE · 1 FLEX | None | Proj / floor / ceiling |
| DraftKings Classic | 9 (incl. DST) | $50,000 default | + value (pts/$1k) |
| FanDuel Classic | 9 (incl. DST) | $60,000 default | + value (pts/$1k) |

**Salary workflow:** export slate CSV from DK/FD → **Import salary CSV** on Lineup tab → match to ScoreSense `player_id` via name + team → optimize under cap.

**DST note:** DST rows come from the salary file with a fixed 7-point projection placeholder until we add a defensive model.

---

## Phase 2 — DFS depth

### Multi-lineup generation
- Generate N diverse lineups (exposure caps, max overlap).
- “Randomness” dial: optimize ceiling with jitter or MIP with diversity constraints.

### Showdown / single-game slates
- CPT (1.5× points) + FLEX slots; separate site configs.
- Captain eligibility from salary export `Roster Position` column.

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
- Block players on bye for selected week.
- “Playable %” or game script hints from spread/total (Vegas integration).

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

**MVP:** “Best ball board” tab — sortable by model vs ADP delta, stack tags, bye concentration warnings.

**Later:** draft assistant that recommends next pick given roster construction rules (max 3 QB, etc.).

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
lineup_optimizer.py     # MILP core — roster + salary constraints
dfs_config.py           # Site roster templates
dfs_salaries.py         # CSV parse + pool join
integrations/dfs_*.py   # (future) live slate fetchers
integrations/odds_*.py  # (future) prop lines
analytics/bestball_*.py # (future) ADP delta + sims
```

New competition modes should add a **site config** + **objective function** + **data adapter**, reusing the same MILP or simulation shell where possible.

---

## Suggested priority

1. **DFS multi-lineup + stacks** — highest overlap with existing users on Lineup tab.
2. **Bye-week blocking** — cheap win for season-long mode.
3. **Best ball board** — reuses draft/ROS projections already built.
4. **Prop scan** — needs odds data partnership; build after FP/salary pipelines stabilize.
