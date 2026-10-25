"""A stale release must fail before extraction, reset, or service shutdown."""
from pathlib import Path
import importlib.util
import io
import json
import subprocess
import tarfile

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("release_guard", ROOT / "scripts/ops/release_guard.py")
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)
POLICY = ROOT / "deploy/approved-release.json"


def test_current_source_is_the_approved_release():
    guard.check_tree(ROOT, guard.load_policy(POLICY))


@pytest.mark.parametrize("name", sorted(json.loads(POLICY.read_text(encoding="utf-8"))["protected_sources"]))
def test_removing_any_approved_fix_blocks_release(tmp_path, name):
    # One known-good policy entry at a time, so another mismatch cannot mask it.
    policy = {name: guard.load_policy(POLICY)[name]}
    dest = tmp_path / name
    dest.parent.mkdir(parents=True)
    dest.write_bytes((ROOT / name).read_bytes())
    guard.check_tree(tmp_path, policy)
    dest.write_bytes(b"// stale release without the approved fix\n")
    with pytest.raises(guard.ReleaseBlocked, match="Release blocked"):
        guard.check_tree(tmp_path, policy)
    dest.unlink()
    with pytest.raises(guard.ReleaseBlocked):
        guard.check_tree(tmp_path, policy)


def archive(path, members):
    with tarfile.open(path, "w:gz") as tar:
        for name, data, kind in members:
            info = tarfile.TarInfo(name)
            if kind == "symlink":
                info.type = tarfile.SYMTYPE
                info.linkname = "elsewhere"
                tar.addfile(info)
            else:
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))


@pytest.mark.parametrize("members", [
    [("src/fix.py", b"old", "file")],
    [("src/fix.py", b"good", "file"), ("src/fix.py", b"old", "file")],
    [("../fix.py", b"good", "file")],
    [("src/fix.py", b"", "symlink")],
    [("/fix.py", b"good", "file")],
    [("src/fix.py", b"good", "file"), ("./src/fix.py", b"old", "file")],
    [("src/fix.py", b"good", "file"), ("src//fix.py", b"old", "file")],
])
def test_archive_cannot_smuggle_a_stale_or_unsafe_source(tmp_path, members):
    path = tmp_path / "release.tar.gz"
    archive(path, members)
    with pytest.raises(guard.ReleaseBlocked):
        guard.check_archive(path, {"src/fix.py": guard.digest(b"good")})
    assert not (tmp_path / "src").exists()  # Validation never extracts.


def test_valid_archive_and_crlf_are_accepted(tmp_path):
    path = tmp_path / "release.tar.gz"
    archive(path, [("src/fix.py", b"good\r\n", "file")])
    guard.check_archive(path, {"src/fix.py": guard.digest(b"good\n")})


@pytest.mark.parametrize("content", ["{}", '{"schema":1,"protected_sources":{}}',
    '{"schema":1,"protected_sources":{"../escape":"bad"}}'])
def test_missing_or_lowered_policy_fails_closed(tmp_path, content):
    policy = tmp_path / "policy.json"
    with pytest.raises(guard.ReleaseBlocked):
        guard.load_policy(policy)
    policy.write_text(content)
    with pytest.raises(guard.ReleaseBlocked):
        guard.load_policy(policy)


def test_git_target_is_checked_without_resetting_checkout(tmp_path, monkeypatch):
    calls = []
    def show(cmd, **kw):
        calls.append(cmd)
        return b"stale"
    monkeypatch.setattr(subprocess, "check_output", show)
    with pytest.raises(guard.ReleaseBlocked):
        guard.check_git(tmp_path, "a" * 40, {"src/fix.py": guard.digest(b"good")})
    assert calls == [["git", "-C", str(tmp_path), "show", f"{'a' * 40}:src/fix.py"]]


def test_ci_guard_runs_before_stop_reset_and_database_backup():
    workflow = (ROOT / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
    gate = workflow.index('release_guard.py" git')
    assert gate < workflow.index("stop api")
    assert gate < workflow.index("git reset --hard")
    assert gate < workflow.index('DB_BACKUP=""')
    assert 'git reset --hard "$RELEASE_COMMIT"' in workflow


def test_server_guard_runs_before_environment_changes_and_build():
    script = (ROOT / "deploy/server/deploy-on-server.sh").read_text(encoding="utf-8")
    gate = script.index('release_guard.py" tree')
    assert gate < script.index("if [ ! -f .env ]")
    assert gate < script.index("build --pull")


def test_desktop_guard_runs_before_packaging_and_remote_extraction():
    script = (ROOT / "scripts/ops/deploy_to_vps.py").read_text(encoding="utf-8")
    assert script.index("check_tree(PROJECT_ROOT") < script.index('print(f"==> SSH preflight')
    assert script.index('release_guard.py\" archive') < script.index("tar -xzf")
    assert 'EXCLUDE_DIR_NAMES' in script


def load_helper(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"scripts/ops/{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_desktop_stale_checkout_cannot_upload_or_contact_server(monkeypatch):
    deploy = load_helper("deploy_to_vps")
    monkeypatch.setenv("SCORESENSE_VPS_HOST", "fixture.invalid")
    monkeypatch.setattr(deploy.shutil, "which", lambda *a: "available")
    def blocked(*a):
        raise guard.ReleaseBlocked("stale checkout")
    monkeypatch.setattr(deploy, "check_tree", blocked)
    def forbidden(*a, **kw):
        pytest.fail("Stale source must fail before any subprocess, upload, or SSH")
    monkeypatch.setattr(deploy.subprocess, "run", forbidden)
    with pytest.raises(guard.ReleaseBlocked, match="stale checkout"):
        deploy.main()


def test_package_excludes_old_releases_secrets_and_generated_assets(tmp_path, monkeypatch):
    deploy = load_helper("deploy_to_vps")
    monkeypatch.setattr(deploy, "PROJECT_ROOT", tmp_path)
    for name in ["src/fix.py", "outputs/old-release/src/fix.py", "frontend/dist/assets/old.js",
                 ".env", ".env.local", "accounts.sqlite", "data/admin_ops/key.bin",
                 "data/draft_hub/draft_hub.db", "artifacts/models/v2/current.pkl"]:
        dest = tmp_path / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"fixture")
    bundle = tmp_path.parent / "release.tar.gz"
    deploy.build_tarball(bundle)
    with tarfile.open(bundle) as tar:
        assert tar.getnames() == ["src/fix.py"]


def test_installed_floor_cannot_be_lowered_without_explicit_approval(tmp_path):
    installer = load_helper("install_release_guard")
    root, host = tmp_path / "reviewed", tmp_path / "host"
    (root / "deploy").mkdir(parents=True)
    (root / "scripts/ops").mkdir(parents=True)
    (root / "scripts/ops/release_guard.py").write_bytes(b"guard")
    source = root / "fix.py"
    policy = root / "deploy/approved-release.json"
    def revision(data):
        source.write_bytes(data)
        policy.write_text(json.dumps({"schema": 1, "protected_sources": {"fix.py": guard.digest(data)}}))
    revision(b"approved")
    installer.install(root, host)
    previous = (host / "approved-release.json").read_bytes()
    revision(b"changed")
    with pytest.raises(installer.ReleaseBlocked, match="Installed policy differs"):
        installer.install(root, host)
    assert (host / "approved-release.json").read_bytes() == previous
    installer.install(root, host, replace_policy=True)
    assert (host / "approved-release.previous.json").read_bytes() == previous


def test_releases_wait_for_refresh_before_source_or_service_mutation():
    workflow = (ROOT / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
    assert workflow.index("flock -x -w 1800 8") < workflow.index("stop api")
    assert workflow.index("flock -x -w 1800 8") < workflow.index("git reset --hard")
    client = (ROOT / "scripts/ops/deploy_to_vps.py").read_text(encoding="utf-8")
    assert client.index("flock -x -w 1800 8") < client.index("tar -xzf")
    server = (ROOT / "deploy/server/deploy-on-server.sh").read_text(encoding="utf-8")
    assert server.index("flock -x -w 1800 8") < server.index("build --pull")
    assert "SCORESENSE_DEPLOY_LOCK_HELD" in server


def test_release_waits_for_the_same_firefox_and_webkit_gates_as_ready_review():
    import yaml

    workflows = [yaml.safe_load((ROOT / ".github/workflows" / name).read_text(encoding="utf-8"))
                 for name in ("layout-audit.yml", "deploy.yml")]
    for workflow in workflows:
        gate = workflow["jobs"]["cross_browser_chat"]
        assert set(gate["strategy"]["matrix"]["engine"]) == {"firefox", "webkit"}
        assert gate["strategy"]["fail-fast"] is False
        assert gate["env"]["RELEASE_BROWSER_ENGINE"] == "${{ matrix.engine }}"
        commands = "\n".join(step.get("run", "") for step in gate["steps"])
        assert "playwright install --with-deps ${{ matrix.engine }}" in commands
        assert "npm run test:release-layout" in commands
    assert workflows[0]["jobs"]["cross_browser_chat"]["if"] == "github.event.pull_request.draft == false"
    deploy = workflows[1]["jobs"]["deploy"]
    assert set(deploy["needs"]) == {"regressions", "cross_browser_chat"}
    assert "always()" not in deploy.get("if", "")
