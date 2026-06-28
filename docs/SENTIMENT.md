# YouTube Sentiment Features

Beat-narrative signals from curated **team-focused YouTube channels** (Locked On, SB Nation), aggregated to player-week rows in `data/candidates/sentiment_features.parquet`.

## Source registry

| File | Purpose |
|------|---------|
| [`data/sentiment/networks.yaml`](../data/sentiment/networks.yaml) | Network taxonomy and weight multipliers |
| [`data/sentiment/channels.yaml`](../data/sentiment/channels.yaml) | Per-team YouTube channels (`network`, `search_query`, `channel_id`) |
| [`data/sentiment/chat_sports_channels.yaml`](../data/sentiment/chat_sports_channels.yaml) | Chat Sports per-team registry (32 teams; separate from Locked On) |
| [`data/sentiment/niche_routing.yaml`](../data/sentiment/niche_routing.yaml) | Evidence-backed position/team routing from niche discovery |
| [`data/sentiment/beat_writers.yaml`](../data/sentiment/beat_writers.yaml) | Primary beat reporters per team (UI attribution; Phase 3 X ingest) |
| [`data/sentiment/locked_on_channel_ids.json`](../data/sentiment/locked_on_channel_ids.json) | Resolved Locked On UC ids (refreshed via ops script) |

### Network tiers

Effective mention weight: `tier_weight × network_multiplier`

| Network | Tier | Multiplier |
|---------|------|------------|
| Locked On | `reporting` | 1.0 |
| ESPN NFL Nation | `reporting` | 1.0 |
| SB Nation | `fan_analysis` | 0.55 |
| The Athletic | `analysis` | 0.85 |

Tier defaults: `reporting` 1.0, `analysis` 0.85, `fan_analysis` 0.55, `fan` 0.4 (excluded unless `SENTIMENT_INCLUDE_FAN=true`).

## Channel resolution

```bash
# Regenerate channel rows from franchise seeds
python scripts/ops/build_channels_yaml.py

# Fetch Locked On IDs from public @handle pages (no API key)
python scripts/ops/fetch_locked_on_ids.py
python scripts/ops/apply_channel_ids.py

# Or resolve via YouTube Data API search (writes channels.resolved.yaml by default)
python scripts/ops/resolve_youtube_channels.py
python scripts/ops/resolve_youtube_channels.py --apply --network sb_nation
```

Review `channels.resolved.yaml` before `--apply` when using the API resolver.

### Phase 1 ingest (SB Nation + transcripts)

One-shot ops script for SB Nation ID resolution and transcript backfill:

```bash
# Resolve SB Nation placeholders (requires YOUTUBE_API_KEY)
python scripts/ops/sentiment_phase1_ingest.py --resolve-sb-nation --apply-sb-nation

# Full phase 1: resolve (optional) + ingest + transcript backfill (14-day lookback default)
python scripts/ops/sentiment_phase1_ingest.py --apply-sb-nation --lookback-days 14 --transcript-limit 2000
```

Weekly refresh (`src/jobs/weekly_refresh.py`) runs sentiment with `fetch_transcripts=True` and `SENTIMENT_LOOKBACK_DAYS=14` by default.

### Chat Sports team channels

Chat Sports runs 40+ team-branded NFL shows with inconsistent naming (`Raiders Report`, `Vikings Now`, `Bills Breakdown`, etc.). Use the dedicated registry and discovery pipeline:

```bash
# Seed 32 team rows (LV pre-resolved)
python scripts/ops/build_chat_sports_channels_yaml.py

# Discover channel IDs (handle-first via channels.list; falls back to search API)
python scripts/ops/discover_chat_sports_channels.py
python scripts/ops/discover_chat_sports_channels.py --apply

# Phase A: shallow ingest + per-team QB/RB/WR correlation screen
python scripts/ops/screen_chat_sports_channels.py --seasons 2024 2025

# Phase B: deep backfill for a single team (before/after walk-forward eval)
python scripts/ops/chat_sports_team_experiment.py --team MIN --max-pages 80 --transcript-limit 2000
```

Reports: `artifacts/analytics/chat_sports_discovery.json`, `chat_sports_screen.json`, `chat_sports_experiment_{team}.json`.

**Phase A (2024–2025, 32 teams):** Only **LV RB** passed projection lift (`strong`, composite Δ −0.31). LV WR showed correlation only. Shallow ingest did not produce enough player mentions on other teams — queue Phase B before promoting additional niches.

**Phase B — MIN (Vikings Now):** Deep backfill (1,776 videos, full transcripts) raised mention coverage but **did not improve projections**. WR 2025 composite Δ **+0.17** vs Locked On baseline (hurt). MIN QB showed no lift.

**Proven niche:** LV RB via Raiders Report (`promote_to_features: true` on LV row). No league-wide Chat Sports blend.

### League-wide fantasy YouTube channels

Registry: `data/sentiment/fantasy_channels.yaml` (10 channels). Screen via:

```bash
python scripts/ops/screen_fantasy_channels.py --ingest --screen
python scripts/ops/screen_fantasy_channels.py --ingest --networks fantasy_points establish_the_run --max-pages 40
```

**Promoted to features (2024–25 screen):**

| Position | Primary network | Notes |
|----------|-----------------|-------|
| RB | `fantasy_footballers` | ρ=−0.41, p=0.005 |
| WR | `late_round`, `fantasypros_yt`, `reception_perception` | Late-Round p=0.0005; Reception Perception p=0.0495 |
| QB | `fantasy_points` (watch) | Borderline p=0.081 after deep backfill; no projection lift yet |

New channels added: QB List, Underdog Fantasy, Reception Perception. Reports: `artifacts/analytics/fantasy_channel_screen.json`, `fantasy_new_channels_corr.json`.

## Raw content cache

Ingest writes `data/cache/sentiment/raw_content.parquet` with:

- `content_type` (`youtube_video`; later `tweet`, `rss_article`)
- `network`, `tier`, `channel_weight` (tier × network multiplier)

Legacy `raw_videos.parquet` is migrated automatically on first read.

## Publish window (leakage guard)

Videos are mapped to NFL `(season, week)` using team schedule kickoffs:

- A video published in `[prev_game_kickoff, current_game_kickoff)` counts toward **current week** projections.
- Post-game recaps attach to the **following** week.

## Refresh

```bash
python -m src.jobs.sentiment_refresh --season 2025 --week 19
python -m src.jobs.sentiment_refresh --since 2025-12-01
```

Requires `YOUTUBE_API_KEY` in `.env`. Without a key, ingest is skipped.

## Feature columns

Core `yt_*` columns plus network breakdown:

| Column | Description |
|--------|-------------|
| `yt_locked_on_mentions` | Weighted mentions from Locked On |
| `yt_sb_nation_mentions` | Weighted mentions from SB Nation |
| `narrative_source_count` | Distinct networks mentioning player |

## Evaluation

Sentiment columns are **not** merged into production mlready until feature screening passes:

```bash
python -m src.analytics.feature_screen --position wr --with-sentiment
```

### Projection incorporation test (walk-forward)

Compare core model vs core + `yt_*` features on held-out seasons:

```bash
# Backfill historical Locked On uploads (requires YOUTUBE_API_KEY)
python scripts/ops/backfill_youtube_sentiment.py --after 2024-09-01 --max-pages 12 --network locked_on
python scripts/ops/fetch_sentiment_transcripts.py --seasons 2025 --limit 600

# LOO walk-forward eval (writes artifacts/analytics/sentiment_projection_eval.json)
python -m src.analytics.sentiment_projection_eval --position all --seasons 2025
```

**Latest 2025 test (Locked On, partial transcript coverage):**

| Position | Mention coverage | Composite Δ | Verdict |
|----------|------------------|-------------|---------|
| QB | 65% | −0.008 (helped) | inconclusive — promising signal |
| RB | 26% | +0.006 | inconclusive |
| WR | 20% | +0.004 | inconclusive |

QB showed a small upside gain on boom recall (+2.5pp) with flat MAE. RB/WR need more transcript coverage and multi-season LOO before promotion. **Do not blend into live projections yet.**

## UI

Weekly tab:

- **Narrative column** in the projections table — tone badge + sentiment meter (− to + scale) per player.
- **Weekly narrative panel** — toggle **Charts** vs **Player list**:
  - **Charts:** stat cards, tone donut, buzz leaders bar chart, buzz-vs-tone scatter, source breakdown.
  - **Player list:** searchable table with snippets and source badges.

API fields per player: `sentiment_label`, `sentiment_label_text`, `sentiment_summary`, `mention_count`, `snippet`, `sources`.

Video narrative is **read-only** in the Weekly tab unless a source is promoted into the model.

### Offseason / upcoming season (Weekly tab)

When Sleeper reports `season_type: off`, the Weekly tab defaults to the **upcoming season** (e.g. 2026 Week 1):

- Schedule **opponents** and bye weeks from nflverse
- **Sleeper roster overlay** (same as Draft tab)
- Projections labeled **preseason estimate** (prior-year player profiles)

Use the **Draft** tab for full-season totals; Weekly is for slate + per-game context.

## Roadmap

| Phase | Source | Status |
|-------|--------|--------|
| 1–2 | Locked On + SB Nation YouTube | Implemented |
| 3 | Twitter / `@32BeatWriters` | Deferred (`twitter_handle` hooks in beat_writers.yaml) |
| 4 | ESPN / Athletic RSS | Future (`content_type: rss_article`) |
