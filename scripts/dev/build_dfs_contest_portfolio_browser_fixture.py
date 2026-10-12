"""Produce actual research-selector responses from maintained synthetic inputs."""
from copy import deepcopy
import json
from pathlib import Path

from src.products.dfs_contest_portfolio import OBJECTIVES, select_contest_portfolio
from src.products.dfs_contest_research import prepare_contest_research
from src.products.dfs_shared_outcomes import prepare_scenario_bank

ROOT = Path(__file__).resolve().parents[2]


def main():
    shared = json.loads((ROOT / "frontend/test-fixtures/dfs-shared-data.json").read_text(encoding="utf-8"))
    contest = json.loads((ROOT / "frontend/test-fixtures/dfs-contest-data.json").read_text(encoding="utf-8"))
    inputs = deepcopy(shared["engine_inputs"])
    bank = prepare_scenario_bank(inputs["bank"], context=inputs["context"], pool=inputs["pool"])
    prepared = prepare_contest_research(bank, contest["file"]["contest_field"], contest["file"]["payout_contract"])
    settings = {"projection_scores": {row["lineup_id"]: shared["built_lineups"][index]["total_points"]
                    for index, row in enumerate(inputs["lineups"])}, "count": 1,
                "scenario_id": prepared["field"]["scenarios"][0]["scenario_id"],
                "seed": 0, "draw_count": 128, "top_k": 10, "risk_alpha": "0.9", "risk_weight": "1",
                "max_exposure": 1, "max_overlap": 7, "classic_stack_rules": None,
                "block_qb_opposing_dst": True, "max_per_team": None, "min_salary": 0,
                "max_salary": 50000, "player_exposure_limits": {}, "group_exposure_limits": [],
                "locked_player_ids": [], "excluded_player_ids": []}
    responses = {mode: select_contest_portfolio(bank, prepared, inputs["lineups"], objective=mode, **settings)
                 for mode in sorted(OBJECTIVES)}
    failure_settings = {**settings, "count": 2}
    failure = select_contest_portfolio(bank, prepared, inputs["lineups"], objective="conditional_mean_net", **failure_settings)
    value = {"synthetic": True, "purpose": "Actual conditional selector engineering replay; no forecast or calibration evidence.",
             "engine_inputs": inputs, "contest_file": contest["file"], "settings": settings,
             "evaluations": responses, "evaluation": responses["conditional_mean_net"],
             "failure_settings": failure_settings, "failures": {"count2": failure}}
    target = ROOT / "frontend/test-fixtures/dfs-contest-portfolio-data.json"
    target.write_bytes((json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8"))
    print(json.dumps({"synthetic": True, "candidate_count": len(inputs["lineups"]), "requested_count": 1,
                      "draw_count": 128, "objectives": sorted(responses), "bank_id": bank["content_id"]}))


if __name__ == "__main__":
    main()
