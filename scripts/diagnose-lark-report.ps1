#!/usr/bin/env pwsh
# AgentCli lark-cli 上报排查脚本
# 用法：在 PowerShell 里跑 .\diagnose-lark-report.ps1
# 输出：逐步检查 + 末尾汇总诊断

$ErrorActionPreference = 'Continue'
$home2 = $env:USERPROFILE
$agentcliRoot = Join-Path $env:APPDATA 'npm\node_modules\@yancyyu\agentcli'

function Section($t) { Write-Host "`n========== $t ==========" -ForegroundColor Cyan }
function OK($t) { Write-Host "[OK]   $t" -ForegroundColor Green }
function Warn($t) { Write-Host "[WARN] $t" -ForegroundColor Yellow }
function Bad($t) { Write-Host "[FAIL] $t" -ForegroundColor Red }

$issues = @()

# ---------- 1. 版本 ----------
Section '1. 版本'
try { $v = agentcli --version 2>&1; OK "agentcli: $v" } catch { Bad 'agentcli 命令找不到（PATH/执行策略问题）'; $issues += 'agentcli 命令不可用' }
try { $lv = lark-cli --version 2>&1; OK "lark-cli: $lv" } catch { Bad 'lark-cli 未安装'; $issues += 'lark-cli 未安装（npm install -g @larksuiteoapi/lark-cli）' }

# ---------- 2. lark-cli 授权状态 ----------
Section '2. lark-cli 授权状态'
$auth = $null
try { $auth = lark-cli auth status --json 2>&1 | ConvertFrom-Json } catch {}
if ($auth) {
    $u = $auth.identities.user
    if ($u.status -eq 'ready' -and $u.tokenStatus -eq 'valid') {
        OK "已登录: $($u.userName) (openId $($u.openId))"
        OK "scope: $($u.scope)"
    } else {
        Bad "用户授权未就绪: status=$($u.status) tokenStatus=$($u.tokenStatus)"
        $issues += 'lark-cli 授权未就绪（重新 lark-cli auth login）'
    }
} else {
    try { $auth2 = lark-cli auth status 2>&1; Write-Host $auth2 } catch { Bad 'lark-cli auth status 失败'; $issues += 'lark-cli 授权状态不可用' }
}

# ---------- 3. scope 覆盖检查 ----------
Section '3. 数字员工 scope 检查'
$required = @(
    'contact:contact.base:readonly','contact:user.base:readonly','contact:user.basic_profile:readonly',
    'docs:document.content:read','docx:document:readonly','docx:document:write_only',
    'drive:drive:readonly','im:chat:read','im:message:readonly','im:message.send_as_user'
)
if ($auth -and $auth.identities.user.scope) {
    $have = $auth.identities.user.scope -split ' '
    $missing = $required | Where-Object { $_ -notin $have }
    if ($missing.Count -eq 0) { OK 'scope 齐全（10/10）' }
    else { Warn "缺少 scope ($($missing.Count) 项): $($missing -join ', ')"; $issues += "scope 不足：$($missing -join ', ')" }
} else { Warn '无法读取 scope（跳过）' }

# ---------- 4. 凭证注册表（DPAPI） ----------
Section '4. lark-cli 凭证注册表'
$reg = 'HKCU:\Software\LarkCli\keychain\lark-cli'
if (Test-Path $reg) {
    $props = (Get-Item $reg).Property
    OK "注册表有 $($props.Count) 个凭证项"
} else {
    Bad "注册表路径不存在: $reg（凭证未存储，授权可能没成功）"
    $issues += 'DPAPI 注册表无 lark-cli 凭证'
}

# ---------- 5. 上报状态文件 ----------
Section '5. 上报状态 status.json'
$statusFile = Join-Path $home2 '.hermit\lark-credentials\status.json'
if (Test-Path $statusFile) {
    $s = Get-Content $statusFile -Raw | ConvertFrom-Json
    Write-Host "state: $($s.state)"
    Write-Host "lastAttempt: $($s.lastAttempt)"
    if ($s.report) {
        Write-Host "report.ok: $($s.report.ok)"
        Write-Host "report.reason: $($s.report.reason)"
        Write-Host "report.accountCount: $($s.report.accountCount)"
        Write-Host "report.message: $($s.report.message)"
        if (-not $s.report.ok) { $issues += "上次上报失败: $($s.report.reason) - $($s.report.message)" }
    }
} else { Warn 'status.json 不存在（从未上报过）' }

# ---------- 6. 手动触发上报 ----------
Section '6. 手动触发上报'
if (Test-Path $agentcliRoot) {
    Push-Location $agentcliRoot
    $report = node bin/hermit.mjs __telemetry-worker --report-lark-credentials-once --json 2>&1
    Pop-Location
    Write-Host $report
    try {
        $r = $report | ConvertFrom-Json
        if ($r.ok) { OK "上报成功，accountCount=$($r.accountCount)" }
        else { Bad "上报失败: reason=$($r.reason)"; $issues += "手动上报失败: $($r.reason)" }
    } catch { Bad '上报无有效 JSON 输出（worker 可能崩溃）'; $issues += 'worker 子进程崩溃' }
} else { Bad "找不到 agentcli 安装目录: $agentcliRoot" }

# ---------- 7. 上报服务器网络 ----------
Section '7. 上报服务器网络'
$settings = Join-Path $home2 '.hermit\settings.json'
$baseUrl = $null
if (Test-Path $settings) {
    $cfg = Get-Content $settings -Raw | ConvertFrom-Json
    $baseUrl = $cfg.cloud.baseUrl
    Write-Host "配置的 baseUrl: $baseUrl"
}
if ($baseUrl) {
    try {
        $resp = Invoke-WebRequest -Uri $baseUrl -Method Head -TimeoutSec 10 -UseBasicParsing
        OK "上报服务器可达 (HTTP $($resp.StatusCode))"
    } catch {
        Bad "上报服务器不可达: $($_.Exception.Message)"
        $issues += "上报服务器网络不通（代理/防火墙？）"
    }
} else { Warn '未配置 cloud.baseUrl（用默认地址）' }

# ---------- 汇总 ----------
Section '诊断汇总'
if ($issues.Count -eq 0) {
    OK '未发现明显问题。如仍上报失败，把本脚本完整输出贴给开发者。'
} else {
    Bad "发现 $($issues.Count) 个问题："
    $issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}
Write-Host "`n排查完毕。把以上输出（尤其是第 6 步）贴给开发者可进一步定位。`n" -ForegroundColor Cyan
