import pandas as pd
from src.config import PROCESSED_DATA_DIR

df = pd.read_parquet(PROCESSED_DATA_DIR / "qb_mlready.parquet")
fp = [c for c in df.columns if c.startswith("fp_")]
print("fp_cols", fp)
print("rows_with_fp", int(df["fp_consensus_ppr"].notna().sum()) if "fp_consensus_ppr" in df.columns else 0)
