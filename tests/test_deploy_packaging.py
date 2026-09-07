"""Deploy tarball must not include live account or league databases."""

import importlib.util
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location(
    "deploy_to_vps",
    _ROOT / "scripts" / "ops" / "deploy_to_vps.py",
)
_DEPLOY = importlib.util.module_from_spec(_SPEC)
assert _SPEC and _SPEC.loader
_SPEC.loader.exec_module(_DEPLOY)


def test_deploy_skips_auth_and_league_runtime_state():
    skip = _DEPLOY._should_skip
    assert skip(Path("data/auth/users.db"))
    assert skip(Path("data/auth/users.db-wal"))
    assert skip(Path("data/draft_hub/draft_hub.db"))
    assert skip(Path("users.db"))
    assert not skip(Path("src/auth/user_store.py"))
    assert not skip(Path("src/draft_hub/storage.py"))
