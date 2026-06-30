# Start ScoreSense API + Vite dev servers (use when port 8000 is stuck).
$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

$ApiPort = if ($env:SCORESENSE_API_PORT) { $env:SCORESENSE_API_PORT } else { "8010" }
$env:PYTHONPATH = "."
$env:SCORESENSE_API_PORT = $ApiPort

function Stop-ScoreSenseApiListeners {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*ScoreSense*" -and $_.CommandLine -like "*uvicorn*app.api*" } |
        ForEach-Object {
            Write-Host "Stopping stale API process $($_.ProcessId)"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    Start-Sleep -Seconds 1
}

Stop-ScoreSenseApiListeners

Write-Host "Starting API on http://127.0.0.1:$ApiPort"
Start-Process -FilePath "$Root\.venv\Scripts\uvicorn.exe" `
  -ArgumentList "app.api:app", "--reload", "--port", $ApiPort `
  -WorkingDirectory $Root `
  -WindowStyle Normal

Start-Sleep -Seconds 2

Write-Host "Starting Vite on http://127.0.0.1:5173 (proxy -> $ApiPort)"
Set-Location "$Root\frontend"
$env:SCORESENSE_API_PORT = $ApiPort
npm run dev -- --host 127.0.0.1 --port 5173
