"""CLI shim — prefer: python -m src.pipeline.backtest"""

from src.pipeline.backtest import main

if __name__ == "__main__":
    main()
