---
name: file-fun-ux-idea
description: Turn a fun ScoreSense UX idea into a SCORE Jira Feature that also improves a fantasy decision. Use for scheduled idea agents, vibe-style features, or when the user asks to add UX ideas to the Jira board.
---

# File a fun UX idea to Jira

Use this when a scheduled Cursor agent (or a human) wants to put a **fun** Fantasy / Tools / Projections idea on the ScoreSense board **without** inventing chrome or a fourth product area.

Project: **SCORE** (`ScoreSense_Product`) at `scoresenseapp.atlassian.net`.  
Cloud id: `3ca7af20-a021-4266-911e-860fd82cc42c`.  
Issue type: **Feature** (id `10047`). Labels: `fun-ux` plus one of `fantasy-ui` | `tools` | `projections`.

## Why this exists

Fun is priority 1 in `docs/PRODUCT.md`, but fun is **consequence and rhythm**, not decoration. An idea that is only a swipe, glow, mascot, or animation does not ship and does not get a ticket.

The prototype for this class of idea is **Vibes** (`hub.vibes`, `/hub/vibes`): Tinder-style start/sit swipes become **aura**, which scales the week projection and suggests a start slate. The joy is watching the slate change.

## Scheduled agent prompt (paste into a Cursor Automation)

```
You are a ScoreSense product agent. File at most two SCORE Jira Features this run.

Read docs/PRODUCT.md, frontend/src/livingSurfaces.js, and .cursor/skills/file-fun-ux-idea/SKILL.md.

Invent ideas that are fun AND change a decision: start/sit, bid, cut, trade, or draft nomination. Prefer extending an existing destination over a new tab.

Do not invent a fourth top-level area. Do not use casino/neon chrome, gold except awards, or a new accent. Do not invent a parallel rules model.

Dedup: JQL project = SCORE AND (summary ~ "…" OR labels = fun-ux). Skip anything already filed.

Each Feature must use the SCORE template (Hypothesis, Impact, Backend, Frontend, Acceptance) and name: destination id, living-surface page, decision changed, interaction, and the consequence the user feels.

Create issues with Atlassian MCP (project SCORE, type Feature, labels fun-ux + area). Do not implement. Do not mark PRs ready.
```

## Gate (all must be true)

1. **Decision** — start/sit, bid, cut, trade accept, or draft nomination changes because of the idea.
2. **Destination** — lives under Projections, Fantasy, or Tools. Reuse a living surface when one already owns the job (`resolveLivingSurfaceFromText`).
3. **Consequence** — the user sees a slate, price, or eligibility change, not confetti.
4. **Chrome** — `HubExperience*` or the row’s existing chrome. Tokens only.
5. **Novel** — not already on SCORE (search Jira) and not a restatement of Vibes unless it extends persistence / lineup apply.

If a gate fails: **do not file**. Write one sentence why, then try another idea.

## Ticket template (required)

Match existing SCORE Features (SCORE-78…SCORE-80). Markdown description:

```markdown
## Hypothesis & Domain Logic
{what the user does} → {number or rank that changes} → {decision that changes}.
Name the living surface (`hub.week`, `hub.vibes`, …) and the files to extend.

## Estimated Impact (Value to the User)
Why this is more fun *and* a better call. One concrete moment (Sunday sit, auction bid, cut).

## Backend/Data Specification
Reuse week/roster/pool caches. No live `predict_*` on a hub hot path.
If personal signal (vibes, watches): say where it persists (local first is fine).
Out of scope: gambling framing, new rules schema, new top-level nav.

## Frontend Specification
Eyebrow + sentence heading + one support line (goal + consequence).
Interaction (swipe, hold, compare). Motion 120–200ms. `prefers-reduced-motion`.
Buttons exist; gesture is not the only path. Same headshots as rosters.
Never show: Draft Hub, Submit, “you do not have permission”.

## Acceptance
- [ ] Decision output is visible without a second destination
- [ ] Empty / demo / loading / error states
- [ ] No new accent; gold is not used for scores
- [ ] Tests on the presentation module and any scoring helper
```

Summary line: `{Area}: {verb the user does} so {decision}`  
Examples: `Fantasy: Swipe start/sit so aura sets a vibe slate` · `Fantasy: Hold a nominee to lock a bid ceiling`

## Cadence and budget

- Scheduled run: **at most 2 Features**. Prefer 1 if the idea is large.
- Skip weeks when the last `fun-ux` ticket is still in progress.
- Do not clone Vibes. Next ideas should be different interactions or a persistence/apply follow-up.
- Leave tickets in **Backlog**. Do not assign unless asked.

## Seed ideas (file only if still novel after JQL)

| Idea | Destination | Decision |
|------|-------------|----------|
| Vibes persist + apply slate on This Week | `hub.vibes` → `hub.week` | Start/sit write |
| Bid-or-pass swipe on Strategy targets | `hub.value` | Auction bid |
| Cut-or-keep hold on Cap overage | `hub.planner` | Cut |
| Two-card compare on This Week (SCORE-4 spirit) | `hub.week` | Start/sit |

## Tools

Atlassian MCP: `getAccessibleAtlassianResources` → `searchJiraIssuesUsingJql` → `createJiraIssue` (`projectKey=SCORE`, `issueTypeName=Feature`, `additional_fields.labels=["fun-ux","fantasy-ui"]`).
