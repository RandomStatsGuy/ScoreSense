"""Generate actual offline planner responses for production-component UI tests.

All entries, identities, player inputs and source receipts are synthetic. This
does not access accounts, providers, saved entries or a current live slate.
"""
from copy import deepcopy
import json
from pathlib import Path

from scripts.dev.verify_dfs_late_swap import late_swap_fixture
from src.products.dfs_late_swap import prepare_late_swap_package, late_swap_summary, plan_late_swap


def main():
    package = late_swap_fixture(entry_count=2, alternatives_per_entry=2)
    package["context"] = {"site": "draftkings", "sport": "NFL", "format": "classic", "season": 2026, "week": 5, "slate_id": "classic-fixture"}
    frozen = prepare_late_swap_package(package)
    result = {"synthetic": True, "package": package, "preview": late_swap_summary(frozen), "report": plan_late_swap(frozen), "blocked": {}}
    normalized_variant = deepcopy(package)
    for player in normalized_variant["catalog"]:
        for key in ("team", "opponent"):
            player[key] = {"BUF": "LAR", "MIA": "JAC"}.get(player[key], player[key])
    for source in normalized_variant["sources"]:
        source["content_sha256"] = source["content_sha256"].upper()
    normalized_variant["accepted_state"]["readback_sha256"] = normalized_variant["accepted_state"]["readback_sha256"].upper()
    next(player for player in normalized_variant["catalog"] if player["player_id"] == "rb1")["projection"] = "4.000000000001"
    normalized_frozen = prepare_late_swap_package(normalized_variant)
    result["normalized"] = {"package": normalized_variant, "preview": late_swap_summary(normalized_frozen), "report": plan_late_swap(normalized_frozen)}
    for label in ("unknown_lock", "locked_move"):
        malformed = deepcopy(package)
        if label == "unknown_lock":
            malformed["catalog"][0]["lock_state"] = "unknown"
        else:
            slots = malformed["candidates"][0]["slots"]
            slots["WR1"], slots["FLEX"] = slots["FLEX"], slots["WR1"]
        try:
            prepare_late_swap_package(malformed)
        except ValueError as exc:
            result["blocked"][label] = {"package": malformed, "error": str(exc)}
        else:
            raise AssertionError("The synthetic blocked package must fail actual admission.")
    target = Path(__file__).resolve().parents[2] / "frontend" / "test-fixtures" / "dfs-late-swap-data.json"
    target.write_bytes((json.dumps(result, indent=2, ensure_ascii=True, allow_nan=False) + "\n").encode("utf-8"))
    print(json.dumps({"fixture": str(target), "entries": result["preview"]["entry_count"], "candidates": result["preview"]["candidate_count"],
                      "selected": result["report"]["selected_count"], "solver_status": result["report"]["solver"]["status"],
                      "blocked_cases": sorted(result["blocked"])}))


if __name__ == "__main__":
    main()
