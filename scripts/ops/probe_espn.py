import json
import requests

headers = {
    "User-Agent": "Mozilla/5.0",
    "x-fantasy-filter": json.dumps(
        {
            "players": {
                "limit": 100,
                "sortDraftRanks": {"sortPriority": 100, "sortAsc": True, "value": "STANDARD"},
            }
        }
    ),
}
url = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2024/players"
params = {"view": "kona_player_info", "scoringPeriodId": 10}
r = requests.get(url, headers=headers, params=params, timeout=30)
print("status", r.status_code)
if r.ok:
    data = r.json()
    print("keys", data.keys())
    players = data.get("players", [])
    print("n players", len(players))
    if players:
        p = players[0]["player"]
        print("name", p.get("fullName"), "pos", p.get("defaultPositionId"))
        for s in p.get("stats", [])[:5]:
            print(" stat", s.get("scoringPeriodId"), s.get("statSourceId"), s.get("appliedTotal"))
