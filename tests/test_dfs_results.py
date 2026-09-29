import pytest
from pydantic import ValidationError
from fastapi import HTTPException
from src.products import dfs_results
from app.dfs_results_routes import (owner, Entry, EntryImport, import_results, get_results, Build, save_build,
                                    Contest, ContestKey, get_contests, save_contest, remove_contest)


@pytest.fixture(autouse=True)
def results_db(tmp_path, monkeypatch):
    monkeypatch.setattr(dfs_results, "RESULTS_DB", tmp_path / "results.db")


def test_results_require_a_stable_account():
    with pytest.raises(HTTPException):
        owner(None)
    assert owner({"sub":"native:1"}) == "native:1"


def test_reimport_is_idempotent_and_score_updates_preserve_money():
    row = Entry(entry_id="0001", contest_id="002", fee_cents=500, payout_cents=1200, status="settled")
    req = EntryImport(entries=[row])
    import_results(req, "a")
    import_results(req, "a")
    import_results(EntryImport(entries=[Entry(entry_id="0001", contest_id="002", points=100, rank=3)]), "a")
    result = get_results("a")["entries"]
    assert len(result) == 1
    assert result[0]["payout_cents"] == 1200
    assert result[0]["points"] == 100
    assert get_results("b")["entries"] == []


def test_cannot_link_another_accounts_build_or_invalid_lineup():
    build = save_build(Build(site="draftkings_showdown", slate_id="1", slate_name="Test", lineups=[{"lineup":[]}], settings={}), "a")
    req = EntryImport(entries=[Entry(entry_id="1",contest_id="2",build_id=build["id"],lineup_index=0)])
    with pytest.raises(HTTPException): import_results(req,"b")
    import_results(req,"a")
    req.entries[0].lineup_index = 1
    with pytest.raises(HTTPException): import_results(req,"a")


def test_cents_are_nonnegative_integers_and_removal_is_owner_scoped():
    for cents in (-1, 1.5, "5"):
        with pytest.raises(ValidationError): Entry(entry_id="1",contest_id="2",fee_cents=cents)
    import_results(EntryImport(entries=[Entry(entry_id="1",contest_id="2",fee_cents=500)]),"a")
    dfs_results.delete_entries("b",[("draftkings","2","1")])
    assert len(get_results("a")["entries"]) == 1


def test_duplicate_rows_rejected_before_writes():
    req=EntryImport(entries=[Entry(entry_id="1",contest_id="2"),Entry(entry_id="1",contest_id="2")])
    with pytest.raises(HTTPException): import_results(req,"a")
    assert get_results("a")["entries"] == []


def test_snapshot_rejects_nonfinite_nested_values():
    request = Build(site="draftkings", slate_id="1", slate_name="Test", lineups=[{"lineup": [{"proj": float("nan")}]}], settings={})
    with pytest.raises(HTTPException) as error:
        save_build(request, "a")
    assert error.value.status_code == 400


def test_referenced_builds_survive_recent_build_limit():
    first = save_build(Build(site="draftkings", slate_id="1", slate_name="First", lineups=[{"lineup": []}], settings={}), "a")
    import_results(EntryImport(entries=[Entry(entry_id="1", contest_id="2", build_id=first["id"])]), "a")
    for i in range(101):
        save_build(Build(site="draftkings", slate_id=str(i), slate_name="Later", lineups=[{"lineup": []}], settings={}), "a")
    assert first["id"] in {b["id"] for b in get_results("a")["builds"]}


def test_compact_batches_support_large_retries_without_reading_whole_ledger(monkeypatch):
    rows = [Entry(entry_id=f"000{i}", contest_id="002", points=111.5) for i in range(6001)]
    original = dfs_results.read_results
    def unexpected_read(*args):
        raise AssertionError("A compact score import must not read the entire ledger")
    monkeypatch.setattr(dfs_results, "read_results", unexpected_read)
    for _ in range(2):
        for offset in range(0, len(rows), 1000):
            batch = rows[offset:offset + 1000]
            assert import_results(EntryImport(entries=batch), "a", compact=True) == {"imported": len(batch)}
    monkeypatch.setattr(dfs_results, "read_results", original)
    assert len(get_results("a")["entries"]) == 6001
    assert get_results("b")["entries"] == []


def test_compact_batch_retains_atomic_validation_and_request_limit():
    duplicate = Entry(entry_id="1", contest_id="2")
    with pytest.raises(HTTPException):
        import_results(EntryImport(entries=[duplicate, duplicate]), "a", compact=True)
    assert get_results("a")["entries"] == []
    with pytest.raises(ValidationError):
        EntryImport(entries=[duplicate] * 5001)


def test_standings_entry_name_preserves_cash_history_and_account_scope():
    import_results(EntryImport(entries=[Entry(entry_id="0001", contest_id="123", fee_cents=500, payout_cents=1500, status="settled")]), "a")
    request = EntryImport(entries=[Entry(entry_id="0001", entry_name="Example (1/20)", contest_id="123", points=105.8, rank=1)])
    import_results(request, "a", compact=True)
    result = get_results("a")["entries"][0]
    assert result["entry_name"] == "Example (1/20)"
    assert result["payout_cents"] == 1500
    assert result["fee_cents"] == 500
    assert result["points"] == 105.8
    assert get_results("b")["entries"] == []


def contest(contest_id="195390867", **over):
    base = dict(contest_id=contest_id, contest_name="NFL Showdown", contest_date="2026-09-18", entries=83234,
                unique_lineups=16742, my_entries=18, my_payout_cents=750, my_fee_cents=5400,
                summary={"field": {"entries": 83234}, "ownership": [{"player": "A", "drafted_pct": 51.9}],
                         "winners": {"entries": 837, "cutoff_rank": 412}, "mine": [{"entry_id": "1"}]},
                tiers=[{"from": 1, "to": 1, "cents": 100000}])
    return Contest(**{**base, **over})


def test_saved_contests_are_owner_scoped_and_list_without_the_breakdown():
    save_contest(contest(), "a")
    listed = get_contests(account="a")["contests"]
    assert len(listed) == 1
    assert listed[0]["contest_id"] == "195390867"
    assert listed[0]["my_payout_cents"] == 750
    # The date is what puts a contest on the returns chart, so the list carries it.
    assert listed[0]["contest_date"] == "2026-09-18"
    # The list must never carry a whole slate's ownership table.
    assert "summary" not in listed[0] and "tiers" not in listed[0]
    assert get_contests(account="b")["contests"] == []
    with pytest.raises(HTTPException) as error:
        get_contests(site="draftkings", contest_id="195390867", account="b")
    assert error.value.status_code == 404


def test_reopening_returns_the_whole_breakdown_and_resaving_replaces_it():
    save_contest(contest(), "a")
    save_contest(contest("222"), "a")
    save_contest(contest(my_entries=20, my_payout_cents=125000), "a")
    listed = get_contests(account="a")["contests"]
    assert [c["contest_id"] for c in listed] == ["195390867", "222"]  # newest save first
    assert listed[0]["my_entries"] == 20

    full = get_contests(site="draftkings", contest_id="195390867", account="a")
    assert full["summary"]["winners"]["cutoff_rank"] == 412
    assert full["tiers"][0]["cents"] == 100000
    assert full["saved_at"]


def test_contest_removal_is_owner_and_site_scoped():
    save_contest(contest(), "a")
    save_contest(contest(site="fanduel"), "a")
    remove_contest(ContestKey(contest_id="195390867"), "b")
    assert len(get_contests(account="a")["contests"]) == 2
    remove_contest(ContestKey(contest_id="195390867"), "a")
    assert [c["site"] for c in get_contests(account="a")["contests"]] == ["fanduel"]


def test_contest_money_is_nonnegative_integers_and_nonfinite_is_refused():
    for cents in (-1, 2.5, "5"):
        with pytest.raises(ValidationError):
            contest(my_payout_cents=cents)
    # A non-finite value inside the free-form breakdown must be refused, not
    # quietly rewritten to null and stored as though the number were unknown.
    for bad in (float("inf"), float("-inf"), float("nan")):
        with pytest.raises(HTTPException) as error:
            save_contest(contest(summary={"field": {"score_median": bad}}), "a")
        assert error.value.status_code == 400
    with pytest.raises(HTTPException):
        save_contest(contest(tiers=[{"from": 1, "to": 1, "cents": float("nan")}]), "a")
    assert get_contests(account="a")["contests"] == []

    # The same shape with a real number saves, and keeps the number.
    save_contest(contest(summary={"field": {"score_median": 59.6}}), "a")
    saved = get_contests(site="draftkings", contest_id="195390867", account="a")
    assert saved["summary"]["field"]["score_median"] == 59.6
    assert saved["contest_date"] == "2026-09-18"


def test_a_contest_without_a_date_saves_rather_than_inventing_one():
    save_contest(contest(contest_date=None), "a")
    assert get_contests(account="a")["contests"][0]["contest_date"] is None
    with pytest.raises(ValidationError):
        contest(contest_date="not a date")
