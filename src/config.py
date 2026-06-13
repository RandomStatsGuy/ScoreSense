"""Project paths and constants."""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = PROJECT_ROOT / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
CACHE_DIR = DATA_DIR / "cache"

LEGACY_MODEL_DIR = PROJECT_ROOT / "Model"
MODEL_DIR = PROJECT_ROOT / "models" / "v2"
LEGACY_PREDICTIONS_DIR = PROJECT_ROOT / "Predictions"
PREDICTIONS_DIR = PROJECT_ROOT / "outputs" / "predictions"
BACKTEST_DIR = PROJECT_ROOT / "outputs" / "backtest"
BDB_DIR = PROJECT_ROOT / "outputs" / "bdb"

LEGACY_TRAIN_DIR = PROJECT_ROOT / "TrainData"
LEGACY_PFF_DIR = PROJECT_ROOT / "PFFData"

POSITIONS = ("qb", "rb", "wr")

# Standard PPR scoring weights (used when nflverse column unavailable)
FANTASY_SCORING = {
    "passing_yards": 0.04,
    "passing_tds": 4.0,
    "interceptions": -2.0,
    "rushing_yards": 0.1,
    "rushing_tds": 6.0,
    "receptions": 1.0,
    "receiving_yards": 0.1,
    "receiving_tds": 6.0,
    "fumbles_lost": -2.0,
}

# Seasons used for default training/backtest
DEFAULT_TRAIN_SEASONS = list(range(2018, 2024))
DEFAULT_TEST_SEASONS = [2024]

for path in (
    PROCESSED_DATA_DIR,
    CACHE_DIR,
    MODEL_DIR,
    PREDICTIONS_DIR,
    BACKTEST_DIR,
    BDB_DIR,
):
    path.mkdir(parents=True, exist_ok=True)
