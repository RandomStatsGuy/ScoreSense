# CI, bots, and what actually protects the VPS

Production is **Vultr + Cloudflare Tunnel** (`app.fourthdownlabs.com`). Vercel is not in that path. GitHub checks should stay cheap so Cursor work is not waiting on previews and review bots.

## What runs when

| Event | What runs | What does not |
|-------|-----------|----------------|
| Draft PR | Nothing required | Actions CI, frontend build |
| Ready PR touching `app/`, `src/`, `tests/`, requirements | `CI` (pytest via `requirements-ci.txt`) | Vercel, VPS deploy |
| Ready PR touching `frontend/` | `Frontend` (`npm ci` + `vite build`) | Vercel |
| Ready PR that is only docs / `render.yaml` / `vercel.json` | No Actions workflow | Vercel, pytest, npm |
| Merge to `develop` | Nothing extra (already paid on the PR) | Second full pytest |
| Push to `master` with app/image changes | `Deploy to VPS` | Docs-only master merges |
| Push to `master` that is only docs/CI/tests | Nothing | Docker rebuild |

Draft → iterate in Cursor → mark **Ready for review** when you want the paid stack. That is the same rule as `.cursorrules`.

## Why Vercel is off

`vercel.json` sets `git.deploymentEnabled: false`. The old `agent/**` / `cursor/**` globs did **not** stop previews on `develop`. Merging `render.yaml` still spawned a Vercel preview of an app Vercel cannot serve (FastAPI + SQLite on Docker). That preview does not protect the VPS and burns build minutes.

## Why CI is slimmer

`requirements.txt` still installs desktop extras for local/legacy tools (`PyQt5`, `pandasgui`, `streamlit`, matplotlib). Backtest plot helpers lazy-import matplotlib/seaborn. Metric helpers and `app.api` do not need them, so pytest can collect on `requirements-ci.txt`. CI caches pip so a ready PR is not a 3-minute Qt install.

## Bots (Cursor dashboard — not in git)

GitHub Actions can skip drafts and paths. **Bugbot, Security, and Approval agents cannot** from this repo alone. They fire when a PR is marked ready.

Set on [cursor.com/dashboard](https://cursor.com/dashboard):

1. **Bugbot** → this repo → **Run only when mentioned** (`bugbot run` / `cursor review`), or **only once per PR**.
2. **Security / Approval automations** → same: mention-only or skip `docs/**`, `render.yaml`, `.github/**`.
3. Do not enable Bugbot on draft PRs.

`.cursor/BUGBOT.md` tells Bugbot to skip docs/ops diffs if it does run.

## Local gate (no GitHub wait)

```powershell
$env:PYTHONPATH="."
.venv\Scripts\python -m pytest tests/ -q
cd frontend; npm run build
```

If those pass, the VPS image will build. Mark the PR ready only when you want a second machine to say the same thing.
