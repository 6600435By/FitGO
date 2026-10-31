# Rebuild API + prisma push. Frontends stay up; Apache serves maintenance only if API health fails after restart.
# Breaking API changes for the client channel must ship with a client release the same day.
param(
  [string]$FitGoRoot = '',
  [switch]$SkipPull,
  [switch]$SkipBackup,
  [string]$OffsitePath = ''
)

$ErrorActionPreference = 'Stop'
if (-not $FitGoRoot) {
  $FitGoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
}

function Resolve-GitExe {
  $cmd = Get-Command git -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($c in @(
    "${env:ProgramFiles}\Git\cmd\git.exe",
    "${env:ProgramFiles(x86)}\Git\cmd\git.exe"
  )) { if (Test-Path $c) { return $c } }
  return $null
}

if (-not $SkipBackup) {
  $backupScript = Join-Path $PSScriptRoot 'Backup-FitGO.ps1'
  if (Test-Path $backupScript) {
    # Backup-FitGO.ps1 takes InstallRoot (C:\FitGO), not FitGoRoot (C:\FitGO\FitGO)
    $installRoot = Split-Path -Parent $FitGoRoot
    $backupArgs = @{
      InstallRoot = $installRoot
      Mode = 'Backup'
    }
    if ($OffsitePath) { $backupArgs['OffsitePath'] = $OffsitePath }
    & $backupScript @backupArgs
  }
}

Stop-Service FitGO-API -ErrorAction SilentlyContinue

Push-Location $FitGoRoot
try {
  if (-not $SkipPull -and (Test-Path (Join-Path $FitGoRoot '.git'))) {
    $gitExe = Resolve-GitExe
    if ($gitExe) {
      & $gitExe pull --ff-only
      if ($LASTEXITCODE -ne 0) { throw "git pull failed" }
    }
  }
  pnpm install
  pnpm --filter @fitgo/shared-types build
  pnpm --filter @fitgo/1c-adapter build
  pnpm --filter @fitgo/osmi-adapter build
  pnpm --filter @fitgo/api exec prisma generate
  pnpm --filter @fitgo/api exec prisma db push --skip-generate --accept-data-loss
  pnpm --filter @fitgo/api exec node ./scripts/backfill-phone-verified.mjs
  pnpm --filter @fitgo/api build
} finally {
  Pop-Location
}

Start-Service FitGO-API
Start-Sleep -Seconds 3
try {
  $health = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/api/auth/me' -Method GET -TimeoutSec 5 -UseBasicParsing
  Write-Host "API up (HTTP $($health.StatusCode) on /auth/me without token is expected)." -ForegroundColor Green
} catch {
  # 401 is fine — means Nest answered
  if ($_.Exception.Response.StatusCode.value__ -eq 401) {
    Write-Host 'API up (401 on /auth/me without token).' -ForegroundColor Green
  } else {
    Write-Host "WARNING: API health check failed: $_" -ForegroundColor Yellow
  }
}

Write-Host 'API updated. Smoke client login + staff login before announcing.' -ForegroundColor Cyan
