"""Bounded public roster activity from the locally saved league movement log."""
from src.draft_hub import storage


def recent_week_activity(league_id: str, season: int, week: int) -> list[dict]:
    # Inferred contract history and private waiver bids are not public roster moves.
    with storage.get_conn() as conn:
        rows = conn.execute(
            """SELECT player_name, event_type, from_owner, to_owner, event_at
               FROM league_player_movement
               WHERE league_id = ? AND season_year = ? AND week = ?
                 AND event_type IN ('add', 'waiver', 'drop', 'trade')
                 AND ((sleeper_transaction_id IS NOT NULL AND TRIM(sleeper_transaction_id) != '')
                      OR (source = 'manual' AND confidence IN ('confirmed', 'verified')))
               ORDER BY event_at DESC, id DESC LIMIT 3""",
            (league_id, int(season), int(week)),
        ).fetchall()
    return [dict(row) for row in rows]
