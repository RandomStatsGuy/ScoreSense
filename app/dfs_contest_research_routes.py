"""Read-only contest assumption preview and conditional cash replay."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field

from app.auth import require_patron
from app.dfs_shared_outcomes_routes import PreviewResearch, EvaluateResearch, _body
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
