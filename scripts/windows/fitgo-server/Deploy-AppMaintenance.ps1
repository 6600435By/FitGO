<#
.SYNOPSIS
  Install the FitGO "updating" page for Apache ErrorDocument 502/503.

.DESCRIPTION
  Defines Deploy-AppMaintenancePage for Update-FitGO-Staff.ps1 (dot-source).
  When run directly, copies deploy/hoster-wp-proxy/maintenance.html to
  C:\Apache24\htdocs\app-maintenance.html

  Name must NOT be fitgo-maintenance.html - global Alias /fitgo sends that
  prefix to 1C VRS (JSON 404). Safe to run anytime (does not stop services).

  Keep this file ASCII-only: Windows PowerShell 5.1 mis-parses UTF-8 Cyrillic
  without BOM (TerminatorExpectedAtEndOfString).

.EXAMPLE
  . .\Deploy-AppMaintenance.ps1
  Deploy-AppMaintenancePage -RepoRoot C:\FitGO\FitGO

  .\Deploy-AppMaintenance.ps1
  .\Deploy-AppMaintenance.ps1 -InstallRoot C:\FitGO
#>
param(
  [string]$InstallRoot = 'C:\FitGO',
  [string]$RepoRoot = '',
  [string]$Htdocs = 'C:\Apache24\htdocs'
)

function Deploy-AppMaintenancePage {
  param(
    [string]$RepoRoot = '',
    [string]$InstallRoot = 'C:\FitGO',
    [string]$Htdocs = 'C:\Apache24\htdocs'
  )

  if (-not $RepoRoot) {
    $RepoRoot = Join-Path $InstallRoot 'FitGO'
  }

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
  Write-Host "OK: $dest" -ForegroundColor Green
  Write-Host 'Smoke: curl.exe -sk https://127.0.0.1:444/app-maintenance.html -H "Host: app.ffs.by" | more'
  Write-Host 'Expect HTML title FitGO updating, not 1C JSON.'
}

# Dot-sourced by Update-FitGO-Staff: only define the function.
# Direct run: install the page once.
if ($MyInvocation.InvocationName -ne '.') {
  Deploy-AppMaintenancePage -InstallRoot $InstallRoot -RepoRoot $RepoRoot -Htdocs $Htdocs
}
