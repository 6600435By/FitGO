<#
.SYNOPSIS
  Remove FitGO Windows services. Does NOT drop Postgres by default.
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = 'C:\FitGO',
  [switch]$RemoveFiles,
  [switch]$DropDatabase
)

$ErrorActionPreference = 'Stop'
$NssmExe = Join-Path $InstallRoot 'tools\nssm\nssm.exe'

function Remove-Svc($Name) {
  if (Get-Service $Name -ErrorAction SilentlyContinue) {
    Stop-Service $Name -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $NssmExe) {
    & $NssmExe stop $Name 2>$null
    & $NssmExe remove $Name confirm 2>$null
  }
}

Write-Host '=== FitGO СП Uninstall ===' -ForegroundColor Yellow
Remove-Svc 'FitGO-Web'
Remove-Svc 'FitGO-API'

if ($DropDatabase) {
  Write-Host 'DropDatabase requested — run manually in psql if needed:' -ForegroundColor Red
  Write-Host '  DROP DATABASE fitgo; DROP USER fitgo;'
}

if ($RemoveFiles) {
  $FitGoRoot = Join-Path $InstallRoot 'FitGO'
  if (Test-Path $FitGoRoot) {
    Remove-Item -Recurse -Force $FitGoRoot
    Write-Host "Removed $FitGoRoot"
  }
}

Write-Host 'Services removed. Postgres data kept unless you drop it manually.'
