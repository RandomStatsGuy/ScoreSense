"""Read-only evidence and bounded diagnostics; no live lineup or model writes."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.auth import require_patron
from app.process_pool import submit_cpu_job
from src.products.dfs_opportunity import read_opportunity_artifact
from src.products.dfs_classic_comparison import compare_classic_lineups
from src.products.lineup_optimizer import LineupPlayer

router = APIRouter(prefix="/api/lineup", tags=["dfs-evidence"])


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class DecisionContext(StrictModel):
    site: Literal["draftkings"] = "draftkings"
    sport: Literal["NFL"] = "NFL"
    format: Literal["classic"] = "classic"
    season: int = Field(ge=2000, le=2200, strict=True)
    week: int = Field(ge=1, le=22, strict=True)
    slate_id: str = Field(min_length=1, max_length=100, pattern=r"^\S(?:.*\S)?$")


class DecisionPlayer(StrictModel):
    player_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=150)
    team: str = Field(min_length=2, max_length=3, pattern=r"^[A-Z]{2,3}$")
    position: Literal["QB", "RB", "WR", "TE", "DST"]
    opponent: str = Field(default="", max_length=3)
    proj: float = Field(ge=-100, le=200, strict=True)
    floor: float = Field(ge=-100, le=200, strict=True)
    ceiling: float = Field(ge=-100, le=200, strict=True)
    salary: int = Field(gt=0, le=50000, strict=True)
    dfs_id: str = Field(default="", max_length=100)
    injury_status: str = Field(default="", max_length=100)
    on_bye: bool = False
    value: float | None = Field(default=None, strict=True)

    @field_validator("player_id")
    @classmethod
    def exact_id(cls, value):
        if value != value.strip():
            raise ValueError("Canonical IDs must be exact, without padding.")
        return value

    @model_validator(mode="after")
    def ordered_inputs(self):
        if not self.floor <= self.proj <= self.ceiling:
            raise ValueError("Player input quantiles must be ordered.")
        return self


class RelationshipControl(StrictModel):
    mode: Literal["minimum", "maximum", "exact", "optional", "forbidden"]
    count: int = Field(ge=0, le=7, strict=True)

    @model_validator(mode="after")
    def optional_count(self):
        if self.mode in {"optional", "forbidden"} and self.count != 0:
            raise ValueError("Optional and forbidden controls require count zero.")
        return self


class AttachmentControl(RelationshipControl):
    receiving_rb_ids: list[str] = Field(default_factory=list, max_length=500)


class NativeRules(StrictModel):
    version: Literal[1]
    attachments: AttachmentControl
    bring_back: RelationshipControl


class ComparisonCase(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    qb_id: str = Field(min_length=1, max_length=100)
    attachments: AttachmentControl
    bring_back: RelationshipControl
    core_player_ids: list[str] = Field(default_factory=list, max_length=9)


class CompareClassic(StrictModel):
    # The client supplies a frozen diagnostic pool, not an authenticated salary
    # catalog. Its content hash never authorizes platform export or entry edits.
    pool: list[DecisionPlayer] = Field(min_length=9, max_length=750)
    context: DecisionContext
    objective: Literal["median", "floor", "ceiling", "value"] = "median"
    locked_player_ids: list[str] = Field(default_factory=list, max_length=9)
    excluded_player_ids: list[str] = Field(default_factory=list, max_length=750)
    salary_cap: int = Field(default=50000, ge=1, le=50000, strict=True)
    min_salary: int = Field(default=0, ge=0, le=50000, strict=True)
    max_per_team: int = Field(default=0, ge=0, le=9, strict=True)
    block_qb_opposing_dst: bool = True
    classic_stack_rules: NativeRules | None = None
    stack_teams: list[str] = Field(default_factory=list, max_length=32)
    stack_qb_ids: list[str] = Field(default_factory=list, max_length=40)
    receiving_rb_ids: list[str] = Field(default_factory=list, max_length=500)
    requests: list[ComparisonCase] | None = Field(default=None, max_length=320)
    input_snapshot_id: str = Field(min_length=1, max_length=100)
    evidence_id: str | None = Field(default=None, max_length=100)
    frozen_at: str = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def exact_ids(self):
        ids = [p.player_id for p in self.pool]
        if len(ids) != len(set(ids)):
            raise ValueError("The frozen player pool contains duplicate canonical IDs.")
        for values in (self.locked_player_ids, self.excluded_player_ids, self.stack_qb_ids, self.receiving_rb_ids):
            if len(values) != len(set(values)) or any(not v or v != v.strip() or len(v) > 100 for v in values):
                raise ValueError("Controls require distinct exact canonical IDs.")
        if self.min_salary > self.salary_cap:
            raise ValueError("Minimum salary exceeds the salary cap.")
        return self


@router.get("/evidence")
def get_evidence(site: Literal["draftkings"] = "draftkings",
                 season: int = Query(ge=2000, le=2200), week: int = Query(ge=1, le=22),
                 slate_id: str = Query(min_length=1, max_length=100, pattern=r"^\S(?:.*\S)?$"), user=Depends(require_patron)):
    context = DecisionContext(site=site, season=season, week=week, slate_id=slate_id).model_dump()
    try:
        evidence = read_opportunity_artifact(context)
    except (ValueError, OSError) as exc:
        raise HTTPException(503, "Saved evidence could not be verified. Retry without replacing your selected inputs.") from exc
    if evidence is None or evidence.get("status") == "unavailable":
        return {"status": "unavailable", "context": context, "content_id": None,
                "reason": (evidence or {}).get("reason") or "No verified evidence artifact is available for this exact slate.",
                "games": [], "players": [], "sources": [], "capabilities": {}}
    if not evidence.get("capabilities", {}).get("hosted_display_allowed"):
        # Do not expose restricted observations or source receipts by accident.
        return {"status": "unavailable", "context": context, "content_id": None,
                "reason": "Hosted ingestion and display permissions are not established for this evidence.",
                "games": [], "players": [], "sources": [], "capabilities": {}}
    # Keep the full normalized raw ledger in the offline artifact. The page
    # needs bounded summaries, exact source references and player observations.
    public_evidence = {key: value for key, value in evidence.items() if key != "observation_ledger"}
    return {**public_evidence, "status": "available"}


@router.post("/compare-classic")
async def compare_classic(request: CompareClassic, user=Depends(require_patron)):
    values = request.model_dump()
    context = values.pop("context")
    snapshot_context = {**context, **{key: values.pop(key) for key in ("input_snapshot_id", "evidence_id", "frozen_at")}}
    pool = [LineupPlayer(**player) for player in values.pop("pool")]
    try:
        report = await submit_cpu_job(compare_classic_lineups, pool, site=context["site"],
                                      snapshot_context=snapshot_context, **values)
        return {**report, "input_snapshot_id": request.input_snapshot_id, "evidence_id": request.evidence_id}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
