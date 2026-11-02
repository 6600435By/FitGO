<#
.SYNOPSIS
  Night DumpIB for 1C infobase "forma" (simple: stop Apache, dump, start Apache).

.DESCRIPTION
  Compatible with Windows PowerShell 5.1 (Server 2016).

  Old bat only taskkill'ed 1cv8.exe / 1cv8c.exe — HTTP sessions (WordpressUserAPI
  via Apache) stayed open and blocked exclusive lock for /DumpIB.

  This script mirrors the old bat, plus:
    1) stop Apache briefly (drops HTTP sessions to forma)
    2) DESIGNER /DumpIB /DisableStartupDialogs (no night dialog hang)
    3) always start Apache again in finally

  No rac / RAS. Secrets: C:\BackUp\backup-1c.secret.ps1

.EXAMPLE
  .\Backup-1C-Forma.ps1
#>
[CmdletBinding()]
param(
  [string]$BackupRoot = 'C:\BackUp',
  [string]$SecretPath = '',
  [string]$ServerRef = '127.0.0.1\forma',
  [string]$DesignerExe = 'C:\Program Files (x86)\1cv8\8.3.17.1549\bin\1cv8.exe',
  [string]$ApacheService = 'Apache2.4',
  [int]$AfterStopWaitSec = 5,
  [switch]$SkipClientKill
)

$ErrorActionPreference = 'Stop'

function Write-BackupLog([string]$Message) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
  Write-Host $line
  if ($script:LogPath) {
    Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
  }
}

if (-not $SecretPath) {
  $SecretPath = Join-Path $BackupRoot 'backup-1c.secret.ps1'
}
if (-not (Test-Path -LiteralPath $SecretPath)) {
  throw ("Secret file not found: {0} (copy backup-1c.secret.ps1.example)" -f $SecretPath)
}
. $SecretPath
if (-not $IbUser) { throw 'IbUser is empty in secret file' }
if ($null -eq $IbPassword) { throw 'IbPassword is missing in secret file' }

if (-not (Test-Path -LiteralPath $BackupRoot)) {
  New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
}
$script:LogPath = Join-Path $BackupRoot '1c.log'
Write-BackupLog '=== Backup-1C-Forma start ==='

if (-not (Test-Path -LiteralPath $DesignerExe)) {
  throw ("Designer not found: {0}" -f $DesignerExe)
}
Write-BackupLog ("designer: {0}" -f $DesignerExe)

$folderName = (Get-Date).ToString('dd.MM.yyyy')
$dayDir = Join-Path $BackupRoot $folderName
if (-not (Test-Path -LiteralPath $dayDir)) {
  New-Item -ItemType Directory -Force -Path $dayDir | Out-Null
}

$dumpName = ('1cNew_{0}.dt' -f $folderName)
$dumpPath = Join-Path $dayDir $dumpName
if (Test-Path -LiteralPath $dumpPath) {
  $dumpName = ('1cNew_{0}_{1}.dt' -f $folderName, (Get-Date).ToString('HHmmss'))
  $dumpPath = Join-Path $dayDir $dumpName
}
Write-BackupLog ("dump path: {0}" -f $dumpPath)

if (-not $SkipClientKill) {
  foreach ($im in @('1cv8', '1cv8c')) {
    $procs = Get-Process -Name $im -ErrorAction SilentlyContinue
    if ($procs) {
      Write-BackupLog ("Stopping local {0}.exe ({1})" -f $im, @($procs).Count)
      $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    }
  }
}

$apacheWasRunning = $false
$svc = Get-Service -Name $ApacheService -ErrorAction SilentlyContinue
if (-not $svc) {
  throw ("Apache service not found: {0}" -f $ApacheService)
}
if ($svc.Status -eq 'Running') {
  $apacheWasRunning = $true
  Write-BackupLog ("Stopping {0}..." -f $ApacheService)
  Stop-Service -Name $ApacheService -Force
  Start-Sleep -Seconds $AfterStopWaitSec
} else {
  Write-BackupLog ("{0} already stopped (status={1})" -f $ApacheService, $svc.Status)
}

$dumpOk = $false
try {
  Write-BackupLog 'Starting DESIGNER DumpIB...'
  $argLine = @(
    'DESIGNER',
    ('/S "{0}"' -f $ServerRef),
    ('/N "{0}"' -f $IbUser),
    ('/P "{0}"' -f $IbPassword),
    '/DisableStartupDialogs',
    ('/Out "{0}"' -f $script:LogPath),
    ('/DumpIB "{0}"' -f $dumpPath)
  ) -join ' '
  $p = Start-Process -FilePath $DesignerExe -ArgumentList $argLine -Wait -PassThru -NoNewWindow
  $exit = $p.ExitCode
  Write-BackupLog ("DESIGNER exit code: {0}" -f $exit)
  if ($exit -ne 0) {
    throw ("DumpIB failed with exit code {0}. See {1}" -f $exit, $script:LogPath)
  }
  if (-not (Test-Path -LiteralPath $dumpPath)) {
    throw ("DumpIB reported success but file missing: {0}" -f $dumpPath)
  }
  $sizeMb = [math]::Round((Get-Item -LiteralPath $dumpPath).Length / 1MB, 1)
  Write-BackupLog ("DumpIB OK ({0} MB): {1}" -f $sizeMb, $dumpPath)
  $dumpOk = $true
} finally {
  if ($apacheWasRunning) {
    try {
      Write-BackupLog ("Starting {0}..." -f $ApacheService)
      Start-Service -Name $ApacheService
      Write-BackupLog 'Apache started.'
    } catch {
      Write-BackupLog ("CRITICAL: failed to start Apache: {0}" -f $_.Exception.Message)
      if ($dumpOk) { throw }
    }
  }
}

if (-not $dumpOk) {
  throw 'Backup-1C-Forma finished without dump'
}

Write-BackupLog '=== Backup-1C-Forma done ==='
exit 0
