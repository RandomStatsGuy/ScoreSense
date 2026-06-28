"""CLI shim — prefer: python -m src.pipeline.train"""

from src.pipeline.train import main

if __name__ == "__main__":
    main()
