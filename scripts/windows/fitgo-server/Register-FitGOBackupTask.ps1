<#
.SYNOPSIS
  Register Windows Scheduled Tasks for FitGO backup (01:30 daily) and Sunday verify (06:15).

.DESCRIPTION
  Runs as NT AUTHORITY\SYSTEM (ServiceAccount) so the job starts without an interactive
  RDP session. Does NOT touch 1C tasks (1s-backup / Backup-1C-Forma).

.EXAMPLE
  .\Register-FitGOBackupTask.ps1
  .\Register-FitGOBackupTask.ps1 -OffsitePath E:\FitGO-Offsite -RunNow
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = 'C:\FitGO',
  [string]$BackupRoot = 'E:\FitGO-Backups',
  [string]$OffsitePath = '',
  [string]$PostgresSuperPassword = '',
  # After register, start FitGO-Backup once (smoke test under SYSTEM)
  [switch]$RunNow
)

$ErrorActionPreference = 'Stop'

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run Register-FitGOBackupTask.ps1 as Administrator.'
  }
}

Assert-Admin

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackupScript = Join-Path $ScriptDir 'Backup-FitGO.ps1'
if (-not (Test-Path -LiteralPath $BackupScript)) {
  throw ("Backup-FitGO.ps1 not found at " + $BackupScript)
}
if (-not (Test-Path -LiteralPath $InstallRoot)) {
  throw ("InstallRoot not found: " + $InstallRoot)
}

# One-time: grant CREATEDB to fitgo so VerifyLast / Restore can create check DBs without embedding postgres password in the task.
if ($PostgresSuperPassword) {
  $psqlCandidates = @(
    'C:\Program Files\PostgreSQL\16\bin\psql.exe',
    'C:\Program Files\PostgreSQL\15\bin\psql.exe',
    'C:\Program Files\PostgreSQL\14\bin\psql.exe'
  )
  $psql = $null
  foreach ($c in $psqlCandidates) {
    if (Test-Path $c) { $psql = $c; break }
  }
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { $psql = $cmd.Source }
  if ($psql) {
    $env:PGPASSWORD = $PostgresSuperPassword
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'ALTER ROLE fitgo CREATEDB;' 2>&1 | Out-Null
    $ErrorActionPreference = $prev
    if ($LASTEXITCODE -eq 0) {
      Write-Host 'Granted CREATEDB to role fitgo (for backup verify / restore).' -ForegroundColor DarkGray
    } else {
      Write-Host 'WARNING: could not ALTER ROLE fitgo CREATEDB - pass -PostgresSuperPassword to Backup-FitGO -Mode VerifyLast / Restore manually.' -ForegroundColor Yellow
    }
  }
}

$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# Quote a path only when it contains whitespace. Extra quotes break -File under Task Scheduler.
function Format-TaskArg([string]$Value) {
  if ($null -eq $Value) { return '' }
  if ($Value -match '\s') {
    return ('"{0}"' -f ($Value -replace '"', '\"'))
  }
  return $Value
}

function New-FitGoBackupArgs([string]$Mode) {
  $parts = New-Object System.Collections.Generic.List[string]
  [void]$parts.Add('-NoProfile')
  [void]$parts.Add('-ExecutionPolicy')
  [void]$parts.Add('Bypass')
  [void]$parts.Add('-File')
  [void]$parts.Add((Format-TaskArg $BackupScript))
  [void]$parts.Add('-InstallRoot')
  [void]$parts.Add((Format-TaskArg $InstallRoot))
  [void]$parts.Add('-Mode')
  [void]$parts.Add($Mode)
  if ($BackupRoot) {
    [void]$parts.Add('-BackupRoot')
    [void]$parts.Add((Format-TaskArg $BackupRoot))
  }
  if ($OffsitePath -and $Mode -eq 'Backup') {
    [void]$parts.Add('-OffsitePath')
    [void]$parts.Add((Format-TaskArg $OffsitePath))
  }
  return ($parts -join ' ')
}

function Register-FitGoTask {
  param(
    [string]$TaskName,
    [string]$Arguments,
    [string]$Description,
    $Trigger
  )
  $action = New-ScheduledTaskAction `
    -Execute $psExe `
    -Argument $Arguments `
    -WorkingDirectory $ScriptDir

  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

  # ServiceAccount + SYSTEM: runs at 01:30 without anyone logged on via RDP.
  # Do not use -User alone — that can leave the task needing an interactive session.
  $principal = New-ScheduledTaskPrincipal `
    -UserId 'NT AUTHORITY\SYSTEM' `
    -LogonType ServiceAccount `
    -RunLevel Highest

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $Trigger `
    -Settings $settings `
    -Principal $principal `
    -Description $Description `
    -Force | Out-Null

  $info = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  if ($info.State -eq 'Disabled') {
    Enable-ScheduledTask -TaskName $TaskName | Out-Null
  }
  Write-Host ("Registered " + $TaskName + " (state=" + (Get-ScheduledTask -TaskName $TaskName).State + ")") -ForegroundColor Green
  Write-Host ("  Action: " + $psExe + " " + $Arguments) -ForegroundColor DarkGray
}

# Daily 01:30 (local server time - club uses Europe/Minsk / +03)
# Keep clear of 1C DumpIB (~00:55 via 1s-backup) and FitGO FULL sync (03:00+).
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At '01:30'
Register-FitGoTask `
  -TaskName 'FitGO-Backup' `
  -Arguments (New-FitGoBackupArgs 'Backup') `
  -Description 'Nightly FitGO Postgres + settings backup (01:30). Does not touch 1C.' `
  -Trigger $dailyTrigger

# Sunday 06:15 verify last ok dump into fitgo_backup_check
$sundayTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '06:15'
Register-FitGoTask `
  -TaskName 'FitGO-Backup-Verify' `
  -Arguments (New-FitGoBackupArgs 'VerifyLast') `
  -Description 'Weekly FitGO backup restore check into fitgo_backup_check' `
  -Trigger $sundayTrigger

Write-Host 'Done. Tasks: FitGO-Backup (daily 01:30), FitGO-Backup-Verify (Sun 06:15).' -ForegroundColor Cyan
Write-Host '1C task 1s-backup was NOT modified.' -ForegroundColor DarkGray
Write-Host 'Manual test: .\Backup-FitGO.ps1' -ForegroundColor DarkGray
Write-Host ('Night log: ' + (Join-Path $BackupRoot 'logs\fitgo-backup.log')) -ForegroundColor DarkGray

if ($RunNow) {
  Write-Host 'Starting FitGO-Backup now (SYSTEM context)...' -ForegroundColor Cyan
  Start-ScheduledTask -TaskName 'FitGO-Backup'
  Start-Sleep -Seconds 3
  $ti = Get-ScheduledTaskInfo -TaskName 'FitGO-Backup'
  Write-Host ("LastTaskResult={0} LastRunTime={1}" -f $ti.LastTaskResult, $ti.LastRunTime) -ForegroundColor DarkGray
  Write-Host 'Wait for the run to finish, then check backup-status.json / logs.' -ForegroundColor DarkGray
}
