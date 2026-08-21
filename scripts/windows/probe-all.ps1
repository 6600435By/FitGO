Write-Host "========== FitGO Probe Phase A ==========" -ForegroundColor Magenta
& (Join-Path $PSScriptRoot 'probe-regression-forma.ps1')
& (Join-Path $PSScriptRoot 'probe-rest.ps1')
& (Join-Path $PSScriptRoot 'probe-fitgo-api.ps1')
Write-Host "Results: $PSScriptRoot\results\" -ForegroundColor Green
Write-Host "Fill in report.md - see docs\GO_NO_GO.md"
