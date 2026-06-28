# Run from PowerShell (outside Cursor if SSH uses a password):
#   .\deploy.ps1
#
# Requires: ssh/scp works to root@104.207.158.4

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:SCORESENSE_VPS_HOST = "104.207.158.4"
$env:SCORESENSE_VPS_USER = "root"
$env:SCORESENSE_VPS_PATH = "/root/scoresense"
if (Test-Path "$env:USERPROFILE\.ssh\id_rsa") {
    $env:SCORESENSE_SSH_KEY = "$env:USERPROFILE\.ssh\id_rsa"
}

Write-Host "Deploying ScoreSense to $($env:SCORESENSE_VPS_HOST) ..."
& .\.venv\Scripts\python.exe scripts/ops/deploy_to_vps.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "If .env was missing on the server, SSH in and run:"
Write-Host "  cd /root/scoresense && cp deploy/env.production.example .env && nano .env"
Write-Host "  docker compose -f deploy/docker-compose.prod.yml up -d --build"
