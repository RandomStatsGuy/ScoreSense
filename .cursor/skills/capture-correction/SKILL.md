---
name: capture-correction
description: Classify a user correction into persist/skip/ask, assign always|never|usually|rarely, and write one rule line. Use whenever the user corrects the agent, says don’t/never/always/usually/stop/instead, or asks to remember a preference.
---

# Capture a correction

Triggered by `.cursor/rules/correction-capture.mdc` whenever the user corrects you. Run this before treating the correction as chat-only.

## 1. Extract the constraint

Rewrite the correction as one imperative sentence. Drop this-PR details (file names, ticket ids) unless they *are* the rule.

Examples:

| User said | Constraint |
|-----------|------------|
| “Don’t call it Draft Hub” | Never show users the name Draft Hub |
| “For this card, tighter gap is fine” | Use a tighter gap on this card |
| “We usually keep PRs draft until I say ready” | Usually leave PRs draft until the user asks to mark ready |

## 2. Persist, skip, or ask

**Skip** (apply this turn only) when:

- It is a typo, one-off number, or “just this PR / this screen / this once”
- It is a factual bug fix with no reusable convention
- The same rule already exists in `docs/PRODUCT.md` or a `.mdc` — apply the existing line; do not clone it

**Ask** (one question, then stop capturing) when:

- Durable vs one-off is unclear
- The correction contradicts `docs/PRODUCT.md`
- Frequency is ambiguous **and** the wrong choice would change product behavior

**Persist** when it will apply to future tasks: product, brand, copy, chrome, league/contract behavior, performance, git/ops, or how agents work for this repo.

## 3. Frequency

Use exactly one of `always` | `never` | `usually` | `rarely`.

Infer from language first:

| User language | Freq |
|---------------|------|
| always, must, required, every time | `always` |
| never, don’t, do not, stop, no more | `never` |
| usually, default, prefer, most of the time | `usually` |
| rarely, only if, exception, last resort | `rarely` |

If they did not mark frequency:

- Product / brand / safety / contract invariants → `always` or `never`
- Taste, process, or default approach → `usually`

## 4. Scope

Exactly one of:

| Scope | Use for |
|-------|---------|
| `product` | Names, IA, tokens, copy, chrome, league policy |
| `fantasy-ui` | Fantasy / Tools UI structure |
| `projections` | Models, eval, artifacts |
| `perf` | Caches, hot paths |
| `ops` | Git, CI, deploy, environment |
| `agent` | How agents work in this repo |

## 5. Where to write

Write **one line**. Same change as the fix when you are already editing.

| Persist when | Write to |
|--------------|----------|
| `always` / `never` + `product` (new name, token, destination, pattern) | `docs/PRODUCT.md` and the compressed line in `.cursor/rules/scoresense-core.mdc` |
| Chrome / “match this page” / living component | `frontend/src/livingSurfaces.js` (update the row). Follow `.cursor/skills/match-living-surface/SKILL.md` |
| `always` / `never` + `fantasy-ui` | `.cursor/rules/frontend-draft-hub.mdc` |
| `always` / `never` + `projections` | `.cursor/rules/ml-projections.mdc` |
| `always` / `never` + `perf` | `.cursor/rules/draft-hub-performance.mdc` |
| `always` / `never` + `ops` (git/PR) | `.cursorrules` |
| `usually` / `rarely` (any scope) | `.cursor/rules/learned-rules.mdc` catalog table |
| `always` / `never` + `agent` | `.cursor/rules/correction-capture.mdc` or the learned-rules table if it is a default, not a hard process |

Also update `tests/test_product_constitution.py` (or the matching test) when the line is a user-facing name or destination.

Do not add a fourth always-on essay. If `learned-rules.mdc` would exceed 30 data rows, promote the oldest `always` / `never` rows into domain files and delete those rows first.

## 6. Catalog row format

Append one markdown table row to `.cursor/rules/learned-rules.mdc`:

```markdown
| usually | agent | Prefer one-line rules and tests over new long docs |
```

Allowed `Freq` values: `always`, `never`, `usually`, `rarely`.  
Allowed `Scope` values: `product`, `fantasy-ui`, `projections`, `perf`, `ops`, `agent`.  
`Rule` is one sentence. No pipes inside the rule.

## 7. Apply it now

After classifying, follow the frequency table in `.cursor/rules/learned-rules.mdc` for the rest of this turn. Then reply with **Captured**, **Not a rule**, or **Need a call** as required by `.cursor/rules/correction-capture.mdc`.
