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

Write-Host '=== FitGO СП Update (keeps Postgres + .env) ===' -ForegroundColor Cyan

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
