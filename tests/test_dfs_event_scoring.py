"""Site scoring and shared-event identities; every game here is synthetic."""
from copy import deepcopy

import pytest

from src.products.dfs_event_scoring import MAX_EVENTS, SCORING_SOURCE, SCORING_VERSION, score_game_events


@pytest.fixture
def ledger():
    game = {"game_id": "synthetic-BUF-MIA", "home_team": "BUF", "away_team": "MIA", "ledger_complete": True}
    players = []
    for team, opp in (("BUF", "MIA"), ("MIA", "BUF")):
        for suffix, pos, status in (("q", "QB", "active"), ("r", "RB", "active"), ("w", "WR", "active"), ("t", "TE", "inactive"), ("other", "RESIDUAL", "active"), ("dst", "DST", "active")):
            player = {"player_id": f"{team}-{suffix}", "team": team, "opponent": opp, "position": pos, "status": status}
            if pos == "RESIDUAL":
                player["residual"] = True
            players.append(player)
    return game, players


def event(eid, kind, team="BUF", **fields):
    return {"event_id": eid, "kind": kind, "team": team, "period": 1, **fields}


def passing(eid, *, team="BUF", receiver="w", complete=True, intercepted=False, yards=10, td=False, **fields):
    return event(eid, "pass", team, passer_id=f"{team}-q", receiver_id=f"{team}-{receiver}" if receiver else None, complete=complete, intercepted=intercepted, yards=yards, td=td, **fields)


def rushing(eid, *, team="BUF", player="r", mode="designed", yards=10, td=False, **fields):
    return event(eid, "rush", team, rusher_id=f"{team}-{player}", rush_type=mode, yards=yards, td=td, **fields)


def score(ledger, events):
    return score_game_events(*ledger, events)


def test_explicit_whole_game_zeroes_and_scoring_receipt(ledger):
    result = score(ledger, [])
    assert result["player_scores"]["BUF-t"] == 0  # explicitly inactive, not missing
    assert result["player_scores"]["BUF-w"] == 0  # complete declared ledger, no events
    assert result["player_scores"]["BUF-dst"] == 10
    assert result["game_score"] == {"BUF": 0, "MIA": 0}
    assert result["audit"]["source_completeness_verified"] is False
    assert result["capabilities"]["site_scoring_rules_verified"] is True
    assert result["capabilities"]["calibrated_forecast"] is False
    assert result["capabilities"]["specialist_distribution_calibrated"] is False
    assert result["scoring_version"] == SCORING_VERSION
    result["scoring_source"]["provider"] = "mutated"
    assert SCORING_SOURCE["provider"] == "DraftKings"


def test_selected_and_residual_receiver_production_reconciles(ledger):
    result = score(ledger, [passing("1", yards=20, td=True), passing("2", receiver="other", yards=8), passing("3", complete=False, yards=0), passing("4", receiver=None, complete=False, yards=0)])
    ts = result["team_stats"]["BUF"]
    assert (ts["plays"], ts["dropbacks"], ts["throws"], ts["targeted"], ts["untargeted"], ts["completions"]) == (4, 4, 4, 3, 1, 2)
    assert (ts["passing_yards"], ts["receiving_yards"], ts["passing_tds"], ts["receiving_tds"]) == (28, 28, 1, 1)
    assert result["player_scores"]["BUF-q"] == 5.12
    assert result["player_scores"]["BUF-w"] == 9
    assert result["player_scores"]["BUF-other"] == 1.8
    assert result["game_score"]["BUF"] == 6
    assert result["team_stats"]["MIA"]["points_allowed"] == 6
    assert all(all(checks.values()) for checks in result["audit"]["identities"].values())


def test_sack_scramble_designed_rush_kneel_spike_and_no_play_are_distinct(ledger):
    result = score(ledger, [event("s", "sack", passer_id="BUF-q", yards=-7), rushing("c", player="q", mode="scramble", yards=12), rushing("r", yards=-2), rushing("k", player="q", mode="kneel", yards=-1), event("p", "spike", passer_id="BUF-q"), event("n", "no_play")])
    ts = result["team_stats"]["BUF"]
    assert (ts["plays"], ts["dropbacks"], ts["sacks"], ts["scrambles"], ts["designed_runs"], ts["throws"]) == (3, 2, 1, 1, 1, 0)
    assert (ts["official_pass_attempts"], ts["official_rush_attempts"], ts["spikes"], ts["kneels"], ts["no_plays"]) == (1, 3, 1, 1, 1)
    assert result["player_stats"]["BUF-q"]["passing_yards"] == 0
    assert (ts["sack_yards_lost"], ts["net_passing_yards"], ts["rushing_yards"], ts["modeled_rushing_yards"]) == (7, -7, 9, 10)
    assert result["player_scores"]["BUF-q"] == 1.1
    assert result["player_scores"]["BUF-r"] == -0.2
    assert result["player_scores"]["MIA-dst"] == 11


def test_bonuses_use_final_game_totals_once_and_negative_yards_remain(ledger):
    events = [passing("1", yards=99), passing("2", yards=1), passing("3", receiver="other", yards=99), passing("4", receiver="other", yards=99), passing("5", receiver="other", yards=2), rushing("6", yards=99), rushing("7", yards=1)]
    result = score(ledger, events)
    assert result["player_scores"]["BUF-q"] == 15  # 300 *.04 + 3
    assert result["player_scores"]["BUF-w"] == 15  # 100 *.1 + 2 catches + 3
    assert result["player_scores"]["BUF-other"] == 26  # 200*.1 + 3 catches + 3
    assert result["player_scores"]["BUF-r"] == 13
    result = score(ledger, events + [passing("8", yards=-1), rushing("9", yards=-1)])
    assert result["player_scores"]["BUF-q"] == 11.96  # now 299: no bonus
    assert result["player_scores"]["BUF-w"] == 12.9  # now 99: no bonus
    assert result["player_scores"]["BUF-r"] == 9.9


def test_interception_return_and_extra_point_share_scoreboard_but_not_pa_td(ledger):
    events = [passing("int", complete=False, intercepted=True, yards=0, return_td=True), event("xp", "extra_point", "MIA", made=True, after_event_id="int")]
    result = score(ledger, events)
    assert result["player_scores"]["BUF-q"] == -1
    assert result["player_scores"]["MIA-dst"] == 18  # shutout10 + INT2 + TD6
    assert result["game_score"] == {"BUF": 0, "MIA": 7}
    assert result["team_stats"]["BUF"]["points_allowed"] == 1
    assert result["player_scores"]["BUF-dst"] == 7


def test_fumble_loss_return_scores_both_offense_and_dst(ledger):
    result = score(ledger, [rushing("f", yards=-5, fumbler_id="BUF-r", fumble_lost=True, fumble_return_td=True)])
    assert result["player_scores"]["BUF-r"] == -1.5
    assert result["player_scores"]["MIA-dst"] == 18
    assert result["game_score"]["MIA"] == 6
    assert result["team_stats"]["BUF"]["points_allowed"] == 0
    assert result["team_stats"]["MIA"]["defensive_fumble_recoveries"] == 1


def test_sack_fumble_and_sack_safety_are_not_independent_defensive_draws(ledger):
    result = score(ledger, [event("f", "sack", passer_id="BUF-q", yards=-7, fumbler_id="BUF-q", fumble_lost=True), event("s", "sack", passer_id="BUF-q", yards=-3, safety=True)])
    assert result["player_scores"]["BUF-q"] == -1
    assert result["player_scores"]["MIA-dst"] == 16  #10+2sacks+2recovery+2safety
    assert result["game_score"]["MIA"] == 2
    assert result["team_stats"]["BUF"]["points_allowed"] == 0


@pytest.mark.parametrize("kind", ["rush", "pass"])
def test_offensive_fumble_recovery_td_has_explicit_recipient_and_no_fake_receiving_td(ledger, kind):
    play = rushing("f", fumbler_id="BUF-r", fumble_lost=False, recovery_td_id="BUF-w") if kind == "rush" else passing("f", fumbler_id="BUF-w", fumble_lost=False, recovery_td_id="BUF-r")
    result = score(ledger, [play])
    scorer = "BUF-w" if kind == "rush" else "BUF-r"
    assert result["player_stats"][scorer]["offensive_recovery_tds"] == 1
    assert result["game_score"]["BUF"] == 6
    assert result["team_stats"]["BUF"]["passing_tds"] == result["team_stats"]["BUF"]["receiving_tds"] == 0
    assert result["team_stats"]["MIA"]["points_allowed"] == 6


@pytest.mark.parametrize("mode", ["pass", "run"])
def test_two_point_production_excludes_ordinary_yards_and_attempts(ledger, mode):
    fields = {"passer_id": "BUF-q", "receiver_id": "BUF-w"} if mode == "pass" else {"rusher_id": "BUF-r"}
    result = score(ledger, [rushing("td", td=True), event("try", "two_point", mode=mode, success=True, after_event_id="td", **fields)])
    assert result["game_score"]["BUF"] == 8
    assert result["team_stats"]["BUF"]["official_pass_attempts"] == 0
    assert result["team_stats"]["BUF"]["official_rush_attempts"] == 1
    assert result["player_scores"]["BUF-q"] == (2 if mode == "pass" else 0)
    assert result["player_scores"]["BUF-w"] == (2 if mode == "pass" else 0)
    assert result["player_scores"]["BUF-r"] == (7 if mode == "pass" else 9)


def test_two_point_return_is_not_an_ordinary_interception_or_td(ledger):
    result = score(ledger, [rushing("td", td=True), event("try", "two_point", mode="pass", passer_id="BUF-q", receiver_id="BUF-w", success=False, returned=True, after_event_id="td")])
    assert result["game_score"] == {"BUF": 6, "MIA": 2}
    assert result["player_scores"]["BUF-q"] == 0
    assert result["team_stats"]["MIA"]["defensive_interceptions"] == 0
    assert result["team_stats"]["MIA"]["conversion_returns"] == 1
    assert result["player_scores"]["MIA-dst"] == 9  # PA6=7 +2return
    assert result["team_stats"]["BUF"]["points_allowed"] == 2


@pytest.mark.parametrize("return_type", ["punt", "kickoff", "field_goal"])
def test_special_team_return_td_scores_returner_and_dst_and_opponent_pa(ledger, return_type):
    result = score(ledger, [event("ret", "return_td", returner_id="BUF-w", return_type=return_type)])
    assert result["player_scores"]["BUF-w"] == 6
    assert result["player_scores"]["BUF-dst"] == 16
    assert result["team_stats"]["MIA"]["points_allowed"] == 6


@pytest.mark.parametrize("kick_type", ["punt", "field_goal", "extra_point"])
def test_blocks_and_returns_have_verified_distinct_scoring(ledger, kick_type):
    events = [rushing("td", td=True)] if kick_type == "extra_point" else []
    fields = {"after_event_id": "td"} if kick_type == "extra_point" else {}
    events.append(event("block", "blocked_kick", kick_type=kick_type, return_td=True, **fields))
    result = score(ledger, events)
    assert result["player_scores"]["MIA-dst"] == (11 if kick_type == "extra_point" else 18)
    assert result["game_score"]["MIA"] == (2 if kick_type == "extra_point" else 6)
    assert result["team_stats"]["BUF"]["points_allowed"] == (2 if kick_type == "extra_point" else 6)


@pytest.mark.parametrize("pa,pa_points", [(0, 10), (1, 7), (6, 7), (7, 4), (13, 4), (14, 1), (20, 1), (21, 0), (27, 0), (28, -1), (34, -1), (35, -4), (42, -4)])
def test_points_allowed_tier_edges_from_actual_scoring_events(ledger, pa, pa_points):
    # Residue-one PA is an XP after a pick-six: the six is excluded, the XP counts.
    events = []
    remaining = pa
    if remaining % 3 == 1:
        events += [passing("pick", complete=False, intercepted=True, yards=0, return_td=True), event("xp", "extra_point", "MIA", made=True, after_event_id="pick")]
        remaining -= 1
    elif remaining % 3 == 2:
        events += [passing("pick", complete=False, intercepted=True, yards=0, return_td=True), event("try", "two_point", "MIA", mode="run", rusher_id="MIA-r", success=True, after_event_id="pick")]
        remaining -= 2
    events += [event(f"fg{i}", "field_goal", "MIA", made=True) for i in range(remaining // 3)]
    result = score(ledger, events)
    assert result["team_stats"]["BUF"]["points_allowed"] == pa
    assert result["player_scores"]["BUF-dst"] == pa_points


def test_overtime_counts_and_negative_completed_pass_are_preserved(ledger):
    play = passing("ot", yards=-4)
    play["period"] = 5
    result = score(ledger, [play])
    assert result["team_stats"]["BUF"]["plays"] == 1
    assert result["player_scores"]["BUF-q"] == -0.16
    assert result["player_scores"]["BUF-w"] == 0.6


def test_team_aliases_normalize_without_changing_exact_player_ids(ledger):
    game, players = deepcopy(ledger)
    game["home_team"] = "LAR"
    for player in players:
        if player["team"] == "BUF":
            player["team"] = "LA"
        else:
            player["opponent"] = "LAR"
    result = score_game_events(game, players, [event("r", "rush", "LAR", rusher_id="BUF-r", rush_type="designed", yards=1, td=False)])
    assert result["game_score"] == {"LA": 0, "MIA": 0}
    assert result["player_scores"]["BUF-r"] == 0.1


@pytest.mark.parametrize("mutate", [
    lambda g, p: g.update(ledger_complete=False),
    lambda g, p: g.update(home_team="AAA"),
    lambda g, p: g.update(home_team=" MIA"),
    lambda g, p: g.update(format="showdown"),
    lambda g, p: p.append(dict(p[0])),
    lambda g, p: p.pop(),
    lambda g, p: p[0].update(opponent="NYJ"),
    lambda g, p: p[0].update(player_id=" BUF-q"),
    lambda g, p: p[0].update(position="K"),
    lambda g, p: p[0].update(position=[]),
    lambda g, p: p[4].pop("residual"),
    lambda g, p: p[5].update(status="inactive"),
])
def test_invalid_game_or_roster_is_rejected_without_mutation(ledger, mutate):
    game, players = deepcopy(ledger)
    mutate(game, players)
    before = deepcopy((game, players))
    with pytest.raises(ValueError):
        score_game_events(game, players, [])
    assert (game, players) == before


@pytest.mark.parametrize("play", [
    passing("x", yards=True), passing("x", yards="10"), passing("x", complete=False, yards=1),
    passing("x", receiver=None), passing("x", complete=True, intercepted=True),
    passing("x", complete=False, yards=0, td=True), passing("x", return_td=True),
    passing("x", receiver="t"), passing("x", receiver="q"),
    passing("x", receiver="unknown"), passing("x", lateral_receiver_id="BUF-r"),
    passing("x", complete=False, yards=0, fumbler_id="BUF-w", fumble_lost=True),
    rushing("x", fumble_lost=True), rushing("x", fumble_return_td=True),
    rushing("x", td=True, fumbler_id="BUF-r"), rushing("x", safety=True, yards=1),
    rushing("x", player="w", mode="scramble"), rushing("x", player="q", mode="kneel", td=True),
    rushing("x", yards=-1, td=True), rushing("x", fumbler_id="BUF-r", fumble_lost=True, recovery_td_id="BUF-w"),
    event("x", "sack", passer_id="MIA-q", yards=-1), event("x", "sack", passer_id="BUF-dst", yards=-1),
    event("x", "spike", passer_id="BUF-q", yards=0), event("x", "no_play", yards=2),
    event("x", "extra_point", made=True, after_event_id="missing"),
    event("x", "return_td", returner_id="BUF-w", return_type="interception"),
    event("x", "safety", reason="one_point"), event("x", "lateral"), event("x", [], team="BUF"),
])
def test_inconsistent_unsupported_or_unbounded_event_is_atomic(ledger, play):
    good = passing("good")
    before = deepcopy((ledger, good, play))
    with pytest.raises(ValueError):
        score(ledger, [good, play])
    assert (ledger, good, play) == before


def test_duplicate_try_duplicate_event_and_nonchronological_period_reject(ledger):
    td = rushing("td", td=True)
    xp = event("xp", "extra_point", made=True, after_event_id="td")
    with pytest.raises(ValueError):
        score(ledger, [td, xp, event("xp2", "extra_point", made=True, after_event_id="td")])
    with pytest.raises(ValueError):
        score(ledger, [td, dict(td)])
    first, last = passing("a"), passing("b")
    first["period"] = 2
    with pytest.raises(ValueError):
        score(ledger, [first, last])
    with pytest.raises(ValueError):
        score(ledger, [td, passing("middle"), xp])


def test_absent_target_identity_does_not_silently_become_an_untargeted_throw(ledger):
    play = passing("missing", complete=False, yards=0)
    del play["receiver_id"]
    with pytest.raises(ValueError, match="explicit target"):
        score(ledger, [play])


def test_bounded_runtime_inputs_and_other_site_never_fallback(ledger):
    with pytest.raises(ValueError):
        score(ledger, [event(str(i), "no_play") for i in range(MAX_EVENTS + 1)])
    for site in ("fanduel", "draftkings_showdown", "seasonal", None):
        with pytest.raises(ValueError):
            score_game_events(*ledger, [], site=site)


def test_success_does_not_mutate_inputs_and_hash_pins_events_and_roster(ledger):
    events = [passing("1")]
    before = deepcopy((ledger, events))
    first = score(ledger, events)
    assert (ledger, events) == before
    assert score(ledger, deepcopy(events))["event_ledger_id"] == first["event_ledger_id"]
    events[0]["yards"] += 1
    assert score(ledger, events)["event_ledger_id"] != first["event_ledger_id"]
