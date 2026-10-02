"""Shared invalidation for projection input and role semantics."""

import hashlib

from src.config import CACHE_DIR, ROOKIE_ROLE_OVERRIDES_PATH
from src.core.artifact_revision import file_content_revision

PROJECTION_INPUT_POLICY = "completed_profiles_current_roles_exact_week_consensus_v2"


def projection_input_revisions() -> list[str]:
    parts = [f"input_policy:{PROJECTION_INPUT_POLICY}"]
    if ROOKIE_ROLE_OVERRIDES_PATH.exists():
        parts.append("rookie_roles:" + hashlib.sha256(ROOKIE_ROLE_OVERRIDES_PATH.read_bytes()).hexdigest()[:16])
    schedule = CACHE_DIR / "nfl_schedules.parquet"
    if schedule.exists():
        parts.append(f"schedule:{file_content_revision(schedule)}")
    consensus = CACHE_DIR / "fantasypros" / "revision.txt"
    if consensus.exists():
        parts.append(f"consensus:{file_content_revision(consensus)}")
    return parts
