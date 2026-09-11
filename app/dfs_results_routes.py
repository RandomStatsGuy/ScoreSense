"""Personal DFS results. All records are scoped to the authenticated subject."""
from datetime import date as CalendarDate, datetime, timezone
from typing import Literal
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from app.auth import require_patron
from src.products import dfs_results

router = APIRouter(prefix="/api/lineup", tags=["dfs-results"])


def owner(user=Depends(require_patron)):
    if not user or not user.get("sub"):
        raise HTTPException(status_code=401, detail="Sign in to save your DFS results.")
    return str(user["sub"])


class Entry(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    site: Literal["draftkings", "fanduel"] = "draftkings"
    entry_id: str = Field(min_length=1, max_length=100)
    contest_id: str = Field(min_length=1, max_length=100)
    contest_name: str | None = Field(default=None, max_length=300)
    date: CalendarDate | None = None
    format: str | None = Field(default=None, max_length=50)
    fee_cents: int | None = Field(default=None, ge=0, le=1_000_000_000, strict=True)
    payout_cents: int | None = Field(default=None, ge=0, le=10_000_000_000, strict=True)
    status: Literal["settled", "unsettled", "void"] | None = None
    points: float | None = Field(default=None, ge=-200, le=2000)
    rank: int | None = Field(default=None, ge=1)
    lineup_text: str | None = Field(default=None, max_length=4000)
    build_id: str | None = Field(default=None, max_length=100)
    lineup_index: int | None = Field(default=None, ge=0, le=149)
    note: str | None = Field(default=None, max_length=4000)


class EntryImport(BaseModel):
    entries: list[Entry] = Field(max_length=5000, min_length=1)


class Build(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    site: str = Field(max_length=50)
    slate_id: str = Field(max_length=100)
    slate_name: str = Field(max_length=300)
    lineups: list[dict] = Field(min_length=1, max_length=150)
    settings: dict
    note: str = Field(default="", max_length=4000)


@router.get("/results")
def get_results(account=Depends(owner)):
    return dfs_results.read_results(account)


@router.post("/results/import")
def import_results(request: EntryImport, account=Depends(owner), compact: bool = False):
    records = [row.model_dump(mode="json", exclude_none=True) for row in request.entries]
    owned_builds = ({b["id"]: b for b in dfs_results.read_results(account)["builds"]}
                    if any(row.get("build_id") for row in records) else {})
    seen = set()
    for row in records:
        key = (row["site"], row["contest_id"], row["entry_id"])
        if key in seen:
            raise HTTPException(400, "The import repeats an entry ID in the same contest.")
        seen.add(key)
        if row.get("build_id"):
            build = owned_builds.get(row["build_id"])
            if not build or row.get("lineup_index", 0) >= len(build["lineups"]):
                raise HTTPException(400, "The saved build does not belong to this account or the lineup is missing.")
    return dfs_results.import_entries(account, records, compact=compact)


@router.post("/builds")
def save_build(request: Build, account=Depends(owner)):
    import json
    payload = request.model_dump()
    try:
        serialized = json.dumps(payload, allow_nan=False)
    except ValueError:
        raise HTTPException(400, "Build values must be finite numbers.")
    if len(serialized) > 2_000_000:
        raise HTTPException(413, "Save a smaller lineup set.")
    payload.update(id=str(uuid4()), saved_at=datetime.now(timezone.utc).isoformat())
    return dfs_results.save_build(account, payload)


@router.post("/results/remove")
def remove_results(request: EntryImport, account=Depends(owner)):
    return dfs_results.delete_entries(account, [(r.site, r.contest_id, r.entry_id) for r in request.entries])
