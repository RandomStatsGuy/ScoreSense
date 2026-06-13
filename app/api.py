"""FastAPI backend for ScoreSense projections."""

from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from src.predict import get_model_metrics, predict_upcoming_week

app = FastAPI(
    title="ScoreSense API",
    description="NFL fantasy projection API",
    version="2.0.0",
)


class ProjectionRequest(BaseModel):
    position: str = "qb"
    season: Optional[int] = None
    week: Optional[int] = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/metrics")
def metrics() -> dict:
    return get_model_metrics()


@app.post("/predict")
def predict(request: ProjectionRequest) -> dict:
    position = request.position.lower()
    if position not in ("qb", "rb", "wr"):
        raise HTTPException(status_code=400, detail="position must be qb, rb, or wr")
    try:
        preds = predict_upcoming_week(
            position,
            season=request.season,
            week=request.week,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "position": position,
        "count": len(preds),
        "projections": preds.to_dict(orient="records"),
    }
