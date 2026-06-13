"""Run the full ScoreSense pipeline: ETL, train, backtest, BDB companion."""

from src.backtest import run_all_backtests
from src.config import DEFAULT_TRAIN_SEASONS, DEFAULT_TEST_SEASONS
from src.etl.nflverse_etl import build_all_datasets
from src.train import train_all

from bdb_companion.target_quality import save_target_quality_report


def main() -> None:
    print("=== Step 1: Build nflverse datasets ===")
    build_all_datasets(seasons=DEFAULT_TRAIN_SEASONS + DEFAULT_TEST_SEASONS)

    print("\n=== Step 2: Train models ===")
    train_all(train_seasons=DEFAULT_TRAIN_SEASONS)

    print("\n=== Step 3: Walk-forward backtest ===")
    run_all_backtests(test_seasons=DEFAULT_TEST_SEASONS)

    print("\n=== Step 4: BDB target quality companion ===")
    save_target_quality_report()

    print("\nPipeline complete. Run: streamlit run app/streamlit_app.py")


if __name__ == "__main__":
    main()
