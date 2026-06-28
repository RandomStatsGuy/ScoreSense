"""Player prop scan — model fair lines vs market (CSV) or heuristic benchmarks."""

from __future__ import annotations

import io
import re
from typing import BinaryIO

import pandas as pd

from src.integrations.external_projections import _normalize_name
from src.projections.predict import predict_upcoming_week
from src.core.projection_context import resolve_projection_context

PROP_TYPES = (
    "pass_yards",
    "pass_tds",
    "rush_yards",
    "rec_yards",
    "receptions",
    "anytime_td",
)


def _fair_lines_for_row(position: str, proj: float, floor: float, ceiling: float) -> dict[str, float]:
    pos = position.upper()
    proj = float(proj or 0)
    floor = float(floor or 0)
    ceiling = float(ceiling or 0)

    if pos == "QB":
        return {
            "pass_yards": round(proj * 24.0, 1),
            "pass_tds": round(proj / 4.8, 2),
            "rush_yards": round(max(0, proj - 14) * 3.5, 1),
            "anytime_td": round(min(0.85, proj / 22.0), 3),
        }
    if pos == "RB":
        return {
            "rush_yards": round(proj * 5.2, 1),
            "rec_yards": round(proj * 2.8, 1),
            "receptions": round(proj / 5.5, 1),
            "anytime_td": round(min(0.75, proj / 16.0), 3),
        }
    return {
        "rec_yards": round(proj * 7.5, 1),
        "receptions": round(proj / 4.2, 1),
        "anytime_td": round(min(0.65, proj / 14.0), 3),
    }


def build_prop_scan(
    position: str,
    season: int | None = None,
    week: int | None = None,
    data_dir=None,
    model_dir=None,
    market_lines: pd.DataFrame | None = None,
    use_odds_api: bool = False,
) -> tuple[pd.DataFrame, dict]:
    from src.config import MODEL_DIR, PROCESSED_DATA_DIR

    data_dir = data_dir or PROCESSED_DATA_DIR
    model_dir = model_dir or MODEL_DIR

    path = data_dir / f"{position}_mlready.parquet"
    if not path.exists():
        path = data_dir / f"{position}_mlready.csv"
    df = pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)
    season, week = resolve_projection_context(df, season, week)

    preds = predict_upcoming_week(
        position,
        season=season,
        week=week,
        data_dir=data_dir,
        model_dir=model_dir,
        apply_injury_adjustments=False,
    )
    if "Position" not in preds.columns:
        preds["Position"] = position.upper()

    rows: list[dict] = []
    for _, row in preds.iterrows():
        pos = str(row.get("Position") or position).upper()
        proj = float(row.get("Projected Points") or 0)
        floor = float(row.get("Low (P10)") or 0)
        ceiling = float(row.get("High (P90)") or 0)
        fair = _fair_lines_for_row(pos, proj, floor, ceiling)
        for prop_type, fair_line in fair.items():
            rows.append(
                {
                    "player_id": str(row.get("player_id") or ""),
                    "player": row.get("Player"),
                    "team": row.get("Team"),
                    "position": pos,
                    "prop_type": prop_type,
                    "model_fair": fair_line,
                    "proj": proj,
                    "floor": floor,
                    "ceiling": ceiling,
                    "name_key": _normalize_name(row.get("Player") or ""),
                }
            )

    scan = pd.DataFrame(rows)
    if scan.empty:
        return scan, {"season": season, "week": week, "count": 0}

    odds_meta = None
    if market_lines is None and use_odds_api:
        try:
            from src.integrations.odds_api import load_market_lines, odds_api_key_configured

            if odds_api_key_configured():
                market_lines = load_market_lines(season, week, live=True)
                odds_meta = {"source": "odds_api", "rows": len(market_lines)}
        except Exception as exc:
            odds_meta = {"source": "odds_api", "error": str(exc)}

    if market_lines is not None and not market_lines.empty:
        scan = scan.merge(
            market_lines,
            on=["name_key", "prop_type"],
            how="left",
            suffixes=("", "_mkt"),
        )
        scan["edge"] = scan["model_fair"] - pd.to_numeric(scan.get("market_line"), errors="coerce")
        scan["recommendation"] = scan.apply(_recommendation, axis=1)
    else:
        scan["market_line"] = float("nan")
        scan["edge"] = float("nan")
        scan["recommendation"] = "model_only"

    scan = scan.sort_values(["edge", "model_fair"], ascending=[False, False], na_position="last")
    meta = {
        "season": season,
        "week": week,
        "position": position,
        "count": len(scan),
        "with_market": int(scan["market_line"].notna().sum()) if "market_line" in scan.columns else 0,
        "odds": odds_meta,
        "note": "Fair lines are heuristic from Proj/Floor/Ceiling until stat-level models ship.",
    }
    return scan, meta


def _recommendation(row) -> str:
    edge = row.get("edge")
    if edge is None or pd.isna(edge):
        return "model_only"
    prop = str(row.get("prop_type") or "")
    if prop == "anytime_td":
        if edge >= 0.08:
            return "lean_over"
        if edge <= -0.08:
            return "lean_under"
        return "pass"
    if edge >= 8:
        return "lean_over"
    if edge <= -8:
        return "lean_under"
    return "pass"


def parse_prop_lines_csv(file: BinaryIO | bytes | str) -> pd.DataFrame:
    if isinstance(file, bytes):
        buf = io.BytesIO(file)
    elif isinstance(file, str):
        buf = io.StringIO(file)
    else:
        buf = file

    raw = pd.read_csv(buf)
    cols = {c.lower(): c for c in raw.columns}
    name_col = cols.get("player") or cols.get("name") or cols.get("player_name")
    prop_col = cols.get("prop_type") or cols.get("prop") or cols.get("market")
    line_col = cols.get("line") or cols.get("market_line") or cols.get("odds_line")
    if not name_col or not prop_col or not line_col:
        raise ValueError("CSV needs player, prop_type, and line columns.")

    rows = []
    for _, row in raw.iterrows():
        prop_type = str(row[prop_col]).strip().lower()
        prop_type = re.sub(r"[^a-z_]", "_", prop_type)
        prop_type = prop_type.strip("_")
        if prop_type not in PROP_TYPES:
            aliases = {
                "passing_yards": "pass_yards",
                "passing_tds": "pass_tds",
                "rushing_yards": "rush_yards",
                "receiving_yards": "rec_yards",
                "reception": "receptions",
                "td": "anytime_td",
                "anytime_touchdown": "anytime_td",
            }
            prop_type = aliases.get(prop_type, prop_type)
        try:
            line = float(row[line_col])
        except (TypeError, ValueError):
            continue
        rows.append(
            {
                "name_key": _normalize_name(row[name_col]),
                "prop_type": prop_type,
                "market_line": line,
            }
        )
    return pd.DataFrame(rows)
