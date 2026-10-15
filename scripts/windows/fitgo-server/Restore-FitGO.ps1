<#
.SYNOPSIS
  Restore FitGO SP from a backup bundle (Data or Release mode).

.DESCRIPTION
  Stops FitGO-API / FitGO-Web only. Does not stop 1C.
  Restores into fitgo_restore, then renames databases.
  Compatible with Windows PowerShell 5.1.

.EXAMPLE
  .\Restore-FitGO.ps1 -Mode Data
  .\Restore-FitGO.ps1 -Mode Release -BundleId 2026-10-14_0130
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = 'C:\FitGO',
  [string]$BackupRoot = 'E:\FitGO-Backups',
  [string]$BundleId = '',
  [ValidateSet('Data', 'Release')]
  [string]$Mode = 'Data',
  [switch]$Force,
  [string]$PostgresSuperPassword = ''
)

$ErrorActionPreference = 'Stop'
$started = Get-Date
$FitGoRoot = Join-Path $InstallRoot 'FitGO'
$ApiEnv = Join-Path $FitGoRoot 'apps\api\.env'
$WebEnvLocal = Join-Path $FitGoRoot 'apps\web\.env.local'
$StatusPathDefault = Join-Path $FitGoRoot 'apps\api\var\backup-status.json'

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
  if (-not $Url) { throw 'DATABASE_URL is empty' }
  $u = $Url -replace '^postgresql://', 'http://' -replace '^postgres://', 'http://'
  $uri = [Uri]$u
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
  $dbName = $uri.AbsolutePath.TrimStart('/')
  if ($dbName.Contains('?')) { $dbName = $dbName.Split('?')[0] }
  if (-not $dbName) { $dbName = 'fitgo' }
  $hostName = $uri.Host
  if (-not $hostName) { $hostName = '127.0.0.1' }
  $port = $uri.Port
  if ($port -le 0) { $port = 5432 }
  return @{
    User = $user
    Password = $pass
    Host = $hostName
    Port = $port
    Database = $dbName
  }
}

function Resolve-BackupRoot([string]$Preferred) {
  if ($Preferred -and $Preferred.Trim()) { return $Preferred.Trim() }
  $e = Get-PSDrive -Name 'E' -ErrorAction SilentlyContinue
  if ($e -and $e.Provider.Name -eq 'FileSystem') { return 'E:\FitGO-Backups' }
  $d = Get-PSDrive -Name 'D' -ErrorAction SilentlyContinue
  if ($d -and $d.Provider.Name -eq 'FileSystem') { return 'D:\FitGO-Backups' }
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

function Invoke-Native {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $FilePath @ArgumentList 2>&1
    return @{ Code = $LASTEXITCODE; Output = ($out | Out-String).Trim() }
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run Restore-FitGO.ps1 as Administrator.'
  }
}

function Read-Manifest([string]$Path) {
  if (-not (Test-Path $Path)) { return $null }
  $raw = [System.IO.File]::ReadAllText($Path)
  return $raw | ConvertFrom-Json
}

Assert-Admin

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
$lastOkPath = Join-Path $backupRoot 'LAST_OK.txt'
$preRestoreRoot = Join-Path $backupRoot 'pre-restore'
$mirrorHall = Join-Path $backupRoot 'files-mirror\hall-snapshots'

if (-not $BundleId) {
  if (-not (Test-Path $lastOkPath)) {
    throw 'No BundleId and LAST_OK.txt missing - specify -BundleId'
  }
  $BundleId = ([System.IO.File]::ReadAllText($lastOkPath)).Trim()
}

$bundlePath = Join-Path $dailyRoot $BundleId
if (-not (Test-Path $bundlePath)) {
  $bundlePath = Join-Path $weeklyRoot $BundleId
}
if (-not (Test-Path $bundlePath)) {
  throw ("Bundle not found: " + $BundleId)
}

$dumpFile = Join-Path $bundlePath 'fitgo.dump'
$manifestPath = Join-Path $bundlePath 'manifest.json'
$bundleEnv = Join-Path $bundlePath 'api.env'
if (-not (Test-Path $dumpFile)) { throw ("Missing dump: " + $dumpFile) }
if (-not (Test-Path $bundleEnv)) { throw ("Missing api.env in bundle") }

$manifest = Read-Manifest $manifestPath
if ($manifest -and $manifest.ok -ne $true) {
  throw 'manifest.json ok != true - refuse to restore this bundle'
}

$currentSha = Get-GitSha $FitGoRoot
$bundleSha = $null
if ($manifest -and $manifest.gitSha) { $bundleSha = [string]$manifest.gitSha }

if ($Mode -eq 'Data') {
  if ($bundleSha -and $currentSha -and ($bundleSha -ne $currentSha) -and -not $Force) {
    throw ("Data mode blocked: bundle gitSha ($bundleSha) != current ($currentSha). Use -Mode Release or -Force.")
  }
}

Write-Host ("=== FitGO Restore ($Mode) bundle=$BundleId ===") -ForegroundColor Cyan

# Stop FitGO only
Stop-Service FitGO-Web -ErrorAction SilentlyContinue
Stop-Service FitGO-API -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$bundleEnvMap = Get-EnvMap $bundleEnv
$dbUrl = $bundleEnvMap['DATABASE_URL']
if (-not $dbUrl -and $envMap['DATABASE_URL']) { $dbUrl = $envMap['DATABASE_URL'] }
if (-not $dbUrl) { throw 'DATABASE_URL missing in bundle and live .env' }
$db = Parse-DatabaseUrl $dbUrl
$adminUser = $db.User
$adminPass = $db.Password
if ($PostgresSuperPassword) {
  $adminUser = 'postgres'
  $adminPass = $PostgresSuperPassword
}
$env:PGPASSWORD = $db.Password

$psql = Find-PgBin 'psql.exe'
$pgDump = Find-PgBin 'pg_dump.exe'
$pgRestore = Find-PgBin 'pg_restore.exe'
if (-not $psql -or -not $pgDump -or -not $pgRestore) {
  throw 'psql / pg_dump / pg_restore not found'
}

# Pre-restore safety dump of current DB
New-Item -ItemType Directory -Force -Path $preRestoreRoot | Out-Null
$preId = (Get-Date).ToString('yyyy-MM-dd_HHmmss')
$preDir = Join-Path $preRestoreRoot $preId
New-Item -ItemType Directory -Force -Path $preDir | Out-Null
$preDump = Join-Path $preDir 'fitgo.dump'
Write-Host 'Safety dump of current fitgo...'
$preRes = Invoke-Native -FilePath $pgDump -ArgumentList @(
  '-h', $db.Host, '-p', ([string]$db.Port), '-U', $db.User, '-d', $db.Database,
  '-Fc', '-Z', '3', '-f', $preDump
)
if ($preRes.Code -ne 0) {
  throw ("Pre-restore pg_dump failed: " + $preRes.Output)
}
if (Test-Path $ApiEnv) {
  Copy-Item -Force $ApiEnv (Join-Path $preDir 'api.env')
}

# Release: checkout SHA then rebuild later
if ($Mode -eq 'Release') {
  if (-not $bundleSha) { throw 'Release mode needs gitSha in manifest.json' }
  $git = Resolve-GitExe
  if (-not $git) { throw 'Git for Windows required for Release mode' }
  Push-Location $FitGoRoot
  try {
    Write-Host ("git checkout " + $bundleSha)
    & $git checkout $bundleSha
    if ($LASTEXITCODE -ne 0) { throw ("git checkout failed exit " + $LASTEXITCODE) }
  } finally {
    Pop-Location
  }
}

$restoreDb = 'fitgo_restore'
$brokenDb = 'fitgo_broken_' + (Get-Date).ToString('yyyyMMdd_HHmmss')
$liveDb = $db.Database

function Invoke-PsqlSql([string]$Database, [string]$Sql, [string]$AsUser = '', [string]$AsPass = '') {
  $u = if ($AsUser) { $AsUser } else { $db.User }
  $prevPass = $env:PGPASSWORD
  if ($AsPass) { $env:PGPASSWORD = $AsPass }
  try {
    return Invoke-Native -FilePath $psql -ArgumentList @(
      '-h', $db.Host, '-p', ([string]$db.Port), '-U', $u, '-d', $Database,
      '-v', 'ON_ERROR_STOP=1', '-c', $Sql
    )
  } finally {
    $env:PGPASSWORD = $prevPass
  }
}

# Drop previous fitgo_restore if any
$termRestore = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '" + $restoreDb + "' AND pid <> pg_backend_pid();"
Invoke-PsqlSql 'postgres' $termRestore $adminUser $adminPass | Out-Null
$dropRestore = "DROP DATABASE IF EXISTS " + $restoreDb + ";"
$rDrop = Invoke-PsqlSql 'postgres' $dropRestore $adminUser $adminPass
if ($rDrop.Code -ne 0) { throw ("DROP fitgo_restore failed: " + $rDrop.Output) }

$createRestore = "CREATE DATABASE " + $restoreDb + " OWNER " + $db.User + ";"
$rCreate = Invoke-PsqlSql 'postgres' $createRestore $adminUser $adminPass
if ($rCreate.Code -ne 0) {
  throw ("CREATE fitgo_restore failed (pass -PostgresSuperPassword if fitgo lacks CREATEDB): " + $rCreate.Output)
}

Write-Host 'pg_restore into fitgo_restore...'
$rRestore = Invoke-Native -FilePath $pgRestore -ArgumentList @(
  '-h', $db.Host, '-p', ([string]$db.Port), '-U', $db.User, '-d', $restoreDb,
  '--no-owner', '--exit-on-error', $dumpFile
)
if ($rRestore.Code -ne 0) {
  throw ("pg_restore failed (live DB untouched): " + $rRestore.Output)
}

$countSql = 'SELECT COUNT(*) FROM "User";'
$rCount = Invoke-Native -FilePath $psql -ArgumentList @(
  '-h', $db.Host, '-p', ([string]$db.Port), '-U', $db.User, '-d', $restoreDb, '-tAc', $countSql
)
if ($rCount.Code -ne 0) { throw ("User count failed: " + $rCount.Output) }
$userCount = ($rCount.Output | Out-String).Trim()
if (-not $userCount -or $userCount -eq '0') {
  throw 'Restored database has 0 users - abort rename'
}

# Swap: terminate live, rename live -> broken, restore -> live
$termLive = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '" + $liveDb + "' AND pid <> pg_backend_pid();"
Invoke-PsqlSql 'postgres' $termLive $adminUser $adminPass | Out-Null
$renameBroken = 'ALTER DATABASE "' + $liveDb + '" RENAME TO "' + $brokenDb + '";'
$rRen1 = Invoke-PsqlSql 'postgres' $renameBroken $adminUser $adminPass
if ($rRen1.Code -ne 0) { throw ("Rename live to broken failed: " + $rRen1.Output) }
$renameLive = 'ALTER DATABASE "' + $restoreDb + '" RENAME TO "' + $liveDb + '";'
$rRen2 = Invoke-PsqlSql 'postgres' $renameLive $adminUser $adminPass
if ($rRen2.Code -ne 0) {
  # Try to rename broken back
  Invoke-PsqlSql 'postgres' ('ALTER DATABASE "' + $brokenDb + '" RENAME TO "' + $liveDb + '";') $adminUser $adminPass | Out-Null
  throw ("Rename restore to live failed: " + $rRen2.Output)
}

# Restore files / .env
Copy-Item -Force $bundleEnv $ApiEnv
$webBundle = Join-Path $bundlePath 'web.env.local'
if (Test-Path $webBundle) {
  Copy-Item -Force $webBundle $WebEnvLocal
}

$uploadsDst = $bundleEnvMap['UPLOADS_DIR']
if (-not $uploadsDst) {
  $uploadsDst = Join-Path $FitGoRoot 'apps\api\var\uploads'
}
$uploadsSrc = Join-Path $bundlePath 'uploads'
if (Test-Path $uploadsSrc) {
  New-Item -ItemType Directory -Force -Path $uploadsDst | Out-Null
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & robocopy $uploadsSrc $uploadsDst /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  $ErrorActionPreference = $prev
}

$hallDst = $bundleEnvMap['HALL_SNAPSHOT_DIR']
if (-not $hallDst) {
  $hallDst = Join-Path $FitGoRoot 'apps\api\var\hall-snapshots'
}
if (Test-Path $mirrorHall) {
  New-Item -ItemType Directory -Force -Path $hallDst | Out-Null
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & robocopy $mirrorHall $hallDst /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  $ErrorActionPreference = $prev
}

$apacheSrc = Join-Path $bundlePath 'fitgo-app-8445.conf'
$apacheDst = 'C:\Apache24\conf\extra\fitgo-app-8445.conf'
if ((Test-Path $apacheSrc) -and (Test-Path (Split-Path -Parent $apacheDst))) {
  Copy-Item -Force $apacheSrc $apacheDst
}

if ($Mode -eq 'Release') {
  Push-Location $FitGoRoot
  try {
    Write-Host 'Rebuilding after checkout...'
    pnpm install
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
    pnpm --filter @fitgo/shared-types build
    if ($LASTEXITCODE -ne 0) { throw 'shared-types build failed' }
    pnpm --filter @fitgo/1c-adapter build
    if ($LASTEXITCODE -ne 0) { throw '1c-adapter build failed' }
    pnpm --filter @fitgo/osmi-adapter build
    if ($LASTEXITCODE -ne 0) { throw 'osmi-adapter build failed' }
    pnpm --filter @fitgo/api exec prisma generate
    if ($LASTEXITCODE -ne 0) { throw 'prisma generate failed' }
    pnpm --filter @fitgo/api build
    if ($LASTEXITCODE -ne 0) { throw 'api build failed' }
    pnpm --filter @fitgo/web build
    if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
  } finally {
    Pop-Location
  }
}

Start-Service FitGO-API
Start-Service FitGO-Web

$dur = [int]((Get-Date) - $started).TotalSeconds
$dumpBytes = (Get-Item $dumpFile).Length
Write-BackupStatus -StatusPath $statusPath -Ok $true -ErrorText $null -BundleId $BundleId -DumpBytes $dumpBytes -DurationSec $dur

Write-Host ("Restore OK. users=$userCount broken_db=$brokenDb pre-restore=$preDir") -ForegroundColor Green
Write-Host 'Smoke: login SUPER_ADMIN, check 1C health via API.' -ForegroundColor DarkGray
