"""Account atmosphere, team identity, trophy polls, and victory reactions."""

from src.draft_hub import storage
from src.draft_hub.league_atmosphere import (
    can_send_victory_emote,
    detect_image_type,
    locker_players_from_roster,
    matchup_winner_and_loser,
    merge_atmosphere_prefs,
    merge_team_identity,
    tally_poll_votes,
)
from src.draft_hub.presets import load_preset


def test_merge_atmosphere_prefs_defaults_and_rejects_unknown():
    assert merge_atmosphere_prefs(None)["atmosphere"] == "none"
    assert merge_atmosphere_prefs({"atmosphere": "snow"})["atmosphere"] == "snow"
    assert merge_atmosphere_prefs({"atmosphere": "neon-disco"})["atmosphere"] == "none"


def test_merge_team_identity_caps_lockers_and_presets():
    merged = merge_team_identity(
        {
            "photo_preset": "storm",
            "banner_preset": "not-real",
            "room_theme": "locker",
            "locker_player_ids": [f"p{i}" for i in range(12)] + ["p1"],
            "photo_media_id": "../evil",
        }
    )
    assert merged["photo_preset"] == "storm"
    assert merged["banner_preset"] == "navy_stripe"
    assert merged["room_theme"] == "locker"
    assert merged["photo_media_id"] is None
    assert merged["photo_focus"] == {"x": 50.0, "y": 50.0, "zoom": 1.0}
    assert merged["banner_focus"] == {"x": 50.0, "y": 50.0, "zoom": 1.0}
    assert len(merged["locker_player_ids"]) == 8
    assert merged["locker_player_ids"][0] == "p0"


def test_merge_team_identity_clamps_focus():
    merged = merge_team_identity(
        {
            "photo_focus": {"x": -20, "y": 140, "zoom": 9},
            "banner_focus": {"x": "40", "y": "bad", "zoom": 1.4},
        }
    )
    assert merged["photo_focus"] == {"x": 0.0, "y": 100.0, "zoom": 2.5}
    assert merged["banner_focus"]["x"] == 40.0
    assert merged["banner_focus"]["y"] == 50.0
    assert merged["banner_focus"]["zoom"] == 1.4


def test_locker_players_skip_missing_and_cut_rows():
    identity = {"locker_player_ids": ["a", "b", "c"]}
    roster = [
        {"player_id": "a", "player_name": "Josh Allen", "position": "QB", "roster_status": "active"},
        {"player_id": "b", "player_name": "Cut Back", "position": "RB", "roster_status": "cut_before_draft"},
    ]
    lockers = locker_players_from_roster(identity, roster)
    assert [row["player_id"] for row in lockers] == ["a"]
    assert lockers[0]["nameplate"] == "Allen"

    blank = locker_players_from_roster(
        {"locker_player_ids": ["a"]},
        [{"player_id": "a", "player_name": "   ", "position": "QB", "roster_status": "active"}],
    )
    assert blank[0]["nameplate"] == "a"


def test_detect_image_type_accepts_jpeg_and_rejects_empty():
    assert detect_image_type(b"\xff\xd8\xff\xe0rest") == "image/jpeg"
    assert detect_image_type(b"not-an-image") is None
    assert detect_image_type(b"") is None


def test_poll_tally_and_emote_eligibility():
    teams = [{"id": "t1", "name": "Alpha"}, {"id": "t2", "name": "Beta"}]
    tally = tally_poll_votes(
        [
            {"voter_team_id": "t1", "nominee_team_id": "t2"},
            {"voter_team_id": "t2", "nominee_team_id": "t2"},
        ],
        teams,
        viewer_team_id="t1",
    )
    assert tally["viewer_vote"] == "t2"
    assert tally["leader_team_id"] == "t2"
    assert tally["total_votes"] == 2

    matchup = {
        "teams": [
            {"hub_team_id": "t1", "points": 120},
            {"hub_team_id": "t2", "points": 90},
        ]
    }
    assert matchup_winner_and_loser(matchup) == ("t1", "t2")
    assert can_send_victory_emote(from_team_id="t1", to_team_id="t2", matchup=matchup)
    assert not can_send_victory_emote(from_team_id="t2", to_team_id="t1", matchup=matchup)
    tie = {"teams": [{"hub_team_id": "t1", "points": 10}, {"hub_team_id": "t2", "points": 10}]}
    assert not can_send_victory_emote(from_team_id="t1", to_team_id="t2", matchup=tie)


def test_prefs_identity_polls_and_emotes_persist(hub_db):
    comm = "atm-comm"
    member = "atm-member"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Atmosphere League", 2026, rules, workspace_id=ws["id"])
    storage.join_league(member, league["room_code"], "Visitor")
    comm_team = storage.get_team_by_user(league["id"], comm)
    other = storage.get_team_by_user(league["id"], member)

    prefs = storage.update_workspace_prefs(comm, {"atmosphere": "leaves"})
    assert prefs["atmosphere"] == "leaves"
    assert storage.get_workspace_prefs(comm)["atmosphere"] == "leaves"

    identity = storage.update_team_identity(
        comm_team["id"],
        {"photo_preset": "tunnel", "room_theme": "locker", "locker_player_ids": ["00-1"]},
    )
    assert identity["photo_preset"] == "tunnel"
    assert storage.get_team(comm_team["id"])["identity"]["room_theme"] == "locker"

    polls = storage.ensure_week_trophy_polls(league["id"], 2026, 3)
    assert len(polls) == 4
    again = storage.ensure_week_trophy_polls(league["id"], 2026, 3)
    assert {p["id"] for p in again} == {p["id"] for p in polls}

    storage.cast_week_poll_vote(polls[0]["id"], comm_team["id"], other["id"])
    storage.cast_week_poll_vote(polls[0]["id"], comm_team["id"], comm_team["id"])
    votes = storage.list_week_poll_votes(polls[0]["id"])
    assert len(votes) == 1
    assert votes[0]["nominee_team_id"] == comm_team["id"]

    emote = storage.upsert_matchup_emote(
        league_id=league["id"],
        season=2026,
        week=3,
        from_team_id=comm_team["id"],
        to_team_id=other["id"],
        emote_key="flex",
    )
    assert emote["emote_key"] == "flex"
    storage.upsert_matchup_emote(
        league_id=league["id"],
        season=2026,
        week=3,
        from_team_id=comm_team["id"],
        to_team_id=other["id"],
        emote_key="bow",
    )
    listed = storage.list_week_emotes(league["id"], 2026, 3)
    assert len(listed) == 1
    assert listed[0]["emote_key"] == "bow"
