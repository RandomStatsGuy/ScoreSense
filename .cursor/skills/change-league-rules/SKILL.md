---
name: change-league-rules
description: Change league policy, contracts, FAAB, keepers, or cap rules without a parallel model. Use when editing rules, contracts, acquisition windows, or Rules Center validation.
---

# Change league rules

Do not invent a second rules or contract model.

## Canonical files

| Layer | File |
|-------|------|
| Client merge / validate / preview | `frontend/src/DraftHub/rulesPresentation.js` (`mergeLeagueRules`, `validateLeagueSettings`, `contractSchedule`, `rulesSummary`) |
| UI | `frontend/src/DraftHub/RulesWizard.jsx` — living surface `hub.rules` |
| Copy | same `rulesPresentation.js` |
| Server schema | `src/draft_hub/schemas.py` (`LeagueRules`) |
| Server math | `src/draft_hub/rules_engine.py`, `src/draft_hub/contracts.py` |
| FA / adds calendar | `frontend/src/DraftHub/acquisitionWindow.js` |
| Import / keeper cases | `docs/CONTRACT_SCENARIOS.md` |

Backend is authoritative for eligibility and materialized contracts. The client may preview; it may not persist a shape the server does not validate.

## Product constraints

- Policy changes apply to **new contracts only** unless a migration exists. Say so next to the control.
- Players-tab adds follow `acquisitionWindow.js`. Staff Roster management may override; Players-tab adds may not.
- Static rookies stay flat; veterans / extensions use the configured step-up.
- Offseason trades: surviving contracts only.

## Tests

- Client: `frontend/src/DraftHub/rulesPresentation.test.js` and `acquisitionWindow.test.js`.
- Server: `tests/test_draft_hub_rules.py`.

Then `.cursor/skills/run-tests/SKILL.md` and click Rules + Cap + My team (`.cursor/skills/verify-fantasy-ui/SKILL.md`).
