"""League communication: private threads, reactions, read cursors, and on-site alerts.

The existing chat tables remain the thread source. Every operation authorizes the
requested league/channel; private message bodies never enter the room broadcast.
"""
from __future__ import annotations

import json
import hashlib
import re
import uuid
from typing import Any

from src.draft_hub import storage

REACTIONS = ("👍", "😂", "🔥", "👀", "🤝", "❤️")
DEFAULT_PREFERENCES = {"trade": True, "direct": True, "mention": True, "league": False}


def install_schema(conn) -> None:
    for statement in (
        """CREATE TABLE IF NOT EXISTS chat_reaction (
            message_id TEXT NOT NULL, user_sub TEXT NOT NULL, emoji TEXT NOT NULL,
            PRIMARY KEY(message_id, user_sub, emoji))""",
        """CREATE TABLE IF NOT EXISTS chat_read_cursor (
            channel_id TEXT NOT NULL, user_sub TEXT NOT NULL, read_at TEXT NOT NULL,
            PRIMARY KEY(channel_id, user_sub))""",
        """CREATE TABLE IF NOT EXISTS chat_message_mention (
            message_id TEXT NOT NULL, team_id TEXT NOT NULL,
            PRIMARY KEY(message_id, team_id))""",
        """CREATE TABLE IF NOT EXISTS site_notification (
            id TEXT NOT NULL, user_sub TEXT NOT NULL, league_id TEXT NOT NULL,
            kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
            target_json TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT,
            PRIMARY KEY(id, user_sub))""",
        "CREATE INDEX IF NOT EXISTS idx_site_notification ON site_notification(user_sub, league_id, created_at)",
        """CREATE TABLE IF NOT EXISTS communication_preference (
            user_sub TEXT PRIMARY KEY, preferences_json TEXT NOT NULL)""",
    ):
        conn.execute(statement)


def _members(league_id: str) -> list[dict]:
    return [t for t in storage.list_league_teams(league_id) if not t.get("is_bot")]


def members(league_id: str) -> list[dict]:
    return [{"id": t["id"], "name": t.get("owner_name") or t.get("name") or "Manager",
             "team_name": t.get("name"), "can_message": bool(t.get("user_sub")),
             "is_staff": bool(t.get("is_commissioner"))} for t in _members(league_id)]


def _identity(league_id: str, sub: str) -> tuple[dict, dict]:
    league = storage.get_league(league_id)
    team = storage.get_team_by_user(league_id, sub)
    if not league or not team or team.get("is_bot"):
        raise PermissionError("League membership required")
    return league, team


def _direct_kind(team: dict, other: dict) -> str:
    # Team slots can be reassigned. Bind the conversation to the two accounts
    # as well, so a replacement owner never inherits another person's DMs.
    subjects = json.dumps(sorted((team["user_sub"], other["user_sub"])))
    digest = hashlib.sha256(subjects.encode()).hexdigest()
    return "direct:" + ":".join(sorted((team["id"], other["id"]))) + ":" + digest


def _channel(league_id: str, sub: str, thread: str) -> dict:
    league, team = _identity(league_id, sub)
    if thread == "office":
        if not team.get("is_commissioner") and league.get("commissioner_sub") != sub:
            raise PermissionError("Staff chat is commissioner managed")
        kind = thread
    elif thread == "league":
        kind = thread
    elif thread.startswith("direct:"):
        other = storage.get_team(thread.removeprefix("direct:"))
        if (not other or other.get("league_id") != league_id or not other.get("user_sub")
                or other.get("is_bot") or other["id"] == team["id"]):
            raise ValueError("Choose another manager in this league")
        kind = _direct_kind(team, other)
    else:
        raise ValueError("Invalid chat channel")
    with storage.get_conn() as conn:
        conn.execute("INSERT OR IGNORE INTO league_chat_channel(id,league_id,kind,created_at) VALUES (?,?,?,?)",
                     (str(uuid.uuid4()), league_id, kind, storage._utcnow()))
        return dict(conn.execute("SELECT * FROM league_chat_channel WHERE league_id=? AND kind=?", (league_id, kind)).fetchone())


def _message_channel(league_id: str, sub: str, message_id: str) -> dict:
    _, team = _identity(league_id, sub)
    with storage.get_conn() as conn:
        channel = conn.execute("""SELECT c.* FROM league_chat_channel c
            JOIN league_chat_message m ON m.channel_id=c.id WHERE m.id=? AND c.league_id=?""",
            (message_id, league_id)).fetchone()
    if not channel:
        raise ValueError("Message not found")
    kind = channel["kind"]
    if kind.startswith("direct:"):
        participants = kind.removeprefix("direct:").split(":")[:2]
        if team["id"] not in participants:
            raise PermissionError("This conversation is private")
        kind = "direct:" + next(t for t in participants if t != team["id"])
    resolved = _channel(league_id, sub, kind)
    if resolved["id"] != channel["id"]:
        raise PermissionError("This conversation is private")
    return dict(channel)


def enrich_messages(league_id: str, rows: list[dict], sub: str) -> list[dict]:
    people = {t["id"]: t for t in _members(league_id)}
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    placeholders = ",".join("?" for _ in ids)
    with storage.get_conn() as conn:
        reactions = conn.execute(f"SELECT * FROM chat_reaction WHERE message_id IN ({placeholders})", ids).fetchall()
        mentions = conn.execute(f"SELECT * FROM chat_message_mention WHERE message_id IN ({placeholders})", ids).fetchall()
    result = []
    for source in rows:
        message = dict(source)
        person = people.get(message.get("team_id"), {})
        message["owner_name"] = person.get("owner_name") or person.get("name") or "Manager"
        message["team_name"] = person.get("name") or message.get("team_name")
        groups: dict[str, dict] = {}
        for r in reactions:
            if r["message_id"] != message["id"]:
                continue
            group = groups.setdefault(r["emoji"], {"emoji": r["emoji"], "count": 0, "mine": False})
            group["count"] += 1
            group["mine"] |= r["user_sub"] == sub
        message["reactions"] = list(groups.values())
        message["mentions"] = [{"team_id": r["team_id"], "name": people.get(r["team_id"], {}).get("owner_name")
                                or people.get(r["team_id"], {}).get("name") or "Manager"}
                               for r in mentions if r["message_id"] == message["id"]]
        # The JWT subject is an internal identity, not public chat content.
        message.pop("author_sub", None)
        result.append(message)
    return result


def list_messages(league_id: str, sub: str, thread: str, *, limit: int = 80) -> list[dict]:
    channel = _channel(league_id, sub, thread)
    with storage.get_conn() as conn:
        rows = conn.execute("SELECT * FROM league_chat_message WHERE channel_id=? ORDER BY created_at DESC,id DESC LIMIT ?",
                            (channel["id"], max(1, min(limit, 100)))).fetchall()
    return enrich_messages(league_id, [dict(r) for r in reversed(rows)], sub)


def _notify(conn, *, event_id: str, sub: str, league_id: str, kind: str, title: str,
            body: str, target: dict, at: str) -> None:
    conn.execute("""INSERT OR IGNORE INTO site_notification
        (id,user_sub,league_id,kind,title,body,target_json,created_at) VALUES (?,?,?,?,?,?,?,?)""",
        (event_id, sub, league_id, kind, title, body[:300], json.dumps(target), at))


def post_message(league_id: str, sub: str, thread: str, body: str, mention_ids: list[str]) -> dict:
    channel = _channel(league_id, sub, thread)
    _, author = _identity(league_id, sub)
    text = body.strip()
    if not text or len(text) > storage.CHAT_BODY_MAX:
        raise ValueError("Messages must be between 1 and 2000 characters")
    people = _members(league_id)
    by_id = {t["id"]: t for t in people}
    author = by_id.get(author["id"], author)
    eligible = people
    if channel["kind"] == "office":
        league = storage.get_league(league_id)
        eligible = [t for t in people if t.get("is_commissioner") or t.get("user_sub") == league["commissioner_sub"]]
    elif channel["kind"].startswith("direct:"):
        eligible = [t for t in people if t["id"] in channel["kind"].removeprefix("direct:").split(":")]
    eligible_ids = {t["id"] for t in eligible}
    if any(tid not in eligible_ids for tid in mention_ids):
        raise ValueError("Mention a manager in this conversation")
    # Explicit IDs are validated against visible text; legacy typed mentions also work.
    mentioned = {t["id"] for t in eligible if re.search(r"(?<!\w)@" + re.escape(t.get("owner_name") or t.get("name") or "") + r"(?!\w)", text, re.IGNORECASE)}
    if any(tid not in mentioned for tid in mention_ids):
        raise ValueError("Mentioned manager must appear in the message")
    message_id, at = str(uuid.uuid4()), storage._utcnow()
    name = author.get("owner_name") or author.get("name") or "Manager"
    with storage.get_conn() as conn:
        conn.execute("INSERT INTO league_chat_message(id,channel_id,author_sub,team_id,body,created_at) VALUES (?,?,?,?,?,?)",
                     (message_id, channel["id"], sub, author["id"], text, at))
        for tid in mentioned:
            conn.execute("INSERT INTO chat_message_mention(message_id,team_id) VALUES (?,?)", (message_id, tid))
        for person in eligible:
            recipient = person.get("user_sub")
            if not recipient or recipient == sub:
                continue
            direct = channel["kind"].startswith("direct:")
            kind = "direct" if direct else "mention" if person["id"] in mentioned else "league"
            if thread == "office" and kind == "league":
                continue
            target_thread = "direct:" + author["id"] if direct else thread
            title = f"{name} messaged you" if direct else f"{name} mentioned you" if kind == "mention" else f"{name} in league chat"
            _notify(conn, event_id="chat:" + message_id, sub=recipient, league_id=league_id, kind=kind,
                    title=title, body=text, target={"thread": target_thread, "message_id": message_id}, at=at)
        row = dict(conn.execute("SELECT * FROM league_chat_message WHERE id=?", (message_id,)).fetchone())
    return enrich_messages(league_id, [row], sub)[0]


def set_reaction(league_id: str, sub: str, message_id: str, emoji: str, pressed: bool) -> dict:
    _message_channel(league_id, sub, message_id)
    if emoji not in REACTIONS:
        raise ValueError("Choose a supported reaction")
    with storage.get_conn() as conn:
        if pressed:
            conn.execute("INSERT OR IGNORE INTO chat_reaction(message_id,user_sub,emoji) VALUES (?,?,?)", (message_id, sub, emoji))
        else:
            conn.execute("DELETE FROM chat_reaction WHERE message_id=? AND user_sub=? AND emoji=?", (message_id, sub, emoji))
        row = dict(conn.execute("SELECT * FROM league_chat_message WHERE id=?", (message_id,)).fetchone())
    return enrich_messages(league_id, [row], sub)[0]


def mark_read(league_id: str, sub: str, thread: str, last_id: str) -> None:
    channel = _channel(league_id, sub, thread)
    with storage.get_conn() as conn:
        row = conn.execute("SELECT created_at FROM league_chat_message WHERE id=? AND channel_id=?", (last_id, channel["id"])).fetchone()
        if not row:
            raise ValueError("Message not found in this conversation")
        conn.execute("""INSERT INTO chat_read_cursor(channel_id,user_sub,read_at) VALUES (?,?,?)
            ON CONFLICT(channel_id,user_sub) DO UPDATE SET read_at=MAX(read_at,excluded.read_at)""", (channel["id"], sub, row["created_at"]))
        # Reading a thread clears its message alerts as well as the bubble count.
        conn.execute("""UPDATE site_notification SET read_at=? WHERE user_sub=? AND league_id=?
            AND kind IN ('direct','mention','league') AND created_at<=?
            AND json_extract(target_json,'$.thread')=? AND read_at IS NULL""",
            (storage._utcnow(), sub, league_id, row["created_at"], thread))


def preferences(sub: str, patch: dict | None = None) -> dict:
    with storage.get_conn() as conn:
        row = conn.execute("SELECT preferences_json FROM communication_preference WHERE user_sub=?", (sub,)).fetchone()
        result = {**DEFAULT_PREFERENCES, **(json.loads(row[0]) if row else {})}
        if patch is not None:
            if any(key not in DEFAULT_PREFERENCES or type(value) is not bool for key, value in patch.items()):
                raise ValueError("Invalid notification preference")
            result.update(patch)
            conn.execute("INSERT INTO communication_preference(user_sub,preferences_json) VALUES (?,?) ON CONFLICT(user_sub) DO UPDATE SET preferences_json=excluded.preferences_json",
                         (sub, json.dumps(result)))
        return result


def _trade_alerts(league_id: str, sub: str, team: dict) -> None:
    people = {t["id"]: t for t in _members(league_id)}
    with storage.get_conn() as conn:
        proposals = conn.execute("SELECT * FROM trade_proposal WHERE league_id=? ORDER BY updated_at DESC LIMIT 100", (league_id,)).fetchall()
        for p in proposals:
            if team["id"] not in {str(x.get("team_id")) for x in json.loads(p["parties_json"])}:
                continue
            acceptances = json.loads(p["acceptances_json"] or "{}")
            if p["status"] == "pending":
                if p["created_by_sub"] == sub or acceptances.get(team["id"]) not in (None, "pending"):
                    continue
                title, text = "New trade offer", "A manager sent you a trade to review."
            elif p["status"] in ("executed", "awaiting_sleeper", "rejected", "cancelled"):
                title = {"executed": "Trade completed", "awaiting_sleeper": "Trade accepted", "rejected": "Trade declined", "cancelled": "Trade cancelled"}[p["status"]]
                text = "Review the latest trade response."
            else:
                continue
            partner = next((people.get(x.get("team_id"), {}) for x in json.loads(p["parties_json"]) if x.get("team_id") != team["id"]), {})
            name = partner.get("owner_name") or partner.get("name")
            if name:
                text = f"{name} · {text}"
            # A pending offer is one event; subsequent acceptance/status changes get new IDs.
            event_at = p["created_at"] if p["status"] == "pending" else p["updated_at"]
            _notify(conn, event_id=f"trade:{p['id']}:{p['status']}", sub=sub, league_id=league_id, kind="trade",
                    title=title, body=text, target={"view": "trades", "proposal_id": p["id"]}, at=event_at)


def summary(league_id: str, sub: str) -> dict[str, Any]:
    league, team = _identity(league_id, sub)
    _channel(league_id, sub, "league")
    staff = bool(team.get("is_commissioner") or league["commissioner_sub"] == sub)
    _trade_alerts(league_id, sub, team)
    prefs = preferences(sub)
    threads = []
    visible_channels = []
    people = {t["id"]: t for t in _members(league_id)}
    with storage.get_conn() as conn:
        channels = conn.execute("SELECT * FROM league_chat_channel WHERE league_id=?", (league_id,)).fetchall()
        for c in channels:
            kind = c["kind"]
            if kind == "office" and not staff:
                continue
            other_id = None
            if kind.startswith("direct:"):
                parties = kind.removeprefix("direct:").split(":")[:2]
                if team["id"] not in parties:
                    continue
                other_id = next(t for t in parties if t != team["id"])
                if other_id not in people:
                    continue
                if not people[other_id].get("user_sub") or kind != _direct_kind(team, people[other_id]):
                    continue
            elif kind not in ("league", "office"):
                continue
            key = f"direct:{other_id}" if other_id else kind
            visible_channels.append(c["id"])
            cursor = conn.execute("SELECT read_at FROM chat_read_cursor WHERE channel_id=? AND user_sub=?", (c["id"], sub)).fetchone()
            unread = conn.execute("SELECT COUNT(*) FROM league_chat_message WHERE channel_id=? AND author_sub<>? AND created_at>?",
                                  (c["id"], sub, cursor[0] if cursor else "")).fetchone()[0]
            latest = conn.execute("SELECT body,created_at FROM league_chat_message WHERE channel_id=? ORDER BY created_at DESC,id DESC LIMIT 1", (c["id"],)).fetchone()
            person = people.get(other_id, {})
            threads.append({"key": key, "name": person.get("owner_name") or person.get("name") if other_id else "Staff" if kind == "office" else "League",
                            "unread": unread, "latest": dict(latest) if latest else None})
        enabled_kinds = [kind for kind, enabled in prefs.items() if enabled]
        rows, count = [], 0
        if enabled_kinds:
            # Muted league activity cannot push DMs/trades out of the feed. Recheck
            # channel access so revoked staff cannot read a saved message preview.
            scope = f"""user_sub=? AND league_id=? AND kind IN ({','.join('?' for _ in enabled_kinds)})
                AND (kind='trade' OR json_extract(target_json,'$.message_id') IN
                    (SELECT id FROM league_chat_message WHERE channel_id IN ({','.join('?' for _ in visible_channels)})))"""
            params = [sub, league_id, *enabled_kinds, *visible_channels]
            rows = conn.execute(f"SELECT * FROM site_notification WHERE {scope} ORDER BY created_at DESC,id DESC LIMIT 80", params).fetchall()
            count = conn.execute(f"SELECT COUNT(*) FROM site_notification WHERE {scope} AND read_at IS NULL", params).fetchone()[0]
    return {"threads": threads, "unread": sum(t["unread"] for t in threads), "notification_unread": count,
            "notifications": [{**{k: r[k] for k in ("id", "kind", "title", "body", "created_at", "read_at")}, "target": json.loads(r["target_json"])} for r in rows],
            "preferences": prefs, "members": members(league_id)}


def read_notifications(league_id: str, sub: str, ids: list[str], through: str | None = None) -> None:
    _identity(league_id, sub)
    if not ids and not through:
        return
    with storage.get_conn() as conn:
        if through:
            # A snapshot cutoff marks older alerts while preserving later arrivals.
            conn.execute("UPDATE site_notification SET read_at=? WHERE league_id=? AND user_sub=? AND created_at<=? AND read_at IS NULL",
                         (storage._utcnow(), league_id, sub, through))
        elif ids:
            conn.execute(f"UPDATE site_notification SET read_at=? WHERE league_id=? AND user_sub=? AND id IN ({','.join('?' for _ in ids)})",
                         [storage._utcnow(), league_id, sub, *ids])


def clear_channel_metadata(conn, channel_id: str) -> None:
    for table in ("chat_reaction", "chat_message_mention"):
        conn.execute(f"DELETE FROM {table} WHERE message_id IN (SELECT id FROM league_chat_message WHERE channel_id=?)", (channel_id,))
    conn.execute("DELETE FROM site_notification WHERE json_extract(target_json,'$.message_id') IN (SELECT id FROM league_chat_message WHERE channel_id=?)", (channel_id,))
