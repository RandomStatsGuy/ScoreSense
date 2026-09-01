---
name: run-tests
description: Run ScoreSense pytest and frontend node tests. Use before commit, when verifying a change, or when the user asks to run tests, pytest, or frontend tests.
---

# Run tests

From the repo root. Prefer the venv. Always set `PYTHONPATH=.` for Python.

## What to run

Changed `app/`, `src/`, or `tests/` (or you are unsure):

```bash
PYTHONPATH=. .venv/bin/python -m pytest tests/ -q
```

Changed a specific test module or a small area:

```bash
PYTHONPATH=. .venv/bin/python -m pytest tests/test_living_surfaces.py tests/test_product_constitution.py -q
```

Changed `frontend/`:

```bash
node --test frontend/src
```

Local gate before marking a PR ready (same as `docs/CI.md`):

```bash
PYTHONPATH=. .venv/bin/python -m pytest tests/ -q
cd frontend && npm run build
```

On Windows PowerShell, `.venv\Scripts\python` and `$env:PYTHONPATH="."`.

## Rules

- Run targeted tests first. Run the full pytest file only when the change is wide or targeted tests pass and you need the gate.
- Frontend CI is `npm run build`, not a Jest suite. `node --test frontend/src` is the local unit gate.
- Draft PRs skip GitHub Actions. Do not mark ready just to see CI. Use this skill instead.
- If `.venv` is missing, say so. Do not `pip install` the full desktop `requirements.txt` unless asked; CI uses `requirements-ci.txt`.
