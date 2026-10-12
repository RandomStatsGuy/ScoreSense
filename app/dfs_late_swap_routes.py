"""Bounded, read-only late-swap snapshot planning; never writes platform entries."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field, field_validator

from app.auth import require_patron
from app.dfs_evidence_routes import DecisionContext
from app.dfs_shared_outcomes_routes import ResearchModel, _body, _exact_id
from app.process_pool import submit_cpu_job

router = APIRouter(prefix="/api/lineup/late-swap", tags=["dfs-research"])


class PreviewLateSwap(ResearchModel):
    context: DecisionContext
    package: dict


class PlanLateSwap(PreviewLateSwap):
    package_id: str = Field(min_length=64, max_length=64, pattern=r"^[a-f0-9]{64}$", strict=True)

    @field_validator("package_id")
    @classmethod
    def exact_package_id(cls, value):
        return _exact_id(value)


def _preview(values):
    from src.products.dfs_late_swap import prepare_late_swap_package, late_swap_summary

    prepared = prepare_late_swap_package(values["package"], context=values["context"])
    return late_swap_summary(prepared)


def _plan(values):
    from src.products.dfs_late_swap import prepare_late_swap_package, plan_late_swap

    prepared = prepare_late_swap_package(values["package"], context=values["context"])
    if prepared["content_id"] != values["package_id"]:
        raise ValueError("The snapshot changed. Preview and select it again before comparing.")
    return plan_late_swap(prepared, time_limit=8)


@router.post("/preview")
async def preview_late_swap(request: Request, user=Depends(require_patron)):
    values = await _body(request, PreviewLateSwap)
    try:
        return await submit_cpu_job(_preview, values)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/plan")
async def plan_late_swap_snapshot(request: Request, user=Depends(require_patron)):
    values = await _body(request, PlanLateSwap)
    try:
        return await submit_cpu_job(_plan, values)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
