"""Rebuild and persist 2026 sentiment features."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import pandas as pd
from src.sentiment.aggregate import rebuild_sentiment_features

print("Rebuilding sentiment features for 2026…", flush=True)
features = rebuild_sentiment_features(2026)
w1 = features[(features.season == 2026) & (features.week == 1) & (features.yt_mention_count > 0)]
print(f"Saved {len(features[features.season == 2026])} rows for 2026 ({len(w1)} with W1 mentions)", flush=True)
