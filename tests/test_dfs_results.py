import pytest
from pydantic import ValidationError
from fastapi import HTTPException
from src.products import dfs_results
from app.dfs_results_routes import owner, Entry, EntryImport, import_results, get_results, Build, save_build


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
