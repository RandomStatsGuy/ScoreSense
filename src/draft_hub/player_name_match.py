"""Normalize and fuzzy-match player names across commissioner sheets and Sleeper."""

from __future__ import annotations

import re

_EMBEDDED_SALARY_RE = re.compile(r"[A-Za-z][A-Za-z.'-]*\d{1,3}")
_MULTI_CHUNK_RE = re.compile(r"(?:[A-Z][a-z.'-]*\d{1,3}\s*){2,}")


def norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", str(name or "").strip())


def name_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", norm_name(name).lower())


def is_garbage_player_name(name: str) -> bool:
    """Reject concatenated PDF grid cells and other non-player strings."""
    n = norm_name(name)
    if not n or len(n) < 2:
        return True
    lower = n.lower()
    if lower in {"player", "nan", "none"}:
        return True
    if len(n) > 32:
        return True
    if len(_EMBEDDED_SALARY_RE.findall(n)) >= 2:
        return True
    if _MULTI_CHUNK_RE.search(n):
        return True
    if re.search(r"[a-z]\d{2,}", n, re.I):
        return True
    # PDF auction price glued to name: Brady3, Kmet1, Crowder1
    if re.search(r"[A-Za-z]\d{1,2}(?:\s+[A-Z]|\s*$)", n):
        return True
    # Multiple team abbrev + price tokens (DEF grid cells)
    if len(re.findall(r"\b[A-Z]{2,4}\s+\d+\b", n)) >= 2:
        return True
    # Two+ name+salary chunks in one cell
    if len(re.findall(r"[A-Za-z][A-Za-z.'-]*\d{1,2}", n)) >= 2:
        return True
    return False


_GENERATIONAL_SUFFIXES = frozenset({"jr", "sr", "ii", "iii", "iv", "v"})


def _strip_generational_tokens(tokens: list[str]) -> list[str]:
    """Drop trailing Jr/Sr/II/III so 'Penix Jr' keys as penix, not jr."""
    out = list(tokens)
    while out:
        tail = re.sub(r"[^A-Za-z]", "", out[-1]).lower()
        if tail in _GENERATIONAL_SUFFIXES:
            out.pop()
            continue
        break
    return out


def last_name_key(name: str) -> str:
    n = norm_name(name)
    if is_garbage_player_name(n):
        return ""
    parts = re.split(r"[\s.]+", n)
    tokens = _strip_generational_tokens([p for p in parts if p and not p.isdigit()])
    if not tokens:
        return name_key(n)
    last = re.sub(r"[^A-Za-z'-]", "", tokens[-1]).lower()
    return last or name_key(n)


def _edit_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost))
        prev = curr
    return prev[-1]


def names_likely_same(a: str, b: str, *, position: str | None = None, pos_b: str | None = None) -> bool:
    if is_garbage_player_name(a) or is_garbage_player_name(b):
        return False
    if name_key(a) == name_key(b):
        return True
    if position and pos_b and position != pos_b:
        return False
    la, lb = last_name_key(a), last_name_key(b)
    if not la or not lb:
        return False
    if la == lb:
        return True
    if len(la) >= 4 and len(lb) >= 4:
        dist = _edit_distance(la, lb)
        if dist <= 1:
            return True
        if len(la) >= 5 and len(lb) >= 5 and la[0] == lb[0] and dist <= 2:
            return True
    return False


def cluster_key(name: str, position: str | None = None) -> str | None:
    if is_garbage_player_name(name):
        return None
    ln = last_name_key(name)
    if not ln:
        return None
    pos = str(position or "").upper() or "?"
    if pos in {"DST", "D"}:
        pos = "DEF"
    return f"{ln}:{pos}"


def pick_canonical_name(candidates: list[str]) -> str:
    """Prefer the most common clean spelling, then standard dotted abbreviations."""
    from collections import Counter

    clean = [norm_name(c) for c in candidates if c and not is_garbage_player_name(c)]
    if not clean:
        return norm_name(candidates[0]) if candidates else ""

    counts = Counter(clean)
    max_count = counts.most_common(1)[0][1]
    top = [name for name, n in counts.items() if n == max_count]

    def score(n: str) -> tuple[int, int, str]:
        dotted = 1 if re.match(r"^[A-Z]\.\s+[A-Za-z'-]+$", n) else 0
        return (dotted, len(n), n.lower())

    return sorted(top, key=score, reverse=True)[0]


def find_matching_player_key(
    name: str,
    position: str | None,
    keys: dict[str, dict],
) -> str | None:
    """Find an existing ownership player key for a contract profile name."""
    target_cluster = cluster_key(name, position)
    if not target_cluster:
        return None
    for key, player in keys.items():
        pname = player.get("player_name") or ""
        if is_garbage_player_name(pname):
            continue
        if cluster_key(pname, player.get("position")) == target_cluster:
            return key
        if names_likely_same(name, pname, position=position, pos_b=player.get("position")):
            return key
    return None
