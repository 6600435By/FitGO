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

    # Heal nightly FitGO-Backup task; never touches 1C 1s-backup.
    $regBackup = Join-Path $PSScriptRoot 'Register-FitGOBackupTask.ps1'
    $nightTask = Get-ScheduledTask -TaskName 'FitGO-Backup' -ErrorAction SilentlyContinue
    $needRegister = $false
    if (-not $nightTask) { $needRegister = $true }
    elseif ($nightTask.State -eq 'Disabled') { $needRegister = $true }
    else {
      $act = @($nightTask.Actions) | Select-Object -First 1
      $uid = [string]$nightTask.Principal.UserId
      $logon = [string]$nightTask.Principal.LogonType
      if (-not $act -or -not $act.Arguments -or ($act.Arguments -notmatch 'Backup-FitGO\.ps1')) {
        $needRegister = $true
      } elseif ($act.Arguments -match '-File\s+"') {
        $needRegister = $true
      } elseif ($uid -notmatch 'SYSTEM') {
        $needRegister = $true
      } elseif ($logon -and $logon -ne 'ServiceAccount') {
        $needRegister = $true
      }
    }
    if ($needRegister -and (Test-Path -LiteralPath $regBackup)) {
      Write-Host 'FitGO-Backup task missing/broken - re-registering (1C task untouched)...' -ForegroundColor Yellow
      $regArgs = @{
        InstallRoot = $installRoot
        BackupRoot = 'E:\FitGO-Backups'
      }
      if ($OffsitePath) { $regArgs['OffsitePath'] = $OffsitePath }
      & $regBackup @regArgs
    }
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
  pnpm --filter @fitgo/api exec node ./scripts/apply-db-constraints.mjs
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'WARNING: apply-db-constraints.mjs failed — check Postgres EXCLUDE constraints manually.' -ForegroundColor Yellow
  }
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
