<#
.SYNOPSIS
  Register Windows Scheduled Task for nightly SQL .bak of 1C database forma (00:40).

.DESCRIPTION
  Runs Backup-1C-Forma-SQL.ps1 as NT AUTHORITY\SYSTEM.
  Does NOT modify 1s-backup (DumpIB) or FitGO-Backup.

  Schedule: daily 00:40 - before 1s-backup (~00:55) and FitGO-Backup (01:30).

.EXAMPLE
  .\Register-1C-SQLBackupTask.ps1
  .\Register-1C-SQLBackupTask.ps1 -RunNow
#>
[CmdletBinding()]
param(
  [string]$InstallScriptDir = '',
  [string]$BackupRoot = 'C:\BackUp',
  [string]$At = '00:40',
  [switch]$RunNow
)

$ErrorActionPreference = 'Stop'

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run Register-1C-SQLBackupTask.ps1 as Administrator.'
  }
}

Assert-Admin

$ScriptDir = if ($InstallScriptDir) { $InstallScriptDir } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$BackupScript = Join-Path $ScriptDir 'Backup-1C-Forma-SQL.ps1'
if (-not (Test-Path -LiteralPath $BackupScript)) {
  throw ("Backup-1C-Forma-SQL.ps1 not found at " + $BackupScript)
}

$secret = Join-Path $BackupRoot 'backup-1c.secret.ps1'
if (-not (Test-Path -LiteralPath $secret)) {
  throw ("Secret missing: {0} - add SqlUser/SqlPassword (see backup-1c.secret.ps1.example)" -f $secret)
}

$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Format-TaskArg([string]$Value) {
  if ($null -eq $Value) { return '' }
  if ($Value -match '\s') {
    return ('"{0}"' -f ($Value -replace '"', '\"'))
  }
  return $Value
}

$argLine = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', (Format-TaskArg $BackupScript),
  '-BackupRoot', (Format-TaskArg $BackupRoot)
) -join ' '

$action = New-ScheduledTaskAction `
  -Execute $psExe `
  -Argument $argLine `
  -WorkingDirectory $ScriptDir

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3)

$principal = New-ScheduledTaskPrincipal `
  -UserId 'NT AUTHORITY\SYSTEM' `
  -LogonType ServiceAccount `
  -RunLevel Highest

$trigger = New-ScheduledTaskTrigger -Daily -At $At

$taskName = '1C-SQL-Backup-Forma'
Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'Nightly compressed SQL .bak for forma (replaces previous only after VERIFYONLY). Does not touch DumpIB.' `
  -Force | Out-Null

$info = Get-ScheduledTask -TaskName $taskName
if ($info.State -eq 'Disabled') {
  Enable-ScheduledTask -TaskName $taskName | Out-Null
}

Write-Host ("Registered {0} daily at {1} (state={2})" -f $taskName, $At, (Get-ScheduledTask -TaskName $taskName).State) -ForegroundColor Green
Write-Host ("  {0} {1}" -f $psExe, $argLine) -ForegroundColor DarkGray
Write-Host '1s-backup and FitGO-Backup were NOT modified.' -ForegroundColor DarkGray
Write-Host ('Log: ' + (Join-Path $BackupRoot 'sql\forma-sql-backup.log')) -ForegroundColor DarkGray

if ($RunNow) {
  Write-Host ("Starting {0} now..." -f $taskName) -ForegroundColor Cyan
  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 3
  $ti = Get-ScheduledTaskInfo -TaskName $taskName
  Write-Host ("LastTaskResult={0} LastRunTime={1}" -f $ti.LastTaskResult, $ti.LastRunTime) -ForegroundColor DarkGray
  Write-Host 'Wait for BACKUP to finish (large DB = many minutes), then check C:\BackUp\sql\forma_full.bak' -ForegroundColor DarkGray
}
