"""Dump 2024 contract cap analytics (same shape as Insights API)."""
import json
import sys

from src.draft_hub.historic_insights import build_contract_analytics
from src.draft_hub.owner_display import enrich_team_row, team_owner_map_for_league

LID = sys.argv[1] if len(sys.argv) > 1 else "76a70d52-d059-4421-86b2-378d8ebe8381"
YEAR = int(sys.argv[2]) if len(sys.argv) > 2 else 2024

cap = build_contract_analytics(LID, season_year=YEAR, salary_cap=200)
if not cap:
    print("no analytics")
    raise SystemExit(1)

owner_map = team_owner_map_for_league(LID, season_year=YEAR)
teams = [enrich_team_row(t, owner_map, year_specific=True) for t in cap["teams"]]
payload = {**cap, "teams": teams}

print(json.dumps(payload, indent=2))

print("\n--- table ---")
for t in sorted(teams, key=lambda x: -x["committed"]):
    pos = t["spend_by_position"]
    pct = t["pct_by_position"]
    label = f"{t.get('owner_label') or '?'} · {t['team_name']}"
    print(
        f"{label:40} "
        f"QB ${pos['QB']:.0f} ({pct['QB']}%)  "
        f"RB ${pos['RB']:.0f} ({pct['RB']}%)  "
        f"WR ${pos['WR']:.0f} ({pct['WR']}%)  "
        f"TE ${pos['TE']:.0f} ({pct['TE']}%)  "
        f"K ${pos['K']:.0f}  DEF ${pos['DEF']:.0f}  "
        f"tot ${t['committed']:.0f}  dead ${t['dead_cap']:.0f}  unspent ${t['unspent']:.0f}"
    )
