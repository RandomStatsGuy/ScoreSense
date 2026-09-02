---
name: start-local-app
description: Start or confirm the local ScoreSense API and Vite servers. Use when Cloud or Linux agents need the running app, /api/health fails, or port 8000 or 5173 is down.
---

# Start the local app

Do not remirror league `0BBESQ`. The snapshot DB already has it.

## Check

```bash
curl -sf http://127.0.0.1:8000/api/health
curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/
```

## Start if down

From the repo root:

```bash
bash scripts/dev/start_hub_dev.sh
```

That script is idempotent. It writes `.env` only when missing (`AUTH_REQUIRED=false`, `HUB_AUTH_REQUIRED=false`), starts API `:8000` and Vite `:5173` if they are down, then waits.

Open the app at `http://127.0.0.1:5173`. Vite proxies `/api` to `:8000`.

Windows: `.\scripts\dev\start_local.ps1` (API port may be `8014` there).

## Rules

- Do not run `mirror_prod_hub` or `preseason_refresh` to "get the app up."
- Do not start a second stack on another port.
- Leave the servers running when you are done.
- Fantasy UI verify: `.cursor/skills/verify-fantasy-ui/SKILL.md`.
