# Start ScoreSense API + Vite dev servers (use when port 8000 is stuck).
$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

$ApiPort = if ($env:SCORESENSE_API_PORT) { $env:SCORESENSE_API_PORT } else { "8014" }
$env:PYTHONPATH = "."
$env:SCORESENSE_API_PORT = $ApiPort

function Stop-ScoreSenseApiListeners {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -like "*ScoreSense*" -and
            ($_.CommandLine -like "*uvicorn*app.api*" -or $_.CommandLine -like "*-m*uvicorn*app.api*")
        } |
        ForEach-Object {
            Write-Host "Stopping stale API process $($_.ProcessId)"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*ScoreSense*frontend*" -and $_.CommandLine -like "*vite*" } |
        ForEach-Object {
            Write-Host "Stopping stale Vite process $($_.ProcessId)"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -like "*ScoreSense*" -and
            $_.CommandLine -like "*multiprocessing-fork*"
        } |
        ForEach-Object {
            Write-Host "Stopping orphan API worker $($_.ProcessId)"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    foreach ($port in @("8000", "8010", "8012", "8014", "8015")) {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object {
                $procId = $_.OwningProcess
                if ($procId) {
                    Write-Host "Stopping listener on :$port (PID $procId)"
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                }
            }
    }
    Start-Sleep -Seconds 2
}

Stop-ScoreSenseApiListeners

$ApiLog = Join-Path $Root "data\dev\api-$ApiPort.log"
New-Item -ItemType Directory -Force -Path (Split-Path $ApiLog -Parent) | Out-Null

Write-Host "Starting API on http://127.0.0.1:$ApiPort (log: $ApiLog)"
$env:PYTHONPATH = $Root
Start-Process -FilePath "$Root\.venv\Scripts\python.exe" `
  -ArgumentList "-m", "uvicorn", "app.api:app", "--reload", "--port", $ApiPort, "--host", "127.0.0.1" `
  -WorkingDirectory $Root `
  -RedirectStandardError $ApiLog `
  -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(45)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $health = Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/api/health" -UseBasicParsing -TimeoutSec 2
        if ($health.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {
        # API still booting or crashed — keep polling
    }
    Start-Sleep -Milliseconds 500
}

if (-not $ready) {
    Write-Host ""
    Write-Host "ERROR: API did not respond on http://127.0.0.1:$ApiPort within 45s." -ForegroundColor Red
    if (Test-Path $ApiLog) {
        Write-Host "Last lines from API log:" -ForegroundColor Yellow
        Get-Content $ApiLog -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
    Write-Host ""
    Write-Host "Try manually: `$env:PYTHONPATH='.'; .venv\Scripts\python.exe -m uvicorn app.api:app --reload --port $ApiPort"
    exit 1
}

Write-Host "API ready on http://127.0.0.1:$ApiPort"

Write-Host "Starting Vite on http://127.0.0.1:5173 (proxy -> $ApiPort)"
Set-Location "$Root\frontend"
$env:SCORESENSE_API_PORT = $ApiPort
npm run dev -- --host 127.0.0.1 --port 5173
