<#
.SYNOPSIS
  First-time FitGO Server Program (SP) install on Windows next to 1C.

.DESCRIPTION
  Variant C: empty Postgres + prisma db push + minimal seed (club + SUPER_ADMIN).
  Does NOT restore dump from Mac/VPS stand.
  Registers Windows services FitGO-API and FitGO-Web via NSSM.
  Compatible with Windows PowerShell 5.1 (Server 2016).

.EXAMPLE
  .\Install-FitGO.ps1 -SourcePath D:\FitGO -SuperAdminPassword 'YourStrongPass!'
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = 'C:\FitGO',
  [string]$SourcePath = '',
  [string]$RepoUrl = '',
  [string]$SuperAdminEmail = 'superadmin@club.local',
  [string]$SuperAdminPassword = '',
  [string]$PostgresUser = 'fitgo',
  [string]$PostgresPassword = 'fitgo',
  [string]$PostgresDb = 'fitgo',
  [string]$PostgresSuperPassword = '',
  [switch]$SkipDeps
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# TLS 1.2 required for HTTPS downloads on Server 2016
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {}

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run Install-FitGO.ps1 as Administrator.'
  }
}

function Ensure-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw ("Required command not found: " + $Name)
  }
}

function New-RandomSecret([int]$Bytes = 32) {
  $buf = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
  return [Convert]::ToBase64String($buf).TrimEnd('=').Replace('+', 'x').Replace('/', 'y')
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Import-DotEnv([string]$Path) {
  if (-not (Test-Path $Path)) { return }
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
    Set-Item -Path ("Env:" + $k) -Value $v
  }
}

function Assert-LastExit([string]$Step) {
  if ($LASTEXITCODE -ne 0) {
    throw ($Step + " failed with exit code " + $LASTEXITCODE)
  }
}

function Set-DatabaseUrlInEnvFile([string]$Path, [string]$DbUrl) {
  $raw = ''
  if (Test-Path $Path) {
    $raw = [System.IO.File]::ReadAllText($Path)
    if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) {
      $raw = $raw.Substring(1)
    }
  }
  $line = 'DATABASE_URL="' + $DbUrl + '"'
  if ($raw -match '(?m)^DATABASE_URL=.*$') {
    $raw = [regex]::Replace($raw, '(?m)^DATABASE_URL=.*$', $line)
  } else {
    $raw = $line + "`r`n" + $raw
  }
  Write-Utf8NoBom -Path $Path -Content $raw
}

function Find-Psql {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    'C:\Program Files\PostgreSQL\16\bin\psql.exe',
    'C:\Program Files\PostgreSQL\15\bin\psql.exe',
    'C:\Program Files\PostgreSQL\14\bin\psql.exe'
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

Assert-Admin

$FitGoRoot = Join-Path $InstallRoot 'FitGO'
$NssmDir = Join-Path $InstallRoot 'tools\nssm'
$NssmExe = Join-Path $NssmDir 'nssm.exe'
$ApiEnv = Join-Path $FitGoRoot 'apps\api\.env'
$WebEnvLocal = Join-Path $FitGoRoot 'apps\web\.env.local'

Write-Host '=== FitGO SP Install (variant C: empty DB) ===' -ForegroundColor Cyan

# --- Locate / place sources ---
if ($SourcePath) {
  $SourcePath = (Resolve-Path $SourcePath).Path
  if (-not (Test-Path (Join-Path $SourcePath 'pnpm-workspace.yaml'))) {
    throw ("SourcePath is not a FitGO monorepo: " + $SourcePath)
  }
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  if (Test-Path $FitGoRoot) {
    Write-Host ("Using existing " + $FitGoRoot + " (not overwriting). Use Update-FitGO.ps1 for code updates.") -ForegroundColor Yellow
  } else {
    Write-Host ("Copying repo to " + $FitGoRoot + " ...")
    Copy-Item -Path $SourcePath -Destination $FitGoRoot -Recurse -Force
  }
} elseif ($RepoUrl) {
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  if (-not (Test-Path $FitGoRoot)) {
    Ensure-Command git
    git clone $RepoUrl $FitGoRoot
  }
} elseif (-not (Test-Path (Join-Path $FitGoRoot 'pnpm-workspace.yaml'))) {
  throw ("No FitGO at " + $FitGoRoot + ". Pass -SourcePath or -RepoUrl.")
}

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
    [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

function Find-NodeExe {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    'C:\Program Files\nodejs\node.exe',
    'C:\Program Files (x86)\nodejs\node.exe'
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

function Install-NodeLts {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host 'Installing Node.js 20 LTS via winget...' -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    Refresh-Path
    return
  }
  # Server 2016 often has no winget — silent MSI from nodejs.org
  $msiUrl = 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi'
  $msi = Join-Path $env:TEMP 'node-v20-x64.msi'
  Write-Host 'Downloading Node.js 20 LTS MSI (no winget)...' -ForegroundColor Yellow
  Invoke-WebRequest -Uri $msiUrl -OutFile $msi -UseBasicParsing
  if (-not (Test-Path $msi) -or ((Get-Item $msi).Length -lt 1MB)) {
    throw 'Failed to download Node MSI. Install manually from https://nodejs.org (Windows Installer .msi x64), then re-run.'
  }
  Write-Host 'Installing Node.js silently...'
  $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', $msi, '/qn', '/norestart') -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
    throw ("msiexec Node install failed, exit code " + $p.ExitCode)
  }
  Refresh-Path
  $nodeDir = 'C:\Program Files\nodejs'
  if ((Test-Path $nodeDir) -and ($env:Path -notlike ("*" + $nodeDir + "*"))) {
    $env:Path = $env:Path + ';' + $nodeDir
  }
}

if (-not $SkipDeps) {
  $nodeExeFound = Find-NodeExe
  if ($nodeExeFound) {
    $nodeDir = Split-Path -Parent $nodeExeFound
    if ($env:Path -notlike ("*" + $nodeDir + "*")) {
      $env:Path = $env:Path + ';' + $nodeDir
    }
  } else {
    Install-NodeLts
  }
  if (-not (Find-NodeExe)) {
    throw 'Node.js still not found after install. Open a NEW Administrator PowerShell and re-run Install-FitGO.ps1.'
  }
  Ensure-Command node
  Write-Host ("Node: " + (node -v))
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host 'Installing pnpm...'
    npm install -g pnpm@9.15.4
    Refresh-Path
  }
  Ensure-Command pnpm

  if (-not (Test-Path $NssmExe)) {
    Write-Host 'Downloading NSSM...'
    New-Item -ItemType Directory -Force -Path $NssmDir | Out-Null
    $zip = Join-Path $env:TEMP 'nssm.zip'
    $extract = Join-Path $env:TEMP 'nssm-extract'
    Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zip -UseBasicParsing
    if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    $win64 = Get-ChildItem -Path $extract -Recurse -Filter nssm.exe |
      Where-Object { $_.FullName -match 'win64' } |
      Select-Object -First 1
    if (-not $win64) { throw 'nssm.exe win64 not found in archive' }
    Copy-Item $win64.FullName $NssmExe -Force
  }
}

function Invoke-Psql {
  param(
    [string]$PsqlExe,
    [string]$Sql,
    [switch]$IgnoreErrors
  )
  # Native stderr + $ErrorActionPreference Stop = terminating NativeCommandError on PS 5.1
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $PsqlExe -U postgres -v ON_ERROR_STOP=1 -c $Sql 2>&1
    $code = $LASTEXITCODE
    if ($IgnoreErrors) { return $true }
    if ($code -ne 0) {
      $msg = ($out | Out-String).Trim()
      throw ("psql failed (exit $code): " + $msg)
    }
    return $true
  } finally {
    $ErrorActionPreference = $prev
  }
}

$psqlExe = Find-Psql
if (-not $psqlExe) {
  Write-Host 'PostgreSQL client (psql) not found.' -ForegroundColor Yellow
  Write-Host 'Install PostgreSQL 16, add bin to PATH, create role/db manually, then re-run.' -ForegroundColor Yellow
} else {
  $pgBin = Split-Path -Parent $psqlExe
  if ($env:Path -notlike ("*" + $pgBin + "*")) {
    $env:Path = $env:Path + ";" + $pgBin
  }
  if (-not $PostgresPassword) { $PostgresPassword = 'fitgo' }
  Write-Host 'Ensuring Postgres role/db (may fail if already exists - OK)...'
  if ($PostgresSuperPassword) {
    $env:PGPASSWORD = $PostgresSuperPassword
  } elseif (-not $env:PGPASSWORD) {
    Write-Host 'Tip: set -PostgresSuperPassword to the postgres superuser password.' -ForegroundColor DarkGray
  }

  # Prove we can connect as postgres
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $probe = & $psqlExe -U postgres -c "SELECT 1;" 2>&1
  $probeCode = $LASTEXITCODE
  $ErrorActionPreference = $prevEa
  if ($probeCode -ne 0) {
    throw ("Cannot connect to PostgreSQL as user postgres. Check -PostgresSuperPassword. Details: " + (($probe | Out-String).Trim()))
  }

  # Idempotent role/db; reset password if role already exists
  $createUserSql = @"
DO `$`$
BEGIN
  CREATE ROLE $PostgresUser LOGIN PASSWORD '$PostgresPassword';
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE $PostgresUser WITH LOGIN PASSWORD '$PostgresPassword';
END
`$`$;
"@
  Invoke-Psql -PsqlExe $psqlExe -Sql $createUserSql
  $dbExistsSql = "SELECT 1 FROM pg_database WHERE datname = '" + $PostgresDb + "';"
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $dbCheck = & $psqlExe -U postgres -tAc $dbExistsSql 2>&1
  $ErrorActionPreference = $prevEa
  if (($dbCheck | Out-String).Trim() -ne '1') {
    Invoke-Psql -PsqlExe $psqlExe -Sql ("CREATE DATABASE " + $PostgresDb + " OWNER " + $PostgresUser + ";")
  } else {
    Write-Host ("Database " + $PostgresDb + " already exists.") -ForegroundColor DarkGray
  }
}

if (-not $SuperAdminPassword) { $SuperAdminPassword = New-RandomSecret 12 }
$JwtSecret = New-RandomSecret 36
if (-not $PostgresPassword) { $PostgresPassword = 'fitgo' }

$dbUrl = 'postgresql://' + $PostgresUser + ':' + $PostgresPassword + '@127.0.0.1:5432/' + $PostgresDb + '?schema=public'

# --- .env (create or refresh DATABASE_URL; no UTF-8 BOM) ---
if (-not (Test-Path $ApiEnv)) {
  $example = Join-Path $ScriptDir 'fitgo-api.env.example'
  $content = Get-Content -Path $example -Raw
  $content = $content.Replace('CHANGE_ME_at_least_32_chars_random', $JwtSecret)
  $content = $content.Replace(
    'postgresql://fitgo:CHANGE_ME@127.0.0.1:5432/fitgo?schema=public',
    $dbUrl
  )
  Write-Utf8NoBom -Path $ApiEnv -Content $content
  Write-Host ("Wrote " + $ApiEnv + " - fill FORMA_API_KEY / FORMA_BASIC_AUTH before production use.") -ForegroundColor Green
} else {
  Set-DatabaseUrlInEnvFile -Path $ApiEnv -DbUrl $dbUrl
  Write-Host ("Updated DATABASE_URL in existing " + $ApiEnv) -ForegroundColor DarkGray
}

if (-not (Test-Path $WebEnvLocal)) {
  # Empty = browser calls same-origin /api (Next rewrite → Nest on :3001)
  Write-Utf8NoBom -Path $WebEnvLocal -Content "NEXT_PUBLIC_API_URL=`r`nFITGO_API_PROXY_TARGET=http://127.0.0.1:3001`r`n"
}

Push-Location $FitGoRoot
try {
  Write-Host 'pnpm install...'
  pnpm install
  Assert-LastExit 'pnpm install'
  Write-Host 'Building packages...'
  pnpm --filter @fitgo/shared-types build
  Assert-LastExit 'shared-types build'
  pnpm --filter @fitgo/1c-adapter build
  Assert-LastExit '1c-adapter build'
  pnpm --filter @fitgo/osmi-adapter build
  Assert-LastExit 'osmi-adapter build'
  pnpm --filter @fitgo/api exec prisma generate
  Assert-LastExit 'prisma generate'
  Write-Host 'DB push + minimal seed (C)...'
  $env:FITGO_SEED_MODE = 'minimal'
  $env:FITGO_SUPERADMIN_EMAIL = $SuperAdminEmail
  $env:FITGO_SUPERADMIN_PASSWORD = $SuperAdminPassword
  Import-DotEnv -Path $ApiEnv
  if (-not $env:DATABASE_URL) {
    throw 'DATABASE_URL not loaded from apps/api/.env'
  }
  Write-Host ('DATABASE_URL loaded, length=' + $env:DATABASE_URL.Length) -ForegroundColor DarkGray
  pnpm db:push
  Assert-LastExit 'prisma db push'
  pnpm db:seed
  Assert-LastExit 'db seed'
  pnpm --filter @fitgo/api build
  Assert-LastExit 'api build'
  pnpm --filter @fitgo/web build
  Assert-LastExit 'web build'
} finally {
  Pop-Location
}

# --- NSSM services ---
function Register-FitGoService {
  param(
    [string]$Name,
    [string]$AppDir,
    [string]$App,
    [string]$AppParams,
    [string]$ExtraEnv
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $NssmExe stop $Name 2>&1 | Out-Null
  & $NssmExe remove $Name confirm 2>&1 | Out-Null
  $ErrorActionPreference = $prev
  & $NssmExe install $Name $App $AppParams
  & $NssmExe set $Name AppDirectory $AppDir
  & $NssmExe set $Name Start SERVICE_AUTO_START
  & $NssmExe set $Name AppStdout (Join-Path $InstallRoot ("logs\" + $Name + "-out.log"))
  & $NssmExe set $Name AppStderr (Join-Path $InstallRoot ("logs\" + $Name + "-err.log"))
  & $NssmExe set $Name AppRotateFiles 1
  if ($ExtraEnv) {
    & $NssmExe set $Name AppEnvironmentExtra $ExtraEnv
  }
}

New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'logs') | Out-Null

$nodeExe = (Get-Command node).Source
$apiDir = Join-Path $FitGoRoot 'apps\api'
$webDir = Join-Path $FitGoRoot 'apps\web'
$nextBin = Join-Path $webDir 'node_modules\next\dist\bin\next'

Register-FitGoService -Name 'FitGO-API' -AppDir $apiDir -App $nodeExe -AppParams 'dist\main.js' -ExtraEnv ''
$webParams = '"' + $nextBin + '" start -p 3000'
Register-FitGoService -Name 'FitGO-Web' -AppDir $webDir -App $nodeExe -AppParams $webParams -ExtraEnv 'NODE_ENV=production'

Start-Service FitGO-API
Start-Service FitGO-Web

Write-Host ''
Write-Host '=== Install complete (variant C) ===' -ForegroundColor Green
Write-Host 'Admin web:  http://127.0.0.1:3000'
Write-Host 'API:        http://127.0.0.1:3001/api'
Write-Host ("Login:      " + $SuperAdminEmail)
Write-Host ("Password:   " + $SuperAdminPassword)
Write-Host ''
Write-Host 'Next (on-site checklist): see README.md in this folder.'
Write-Host 'Fill FORMA_* in apps\api\.env, then: Restart-Service FitGO-API'
Write-Host 'Do NOT dump/restore Mac/VPS Postgres into this install.'
