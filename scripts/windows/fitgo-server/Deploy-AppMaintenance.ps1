<#
.SYNOPSIS
  Install the Russian FitGO "updating" page for Apache ErrorDocument 502/503.

.DESCRIPTION
  Copies deploy/hoster-wp-proxy/maintenance.html to
  C:\Apache24\htdocs\app-maintenance.html

  Name must NOT be fitgo-maintenance.html — global Alias /fitgo sends that
  prefix to 1C VRS (JSON 404). Safe to run anytime (does not stop services).

.EXAMPLE
  .\Deploy-AppMaintenance.ps1
  .\Deploy-AppMaintenance.ps1 -InstallRoot C:\FitGO
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = 'C:\FitGO',
  [string]$Htdocs = 'C:\Apache24\htdocs'
)

$ErrorActionPreference = 'Stop'
$FitGoRoot = Join-Path $InstallRoot 'FitGO'
$src = Join-Path $FitGoRoot 'deploy\hoster-wp-proxy\maintenance.html'
$dest = Join-Path $Htdocs 'app-maintenance.html'

if (-not (Test-Path $src)) {
  throw "Source not found: $src"
}
if (-not (Test-Path $Htdocs)) {
  throw "Apache htdocs not found: $Htdocs"
}

Copy-Item -Path $src -Destination $dest -Force
Write-Host "OK: $dest" -ForegroundColor Green
Write-Host 'Smoke: curl.exe -sk https://127.0.0.1:444/app-maintenance.html -H "Host: app.ffs.by" | more'
Write-Host 'Expect HTML title "FitGO обновляется", not 1C JSON.'
