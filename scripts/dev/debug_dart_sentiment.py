import pandas as pd
from pathlib import Path

p = Path("data/candidates/sentiment_features.parquet")
df = pd.read_parquet(p)
qb = pd.read_parquet(
    "data/processed/qb_mlready.parquet",
    columns=["player_id", "player_display_name", "season", "week", "team"],
)
names = qb[qb["player_display_name"].str.contains("Dart", case=False, na=False)]
pids = set(names["player_id"].astype(str))
dart = df[df["player_id"].astype(str).isin(pids)]
out = Path("artifacts/analytics/dart_sentiment_debug.txt")
lines = [
    f"Dart player_ids: {pids}",
    f"rows: {len(dart)}",
    f"max season/week in all features: {int(df.season.max())} w{int(df.week.max())}",
    f"2026 w1 rows with mentions: {len(df[(df.season == 2026) & (df.week == 1) & (df.yt_mention_count > 0)])}",
]
if not dart.empty:
    sub = dart.sort_values(["season", "week"]).tail(15)
    for _, r in sub.iterrows():
        snip = str(r.get("yt_top_snippet", ""))[:220].replace("\n", " ")
        lines.append(
            f"{int(r.season)} w{int(r.week)} team={r.team} mentions={r.yt_mention_count} "
            f"inj={r.yt_injury_flag} score={float(r.yt_sentiment_score):.2f} | {snip}"
        )
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text("\n".join(lines), encoding="utf-8")
print(f"wrote {out}")
