---
name: mirror-prod-league
description: Mirror the prod Fantasy league (room 0BBESQ) into the local Draft Hub DB. Use when Fantasy UI needs real rosters, cap, trades, or insights, or when the user asks to mirror prod hub data.
---

# Mirror prod league `0BBESQ`

Imports `data/draft_hub/cap_sheet_test.tsv` into the local league with room code `0BBESQ`. Does not deploy anything.

## Run

Linux / Cloud (preferred here):

```bash
./scripts/dev/mirror_prod_hub.sh
# or a different room: ./scripts/dev/mirror_prod_hub.sh ABCD12
```

Windows:

```powershell
.\scripts\dev\mirror_prod_hub.ps1
```

Live Sleeper overlay (only if hub Sleeper credentials work):

```bash
SYNC_SLEEPER=1 ./scripts/dev/mirror_prod_hub.sh
```

Then `scripts/dev/verify_hub_mirror.py` must print teams and a player count `> 0`.

## Rules

- The league row must already exist locally. If the script exits `No league found with room code 0BBESQ`, stop. Do not invent a fake prod league or write production credentials into the repo.
- Default is sheet import only. `--sync-sleeper` / `SYNC_SLEEPER=1` is optional.
- After a successful mirror, Fantasy UI talks to local SQLite. Do not pass `live_sleeper=1` unless the user asked for a one-off live pull.
- Servers: API `:8000`, Vite `:5173`. Open `/hub/home` on room `0BBESQ`.
