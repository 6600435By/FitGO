<#
.SYNOPSIS
  Register 1C RAS (Remote Administration Server) as a Windows service on port 1545.

.DESCRIPTION
  Night Backup-1C-Forma.ps1 needs rac -> RAS on localhost:1545.
  A console ras.exe dies after reboot / RDP logout. This installs a persistent service
  via NSSM (FitGO uses C:\FitGO\tools\nssm\nssm.exe).

  Run once as Administrator on S2016.

.EXAMPLE
  .\Register-1C-RAS.ps1
  .\Register-1C-RAS.ps1 -PlatformVersion 8.3.17.1549
#>
[CmdletBinding()]
param(
  [string]$PlatformVersion = '8.3.17.1549',
  [string]$RasExe = '',
  [int]$Port = 1545,
  [string]$ServiceName = '1C-RAS-1545',
  [string]$NssmExe = ''
)

$ErrorActionPreference = 'Stop'

function Find-Ras([string]$Version, [string]$Explicit) {
  if ($Explicit -and (Test-Path -LiteralPath $Explicit)) { return $Explicit }
  foreach ($c in @(
      ("C:\Program Files\1cv8\{0}\bin\ras.exe" -f $Version),
      ("C:\Program Files (x86)\1cv8\{0}\bin\ras.exe" -f $Version)
    )) {
    if (Test-Path -LiteralPath $c) { return $c }
  }
  throw "ras.exe not found for version $Version (pass -RasExe)"
}

function Find-Nssm([string]$Explicit) {
  $candidates = @()
  if ($Explicit) { $candidates += $Explicit }
  $candidates += @(
    'C:\FitGO\tools\nssm\nssm.exe',
    'C:\FitGO\FitGO\tools\nssm\nssm.exe'
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  return $null
}

$ras = Find-Ras -Version $PlatformVersion -Explicit $RasExe
Write-Host ("ras: {0}" -f $ras) -ForegroundColor Cyan

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host ("Service {0} already exists (status={1}). Restarting..." -f $ServiceName, $existing.Status) -ForegroundColor Yellow
  if ($existing.Status -eq 'Running') {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  }
  Start-Service -Name $ServiceName
  Get-Service -Name $ServiceName | Format-List Name, Status, StartType
  Write-Host 'Done.' -ForegroundColor Green
  exit 0
}

$nssm = Find-Nssm -Explicit $NssmExe
$argsLine = "cluster --port=$Port"

if ($nssm) {
  Write-Host ("Installing via NSSM: {0}" -f $nssm) -ForegroundColor Cyan
  & $nssm install $ServiceName $ras $argsLine
  if ($LASTEXITCODE -ne 0) { throw "nssm install failed: $LASTEXITCODE" }
  & $nssm set $ServiceName AppDirectory (Split-Path -Parent $ras)
  & $nssm set $ServiceName DisplayName '1C RAS port 1545'
  & $nssm set $ServiceName Description '1C RAS for rac / night DumpIB'
  & $nssm set $ServiceName Start SERVICE_AUTO_START
  if (-not (Test-Path -LiteralPath 'C:\BackUp')) {
    New-Item -ItemType Directory -Force -Path 'C:\BackUp' | Out-Null
  }
  & $nssm set $ServiceName AppStdout 'C:\BackUp\ras-1545.out.log'
  & $nssm set $ServiceName AppStderr 'C:\BackUp\ras-1545.err.log'
  & $nssm set $ServiceName AppRotateFiles 1
} else {
  # sc.exe is picky: space after '=', and whole binPath must be one quoted string via cmd.
  Write-Host 'NSSM not found - using sc.exe' -ForegroundColor Yellow
  $binPath = '"{0}" {1}' -f $ras, $argsLine
  $createCmd = 'sc.exe create {0} binPath= {1} start= auto DisplayName= "1C RAS 1545"' -f $ServiceName, $binPath
  Write-Host ("cmd: {0}" -f $createCmd) -ForegroundColor DarkGray
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $createCmd) -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) {
    throw ("sc create failed: {0}. Install NSSM to C:\FitGO\tools\nssm\nssm.exe or start RAS manually." -f $p.ExitCode)
  }
}

Start-Service -Name $ServiceName
Start-Sleep -Seconds 2
$svc = Get-Service -Name $ServiceName
if ($svc.Status -ne 'Running') {
  throw ("Service {0} did not start (status={1})" -f $ServiceName, $svc.Status)
}

Write-Host ''
Write-Host 'Verify rac:' -ForegroundColor Cyan
$rac = $ras -replace 'ras\.exe$', 'rac.exe'
& $rac ('localhost:{0}' -f $Port) cluster list
if ($LASTEXITCODE -ne 0) {
  throw 'Service started but rac cluster list failed'
}

Write-Host ''
Write-Host ("OK: {0} running, rac sees cluster." -f $ServiceName) -ForegroundColor Green
exit 0
