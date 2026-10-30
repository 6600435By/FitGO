# Rebuild + restart client LK Next only (FitGO-Client :3002). Staff and API stay up.
param(
  [string]$FitGoRoot = '',
  [switch]$SkipPull
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

Stop-Service FitGO-Client -ErrorAction SilentlyContinue

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
  # Empty API URL = same-origin /api via Next rewrite on lk.ffs.by
  $env:NEXT_PUBLIC_API_URL = ''
  $env:FITGO_API_PROXY_TARGET = 'http://127.0.0.1:3001'
  pnpm --filter @fitgo/client-web build
} finally {
  Pop-Location
}

Start-Service FitGO-Client
Write-Host 'Client LK updated. FitGO-Web and FitGO-API were not stopped.' -ForegroundColor Green
Write-Host 'Smoke: https://lk.ffs.by/login' -ForegroundColor Cyan
