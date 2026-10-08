"""Execute the actual deployment script against a fake Docker CLI, never Docker."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _bash():
    git_bash = Path('C:/Program Files/Git/bin/bash.exe')
    executable = str(git_bash) if os.name == 'nt' and git_bash.exists() else shutil.which('bash')
    if not executable:
        pytest.skip('Bash is required to execute the deployment script')
    return executable


def _shell_path(path):
    value = Path(path).as_posix()
    return f'/{value[0].lower()}/{value[3:]}' if os.name == 'nt' else value


def _run_deploy(tmp_path, state, *, archive_fails=False, healthy=True):
    script = tmp_path / 'deploy/server/deploy-on-server.sh'
    script.parent.mkdir(parents=True)
    script.write_bytes((ROOT / 'deploy/server/deploy-on-server.sh').read_bytes().replace(b'\r\n', b'\n'))
    archiver = tmp_path / 'scripts/ops/archive_frontend_assets.py'
    archiver.parent.mkdir(parents=True)
    shutil.copyfile(ROOT / 'scripts/ops/archive_frontend_assets.py', archiver)
    (tmp_path / '.env').write_text('')
    previous = tmp_path / 'previous-assets'
    previous.mkdir()
    (previous / 'DraftHub-old.js').write_text('exact retired JavaScript')
    binaries = tmp_path / 'bin'
    binaries.mkdir()
    fake_docker = '''#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "$1" = cp ]; then
  cp -a "$FAKE_ASSET_SOURCE/." "$3/"
  exit 0
fi
if [ "$1" = image ] || [ "$1" = builder ]; then exit 0; fi
if [ "$1" != compose ]; then exit 99; fi
shift
if [ "${1:-}" = -f ]; then shift 2; fi
command="${1:-}"
shift
case "$command" in
  ps)
    if [ "$FAKE_CONTAINER_STATE" = running ]; then echo previous-api;
    elif [ "$FAKE_CONTAINER_STATE" = stopped ]; then
      case " $* " in *" -a "*|*" --all "*) echo previous-api;; esac
    fi;;
  run)
    if [ "$FAKE_ARCHIVE_FAIL" = 1 ]; then exit 42; fi
    while [ "${1:-}" != python ]; do shift; done
    shift
    "$FAKE_PYTHON" "$1" "./${2#/app/}" "./${3#/app/}";;
  build)
    services=()
    for arg in "$@"; do
      case "$arg" in -*) ;; *) services+=("$arg");; esac
    done
    # Docker's actual unprofiled build plan contains api only. Explicit
    # service targets include the optional refresh worker too.
    if [ "${#services[@]}" = 0 ]; then services=(api); fi
    mkdir -p "$FAKE_IMAGE_DIR"
    for service in "${services[@]}"; do touch "$FAKE_IMAGE_DIR/$service"; done;;
  up|down|exec|start) ;;
  *) exit 98;;
esac
'''
    curl = '#!/usr/bin/env bash\necho healthy\n' if healthy else '#!/usr/bin/env bash\nexit 7\n'
    for name, content in [('docker', fake_docker), ('sleep', '#!/usr/bin/env bash\nexit 0\n'), ('curl', curl)]:
        file = binaries / name
        file.write_text(content, newline='\n')
        file.chmod(0o755)
    log = tmp_path / 'docker.log'
    env = {**os.environ, 'PATH': str(binaries) + os.pathsep + os.environ['PATH'],
           'FAKE_DOCKER_LOG': _shell_path(log), 'FAKE_ASSET_SOURCE': _shell_path(previous),
           'FAKE_CONTAINER_STATE': state, 'FAKE_PYTHON': _shell_path(sys.executable),
           'FAKE_IMAGE_DIR': _shell_path(tmp_path / 'built-images'),
           'FAKE_ARCHIVE_FAIL': '1' if archive_fails else '0'}
    if not healthy:
        # Git Bash puts its own curl ahead of the fake one; nothing listens here.
        env['SCORESENSE_HEALTH_URL'] = 'http://127.0.0.1:9/api/health'
    result = subprocess.run([_bash(), _shell_path(script)], cwd=tmp_path, env=env,
                            capture_output=True, text=True, timeout=20)
    return result, log.read_text(), tmp_path / 'artifacts/frontend_assets/DraftHub-old.js'


@pytest.mark.parametrize('state', ['running', 'stopped', 'absent'])
def test_release_assets_are_archived_before_container_replacement(tmp_path, state):
    result, log, asset = _run_deploy(tmp_path, state)
    assert result.returncode == 0, result.stdout + result.stderr
    if state == 'absent':
        assert not asset.exists()
    else:
        assert asset.read_text() == 'exact retired JavaScript'
        assert log.index('archive_frontend_assets.py') < log.index('up -d --force-recreate')


def test_archive_failure_stops_container_replacement(tmp_path):
    result, log, asset = _run_deploy(tmp_path, 'stopped', archive_fails=True)
    assert result.returncode != 0
    assert 'up -d --force-recreate' not in log
    assert not asset.exists()


def test_healthy_release_prunes_superseded_images_after_replacement(tmp_path):
    result, log, _ = _run_deploy(tmp_path, 'running')
    assert result.returncode == 0, result.stdout + result.stderr
    assert log.index('up -d --force-recreate') < log.index('image prune -f')
    assert 'builder prune -f --filter until=168h' in log


def test_unhealthy_release_keeps_previous_images(tmp_path):
    result, log, _ = _run_deploy(tmp_path, 'running', healthy=False)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'prune' not in log
    assert 'keeping previous images' in result.stdout


def test_deployment_rebuilds_optional_refresh_image_without_running_refresh(tmp_path):
    result, log, _ = _run_deploy(tmp_path, 'absent')
    assert result.returncode == 0, result.stdout + result.stderr
    assert {p.name for p in (tmp_path / 'built-images').iterdir()} == {'api', 'refresh'}
    assert not any('run ' in line and line.endswith(' refresh') for line in log.splitlines())
