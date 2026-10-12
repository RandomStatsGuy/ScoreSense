"""Read-only contest assumption preview and conditional cash replay."""
from fastapi import APIRouter, Depends, HTTPException, Request
from typing import Literal

from pydantic import Field, StrictFloat, StrictInt, StrictStr, field_validator, model_validator

from app.auth import require_patron
from app.dfs_shared_outcomes_routes import PreviewResearch, EvaluateResearch, ResearchLineup, _body, _exact_id
from app.process_pool import submit_cpu_job

router = APIRouter(prefix="/api/lineup/contest-research", tags=["dfs-research"])


class PreviewContest(PreviewResearch):
    contest_field: dict
    payout_contract: dict


class EvaluateContest(EvaluateResearch):
    contest_field: dict
    payout_contract: dict
    contest_research_id: str = Field(min_length=64, max_length=64, pattern=r"^[a-f0-9]{64}$")
    draw_count: int = Field(default=128, ge=32, le=256, strict=True)
    top_k: int = Field(default=10, ge=1, le=100000, strict=True)


class SelectContest(EvaluateContest):
    """Frozen supplied candidates; selection never changes account entries."""
    lineups: list[ResearchLineup] = Field(min_length=1, max_length=600)
    selection_request_id: str = Field(min_length=1, max_length=100)
    projection_scores: dict[str, StrictStr | StrictFloat | StrictInt] = Field(min_length=1, max_length=600)
    count: int = Field(ge=1, le=150, strict=True)
    scenario_id: str = Field(min_length=1, max_length=120)
    objective: Literal["conditional_mean_net", "conditional_risk_adjusted_net", "conditional_top_finish"]
    risk_alpha: str = Field(default="0.9", min_length=1, max_length=32, strict=True)
    risk_weight: str = Field(default="1", min_length=1, max_length=32, strict=True)
    player_exposure_limits: dict[str, dict] = Field(default_factory=dict, max_length=750)
    group_exposure_limits: list[dict] = Field(default_factory=list, max_length=50)
    locked_player_ids: list[StrictStr] = Field(default_factory=list, max_length=750)
    excluded_player_ids: list[StrictStr] = Field(default_factory=list, max_length=750)
    max_exposure: StrictStr | StrictFloat | StrictInt | None = None
    max_overlap: int | None = Field(default=None, ge=0, le=9, strict=True)
    classic_stack_rules: dict | None = None
    block_qb_opposing_dst: bool = Field(default=True, strict=True)
    max_per_team: int | None = Field(default=None, ge=1, le=9, strict=True)
    min_salary: int | None = Field(default=None, ge=0, le=50000, strict=True)
    max_salary: int = Field(default=50000, gt=0, le=50000, strict=True)

    @field_validator("selection_request_id", "scenario_id")
    @classmethod
    def exact_selection_ids(cls, value):
        return _exact_id(value)

    @model_validator(mode="after")
    def exact_selection_inputs(self):
        if set(self.projection_scores) != {row.lineup_id for row in self.lineups}:
            raise ValueError("Each candidate needs exactly one frozen projection score.")
        for values in (self.locked_player_ids, self.excluded_player_ids):
            if len(values) != len(set(values)):
                raise ValueError("Locks and exclusions require distinct exact player IDs.")
            for value in values:
                if len(value) > 100:
                    raise ValueError("Player identities cannot exceed 100 characters.")
                _exact_id(value)
        return self


def _prepare(values):
    from src.products.dfs_shared_outcomes import prepare_scenario_bank
    from src.products.dfs_contest_research import prepare_contest_research
    bank = prepare_scenario_bank(values["bank"], context=values["context"], pool=values["pool"])
    prepared = prepare_contest_research(bank, values["contest_field"], values["payout_contract"])
    return bank, prepared


def _preview(values):
    from src.products.dfs_contest_research import contest_research_summary
    _, prepared = _prepare(values)
    return contest_research_summary(prepared)


def _evaluate(values):
    from src.products.dfs_contest_research import evaluate_contest_research
    bank, prepared = _prepare(values)
    if bank["content_id"] != values["bank_id"] or prepared["content_id"] != values["contest_research_id"]:
        raise ValueError("Research inputs changed. Preview and select them again.")
    return {**evaluate_contest_research(bank, prepared, values["lineups"], seed=values["seed"],
                draw_count=values["draw_count"], top_k=values["top_k"]), "input_snapshot_id": values["input_snapshot_id"]}


def _select(values):
    from src.products.dfs_contest_portfolio import select_contest_portfolio
    bank, prepared = _prepare(values)
    if bank["content_id"] != values["bank_id"] or prepared["content_id"] != values["contest_research_id"]:
        raise ValueError("Research inputs changed. Preview and select them again.")
    controls = {key: values[key] for key in (
        "projection_scores", "count", "scenario_id", "objective", "seed", "draw_count", "top_k",
        "risk_alpha", "risk_weight", "player_exposure_limits", "group_exposure_limits",
        "locked_player_ids", "excluded_player_ids", "max_exposure", "max_overlap",
        "classic_stack_rules", "block_qb_opposing_dst", "max_per_team", "min_salary", "max_salary")}
    return {**select_contest_portfolio(bank, prepared, values["lineups"], **controls),
            "input_snapshot_id": values["input_snapshot_id"],
            "selection_request_id": values["selection_request_id"]}


@router.post("/preview")
async def preview_contest(request: Request, user=Depends(require_patron)):
    values = await _body(request, PreviewContest)
    try:
        return await submit_cpu_job(_preview, values)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/evaluate")
async def evaluate_contest(request: Request, user=Depends(require_patron)):
    values = await _body(request, EvaluateContest)
    try:
        return await submit_cpu_job(_evaluate, values)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/select")
async def select_contest(request: Request, user=Depends(require_patron)):
    values = await _body(request, SelectContest)
    try:
        return await submit_cpu_job(_select, values)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
