# Kill every process listening on port 8000 (and orphaned uvicorn workers), then start API from .venv.
$ErrorActionPreference = "SilentlyContinue"
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not (Test-Path "$repo\.venv\Scripts\python.exe")) {
    $repo = (Get-Location).Path
}

function Stop-PortListeners([int]$Port) {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        taskkill /F /T /PID $_.OwningProcess | Out-Null
    }
}

function Stop-OrphanUvicornWorkers() {
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
        $cmd = $_.CommandLine
        if ($cmd -match "multiprocessing\.spawn.*spawn_main" -or $cmd -match "uvicorn app\.api:app") {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
}

Stop-PortListeners 8000
Stop-OrphanUvicornWorkers
Start-Sleep -Seconds 2

$env:PYTHONPATH = "."
Set-Location $repo
Write-Host "Starting API from $repo (venv python, port 8000)"
& "$repo\.venv\Scripts\python.exe" -m uvicorn app.api:app --reload --port 8000
