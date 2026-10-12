"""Real conditional engine responses for explicitly synthetic browser checks."""
from copy import deepcopy
import json
from pathlib import Path
import runpy
import sys

from src.products.dfs_shared_outcomes import prepare_scenario_bank
from src.products.dfs_contest_research import prepare_contest_research, contest_research_summary, evaluate_contest_research

ROOT = Path(__file__).resolve().parents[2]


def main():
    sys.path.insert(0, str(ROOT / "tests"))
    shared = json.loads((ROOT / "frontend/test-fixtures/dfs-shared-data.json").read_text(encoding="utf-8"))
    inputs = deepcopy(shared["engine_inputs"])
    fixture = runpy.run_path(str(ROOT / "tests/test_dfs_contest_research.py"))["fixture"]
    _, _, _, field, payout = fixture()
    field["context"] = inputs["context"]
    scenario = field["scenarios"][0]
    scenario["templates"] = [{"template_id": f"whole-{i}", "player_ids": row["player_ids"], "weight": [1, 3][i]}
                             for i, row in enumerate(inputs["lineups"])]
    alternative = deepcopy(scenario)
    alternative.update(scenario_id="alternative-news", provider="Synthetic sensitivity provider",
                       injury_assumption="Declared alternative opponent mix; football outcomes unchanged")
    alternative["templates"][0]["weight"] = 6
    alternative["templates"][1]["weight"] = 1
    field["scenarios"].append(alternative)  # intentionally unsorted IDs
    bank = prepare_scenario_bank(inputs["bank"], context=inputs["context"], pool=inputs["pool"])
    prepared = prepare_contest_research(bank, field, payout)
    result = evaluate_contest_research(bank, prepared, inputs["lineups"], seed=0, draw_count=128, top_k=10)
    collection = evaluate_contest_research(bank, prepared, [dict(row, lineup_id=f"collection:{i}") for i, row in enumerate(inputs["lineups"])], seed=0, draw_count=128, top_k=10)
    value = {"synthetic": True, "purpose": "Engineering replay; no forecast or field calibration evidence.",
             "file": {"contest_field": field, "payout_contract": payout}, "summary": contest_research_summary(prepared),
             "evaluation": result, "collection_evaluation": collection, "seed": 0, "draw_count": 128, "top_k": 10}
    output = ROOT / "frontend/test-fixtures/dfs-contest-data.json"
    output.write_bytes((json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8"))
    print(json.dumps({"synthetic": True, "content_id": prepared["content_id"], "assumptions": len(result["assumptions"]),
                      "opponent_entries": result["opponent_entry_count"], "draws": result["draw_count"]}))


if __name__ == "__main__":
    main()
