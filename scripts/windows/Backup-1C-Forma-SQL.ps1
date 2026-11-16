<#
.SYNOPSIS
  Night SQL .bak for 1C database "forma" with compression.
  Replaces the previous .bak only after a successful backup + VERIFYONLY.

.DESCRIPTION
  Compatible with Windows PowerShell 5.1 (Server 2016).

  Why: DESIGNER /DumpIB via x86 1cv8 fails with SQL Native Client
  "memory allocation" (SQL data file ~24GB). SQL BACKUP skips 1C Designer.

  Flow:
    1) BACKUP DATABASE ... WITH COMPRESSION -> forma_full.bak.new
    2) RESTORE VERIFYONLY on the new file
    3) Only then: .bak -> .bak.prev, .new -> .bak, delete .prev
    On failure the previous forma_full.bak is left untouched.

  Secrets: C:\BackUp\backup-1c.secret.ps1 - SqlUser / SqlPassword
  (see backup-1c.secret.ps1.example). Does not stop Apache; does not touch 1s-backup.

.EXAMPLE
  .\Backup-1C-Forma-SQL.ps1
  .\Backup-1C-Forma-SQL.ps1 -BackupRoot C:\BackUp
#>
[CmdletBinding()]
param(
  [string]$BackupRoot = 'C:\BackUp',
  [string]$SecretPath = '',
  [string]$SqlServer = '',
  [string]$SqlDatabase = '',
  [string]$SqlUser = '',
  [string]$SqlPassword = '',
  [string]$BakName = 'forma_full.bak',
  [long]$MinBakBytes = 52428800, # 50 MB
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'

function Write-SqlBackupLog([string]$Message) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
  Write-Host $line
  if ($script:LogPath) {
    Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
  }
}

function Find-SqlCmd {
  $cmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    'C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE',
    'C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\130\Tools\Binn\SQLCMD.EXE',
    'C:\Program Files\Microsoft SQL Server\150\Tools\Binn\SQLCMD.EXE',
    'C:\Program Files\Microsoft SQL Server\140\Tools\Binn\SQLCMD.EXE',
    'C:\Program Files\Microsoft SQL Server\130\Tools\Binn\SQLCMD.EXE'
  )
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) { return $c }
  }
  return $null
}

function Invoke-SqlCmdText {
  param(
    [string]$SqlCmdPath,
    [string]$Server,
    [string]$User,
    [string]$Password,
    [string]$Query
  )
  $argList = @(
    '-S', $Server,
    '-U', $User,
    '-P', $Password,
    '-b',
    '-r', '1',
    '-Q', $Query
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & $SqlCmdPath @argList 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  $text = ($out | ForEach-Object { "$_" }) -join "`n"
  return @{ ExitCode = $code; Text = $text }
}

if (-not $SecretPath) {
  $SecretPath = Join-Path $BackupRoot 'backup-1c.secret.ps1'
}
if (-not (Test-Path -LiteralPath $SecretPath)) {
  throw ("Secret file not found: {0}" -f $SecretPath)
}

# Capture CLI overrides before dot-sourcing secret (secret sets same names).
$cliServer = $SqlServer
$cliDatabase = $SqlDatabase
$cliUser = $SqlUser
$cliPassword = $SqlPassword

. $SecretPath

$useServer = $cliServer
if (-not $useServer) {
  if (Get-Variable -Name SqlServerInstance -ErrorAction SilentlyContinue) {
    $useServer = [string]$SqlServerInstance
  }
}
if (-not $useServer) { $useServer = 'localhost' }

$useDb = $cliDatabase
if (-not $useDb) {
  if (Get-Variable -Name SqlDatabase -ErrorAction SilentlyContinue) {
    $useDb = [string]$SqlDatabase
  }
}
if (-not $useDb) { $useDb = 'forma' }

$useUser = $cliUser
if (-not $useUser) {
  if (Get-Variable -Name SqlUser -ErrorAction SilentlyContinue) {
    $useUser = [string]$SqlUser
  }
}
if (-not $useUser) { $useUser = 'sa' }

$usePassword = $cliPassword
if (-not $usePassword) {
  if (Get-Variable -Name SqlPassword -ErrorAction SilentlyContinue) {
    $usePassword = $SqlPassword
  }
}
if ([string]::IsNullOrWhiteSpace($usePassword)) {
  throw 'SqlPassword is missing in secret file (or pass -SqlPassword). See backup-1c.secret.ps1.example'
}

$sqlDir = Join-Path $BackupRoot 'sql'
if (-not (Test-Path -LiteralPath $sqlDir)) {
  New-Item -ItemType Directory -Force -Path $sqlDir | Out-Null
}
$script:LogPath = Join-Path $sqlDir 'forma-sql-backup.log'

$currentBak = Join-Path $sqlDir $BakName
$newBak = $currentBak + '.new'
$prevBak = $currentBak + '.prev'

$sqlcmd = Find-SqlCmd
if (-not $sqlcmd) {
  throw 'sqlcmd.exe not found'
}

Write-SqlBackupLog '=== Backup-1C-Forma-SQL start ==='
Write-SqlBackupLog ("sqlcmd: {0}" -f $sqlcmd)
Write-SqlBackupLog ("server={0} database={1} user={2}" -f $useServer, $useDb, $useUser)
Write-SqlBackupLog ("target: {0}" -f $currentBak)

if (Test-Path -LiteralPath $newBak) {
  Remove-Item -LiteralPath $newBak -Force
}

$newBakSql = $newBak.Replace("'", "''")
$dbBracket = $useDb.Replace(']', ']]')

$backupSql = @"
BACKUP DATABASE [$dbBracket]
TO DISK = N'$newBakSql'
WITH COMPRESSION, INIT, STATS = 10;
"@

Write-SqlBackupLog 'Starting BACKUP DATABASE WITH COMPRESSION...'
$bakResult = Invoke-SqlCmdText -SqlCmdPath $sqlcmd -Server $useServer -User $useUser -Password $usePassword -Query $backupSql
if ($bakResult.Text) {
  Write-SqlBackupLog '--- sqlcmd backup out ---'
  foreach ($line in ($bakResult.Text -split "`n")) {
    if ($line.Trim()) { Write-SqlBackupLog $line.TrimEnd() }
  }
  Write-SqlBackupLog '--- end sqlcmd backup out ---'
}
if ($bakResult.ExitCode -ne 0) {
  throw ("BACKUP failed, exit {0}. Previous file left untouched: {1}" -f $bakResult.ExitCode, $currentBak)
}
if (-not (Test-Path -LiteralPath $newBak)) {
  throw ("BACKUP reported OK but file missing: {0}" -f $newBak)
}

$newSize = (Get-Item -LiteralPath $newBak).Length
if ($newSize -lt $MinBakBytes) {
  Remove-Item -LiteralPath $newBak -Force -ErrorAction SilentlyContinue
  throw ("New backup too small ({0} bytes) - refuse replace. Previous left untouched." -f $newSize)
}
Write-SqlBackupLog ("New bak size: {0} GB" -f ([math]::Round($newSize / 1GB, 2)))

if (-not $SkipVerify) {
  $verifySql = "RESTORE VERIFYONLY FROM DISK = N'$newBakSql';"
  Write-SqlBackupLog 'RESTORE VERIFYONLY...'
  $verResult = Invoke-SqlCmdText -SqlCmdPath $sqlcmd -Server $useServer -User $useUser -Password $usePassword -Query $verifySql
  if ($verResult.Text) {
    Write-SqlBackupLog '--- sqlcmd verify out ---'
    foreach ($line in ($verResult.Text -split "`n")) {
      if ($line.Trim()) { Write-SqlBackupLog $line.TrimEnd() }
    }
    Write-SqlBackupLog '--- end sqlcmd verify out ---'
  }
  if ($verResult.ExitCode -ne 0) {
    Remove-Item -LiteralPath $newBak -Force -ErrorAction SilentlyContinue
    throw ("VERIFYONLY failed, exit {0}. Previous file left untouched: {1}" -f $verResult.ExitCode, $currentBak)
  }
  Write-SqlBackupLog 'VERIFYONLY OK'
}

if (Test-Path -LiteralPath $prevBak) {
  Remove-Item -LiteralPath $prevBak -Force
}
if (Test-Path -LiteralPath $currentBak) {
  Rename-Item -LiteralPath $currentBak -NewName ([IO.Path]::GetFileName($prevBak))
  Write-SqlBackupLog ("Previous bak moved aside: {0}" -f $prevBak)
}
Rename-Item -LiteralPath $newBak -NewName ([IO.Path]::GetFileName($currentBak))
Write-SqlBackupLog ("Promoted new bak -> {0}" -f $currentBak)

if (Test-Path -LiteralPath $prevBak) {
  Remove-Item -LiteralPath $prevBak -Force
  Write-SqlBackupLog 'Deleted previous bak after successful promote'
}

$finalSize = (Get-Item -LiteralPath $currentBak).Length
Write-SqlBackupLog ("SQL bak OK ({0} GB): {1}" -f ([math]::Round($finalSize / 1GB, 2), $currentBak))
Write-SqlBackupLog '=== Backup-1C-Forma-SQL done ==='
exit 0
