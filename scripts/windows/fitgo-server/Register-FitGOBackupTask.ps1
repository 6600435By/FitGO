<#
.SYNOPSIS
  Register Windows Scheduled Tasks for FitGO backup (01:30 daily) and Sunday verify (06:15).

.EXAMPLE
  .\Register-FitGOBackupTask.ps1
  .\Register-FitGOBackupTask.ps1 -OffsitePath E:\FitGO-Offsite
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = 'C:\FitGO',
  [string]$BackupRoot = '',
  [string]$OffsitePath = '',
  [string]$PostgresSuperPassword = ''
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
if (-not (Test-Path $BackupScript)) {
  throw ("Backup-FitGO.ps1 not found at " + $BackupScript)
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
      Write-Host 'WARNING: could not ALTER ROLE fitgo CREATEDB — pass -PostgresSuperPassword to Backup-FitGO -Mode VerifyLast / Restore manually.' -ForegroundColor Yellow
    }
  }
}

$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function New-FitGoBackupArgs([string]$Mode) {
  $parts = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"' + $BackupScript + '"'),
    '-InstallRoot', ('"' + $InstallRoot + '"'),
    '-Mode', $Mode
  )
  if ($BackupRoot) {
    $parts += @('-BackupRoot', ('"' + $BackupRoot + '"'))
  }
  if ($OffsitePath -and $Mode -eq 'Backup') {
    $parts += @('-OffsitePath', ('"' + $OffsitePath + '"'))
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
  $action = New-ScheduledTaskAction -Execute $psExe -Argument $Arguments
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $Trigger `
    -Settings $settings `
    -Description $Description `
    -User 'SYSTEM' `
    -RunLevel Highest `
    -Force | Out-Null
  Write-Host ("Registered " + $TaskName) -ForegroundColor Green
}

# Daily 01:30 (local server time — club uses Europe/Minsk / +03)
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At '01:30'
Register-FitGoTask `
  -TaskName 'FitGO-Backup' `
  -Arguments (New-FitGoBackupArgs 'Backup') `
  -Description 'Nightly FitGO Postgres + settings backup (01:30)' `
  -Trigger $dailyTrigger

# Sunday 06:15 verify last ok dump into fitgo_backup_check
$sundayTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '06:15'
Register-FitGoTask `
  -TaskName 'FitGO-Backup-Verify' `
  -Arguments (New-FitGoBackupArgs 'VerifyLast') `
  -Description 'Weekly FitGO backup restore check into fitgo_backup_check' `
  -Trigger $sundayTrigger

Write-Host 'Done. Tasks: FitGO-Backup (daily 01:30), FitGO-Backup-Verify (Sun 06:15).' -ForegroundColor Cyan
Write-Host 'Manual test: .\Backup-FitGO.ps1' -ForegroundColor DarkGray
