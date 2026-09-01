# ScoreSense docs

Start here. **Product, brand, and design rules live in [PRODUCT.md](./PRODUCT.md).** Agents load a compressed copy on every turn via `.cursor/rules/scoresense-core.mdc`. If another file disagrees with `PRODUCT.md`, update the other file.

## Read first

| Doc | Use when |
|-----|----------|
| [PRODUCT.md](./PRODUCT.md) | Any user-facing feature — names, IA, visual language, copy, chrome |
| [design.md](./design.md) | Rules Center / Fantasy admin implementation detail |
| [CONTRACT_SCENARIOS.md](./CONTRACT_SCENARIOS.md) | Contract type, years left, keeper / import cases |

## Product operations

| Doc | Use when |
|-----|----------|
| [ONBOARDING.md](./ONBOARDING.md) | Auth, invites, legal, account email |
| [DRAFT_HUB.md](./DRAFT_HUB.md) | Hub API, SQLite storage, Sleeper link (internal name; UI says Fantasy) |
| [LINEUP_ROADMAP.md](./LINEUP_ROADMAP.md) | Tools backlog — DFS is shipped; props / best ball are not nav |
| [MOBILE_APP.md](./MOBILE_APP.md) | PWA and Android TWA |
| [INJURY_TIMELINE.md](./INJURY_TIMELINE.md) | Heuristic return windows |

## Models

| Doc | Use when |
|-----|----------|
| [EVALUATION.md](./EVALUATION.md) | Backtest and season-long metrics (canonical numbers) |
| [MODEL_FEATURES.md](./MODEL_FEATURES.md) | Production training columns |
| [FEATURE_SCREENING.md](./FEATURE_SCREENING.md) | Candidate promotion gate |
| [SENTIMENT.md](./SENTIMENT.md) | YouTube narrative pipeline |
| [WR_UPSIDE_CALIBRATION.md](./WR_UPSIDE_CALIBRATION.md) | WR P90 / rank lab notes |
| [RB_P90_CALIBRATION.md](./RB_P90_CALIBRATION.md) | RB P90 deploy note |
| [CASE_STUDY.md](./CASE_STUDY.md) | 2024 portfolio write-up — not current product IA |

## Deploy

| Doc | Use when |
|-----|----------|
| [DEPLOY.md](./DEPLOY.md) | Patreon, Docker, SMTP overview |
| [DEPLOY_RENDER.md](./DEPLOY_RENDER.md) | Render Blueprint (`render.yaml`) — Docker web service + persist disk |
| [DEPLOY_CLOUDFLARE_TUNNEL.md](./DEPLOY_CLOUDFLARE_TUNNEL.md) | Production runbook (`app.fourthdownlabs.com`) |
| [DEPLOY_VPS.md](./DEPLOY_VPS.md) | nginx / A-record alternative and PriceBot history |

## Agent entry

Architecture and local commands: `../AGENTS.md`.  
Git branching: `../.cursorrules`.
