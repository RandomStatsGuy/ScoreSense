"""Read-only, bounded shared-event research. No account or lineup writes."""
import json
import math
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from starlette.concurrency import run_in_threadpool

from app.auth import require_patron
from app.dfs_evidence_routes import DecisionContext
from app.process_pool import submit_cpu_job

MAX_BODY_BYTES = 8 * 1024 * 1024
router = APIRouter(prefix="/api/lineup/shared-outcomes", tags=["dfs-research"])


def _exact_id(value):
    if not value or value != value.strip() or re.search(r"[\x00-\x1f\x7f]", value):
        raise ValueError("Identities require exact nonempty strings without padding or control characters.")
    return value


class ResearchModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ResearchPlayer(ResearchModel):
    player_id: str = Field(min_length=1, max_length=100)
    game_id: str = Field(min_length=1, max_length=100)
    team: str = Field(min_length=2, max_length=3, pattern=r"^[A-Z]{2,3}$")
    opponent: str = Field(min_length=2, max_length=3, pattern=r"^[A-Z]{2,3}$")
    position: str = Field(pattern=r"^(QB|RB|WR|TE|DST)$")
    salary: int = Field(gt=0, le=50000, strict=True)

    @field_validator("player_id", "game_id")
    @classmethod
    def exact_ids(cls, value):
        return _exact_id(value)


class ResearchLineup(ResearchModel):
    lineup_id: str = Field(min_length=1, max_length=150)
    player_ids: list[str] = Field(min_length=9, max_length=9)

    @model_validator(mode="after")
    def exact_ids(self):
        _exact_id(self.lineup_id)
        if len(set(self.player_ids)) != 9 or any(len(pid) > 100 for pid in self.player_ids):
            raise ValueError("Lineups require nine distinct exact canonical IDs.")
        for pid in self.player_ids:
            _exact_id(pid)
        return self


class PreviewResearch(ResearchModel):
    context: DecisionContext
    pool: list[ResearchPlayer] = Field(min_length=9, max_length=750)
    bank: dict

    @model_validator(mode="after")
    def distinct_pool(self):
        if len({player.player_id for player in self.pool}) != len(self.pool):
            raise ValueError("The frozen pool requires distinct canonical player IDs.")
        _exact_id(self.context.slate_id)
        return self


class EvaluateResearch(PreviewResearch):
    lineups: list[ResearchLineup] = Field(min_length=1, max_length=150)
    input_snapshot_id: str = Field(min_length=1, max_length=100)
    bank_id: str = Field(min_length=1, max_length=100)
    seed: int = Field(default=0, ge=0, le=2**31 - 1, strict=True)
    draw_count: int = Field(default=256, ge=32, le=1024, strict=True)

    @field_validator("input_snapshot_id", "bank_id")
    @classmethod
    def exact_ids(cls, value):
        return _exact_id(value)

    @model_validator(mode="after")
    def distinct_lineups(self):
        if len({lineup.lineup_id for lineup in self.lineups}) != len(self.lineups):
            raise ValueError("Every reviewed lineup requires its own identity.")
        return self


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Repeated JSON fields are not supported.")
        result[key] = value
    return result


def _parse_body(raw, model):
    def reject_constant(value):
        raise ValueError("Nonfinite JSON values are not supported.")

    payload = json.loads(raw, object_pairs_hook=_pairs, parse_constant=reject_constant)
    # Bound nested content before handing it to the event/model validators.
    stack, count = [(payload, 0)], 0
    while stack:
        value, depth = stack.pop()
        count += 1
        if depth > 24 or count > 250000:
            raise ValueError("The scenario package exceeds the nesting or value limit.")
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("Nonfinite JSON values are not supported.")
        if isinstance(value, dict):
            stack.extend((item, depth + 1) for item in value.values())
        elif isinstance(value, list):
            stack.extend((item, depth + 1) for item in value)
    return model.model_validate(payload).model_dump()


async def _body(request, model):
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_BODY_BYTES:
            raise HTTPException(413, "The complete research request must fit within 8 MiB.")
        raw.extend(chunk)
    try:
        return await run_in_threadpool(_parse_body, bytes(raw), model)
    except (ValueError, ValidationError, RecursionError, UnicodeError) as exc:
        # Do not echo user-held source observations in validation responses.
        raise HTTPException(422, "Invalid research package or controls. Review exact identities, salaries, bounds and JSON structure.") from exc


def _preview(values):
    from src.products.dfs_shared_outcomes import prepare_scenario_bank, scenario_bank_summary

    bank = prepare_scenario_bank(values["bank"], context=values["context"], pool=values["pool"])
    return scenario_bank_summary(bank)


def _evaluate(values):
    from src.products.dfs_shared_outcomes import prepare_scenario_bank, evaluate_shared_outcomes

    bank = prepare_scenario_bank(values["bank"], context=values["context"], pool=values["pool"])
    if bank["content_id"] != values["bank_id"]:
        raise ValueError("The scenario version changed. Preview and select it again before evaluating.")
    result = evaluate_shared_outcomes(bank, values["lineups"], seed=values["seed"],
                                     draw_count=values["draw_count"], purpose="evaluation")
    return {**result, "input_snapshot_id": values["input_snapshot_id"], "bank_id": values["bank_id"]}


@router.post("/preview")
async def preview_research(request: Request, user=Depends(require_patron)):
    values = await _body(request, PreviewResearch)
    try:
        return await submit_cpu_job(_preview, values)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/evaluate")
async def evaluate_research(request: Request, user=Depends(require_patron)):
    values = await _body(request, EvaluateResearch)
    try:
        return await submit_cpu_job(_evaluate, values)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
