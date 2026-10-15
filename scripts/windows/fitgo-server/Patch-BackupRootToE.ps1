<#
.SYNOPSIS
  Force BackupRoot default to E:\FitGO-Backups in FitGO SP scripts (in place).
  Run on the Windows server when file copy from Mac did not update the scripts.

.EXAMPLE
  cd C:\FitGO\FitGO\scripts\windows\fitgo-server
  .\Patch-BackupRootToE.ps1
  .\Backup-FitGO.ps1
#>
[CmdletBinding()]
param(
  [string]$ScriptDir = ''
)

$ErrorActionPreference = 'Stop'
if (-not $ScriptDir) {
  $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$files = @(
  'Backup-FitGO.ps1',
  'Restore-FitGO.ps1',
  'Update-FitGO.ps1',
  'Register-FitGOBackupTask.ps1'
)

foreach ($name in $files) {
  $path = Join-Path $ScriptDir $name
  if (-not (Test-Path $path)) {
    Write-Host ("SKIP missing: " + $path) -ForegroundColor Yellow
    continue
  }
  $text = [System.IO.File]::ReadAllText($path)
  $orig = $text
  # Old default empty string
  $text = $text.Replace("[string]`$BackupRoot = ''", "[string]`$BackupRoot = 'E:\FitGO-Backups'")
  # Already-defaulted to D (if any)
  $text = $text.Replace("[string]`$BackupRoot = 'D:\FitGO-Backups'", "[string]`$BackupRoot = 'E:\FitGO-Backups'")
  # Resolve-BackupRoot: insert E: preference before D: if missing
  if ($text -notmatch "Get-PSDrive -Name 'E'" -and $text -match "if \(Test-Path 'D:\\'\) \{ return 'D:\\FitGO-Backups' \}") {
    $old = "if (Test-Path 'D:\') { return 'D:\FitGO-Backups' }"
    $new = @"
`$e = Get-PSDrive -Name 'E' -ErrorAction SilentlyContinue
  if (`$e -and `$e.Provider.Name -eq 'FileSystem') { return 'E:\FitGO-Backups' }
  if (Test-Path 'D:\') { return 'D:\FitGO-Backups' }
"@
    $text = $text.Replace($old, $new.TrimEnd())
  }
  if ($text -eq $orig) {
    Write-Host ($name + ": no text change") -ForegroundColor DarkGray
  } else {
    [System.IO.File]::WriteAllText($path, $text, $utf8)
    Write-Host ($name + ": patched") -ForegroundColor Green
  }
}

Write-Host ''
Write-Host 'Verify Backup-FitGO.ps1:' -ForegroundColor Cyan
Select-String -Path (Join-Path $ScriptDir 'Backup-FitGO.ps1') -Pattern "BackupRoot = 'E:\\FitGO-Backups'"
if (-not $?) {
  Write-Host 'WARNING: pattern still not found - show BackupRoot lines:' -ForegroundColor Yellow
  Select-String -Path (Join-Path $ScriptDir 'Backup-FitGO.ps1') -Pattern 'BackupRoot'
}
