# Rebuild + restart staff Next only (FitGO-Web :3000). Client LK and API stay up.
param(
  [string]$FitGoRoot = '',
  [switch]$SkipPull
)

$ErrorActionPreference = 'Stop'
if (-not $FitGoRoot) {
  $FitGoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
}

. (Join-Path $PSScriptRoot 'Deploy-AppMaintenance.ps1')

function Resolve-GitExe {
  $cmd = Get-Command git -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "${env:ProgramFiles}\Git\cmd\git.exe",
    "${env:ProgramFiles(x86)}\Git\cmd\git.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  return $null
}

Deploy-AppMaintenancePage -RepoRoot $FitGoRoot
Stop-Service FitGO-Web -ErrorAction SilentlyContinue

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
  pnpm --filter @fitgo/web build
} finally {
  Pop-Location
}

Deploy-AppMaintenancePage -RepoRoot $FitGoRoot
Start-Service FitGO-Web
Write-Host 'Staff web updated. FitGO-API and FitGO-Client were not stopped.' -ForegroundColor Green
