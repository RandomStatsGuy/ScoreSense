"""Run the full ScoreSense pipeline: ETL, train, backtest, BDB companion."""

from src.pipeline.backtest import run_all_backtests
from src.config import DEFAULT_ETL_SEASONS, DEFAULT_TEST_SEASONS, DEFAULT_TRAIN_SEASONS
from src.etl.nflverse_etl import build_all_datasets
from src.pipeline.train import train_all

from bdb_companion.target_quality import save_target_quality_report


def main() -> None:
    print("=== Step 1: Build nflverse datasets ===")
    build_all_datasets(seasons=DEFAULT_ETL_SEASONS)

    print("\n=== Step 2: Train models ===")
    train_all(train_seasons=DEFAULT_TRAIN_SEASONS)

    print("\n=== Step 3: Walk-forward backtest ===")
    run_all_backtests(test_seasons=DEFAULT_TEST_SEASONS)

    print("\n=== Step 4: BDB target quality companion ===")
    save_target_quality_report()

    print("\nPipeline complete. API: uvicorn app.api:app --reload --port 8000")


if __name__ == "__main__":
    main()
