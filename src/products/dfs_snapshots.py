"""Content-addressed build inputs for the legacy projection optimizer.

These are reproducibility records, not verified platform/scoring contracts or
proof that source data was available before lock. Callers may archive the returned
record in the existing account-scoped saved-build store.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json

import numpy as np
import scipy

from src.products.dfs_config import get_site_config

SCHEMA_VERSION = "dfs_build_inputs_v1"
ENGINE_VERSION = "legacy_milp_v1"


def _plain(value):
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (set, frozenset)):
        return sorted(_plain(v) for v in value)
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, np.generic):
        return value.item()
    return value


def canonical_json(value):
    return json.dumps(_plain(value), sort_keys=True, separators=(",", ":"), allow_nan=False)


def content_id(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class BuildSnapshot:
    """Serialized content prevents nested mutations after capture."""
    payload_json: str
    captured_at: str

    def to_dict(self):
        payload = json.loads(self.payload_json)
        return {"id": content_id(payload), "captured_at": self.captured_at, "content": payload}


def capture_build_snapshot(pool, players, *, site, parameters, context=None):
    rules = {"version": "legacy_roster_v1", "site": site,
             "certification": "unverified", "config": get_site_config(site)}
    from src.products.dfs_captain_comparison import comparison_budget

    payload = {
        "captain_comparison_budget": comparison_budget() if parameters.get("include_captain_comparison") else None,
        "schema_version": SCHEMA_VERSION,
        "engine": {"version": ENGINE_VERSION, "scipy": scipy.__version__, "numpy": np.__version__},
        "rules": rules, "rules_id": content_id(rules),
        "forecast_semantics": "player_quantiles_not_joint_lineup_quantiles_or_expected_payout",
        "scope": "submitted_pool_and_eligible_players_not_verified_exact_slate",
        "source_context": context or {},
        "source_published_at": None,
        "parameters": parameters,
        # Preserve row order: solver tie-breaking may depend on it. JSON preserves
        # missing observations as null; the exact solver inputs are recorded below.
        "input_pool": json.loads(pool.to_json(orient="records", date_format="iso", double_precision=15)),
        "eligible_players": [asdict(player) for player in players],
    }
    return BuildSnapshot(canonical_json(payload), datetime.now(timezone.utc).isoformat())


def verify_build_snapshot(record):
    """Detect altered content; this is not a signature or a trust attestation."""
    try:
        return (record["content"]["schema_version"] == SCHEMA_VERSION
                and record["id"] == content_id(record["content"])
                and record["content"]["rules_id"] == content_id(record["content"]["rules"]))
    except (KeyError, TypeError, ValueError):
        return False
