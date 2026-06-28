#!/usr/bin/env python3
"""Discover Chat Sports per-team YouTube channel IDs via YouTube Data API."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.config import ANALYTICS_DIR  # noqa: E402
from src.integrations.youtube import _api_get, youtube_api_key_configured  # noqa: E402
from src.sentiment.chat_sports_channels import (  # noqa: E402
    CHAT_SPORTS_CHANNELS_PATH,
    CHAT_SPORTS_DISCOVERED_PATH,
    CHAT_SPORTS_SHORT,
    confidence_from_score,
    naming_variant_from_title,
    resolve_channel_by_handles,
    score_chat_sports_match,
    search_queries_for_team,
    team_keywords,
)
from src.sentiment.channels import TEAM_FRANCHISE_NAMES  # noqa: E402

def search_channel_candidates(team: str, queries: list[str]) -> list[dict]:
    seen: set[str] = set()
    candidates: list[dict] = []
    for query in queries:
        for attempt in range(3):
            try:
                payload = _api_get(
                    "search",
                    {"part": "snippet", "q": query, "type": "channel", "maxResults": 8},
                )
                break
            except Exception as exc:
                if "429" in str(exc) and attempt < 2:
                    time.sleep(2.0 * (attempt + 1))
                    continue
                raise
        time.sleep(0.75)
        for item in payload.get("items") or []:
            snippet = item.get("snippet") or {}
            channel_id = (item.get("id") or {}).get("channelId")
            title = str(snippet.get("title") or "")
            if not channel_id or not channel_id.startswith("UC") or channel_id in seen:
                continue
            seen.add(channel_id)
            score = score_chat_sports_match(title, team)
            candidates.append(
                {
                    "channel_id": channel_id,
                    "title": title,
                    "score": score,
                    "query": query,
                }
            )
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates


def fetch_channel_stats(channel_id: str) -> dict:
    payload = _api_get(
        "channels",
        {
            "part": "snippet,statistics",
            "id": channel_id,
        },
    )
    items = payload.get("items") or []
    if not items:
        return {}
    item = items[0]
    snippet = item.get("snippet") or {}
    stats = item.get("statistics") or {}
    custom_url = snippet.get("customUrl")
    return {
        "custom_url": str(custom_url) if custom_url else None,
        "subscriber_count": int(stats.get("subscriberCount") or 0),
        "video_count": int(stats.get("videoCount") or 0),
        "title": str(snippet.get("title") or ""),
    }


def discover_team(team: str, *, existing_row: dict | None = None) -> dict:
    queries = search_queries_for_team(team)
    if existing_row and existing_row.get("search_queries"):
        queries = list(dict.fromkeys(list(existing_row["search_queries"]) + queries))

    row = {
        "team": team,
        "network": "chat_sports",
        "tier": "reporting",
        "weight": 1.0,
        "search_queries": queries,
        "naming_variant": "unknown",
        "confidence": "unresolved",
        "active": True,
        "promote_to_features": team == "LV",
        "channel_id": f"UC_PLACEHOLDER_{team}_CS",
        "label": f"{CHAT_SPORTS_SHORT[team]} Report by Chat Sports",
    }

    if existing_row:
        cid = str(existing_row.get("channel_id") or "")
        if cid and not cid.startswith("UC_PLACEHOLDER"):
            row["channel_id"] = cid
            row["label"] = existing_row.get("label") or row["label"]
            row["confidence"] = existing_row.get("confidence") or "high"
            row["naming_variant"] = existing_row.get("naming_variant") or row["naming_variant"]
            row["promote_to_features"] = bool(existing_row.get("promote_to_features", False))
            if existing_row.get("custom_url"):
                row["custom_url"] = existing_row["custom_url"]
            return row

    handle_match: dict | None = None
    for attempt in range(3):
        try:
            handle_match = resolve_channel_by_handles(team, api_get=_api_get)
            break
        except Exception as exc:
            if "429" in str(exc) and attempt < 2:
                time.sleep(2.0 * (attempt + 1))
                continue
            handle_match = None
            break

    best = None
    if handle_match:
        best = {
            "channel_id": handle_match["channel_id"],
            "title": handle_match["title"],
            "score": handle_match["score"],
            "resolution": "handle",
        }
    else:
        try:
            candidates = search_channel_candidates(team, queries)
            if candidates:
                best = {**candidates[0], "resolution": "search"}
        except Exception as exc:
            row["discovery_error"] = str(exc)[:200]

    if best and best["score"] >= 8:
        stats: dict = {}
        if best.get("resolution") == "handle" and handle_match:
            stats = {
                "title": handle_match["title"],
                "custom_url": handle_match.get("custom_url"),
                "subscriber_count": handle_match.get("subscriber_count"),
                "video_count": handle_match.get("video_count"),
            }
        else:
            for attempt in range(3):
                try:
                    stats = fetch_channel_stats(best["channel_id"])
                    break
                except Exception as exc:
                    if "429" in str(exc) and attempt < 2:
                        time.sleep(2.0 * (attempt + 1))
                        continue
                    stats = {}
                    break
        title = stats.get("title") or best["title"]
        row.update(
            {
                "channel_id": best["channel_id"],
                "label": title,
                "confidence": confidence_from_score(best["score"]),
                "naming_variant": naming_variant_from_title(title),
                "custom_url": stats.get("custom_url"),
                "subscriber_count": stats.get("subscriber_count"),
                "video_count": stats.get("video_count"),
                "resolution_method": best.get("resolution"),
            }
        )
    return row


def discover_all(*, apply: bool = False, teams: list[str] | None = None) -> dict:
    if not youtube_api_key_configured():
        return {"status": "skipped", "reason": "YOUTUBE_API_KEY not set"}

    existing: dict[str, dict] = {}
    resume_path = CHAT_SPORTS_DISCOVERED_PATH if CHAT_SPORTS_DISCOVERED_PATH.exists() else CHAT_SPORTS_CHANNELS_PATH
    if resume_path.exists():
        prior = yaml.safe_load(resume_path.read_text(encoding="utf-8")) or {}
        for row in prior.get("channels") or []:
            if isinstance(row, dict) and row.get("team"):
                existing[str(row["team"]).upper()] = row

    channels: list[dict] = []
    unresolved: list[str] = []
    low_confidence: list[str] = []
    resolved_count = 0

    team_list = sorted(TEAM_FRANCHISE_NAMES)
    if teams:
        team_list = [t.upper() for t in teams if t.upper() in TEAM_FRANCHISE_NAMES]

    for team in team_list:
        prior = existing.get(team)
        if prior:
            cid = str(prior.get("channel_id") or "")
            if cid and not cid.startswith("UC_PLACEHOLDER"):
                row = {k: v for k, v in prior.items() if k != "candidates"}
                channels.append(row)
                resolved_count += 1
                if str(row.get("confidence") or "") == "medium":
                    low_confidence.append(team)
                continue
        try:
            row = discover_team(team, existing_row=prior)
        except Exception as exc:
            row = {
                "team": team,
                "network": "chat_sports",
                "channel_id": f"UC_PLACEHOLDER_{team}_CS",
                "label": f"{CHAT_SPORTS_SHORT[team]} Report by Chat Sports",
                "search_queries": search_queries_for_team(team),
                "naming_variant": "unknown",
                "confidence": "unresolved",
                "active": True,
                "promote_to_features": team == "LV",
                "discovery_error": str(exc)[:200],
            }
        # Strip internal candidate list from yaml output
        row.pop("candidates", None)
        row.pop("match_score", None)
        row.pop("matched_query", None)
        channels.append(row)
        cid = str(row.get("channel_id") or "")
        conf = str(row.get("confidence") or "unresolved")
        if cid.startswith("UC") and not cid.startswith("UC_PLACEHOLDER"):
            resolved_count += 1
        else:
            unresolved.append(team)
        if conf == "medium":
            low_confidence.append(team)

        # Checkpoint after each team to survive rate limits
        checkpoint = {"schema_version": 1, "channels": channels + [
            {
                "team": t,
                "network": "chat_sports",
                "channel_id": f"UC_PLACEHOLDER_{t}_CS",
                "label": f"{CHAT_SPORTS_SHORT[t]} Report by Chat Sports",
                "search_queries": search_queries_for_team(t),
                "naming_variant": "unknown",
                "confidence": "unresolved",
                "active": True,
                "promote_to_features": t == "LV",
            }
            for t in sorted(TEAM_FRANCHISE_NAMES)
            if t not in {r["team"] for r in channels}
        ]}
        CHAT_SPORTS_DISCOVERED_PATH.write_text(
            yaml.safe_dump(checkpoint, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
        time.sleep(2.0)

    payload = {"schema_version": 1, "channels": channels}
    out_path = CHAT_SPORTS_CHANNELS_PATH if apply else CHAT_SPORTS_DISCOVERED_PATH
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True), encoding="utf-8")

    summary = {
        "status": "ok",
        "teams_total": len(channels),
        "resolved_count": resolved_count,
        "unresolved_teams": unresolved,
        "low_confidence_teams": low_confidence,
        "output": str(out_path),
        "high_confidence": [r["team"] for r in channels if r.get("confidence") == "high"],
        "medium_confidence": [r["team"] for r in channels if r.get("confidence") == "medium"],
    }
    report_path = ANALYTICS_DIR / "chat_sports_discovery.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write to chat_sports_channels.yaml")
    parser.add_argument("--teams", nargs="*", default=None, help="Optional team codes to discover")
    args = parser.parse_args()
    result = discover_all(apply=args.apply, teams=args.teams)
    print(yaml.safe_dump(result, sort_keys=False))
    return 0 if result.get("status") == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
