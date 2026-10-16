<#
.SYNOPSIS
  Update FitGO SP code without wiping Postgres or .env
  ASCII-only strings for Windows PowerShell 5.1 (Server 2016) encoding safety.
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = 'C:\FitGO',
  [switch]$SkipPull,
  [switch]$SkipBackup,
  [string]$BackupRoot = 'E:\FitGO-Backups',
  [string]$OffsitePath = ''
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FitGoRoot = Join-Path $InstallRoot 'FitGO'
$NssmExe = Join-Path $InstallRoot 'tools\nssm\nssm.exe'

if (-not (Test-Path (Join-Path $FitGoRoot 'pnpm-workspace.yaml'))) {
  throw "FitGO not found at $FitGoRoot"
}

function Deploy-AppMaintenancePage {
  param(
    [string]$RepoRoot,
    [string]$Htdocs = 'C:\Apache24\htdocs'
  )
  $src = Join-Path $RepoRoot 'deploy\hoster-wp-proxy\maintenance.html'
  if (-not (Test-Path $src)) {
    Write-Host "WARNING: maintenance.html not found at $src - skip Apache 503 page." -ForegroundColor Yellow
    return
  }
  if (-not (Test-Path $Htdocs)) {
    Write-Host "WARNING: Apache htdocs not found at $Htdocs - skip app-maintenance.html." -ForegroundColor Yellow
    return
  }
  $dest = Join-Path $Htdocs 'app-maintenance.html'
  Copy-Item -Path $src -Destination $dest -Force
  Write-Host "Apache 503 page: $dest" -ForegroundColor Green
}

function Resolve-GitExe {
  $cmd = Get-Command git -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    'C:\Program Files\Git\cmd\git.exe',
    'C:\Program Files (x86)\Git\cmd\git.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

Write-Host '=== FitGO SP Update (keeps Postgres + .env) ===' -ForegroundColor Cyan

if (-not $SkipBackup) {
  $backupScript = Join-Path $ScriptDir 'Backup-FitGO.ps1'
  if (-not (Test-Path $backupScript)) {
    throw ("Backup-FitGO.ps1 not found at " + $backupScript + " - refuse Update without backup")
  }
  Write-Host 'Pre-update backup...' -ForegroundColor Cyan
  $backupArgs = @{
    InstallRoot = $InstallRoot
    Mode = 'Backup'
  }
  if ($BackupRoot) { $backupArgs['BackupRoot'] = $BackupRoot }
  if ($OffsitePath) { $backupArgs['OffsitePath'] = $OffsitePath }
  & $backupScript @backupArgs
} else {
  Write-Host 'SkipBackup: continuing without pre-update dump.' -ForegroundColor Yellow
}

# Russian "updating" page for Apache ErrorDocument while Web is stopped.
# Install before Stop-Service so :444 never falls through to 1C VRS JSON.
# Name must NOT start with fitgo (Alias /fitgo → 1C).
Deploy-AppMaintenancePage -RepoRoot $FitGoRoot

Stop-Service FitGO-Web -ErrorAction SilentlyContinue
Stop-Service FitGO-API -ErrorAction SilentlyContinue

Push-Location $FitGoRoot
try {
  if (-not $SkipPull -and (Test-Path (Join-Path $FitGoRoot '.git'))) {
    $gitExe = Resolve-GitExe
    if ($gitExe) {
      Write-Host "git pull via $gitExe"
      & $gitExe pull --ff-only
      if ($LASTEXITCODE -ne 0) { throw "git pull failed (exit $LASTEXITCODE)" }
    } else {
      Write-Host 'WARNING: git not in PATH and not found under Program Files.' -ForegroundColor Yellow
      Write-Host '  Skipping pull. Either install Git for Windows, or copy new code then:' -ForegroundColor Yellow
      Write-Host '  .\Update-FitGO.ps1 -SkipPull' -ForegroundColor Yellow
      Write-Host '  Or download: https://github.com/6600435By/FitGO/archive/refs/heads/main.zip' -ForegroundColor Yellow
    }
  } elseif ($SkipPull) {
    Write-Host 'SkipPull: using files already on disk.' -ForegroundColor Yellow
  }
  pnpm install
  pnpm --filter @fitgo/shared-types build
  pnpm --filter @fitgo/1c-adapter build
  pnpm --filter @fitgo/osmi-adapter build
  pnpm --filter @fitgo/api exec prisma generate
  # Schema evolves; never drop data. Prefer migrate later; push OK for early SP.
  # --accept-data-loss: only for new unique warnings (not table drops); without it Update hangs on y/N.
  pnpm --filter @fitgo/api exec prisma db push --skip-generate --accept-data-loss
  pnpm --filter @fitgo/api build
  pnpm --filter @fitgo/web build
} finally {
  Pop-Location
}

# Re-copy after git pull in case maintenance.html changed on this update.
Deploy-AppMaintenancePage -RepoRoot $FitGoRoot

Start-Service FitGO-API
Start-Service FitGO-Web
Write-Host 'Update done. Services restarted.' -ForegroundColor Green
