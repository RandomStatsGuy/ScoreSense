"""Canonical player identity and transactional capacity in rolling-priority claims."""
from datetime import datetime, timedelta, timezone
import json

import pytest

from src.draft_hub import fa_market, priority_waivers as waivers, storage
from src.draft_hub.schemas import LeagueRules

MAHOMES = "00-0033873"
WINDOW = "2026-w2-waiver"


@pytest.fixture(autouse=True)
def pregame(monkeypatch):
    monkeypatch.setattr("src.core.schedule_utils.current_projection_week", lambda *a, **k: 1)
    monkeypatch.setattr("src.draft_hub.hub_scoring._utcnow", lambda: datetime(2026, 9, 1, tzinfo=timezone.utc))
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_game_started", lambda *a, **k: False)
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_week_slate_complete", lambda *a, **k: False)
    monkeypatch.setattr("src.draft_hub.league_live_scoring.get_nfl_state", lambda *a, **k: {"season": 2026, "week": 1, "season_type": "regular"})


@pytest.fixture
def league_pair(hub_db, trusted_native_catalog):
    trusted_native_catalog("4046", name="Patrick Mahomes", position="QB", team="KC", gsis_id=MAHOMES)
    trusted_native_catalog("4984", name="Josh Allen", position="QB", team="BUF", gsis_id="00-0034857")
    trusted_native_catalog("wr-one", name="One WR", position="WR", team="KC")
    rules = LeagueRules(draft_type="snake", roster_size_max=2,
                        roster={"qb": {"max": 1, "starter": 1}, "wr": {"max": 1, "starter": 1}})
    league = storage.create_league("priority-home", "Integrity", 2026, rules, team_count=2)
    home = storage.get_team_by_user(league["id"], "priority-home")
    away = storage.join_league("priority-away", league["room_code"], "Away")
    waivers.confirm_waiver_priority(league["id"], [home["id"], away["id"]])
    return league, home, away, rules


def claim(pid="4046", position="QB", **extra):
    return {"player_id": pid, "player_name": "Submitted", "team": "DET", "position": position, **extra}


def submit(league, team, claims, window=WINDOW):
    return waivers.replace_claims(league_id=league["id"], team_id=team["id"], window_id=window,
                                 claims=claims, user_sub=team["user_sub"])


def legacy_claim(league, team, pid, position="QB"):
    with storage.get_conn() as conn:
        conn.execute("""INSERT INTO waiver_claim
        (id,league_id,season,window_id,team_id,player_id,player_name,nfl_team,position,claim_rank,status,user_sub,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,1,'open',?,?,?)""", (str(team["id"])+pid, league["id"],2026,WINDOW,team["id"],pid,
                  "Submitted","DET",position,team["user_sub"],storage._utcnow(),storage._utcnow()))


def test_pick_leagues_keep_priority_acquisition_and_no_bid_spend(league_pair):
    league, home, _, _ = league_pair
    with pytest.raises(ValueError, match="priority waiver claims"):
        fa_market.place_fa_bid(league_id=league["id"], team_id=home["id"], player_id="4046", player_name="Mahomes",
                              position="QB", team="KC", bid_amount=100, window_id=WINDOW,user_sub=home["user_sub"])
    submit(league, home, [claim()])
    result = waivers.process_claims(league["id"], WINDOW)
    row = storage.get_roster_slot(storage.roster_workspace_for_league(league), MAHOMES)
    assert result["awarded_count"] == 1 and row["salary"] == 0 and row["contract_years"] == 1
    assert storage.list_fa_bids(league["id"], status=None) == []


def test_claim_rejects_wrong_position_foreign_team_and_duplicate_aliases(league_pair):
    league, home, away, rules = league_pair
    for rows in ([claim(position="WR")], [claim(), claim(MAHOMES)]):
        with pytest.raises(ValueError, match="position does not match|unique player"):
            submit(league, home, rows)
    foreign = storage.create_league("foreign", "Other", 2026, rules,team_count=1)
    with pytest.raises(ValueError, match="does not belong"):
        submit(league, storage.get_team_by_user(foreign["id"], "foreign"), [claim()])
    assert waivers.list_claims(league["id"], WINDOW) == []


def test_existing_owned_alias_blocks_a_claim(league_pair):
    league, home, away, _ = league_pair
    storage.add_roster_slot(storage.roster_workspace_for_league(league),
                           {"player_id": "sleeper-4046", "position": "QB", "salary": 0, "contract_years": 1}, team_id=away["id"])
    with pytest.raises(ValueError, match="available players"):
        submit(league, home, [claim()])


@pytest.mark.parametrize("invalid_first", [False, True])
def test_legacy_alias_claims_compete_by_priority_once(league_pair, invalid_first):
    league, home, away, _ = league_pair
    legacy_claim(league, home, "4046", "WR" if invalid_first else "QB")
    legacy_claim(league, away, MAHOMES)
    result = waivers.process_claims(league["id"], WINDOW)
    winner = away if invalid_first else home
    assert result["awarded_count"] == 1 and result["awarded"][0]["team_id"] == winner["id"]
    rows = storage.list_workspace_roster_slots(storage.roster_workspace_for_league(league))
    assert len(rows) == 1 and rows[0]["player_id"] == MAHOMES and rows[0]["position"] == "QB" and rows[0]["team"] == "KC"
    assert result["priority"][-1] == winner["id"]
    before = storage.list_workspace_roster_slots(storage.roster_workspace_for_league(league))
    assert waivers.process_claims(league["id"], WINDOW)["already_processed"] is True
    assert storage.list_workspace_roster_slots(storage.roster_workspace_for_league(league)) == before


def test_waiver_protection_covers_all_known_aliases(league_pair):
    league, home, _, _ = league_pair
    with storage.get_conn() as conn:
        conn.execute("INSERT INTO waiver_protection VALUES (?,?,?,?,?)", (league["id"],"sleeper-4046",home["id"],
            (datetime.now(timezone.utc)+timedelta(days=7)).isoformat(),storage._utcnow()))
    assert waivers.waiver_protection(league["id"], MAHOMES)
    with pytest.raises(ValueError, match="waiver protection"):
        submit(league, home, [claim()])


def test_award_counts_actual_position_of_legacy_roster(league_pair):
    league, home, _, _ = league_pair
    storage.add_roster_slot(storage.roster_workspace_for_league(league),
                           {"player_id": MAHOMES,"position": "WR","salary": 0,"contract_years": 1},team_id=home["id"])
    submit(league, home, [claim("4984")])
    result = waivers.process_claims(league["id"], WINDOW)
    assert result["awarded_count"] == 0 and "too many QB" in result["failed"][0]["reason"]
    assert storage.get_roster_slot(storage.roster_workspace_for_league(league),MAHOMES)["position"] == "WR"


def test_latest_capacity_failure_preserves_conditional_drop_and_priority(league_pair, monkeypatch):
    league, home, _, rules = league_pair
    workspace = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace,{"player_id":"wr-one","position":"WR","salary":0,"contract_years":1},team_id=home["id"])
    submit(league, home,[claim(drop_player_id="wr-one")])
    original = waivers.waiver_priority
    def changed(league_id):
        result = original(league_id)
        newer = rules.model_copy(deep=True);newer.roster_size_max = 0
        storage.update_league_rules(league_id,newer)
        return result
    monkeypatch.setattr(waivers,"waiver_priority",changed)
    before = storage.list_workspace_roster_slots(workspace)
    result = waivers.process_claims(league["id"],WINDOW)
    assert result["awarded_count"] == 0 and "maximum size" in result["failed"][0]["reason"]
    assert storage.list_workspace_roster_slots(workspace) == before
    assert not waivers.waiver_protection(league["id"],"wr-one")
    assert result["priority"][0] == home["id"]


def test_linked_host_rejects_priority_claim_mutation(league_pair):
    league, home, _, _ = league_pair
    storage.update_league_sleeper_id(league["id"],"external")
    with pytest.raises(ValueError,match="Add players in Sleeper"):
        submit(league,home,[claim()])
    assert waivers.list_claims(league["id"],WINDOW) == []
