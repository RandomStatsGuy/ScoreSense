"""Count cached videos that map to 2026 NFL weeks."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import pandas as pd
from src.core.schedule_utils import map_publish_time_to_week
from src.integrations.youtube import load_raw_content_cache

df = load_raw_content_cache()
print(f"cache rows: {len(df)}", flush=True)
if df.empty:
    raise SystemExit(0)

mapped = []
for _, row in df.iterrows():
    team = str(row.get("team") or "")
    pub = pd.Timestamp(row["published_at"])
    w = map_publish_time_to_week(team, pub, 2026)
    if w is not None:
        mapped.append((team, w, pub))

print(f"2026-mapped rows: {len(mapped)}", flush=True)
w1 = [m for m in mapped if m[1] == 1]
print(f"2026 week 1 mapped: {len(w1)}", flush=True)
from collections import Counter

print("w1 by team (top 10):", dict(Counter(t for t, w, _ in w1).most_common(10)), flush=True)
