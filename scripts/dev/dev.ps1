# Start ScoreSense API + React dev server (run from project root)
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$env:PYTHONPATH = $Root
Set-Location $Root

# Orphan uvicorn --reload workers can keep port 8000 bound after the parent exits.
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -match 'scoresense.*multiprocessing\.spawn' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='uvicorn.exe'" |
    Where-Object { $_.CommandLine -match 'app\.api:app' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

Write-Host "Starting FastAPI on http://127.0.0.1:8000 ..."
Start-Process -FilePath "$Root\.venv\Scripts\uvicorn.exe" `
    -ArgumentList "app.api:app", "--reload", "--port", "8000" `
    -WorkingDirectory $Root `
    -WindowStyle Normal

Start-Sleep -Seconds 2

Write-Host "Starting React on http://localhost:5173 ..."
Set-Location "$Root\frontend"
npm run dev
