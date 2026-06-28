"""Quick readout after contract history import."""
from __future__ import annotations

import sys
from collections import Counter

from src.draft_hub import storage

lid = sys.argv[1] if len(sys.argv) > 1 else "76a70d52-d059-4421-86b2-378d8ebe8381"

review = storage.list_league_contract_rows(lid, needs_review=True)
ambiguous = [m for m in storage.list_league_movements(lid) if m.get("confidence") == "ambiguous"]

print("=== Summary ===")
print("seasons", storage.list_league_contract_seasons(lid))
print("total rows", len(storage.list_league_contract_rows(lid)))
print("needs_review rows", len(review))
print("ambiguous movements", len(ambiguous))
print()
print("=== Sample needs_review rows (up to 15) ===")
for r in review[:15]:
    print(
        r["season_year"],
        r["owner_label"],
        r["player_name"],
        f"cap={r.get('cap_hit')}",
        r.get("review_reason") or r.get("confidence"),
    )
print()
print("=== Ambiguous movements by season ===")
for k, v in sorted(Counter((m["season_year"], m["event_type"]) for m in ambiguous).items()):
    print(k, v)
print()
print("=== Sleeper-upgraded movements (sample) ===")
upgraded = [m for m in storage.list_league_movements(lid) if "sleeper" in str(m.get("confidence", ""))]
for m in upgraded[:12]:
    print(
        m["season_year"],
        m["event_type"],
        m["player_name"],
        m.get("from_owner"),
        "->",
        m.get("to_owner"),
        m["confidence"],
    )
