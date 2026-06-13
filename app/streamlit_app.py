"""Streamlit portfolio demo for ScoreSense."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import streamlit as st

from src.backtest import run_all_backtests
from src.config import BACKTEST_DIR, MODEL_DIR, PROCESSED_DATA_DIR, PROJECT_ROOT
from src.etl.nflverse_etl import build_all_datasets
from src.predict import get_model_metrics, predict_upcoming_week
from src.train import train_all

st.set_page_config(
    page_title="ScoreSense",
    page_icon="🏈",
    layout="wide",
)

st.title("ScoreSense")
st.caption("NFL fantasy projections powered by nflverse data and gradient boosting")

tab_projections, tab_backtest, tab_pipeline = st.tabs(
    ["Weekly Projections", "Backtest Results", "Pipeline"]
)

with tab_projections:
    col1, col2, col3 = st.columns(3)
    position = col1.selectbox("Position", ["qb", "rb", "wr"], format_func=str.upper)
    season = col2.number_input("Season", min_value=2018, max_value=2025, value=2024)
    week = col3.number_input("Target week", min_value=1, max_value=22, value=18)

    if st.button("Generate projections", type="primary"):
        try:
            preds = predict_upcoming_week(position, season=int(season), week=int(week))
            st.dataframe(preds, use_container_width=True, hide_index=True)
            st.download_button(
                "Download CSV",
                preds.to_csv(index=False),
                file_name=f"scoresense_{position}_week{week}.csv",
            )
        except FileNotFoundError as exc:
            st.error(str(exc))
            st.info("Run the Pipeline tab to build data and train models first.")

with tab_backtest:
    st.write(
        "Walk-forward evaluation on held-out seasons. "
        "Compares the model against season-average and last-game baselines."
    )
    summary_path = BACKTEST_DIR / "backtest_summary.json"
    if summary_path.exists():
        summary = json.loads(summary_path.read_text())
        rows = []
        for pos, metrics in summary.items():
            model_mae = metrics["model"]["mae"]
            baseline_mae = metrics["season_avg_baseline"]["mae"]
            improvement = (baseline_mae - model_mae) / baseline_mae * 100
            rows.append(
                {
                    "Position": pos.upper(),
                    "Model MAE": round(model_mae, 2),
                    "Season Avg MAE": round(baseline_mae, 2),
                    "Improvement vs baseline": f"{improvement:.1f}%",
                    "Top-12 overlap": round(metrics.get("top12_model", 0) * 100, 1),
                }
            )
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

        for pos in ("qb", "rb", "wr"):
            chart = BACKTEST_DIR / f"{pos}_mae_comparison.png"
            if chart.exists():
                st.image(str(chart), caption=f"{pos.upper()} MAE comparison")
    else:
        st.warning("No backtest results yet. Run backtest from the Pipeline tab.")

with tab_pipeline:
    st.write("Rebuild data, train models, and run evaluation.")
    seasons = st.text_input("Seasons (space-separated)", "2018 2019 2020 2021 2022 2023 2024")

    if st.button("1. Build nflverse datasets"):
        with st.spinner("Downloading nflverse data..."):
            season_list = [int(s) for s in seasons.split()]
            paths = build_all_datasets(seasons=season_list)
            st.success(f"Built datasets: {', '.join(p.name for p in paths.values())}")

    if st.button("2. Train models"):
        with st.spinner("Training gradient boosting models..."):
            results = train_all()
            st.json(results)

    if st.button("3. Run walk-forward backtest"):
        with st.spinner("Running backtest..."):
            metrics = run_all_backtests(test_seasons=[2024])
            st.json(metrics)

    metrics = get_model_metrics()
    if metrics:
        st.subheader("Current model metrics")
        st.json(metrics)

st.sidebar.markdown(
    f"""
    ### About
    ScoreSense predicts weekly NFL fantasy points using:
    - **nflverse** weekly stats and play-by-play EPA
    - Rolling usage features (target share, WOPR)
    - Matchup context (opponent EPA allowed)

    [View case study](docs/CASE_STUDY.md)
    """
)
