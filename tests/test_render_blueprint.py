"""Render Blueprint + start script — structure and persist/port wiring."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
BLUEPRINT = ROOT / "render.yaml"
START_SH = ROOT / "deploy" / "render" / "start.sh"


def _load_blueprint() -> dict:
    return yaml.safe_load(BLUEPRINT.read_text(encoding="utf-8"))


def test_blueprint_file_exists():
    assert BLUEPRINT.is_file()
    assert START_SH.is_file()


def test_blueprint_web_service_uses_existing_dockerfile():
    spec = _load_blueprint()
    services = spec["services"]
    assert len(services) == 1
    web = services[0]
    assert web["type"] == "web"
    assert web["runtime"] == "docker"
    assert web["name"] == "scoresense"
    assert web["dockerfilePath"] == "./deploy/Dockerfile"
    assert web["dockerContext"] == "."
    assert web["dockerCommand"] == "/bin/sh /app/deploy/render/start.sh"
    assert web["healthCheckPath"] == "/api/health"
    assert (ROOT / "deploy" / "Dockerfile").is_file()
    assert web["disk"]["mountPath"] == "/var/data"
    assert web["disk"]["sizeGB"] >= 10
    assert web["plan"] not in {"free", "0.5c-512mb"}
    # Render rejects maxShutdownDelaySeconds when a disk is attached.
    assert "maxShutdownDelaySeconds" not in web


def test_blueprint_does_not_hardcode_secrets():
    raw = BLUEPRINT.read_text(encoding="utf-8")
    assert "sk-" not in raw
    spec = _load_blueprint()
    groups = {g["name"]: g for g in spec["envVarGroups"]}
    secrets = groups["scoresense-secrets"]["envVars"]
    secret_keys = {item["key"] for item in secrets}
    assert {
        "PATREON_CLIENT_ID",
        "PATREON_CLIENT_SECRET",
        "PATREON_CAMPAIGN_ID",
        "ADMIN_EMAILS",
    } <= secret_keys
    assert all(item.get("sync") is False for item in secrets)
    web_env = spec["services"][0]["envVars"]
    jwt = next(item for item in web_env if item.get("key") == "JWT_SECRET")
    assert jwt.get("generateValue") is True


def test_blueprint_has_no_diskless_cron():
    spec = _load_blueprint()
    assert all(svc.get("type") != "cron" for svc in spec["services"])
    assert spec["previews"]["generation"] == "off"


def _run_start(
    tmp_path: Path, env: dict[str, str], persist: bool = True
) -> tuple[subprocess.CompletedProcess, Path]:
    app_root = tmp_path / "app"
    persist_dir = tmp_path / "var" / "data"
    env_file = tmp_path / "start.env"
    app_root.mkdir(exist_ok=True)
    (app_root / "data").mkdir(exist_ok=True)
    (app_root / "artifacts").mkdir(exist_ok=True)
    (app_root / "data" / "seed.txt").write_text("from-image", encoding="utf-8")
    (app_root / "artifacts" / "seed.txt").write_text("art-image", encoding="utf-8")
    if persist:
        persist_dir.mkdir(parents=True, exist_ok=True)
    run_env = {
        key: value
        for key, value in os.environ.items()
        if key
        not in {
            "FRONTEND_URL",
            "PATREON_REDIRECT_URI",
            "RENDER_EXTERNAL_URL",
            "PORT",
        }
    }
    run_env.update(
        {
            "SCORESENSE_APP_ROOT": str(app_root),
            "SCORESENSE_PERSIST_DIR": str(persist_dir),
            "SCORESENSE_RENDER_START_SKIP_SERVER": "1",
            "SCORESENSE_RENDER_START_ENV_FILE": str(env_file),
            **env,
        }
    )
    result = subprocess.run(
        ["/bin/sh", str(START_SH)],
        cwd=app_root,
        env=run_env,
        check=True,
        capture_output=True,
        text=True,
    )
    return result, env_file


def test_start_script_seeds_persist_and_symlinks(tmp_path):
    result, _ = _run_start(tmp_path, {})
    persist = tmp_path / "var" / "data"
    app = tmp_path / "app"
    assert (persist / ".seeded").is_file()
    assert (persist / "data" / "seed.txt").read_text(encoding="utf-8") == "from-image"
    assert app.joinpath("data").is_symlink()
    assert app.joinpath("data").resolve() == (persist / "data").resolve()
    assert "starting uvicorn" not in result.stdout


def test_start_script_does_not_clobber_live_persist(tmp_path):
    persist = tmp_path / "var" / "data"
    persist.mkdir(parents=True)
    (persist / "data").mkdir(parents=True)
    (persist / "artifacts").mkdir(parents=True)
    (persist / "data" / "draft_hub.db").write_text("live-league", encoding="utf-8")
    (persist / ".seeded").write_text("", encoding="utf-8")
    _run_start(tmp_path, {})
    assert (persist / "data" / "draft_hub.db").read_text(encoding="utf-8") == "live-league"
    assert not (persist / "data" / "seed.txt").exists()


def test_start_script_derives_public_urls(tmp_path):
    _, env_file = _run_start(
        tmp_path,
        {"RENDER_EXTERNAL_URL": "https://scoresense.onrender.com/"},
    )
    dumped = env_file.read_text(encoding="utf-8")
    assert "FRONTEND_URL=https://scoresense.onrender.com\n" in dumped
    assert (
        "PATREON_REDIRECT_URI=https://scoresense.onrender.com/api/auth/patreon/callback\n"
        in dumped
    )


def test_start_script_honors_port(tmp_path):
    _, env_file = _run_start(tmp_path, {"PORT": "10000"})
    assert "PORT=10000\n" in env_file.read_text(encoding="utf-8")


def test_start_script_keeps_explicit_frontend_url(tmp_path):
    _, env_file = _run_start(
        tmp_path,
        {
            "FRONTEND_URL": "https://app.example.com",
            "RENDER_EXTERNAL_URL": "https://scoresense.onrender.com",
        },
    )
    dumped = env_file.read_text(encoding="utf-8")
    assert "FRONTEND_URL=https://app.example.com\n" in dumped
    assert "scoresense.onrender.com" not in dumped.split("FRONTEND_URL=", 1)[1]


@pytest.mark.parametrize("missing", ("data", "artifacts"))
def test_start_script_survives_missing_image_trees(tmp_path, missing):
    app_root = tmp_path / "app"
    persist_dir = tmp_path / "var" / "data"
    app_root.mkdir()
    persist_dir.mkdir(parents=True)
    if missing != "data":
        (app_root / "data").mkdir()
    if missing != "artifacts":
        (app_root / "artifacts").mkdir()
    env = {
        **os.environ,
        "SCORESENSE_APP_ROOT": str(app_root),
        "SCORESENSE_PERSIST_DIR": str(persist_dir),
        "SCORESENSE_RENDER_START_SKIP_SERVER": "1",
    }
    subprocess.run(["/bin/sh", str(START_SH)], cwd=app_root, env=env, check=True)
    assert (persist_dir / ".seeded").is_file()
