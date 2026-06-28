"""One-off: connect all Sleeper teams to a Draft Hub league."""
import sys

from src.draft_hub import storage
from src.draft_hub.league_sleeper_sync import connect_sleeper_league

LEAGUE_ID = "2d7f0566-3122-48ad-af21-6fc109b4c922"
SLEEPER_LEAGUE_ID = "1257419072740544512"
COMM_ROSTER_ID = "9"

if __name__ == "__main__":
    result = connect_sleeper_league(
        LEAGUE_ID,
        SLEEPER_LEAGUE_ID,
        commissioner_sleeper_roster_id=COMM_ROSTER_ID,
    )
    print("connected", result["teams_connected"], "added", result["merge"]["added"])
    overview = storage.league_roster_overview(LEAGUE_ID)
    print("hub teams", len(overview["teams"]))
    for block in sorted(overview["teams"], key=lambda b: b["team"]["name"].lower()):
        t = block["team"]
        print(f"  {t['name']}: {block['player_count']} players")
