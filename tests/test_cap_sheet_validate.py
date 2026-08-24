"""Tests for cap sheet validate-before-import."""

from __future__ import annotations

from src.draft_hub import storage
from src.draft_hub.cap_sheet_import import parse_cap_sheet_tsv, validate_cap_sheet_for_league
from src.draft_hub.schemas import LeagueRules


def _sample_tsv(*rows: str) -> bytes:
    header = "manager\tposition\tplayer\tsalary\tcontract\n"
    return (header + "\n".join(rows)).encode("utf-8")


def test_validate_cap_sheet_unmatched_manager(hub_db):
    league = storage.create_league(
        commissioner_sub="comm-sub",
        name="Validate League",
        season=2026,
        rules=LeagueRules(),
    )
    league_id = str(league["id"])
    raw = _sample_tsv("UNK\tQB\tPatrick Mahomes\t25\t1/2")
    parsed = parse_cap_sheet_tsv(raw, season=2026, rules=LeagueRules())
    report = validate_cap_sheet_for_league(
        league_id,
        parsed,
        {},
        replace_existing=False,
        contracts_only=True,
    )
    assert report["ok"] is True
    assert any("Manager not in" in w for w in report["warnings"])


def test_validate_cap_sheet_happy_path(hub_db):
    league = storage.create_league(
        commissioner_sub="comm-sub-2",
        name="Validate League 2",
        season=2026,
        rules=LeagueRules(),
        commissioner_team_name="Alpha Team",
    )
    league_id = str(league["id"])
    raw = _sample_tsv("MGR\tQB\tPatrick Mahomes\t25\t1/2")
    parsed = parse_cap_sheet_tsv(raw, season=2026, rules=LeagueRules())
    report = validate_cap_sheet_for_league(
        league_id,
        parsed,
        {"MGR": "Alpha Team"},
        replace_existing=True,
        contracts_only=False,
    )
    assert report["ok"] is True
    assert report["would_replace"] is True
    assert any("wipe" in w.lower() for w in report["warnings"])
