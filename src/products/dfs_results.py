"""Account-scoped DFS entry ledger, build-time snapshots, and contest breakdowns."""
from contextlib import contextmanager
from hashlib import sha256
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
        db.execute("CREATE TABLE IF NOT EXISTS salary_snapshots (owner TEXT, id TEXT, payload TEXT, PRIMARY KEY(owner,id))")
        db.execute("CREATE TABLE IF NOT EXISTS build_retries (owner TEXT, retry_key TEXT, build_id TEXT, content_hash TEXT, PRIMARY KEY(owner,retry_key))")
        yield db


def read_results(owner):
    with connect() as db:
        entries = [json.loads(r[0]) for r in db.execute("SELECT payload FROM entries WHERE owner=?", (owner,))]
        referenced = {entry.get("build_id") for entry in entries}
        builds = [json.loads(row[1]) for i, row in enumerate(db.execute("SELECT id,payload FROM builds WHERE owner=? ORDER BY rowid DESC", (owner,))) if i < 100 or row[0] in referenced]
    return {"entries": entries, "builds": builds}


def read_builds(owner, build_ids):
    """Resolve only requested IDs inside this account, independent of list paging."""
    found = {}
    with connect() as db:
        for build_id in set(build_ids):
            row = db.execute("SELECT payload FROM builds WHERE owner=? AND id=?", (owner, build_id)).fetchone()
            if row:
                found[build_id] = json.loads(row[0])
    return found


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


def save_build(owner, build, *, idempotency_key=None):
    """A retry key identifies immutable input within the authenticated account.

    Keep its original ID and saved_at after an ambiguous/lost response. The key
    is never a lookup across accounts, and changed inputs need a new version.
    """
    with connect() as db:
        if idempotency_key:
            content = {k: v for k, v in build.items() if k not in {"id", "saved_at"}}
            content_hash = sha256(json.dumps(content, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
            # Serialize the lookup and both writes so concurrent retries cannot
            # save duplicate builds or publish a key before its build exists.
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT build_id,content_hash FROM build_retries WHERE owner=? AND retry_key=?",
                             (owner, idempotency_key)).fetchone()
            if old:
                if old[1] != content_hash:
                    raise ValueError("This build retry key already identifies different inputs. Save a new export version.")
                return json.loads(db.execute("SELECT payload FROM builds WHERE owner=? AND id=?", (owner, old[0])).fetchone()[0])
        db.execute("INSERT INTO builds VALUES (?,?,?)", (owner, build["id"], json.dumps(build, allow_nan=False)))
        if idempotency_key:
            db.execute("INSERT INTO build_retries VALUES (?,?,?,?)", (owner, idempotency_key, build["id"], content_hash))
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
