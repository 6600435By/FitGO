<#
.SYNOPSIS
  Update FitGO СП code without wiping Postgres or .env
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = 'C:\FitGO',
  [switch]$SkipPull
)

$ErrorActionPreference = 'Stop'
$FitGoRoot = Join-Path $InstallRoot 'FitGO'
$NssmExe = Join-Path $InstallRoot 'tools\nssm\nssm.exe'

if (-not (Test-Path (Join-Path $FitGoRoot 'pnpm-workspace.yaml'))) {
  throw "FitGO not found at $FitGoRoot"
}

Write-Host '=== FitGO СП Update (keeps Postgres + .env) ===' -ForegroundColor Cyan

Stop-Service FitGO-Web -ErrorAction SilentlyContinue
Stop-Service FitGO-API -ErrorAction SilentlyContinue

Push-Location $FitGoRoot
try {
  if (-not $SkipPull -and (Test-Path (Join-Path $FitGoRoot '.git'))) {
    git pull --ff-only
  }
  pnpm install
  pnpm --filter @fitgo/shared-types build
  pnpm --filter @fitgo/1c-adapter build
  pnpm --filter @fitgo/osmi-adapter build
  pnpm --filter @fitgo/api exec prisma generate
  # Schema evolves; never drop data. Prefer migrate in future; push is OK for early СП.
  pnpm db:push
  pnpm --filter @fitgo/api build
  pnpm --filter @fitgo/web build
} finally {
  Pop-Location
}

Start-Service FitGO-API
Start-Service FitGO-Web
Write-Host 'Update done. Services restarted.' -ForegroundColor Green
