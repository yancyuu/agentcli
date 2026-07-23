#!/usr/bin/env pwsh
# 手动触发一次 lark 凭证上报
# 用法：在 PowerShell 跑 .\report-lark-once.ps1

$ErrorActionPreference = 'Continue'
$root = Join-Path $env:APPDATA 'npm\node_modules\@yancyyu\agentcli'

if (-not (Test-Path $root)) {
    Write-Host "[FAIL] 找不到 agentcli 安装目录: $root" -ForegroundColor Red
    exit 1
}

Write-Host "触发 lark 凭证上报（一次）..." -ForegroundColor Cyan
Push-Location $root
node bin/hermit.mjs __telemetry-worker --report-lark-credentials-once --json 2>&1
$code = $LASTEXITCODE
Pop-Location

Write-Host "`n退出码: $code" -ForegroundColor Cyan
if ($code -eq 0) { Write-Host "[OK] 上报完成" -ForegroundColor Green }
else { Write-Host "[FAIL] 上报异常，看上方输出" -ForegroundColor Red }
