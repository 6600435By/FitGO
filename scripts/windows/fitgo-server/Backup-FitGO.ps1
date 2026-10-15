<#
.SYNOPSIS
  Build a FitGO SP backup bundle (Postgres + .env + uploads) and write backup-status.json.

.DESCRIPTION
  Compatible with Windows PowerShell 5.1 (Server 2016).
  Does not stop FitGO services. Does not touch 1C databases.
  Modes: Backup (default), VerifyLast (restore last ok dump into fitgo_backup_check).

.EXAMPLE
  .\Backup-FitGO.ps1
  .\Backup-FitGO.ps1 -OffsitePath E:\FitGO-Offsite
  .\Backup-FitGO.ps1 -Mode VerifyLast
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = 'C:\FitGO',
  [string]$BackupRoot = '',
  [string]$OffsitePath = '',
  [ValidateSet('Backup', 'VerifyLast')]
  [string]$Mode = 'Backup',
  [int]$KeepDaily = 14,
  [int]$KeepWeekly = 8,
  # Needed for VerifyLast CREATE/DROP fitgo_backup_check (fitgo role may lack CREATEDB)
  [string]$PostgresSuperPassword = ''
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$started = Get-Date
$FitGoRoot = Join-Path $InstallRoot 'FitGO'
$ApiEnv = Join-Path $FitGoRoot 'apps\api\.env'
$WebEnvLocal = Join-Path $FitGoRoot 'apps\web\.env.local'
$StatusPathDefault = Join-Path $FitGoRoot 'apps\api\var\backup-status.json'
$ApacheConf = 'C:\Apache24\conf\extra\fitgo-app-8445.conf'

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Get-EnvMap([string]$Path) {
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  $raw = [System.IO.File]::ReadAllText($Path)
  if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) {
    $raw = $raw.Substring(1)
  }
  foreach ($line in ($raw -split "`r?`n")) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $eq = $t.IndexOf('=')
    if ($eq -lt 1) { continue }
    $k = $t.Substring(0, $eq).Trim()
    $v = $t.Substring($eq + 1).Trim().Trim('"').Trim("'")
    $map[$k] = $v
  }
  return $map
}

function Find-PgBin([string]$ExeName) {
  $cmd = Get-Command $ExeName -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    ("C:\Program Files\PostgreSQL\16\bin\" + $ExeName),
    ("C:\Program Files\PostgreSQL\15\bin\" + $ExeName),
    ("C:\Program Files\PostgreSQL\14\bin\" + $ExeName)
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

function Resolve-GitExe {
  $cmd = Get-Command git -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    'C:\Program Files\Git\cmd\git.exe',
    'C:\Program Files (x86)\Git\cmd\git.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Get-GitSha([string]$RepoRoot) {
  $git = Resolve-GitExe
  if (-not $git) { return $null }
  if (-not (Test-Path (Join-Path $RepoRoot '.git'))) { return $null }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $sha = & $git -C $RepoRoot rev-parse HEAD 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($sha | Out-String).Trim()
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Parse-DatabaseUrl([string]$Url) {
  # postgresql://user:pass@host:port/db?params
  if (-not $Url) { throw 'DATABASE_URL is empty' }
  $u = $Url -replace '^postgresql://', 'http://' -replace '^postgres://', 'http://'
  try {
    $uri = [Uri]$u
  } catch {
    throw ("Cannot parse DATABASE_URL: " + $_)
  }
  $userInfo = $uri.UserInfo
  $user = $userInfo
  $pass = ''
  $colon = $userInfo.IndexOf(':')
  if ($colon -ge 0) {
    $user = [Uri]::UnescapeDataString($userInfo.Substring(0, $colon))
    $pass = [Uri]::UnescapeDataString($userInfo.Substring($colon + 1))
  } else {
    $user = [Uri]::UnescapeDataString($userInfo)
  }
  $db = $uri.AbsolutePath.TrimStart('/')
  if ($db.Contains('?')) { $db = $db.Split('?')[0] }
  if (-not $db) { $db = 'fitgo' }
  $hostName = $uri.Host
  if (-not $hostName) { $hostName = '127.0.0.1' }
  $port = $uri.Port
  if ($port -le 0) { $port = 5432 }
  return @{
    User = $user
    Password = $pass
    Host = $hostName
    Port = $port
    Database = $db
  }
}

function Resolve-BackupRoot([string]$Preferred) {
  if ($Preferred) { return $Preferred }
  if (Test-Path 'D:\') { return 'D:\FitGO-Backups' }
  return 'C:\FitGO-Backups'
}

function Write-BackupStatus {
  param(
    [string]$StatusPath,
    [bool]$Ok,
    [string]$ErrorText,
    [string]$BundleId,
    $DumpBytes,
    $DurationSec
  )
  $iso = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
  $errJson = 'null'
  if ($ErrorText) {
    $esc = $ErrorText.Replace('\', '\\').Replace('"', '\"').Replace("`r", ' ').Replace("`n", ' ')
    $errJson = '"' + $esc + '"'
  }
  $bundleJson = 'null'
  if ($BundleId) { $bundleJson = '"' + $BundleId + '"' }
  $dumpJson = 'null'
  if ($null -ne $DumpBytes) { $dumpJson = [string][int64]$DumpBytes }
  $durJson = 'null'
  if ($null -ne $DurationSec) { $durJson = [string][int]$DurationSec }
  $okJson = if ($Ok) { 'true' } else { 'false' }
  $json = @"
{
  "ok": $okJson,
  "finishedAt": "$iso",
  "error": $errJson,
  "bundleId": $bundleJson,
  "dumpBytes": $dumpJson,
  "durationSec": $durJson
}
"@
  Write-Utf8NoBom -Path $StatusPath -Content $json
}

function Get-FileSha256([string]$Path) {
  $hash = Get-FileHash -Path $Path -Algorithm SHA256
  return $hash.Hash.ToLowerInvariant()
}

function Invoke-Native {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [hashtable]$EnvExtra
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($EnvExtra) {
      foreach ($k in $EnvExtra.Keys) {
        Set-Item -Path ("Env:" + $k) -Value $EnvExtra[$k]
      }
    }
    $out = & $FilePath @ArgumentList 2>&1
    $code = $LASTEXITCODE
    return @{ Code = $code; Output = ($out | Out-String).Trim() }
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Rotate-Bundles {
  param(
    [string]$Root,
    [int]$DailyKeep,
    [int]$WeeklyKeep
  )
  $dailyDir = Join-Path $Root 'daily'
  $weeklyDir = Join-Path $Root 'weekly'
  if (Test-Path $dailyDir) {
    $dailies = Get-ChildItem -Path $dailyDir -Directory | Sort-Object Name -Descending
    if ($dailies.Count -gt $DailyKeep) {
      $dailies | Select-Object -Skip $DailyKeep | ForEach-Object {
        Remove-Item -Recurse -Force $_.FullName
      }
    }
  }
  if (Test-Path $weeklyDir) {
    $weeklies = Get-ChildItem -Path $weeklyDir -Directory | Sort-Object Name -Descending
    if ($weeklies.Count -gt $WeeklyKeep) {
      $weeklies | Select-Object -Skip $WeeklyKeep | ForEach-Object {
        Remove-Item -Recurse -Force $_.FullName
      }
    }
  }
}

# --- resolve paths ---
if (-not (Test-Path (Join-Path $FitGoRoot 'pnpm-workspace.yaml'))) {
  throw "FitGO not found at $FitGoRoot"
}

$envMap = Get-EnvMap $ApiEnv
$statusPath = $StatusPathDefault
if ($envMap['FITGO_BACKUP_STATUS_PATH']) {
  $statusPath = $envMap['FITGO_BACKUP_STATUS_PATH']
}

$backupRoot = Resolve-BackupRoot $BackupRoot
$dailyRoot = Join-Path $backupRoot 'daily'
$weeklyRoot = Join-Path $backupRoot 'weekly'
$mirrorRoot = Join-Path $backupRoot 'files-mirror'
$lastOkPath = Join-Path $backupRoot 'LAST_OK.txt'

try {
  $proc = Get-Process -Id $PID
  $proc.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal
} catch {}

if ($Mode -eq 'VerifyLast') {
  Write-Host '=== FitGO Backup VerifyLast ===' -ForegroundColor Cyan
  if (-not (Test-Path $lastOkPath)) {
    Write-BackupStatus -StatusPath $statusPath -Ok $false -ErrorText 'VerifyLast: LAST_OK.txt missing' -BundleId $null -DumpBytes $null -DurationSec ([int]((Get-Date) - $started).TotalSeconds)
    throw 'LAST_OK.txt not found - no successful backup yet'
  }
  $bundleId = ([System.IO.File]::ReadAllText($lastOkPath)).Trim()
  $bundlePath = Join-Path $dailyRoot $bundleId
  if (-not (Test-Path $bundlePath)) {
    $bundlePath = Join-Path $weeklyRoot $bundleId
  }
  if (-not (Test-Path $bundlePath)) {
    Write-BackupStatus -StatusPath $statusPath -Ok $false -ErrorText ("VerifyLast: bundle missing " + $bundleId) -BundleId $bundleId -DumpBytes $null -DurationSec ([int]((Get-Date) - $started).TotalSeconds)
    throw ("Bundle not found: " + $bundleId)
  }
  $dumpFile = Join-Path $bundlePath 'fitgo.dump'
  $pgRestore = Find-PgBin 'pg_restore.exe'
  $psql = Find-PgBin 'psql.exe'
  if (-not $pgRestore -or -not $psql) { throw 'pg_restore/psql not found' }
  $db = Parse-DatabaseUrl $envMap['DATABASE_URL']
  $adminUser = $db.User
  $adminPass = $db.Password
  if ($PostgresSuperPassword) {
    $adminUser = 'postgres'
    $adminPass = $PostgresSuperPassword
  }
  $env:PGPASSWORD = $adminPass
  $checkDb = 'fitgo_backup_check'
  $dropSql = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '" + $checkDb + "' AND pid <> pg_backend_pid(); DROP DATABASE IF EXISTS " + $checkDb + ";"
  $createSql = "CREATE DATABASE " + $checkDb + " OWNER " + $db.User + ";"
  $r1 = Invoke-Native -FilePath $psql -ArgumentList @('-h', $db.Host, '-p', ([string]$db.Port), '-U', $adminUser, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', $dropSql)
  if ($r1.Code -ne 0) { throw ("Drop check db failed: " + $r1.Output) }
  $r2 = Invoke-Native -FilePath $psql -ArgumentList @('-h', $db.Host, '-p', ([string]$db.Port), '-U', $adminUser, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', $createSql)
  if ($r2.Code -ne 0) {
    throw ("Create check db failed (pass -PostgresSuperPassword if fitgo lacks CREATEDB): " + $r2.Output)
  }
  $env:PGPASSWORD = $db.Password
  $r3 = Invoke-Native -FilePath $pgRestore -ArgumentList @('-h', $db.Host, '-p', ([string]$db.Port), '-U', $db.User, '-d', $checkDb, '--no-owner', '--exit-on-error', $dumpFile)
  if ($r3.Code -ne 0) {
    Write-BackupStatus -StatusPath $statusPath -Ok $false -ErrorText ("VerifyLast pg_restore failed: " + $r3.Output) -BundleId $bundleId -DumpBytes $null -DurationSec ([int]((Get-Date) - $started).TotalSeconds)
    throw ("pg_restore failed: " + $r3.Output)
  }
  $countSql = 'SELECT COUNT(*) FROM "User";'
  $r4 = Invoke-Native -FilePath $psql -ArgumentList @('-h', $db.Host, '-p', ([string]$db.Port), '-U', $db.User, '-d', $checkDb, '-tAc', $countSql)
  if ($r4.Code -ne 0) {
    Write-BackupStatus -StatusPath $statusPath -Ok $false -ErrorText ("VerifyLast User count failed: " + $r4.Output) -BundleId $bundleId -DumpBytes $null -DurationSec ([int]((Get-Date) - $started).TotalSeconds)
    throw ("User count failed: " + $r4.Output)
  }
  $userCount = ($r4.Output | Out-String).Trim()
  if (-not $userCount -or $userCount -eq '0') {
    Write-BackupStatus -StatusPath $statusPath -Ok $false -ErrorText 'VerifyLast: User count is 0' -BundleId $bundleId -DumpBytes $null -DurationSec ([int]((Get-Date) - $started).TotalSeconds)
    throw 'VerifyLast: restored DB has 0 users'
  }
  $env:PGPASSWORD = $adminPass
  Invoke-Native -FilePath $psql -ArgumentList @('-h', $db.Host, '-p', ([string]$db.Port), '-U', $adminUser, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', $dropSql) | Out-Null
  $dur = [int]((Get-Date) - $started).TotalSeconds
  # Keep last successful backup ok; verify only fails the status when restore check fails
  Write-BackupStatus -StatusPath $statusPath -Ok $true -ErrorText $null -BundleId $bundleId -DumpBytes $null -DurationSec $dur
  Write-Host ("VerifyLast OK: users=" + $userCount + " bundle=" + $bundleId) -ForegroundColor Green
  return
}

# --- Backup mode ---
Write-Host '=== FitGO Backup ===' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $dailyRoot | Out-Null
New-Item -ItemType Directory -Force -Path $weeklyRoot | Out-Null
New-Item -ItemType Directory -Force -Path $mirrorRoot | Out-Null

$bundleId = (Get-Date).ToString('yyyy-MM-dd_HHmm')
$bundlePath = Join-Path $dailyRoot $bundleId
$dumpBytes = $null

try {
  if (-not (Test-Path $ApiEnv)) { throw ("Missing " + $ApiEnv) }
  if (-not $envMap['DATABASE_URL']) { throw 'DATABASE_URL missing in apps/api/.env' }

  $pgDump = Find-PgBin 'pg_dump.exe'
  $pgRestore = Find-PgBin 'pg_restore.exe'
  if (-not $pgDump) { throw 'pg_dump.exe not found (install PostgreSQL client tools)' }
  if (-not $pgRestore) { throw 'pg_restore.exe not found' }

  $db = Parse-DatabaseUrl $envMap['DATABASE_URL']
  New-Item -ItemType Directory -Force -Path $bundlePath | Out-Null
  $dumpFile = Join-Path $bundlePath 'fitgo.dump'

  Write-Host ("Dumping " + $db.Database + " -> " + $dumpFile)
  $env:PGPASSWORD = $db.Password
  $dumpArgs = @(
    '-h', $db.Host,
    '-p', ([string]$db.Port),
    '-U', $db.User,
    '-d', $db.Database,
    '-Fc',
    '-Z', '3',
    '-f', $dumpFile
  )
  $dumpRes = Invoke-Native -FilePath $pgDump -ArgumentList $dumpArgs
  if ($dumpRes.Code -ne 0) {
    throw ("pg_dump failed (exit " + $dumpRes.Code + "): " + $dumpRes.Output)
  }
  if (-not (Test-Path $dumpFile)) { throw 'pg_dump produced no file' }
  $dumpBytes = (Get-Item $dumpFile).Length

  Write-Host 'Verifying dump (pg_restore --list)...'
  $listRes = Invoke-Native -FilePath $pgRestore -ArgumentList @('--list', $dumpFile)
  if ($listRes.Code -ne 0) {
    throw ("pg_restore --list failed: " + $listRes.Output)
  }

  $sha = Get-FileSha256 $dumpFile

  # Settings
  Copy-Item -Force $ApiEnv (Join-Path $bundlePath 'api.env')
  if (Test-Path $WebEnvLocal) {
    Copy-Item -Force $WebEnvLocal (Join-Path $bundlePath 'web.env.local')
  }
  if (Test-Path $ApacheConf) {
    Copy-Item -Force $ApacheConf (Join-Path $bundlePath 'fitgo-app-8445.conf')
  }

  # Uploads (staff photos)
  $uploadsSrc = $envMap['UPLOADS_DIR']
  if (-not $uploadsSrc) {
    $uploadsSrc = Join-Path $FitGoRoot 'apps\api\var\uploads'
  }
  $uploadsDst = Join-Path $bundlePath 'uploads'
  if (Test-Path $uploadsSrc) {
    New-Item -ItemType Directory -Force -Path $uploadsDst | Out-Null
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & robocopy $uploadsSrc $uploadsDst /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    $ErrorActionPreference = $prev
  }

  # Hall snapshots - shared mirror
  $hallSrc = $envMap['HALL_SNAPSHOT_DIR']
  if (-not $hallSrc) {
    $hallSrc = Join-Path $FitGoRoot 'apps\api\var\hall-snapshots'
  }
  $hallMirror = Join-Path $mirrorRoot 'hall-snapshots'
  if (Test-Path $hallSrc) {
    New-Item -ItemType Directory -Force -Path $hallMirror | Out-Null
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & robocopy $hallSrc $hallMirror /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    $ErrorActionPreference = $prev
  }

  $gitSha = Get-GitSha $FitGoRoot
  $pgVersion = ''
  $verRes = Invoke-Native -FilePath $pgDump -ArgumentList @('--version')
  if ($verRes.Code -eq 0) { $pgVersion = $verRes.Output }

  $dur = [int]((Get-Date) - $started).TotalSeconds
  $iso = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
  $gitJson = if ($gitSha) { '"' + $gitSha + '"' } else { 'null' }
  $manifest = @"
{
  "ok": true,
  "bundleId": "$bundleId",
  "createdAt": "$iso",
  "gitSha": $gitJson,
  "postgresDumpTool": "$($pgVersion.Replace('"','\"'))",
  "database": "$($db.Database)",
  "dumpFile": "fitgo.dump",
  "dumpBytes": $dumpBytes,
  "dumpSha256": "$sha",
  "durationSec": $dur,
  "hallMirror": "files-mirror/hall-snapshots",
  "files": ["fitgo.dump", "api.env"]
}
"@
  Write-Utf8NoBom -Path (Join-Path $bundlePath 'manifest.json') -Content $manifest

  Write-Utf8NoBom -Path $lastOkPath -Content $bundleId
  Write-BackupStatus -StatusPath $statusPath -Ok $true -ErrorText $null -BundleId $bundleId -DumpBytes $dumpBytes -DurationSec $dur

  # Sunday weekly copy
  $dow = [int](Get-Date).DayOfWeek
  if ($dow -eq 0) {
    $weekDest = Join-Path $weeklyRoot $bundleId
    if (-not (Test-Path $weekDest)) {
      Copy-Item -Recurse -Force $bundlePath $weekDest
    }
  }

  # Offsite: dump + env only
  if ($OffsitePath) {
    New-Item -ItemType Directory -Force -Path $OffsitePath | Out-Null
    $offDest = Join-Path $OffsitePath $bundleId
    New-Item -ItemType Directory -Force -Path $offDest | Out-Null
    Copy-Item -Force $dumpFile (Join-Path $offDest 'fitgo.dump')
    Copy-Item -Force (Join-Path $bundlePath 'api.env') (Join-Path $offDest 'api.env')
    if (Test-Path (Join-Path $bundlePath 'web.env.local')) {
      Copy-Item -Force (Join-Path $bundlePath 'web.env.local') (Join-Path $offDest 'web.env.local')
    }
    Copy-Item -Force (Join-Path $bundlePath 'manifest.json') (Join-Path $offDest 'manifest.json')
  }

  Rotate-Bundles -Root $backupRoot -DailyKeep $KeepDaily -WeeklyKeep $KeepWeekly

  Write-Host ("Backup OK: " + $bundlePath + " (" + [math]::Round($dumpBytes / 1MB, 1) + " MB, " + $dur + "s)") -ForegroundColor Green
  return
}
catch {
  $msg = $_.Exception.Message
  if (-not $msg) { $msg = $_.ToString() }
  $dur = [int]((Get-Date) - $started).TotalSeconds
  Write-BackupStatus -StatusPath $statusPath -Ok $false -ErrorText $msg -BundleId $null -DumpBytes $dumpBytes -DurationSec $dur
  if ((Test-Path $bundlePath) -and -not (Test-Path (Join-Path $bundlePath 'manifest.json'))) {
    try { Remove-Item -Recurse -Force $bundlePath } catch {}
  }
  Write-Host ("Backup FAILED: " + $msg) -ForegroundColor Red
  throw
}
