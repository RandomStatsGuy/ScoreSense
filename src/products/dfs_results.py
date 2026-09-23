"""Account-scoped DFS entry ledger, build-time snapshots, and contest breakdowns."""
from contextlib import contextmanager
import json
import sqlite3
from src.config import DATA_DIR

RESULTS_DB = DATA_DIR / "dfs" / "results.db"


@contextmanager
def connect():
    RESULTS_DB.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(RESULTS_DB, timeout=15) as db:
        db.execute("CREATE TABLE IF NOT EXISTS entries (owner TEXT, site TEXT, contest TEXT, entry TEXT, payload TEXT, PRIMARY KEY(owner,site,contest,entry))")
        db.execute("CREATE TABLE IF NOT EXISTS builds (owner TEXT, id TEXT, payload TEXT, PRIMARY KEY(owner,id))")
        db.execute("CREATE TABLE IF NOT EXISTS contests (owner TEXT, site TEXT, contest TEXT, payload TEXT, PRIMARY KEY(owner,site,contest))")
        yield db


def read_results(owner):
    with connect() as db:
        entries = [json.loads(r[0]) for r in db.execute("SELECT payload FROM entries WHERE owner=?", (owner,))]
        referenced = {entry.get("build_id") for entry in entries}
        builds = [json.loads(row[1]) for i, row in enumerate(db.execute("SELECT id,payload FROM builds WHERE owner=? ORDER BY rowid DESC", (owner,))) if i < 100 or row[0] in referenced]
    return {"entries": entries, "builds": builds}


def import_entries(owner, entries, *, compact=False):
    with connect() as db:
        for entry in entries:
            key = (owner, entry["site"], entry["contest_id"], entry["entry_id"])
            old = db.execute("SELECT payload FROM entries WHERE owner=? AND site=? AND contest=? AND entry=?", key).fetchone()
            payload = json.loads(old[0]) if old else {}
            # Partial results imports never erase known fees or payout data.
            payload.update({k: v for k, v in entry.items() if v is not None})
            db.execute("INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?)", (*key, json.dumps(payload, allow_nan=False)))
    return {"imported": len(entries)} if compact else read_results(owner)


def save_build(owner, build):
    with connect() as db:
        db.execute("INSERT INTO builds VALUES (?,?,?)", (owner, build["id"], json.dumps(build, allow_nan=False)))
    return build


def delete_entries(owner, keys):
    with connect() as db:
        db.executemany("DELETE FROM entries WHERE owner=? AND site=? AND contest=? AND entry=?", [(owner, *key) for key in keys])
    return read_results(owner)


# The list view needs a name and a few totals. The breakdown itself holds every
# player on the slate, so it is never loaded just to draw the list.
CONTEST_SUMMARY_FIELDS = (
    "site",
    "contest_id",
    "contest_name",
    "contest_date",
    "saved_at",
    "entries",
    "unique_lineups",
    "my_entries",
    "my_payout_cents",
    "my_fee_cents",
)


def read_contests(owner):
    with connect() as db:
        rows = db.execute("SELECT payload FROM contests WHERE owner=? ORDER BY rowid DESC", (owner,))
        saved = [json.loads(row[0]) for row in rows]
    return {"contests": [{k: row.get(k) for k in CONTEST_SUMMARY_FIELDS} for row in saved]}


def read_contest(owner, site, contest_id):
    with connect() as db:
        row = db.execute(
            "SELECT payload FROM contests WHERE owner=? AND site=? AND contest=?",
            (owner, site, contest_id),
        ).fetchone()
    return json.loads(row[0]) if row else None


def save_contest(owner, contest):
    """Re-saving a contest replaces it. INSERT OR REPLACE writes a new rowid, so
    the newest save also sorts first, which is the order the list wants."""
    key = (owner, contest["site"], contest["contest_id"])
    with connect() as db:
        db.execute("INSERT OR REPLACE INTO contests VALUES (?,?,?,?)", (*key, json.dumps(contest, allow_nan=False)))
    return read_contests(owner)


def delete_contest(owner, site, contest_id):
    with connect() as db:
        db.execute("DELETE FROM contests WHERE owner=? AND site=? AND contest=?", (owner, site, contest_id))
    return read_contests(owner)
