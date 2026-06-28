# Mirror production Draft Hub test data locally (cap sheet rosters + trade-test league).
# Run from repo root: .\scripts\dev\mirror_prod_hub.ps1
# Optional: .\scripts\dev\mirror_prod_hub.ps1 -RoomCode 0BBESQ

param(
    [string]$RoomCode = "0BBESQ",
    [string]$LeagueId = ""
)

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root
$env:PYTHONPATH = $Root

if (-not $LeagueId) {
    $LeagueId = & "$Root\.venv\Scripts\python.exe" -c @"
import sys
from pathlib import Path
ROOT = Path(r'$Root')
sys.path.insert(0, str(ROOT))
from src.draft_hub import storage
with storage.get_conn() as conn:
    row = conn.execute(
        'SELECT id FROM league WHERE room_code = ? ORDER BY created_at DESC LIMIT 1',
        ('$RoomCode',),
    ).fetchone()
if not row:
    raise SystemExit(f'No league with room code $RoomCode')
print(row['id'])
"@
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$Tsv = Join-Path $Root "data\draft_hub\cap_sheet_test.tsv"
$Map = Join-Path $Root "data\draft_hub\manager_team_map.yaml"

Write-Host "==> Importing cap sheet into league $LeagueId (room $RoomCode) ..."
& "$Root\.venv\Scripts\python.exe" scripts/ops/import_cap_sheet.py $Tsv `
    --league-id $LeagueId `
    --map $Map `
    --sync-sleeper

Write-Host ""
Write-Host "==> Verifying roster + trade insights ..."
& "$Root\.venv\Scripts\python.exe" scripts/dev/verify_hub_mirror.py $LeagueId

Write-Host ""
Write-Host "==> Dev servers (optional): .\scripts\dev\dev.ps1"
Write-Host "    API: http://127.0.0.1:8000  |  UI: http://127.0.0.1:5173"
Write-Host "    Draft Hub -> Setup -> Insights -> Trade ideas"
