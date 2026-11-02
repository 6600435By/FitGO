<#
.SYNOPSIS
  Night DumpIB for 1C infobase "forma" with exclusive lock (deny HTTP sessions first).

.DESCRIPTION
  Compatible with Windows PowerShell 5.1 (Server 2016).
  Old bat only taskkill'ed 1cv8.exe / 1cv8c.exe — HTTP sessions (WordpressUserAPI)
  stayed open and blocked exclusive lock. This script:
    1) denies new sessions + scheduled jobs (permission code NightBackup)
    2) terminates existing sessions/connections via rac
    3) runs DESIGNER /DumpIB /UC NightBackup /DisableStartupDialogs
    4) always clears session deny in finally

  Secrets: C:\BackUp\backup-1c.secret.ps1 (see backup-1c.secret.ps1.example).

.EXAMPLE
  .\Backup-1C-Forma.ps1
  .\Backup-1C-Forma.ps1 -BackupRoot D:\BackUp
#>
[CmdletBinding()]
param(
  [string]$BackupRoot = 'C:\BackUp',
  [string]$SecretPath = '',
  [string]$ServerRef = '127.0.0.1\forma',
  [string]$InfobaseName = 'forma',
  [string]$PermissionCode = 'NightBackup',
  [string]$DesignerExe = 'C:\Program Files (x86)\1cv8\8.3.17.1549\bin\1cv8.exe',
  [string]$RacExe = '',
  [string]$PlatformVersion = '8.3.17.1549',
  [int]$DenyWindowHours = 2,
  [int]$TerminateRounds = 5,
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

function Get-RacField([string]$Text, [string]$Name) {
  foreach ($line in ($Text -split "`r?`n")) {
    if ($line -match ('^\s*' + [regex]::Escape($Name) + '\s*:\s*(.+)\s*$')) {
      return $Matches[1].Trim()
    }
  }
  return $null
}

function Split-RacBlocks([string]$Text) {
  $blocks = @()
  $cur = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($Text -split "`r?`n")) {
    if ($line.Trim() -eq '') {
      if ($cur.Count -gt 0) {
        $blocks += , ($cur -join "`n")
        $cur = New-Object System.Collections.Generic.List[string]
      }
      continue
    }
    $cur.Add($line) | Out-Null
  }
  if ($cur.Count -gt 0) {
    $blocks += , ($cur -join "`n")
  }
  return $blocks
}

function Invoke-Rac {
  param(
    [Parameter(Mandatory = $true)][string[]]$RacArgs
  )
  $all = @()
  if ($script:ClusterUser) {
    $all += @('--cluster-user=' + $script:ClusterUser)
    if ($null -ne $script:ClusterPassword) {
      $all += @('--cluster-pwd=' + $script:ClusterPassword)
    }
  }
  $all += $RacArgs
  $out = & $script:RacPath @all 2>&1
  $code = $LASTEXITCODE
  $text = ($out | ForEach-Object { "$_" }) -join "`n"
  if ($code -ne 0) {
    throw ("rac failed (exit {0}): {1} {2}" -f $code, ($RacArgs -join ' '), $text)
  }
  return $text
}

function Find-RacExe([string]$Version, [string]$Explicit) {
  if ($Explicit -and (Test-Path -LiteralPath $Explicit)) {
    return $Explicit
  }
  $candidates = @(
    ("C:\Program Files\1cv8\{0}\bin\rac.exe" -f $Version),
    ("C:\Program Files (x86)\1cv8\{0}\bin\rac.exe" -f $Version),
    'C:\Program Files\1cv8\common\rac.exe',
    'C:\Program Files (x86)\1cv8\common\rac.exe'
  )
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) { return $c }
  }
  $cmd = Get-Command rac.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Format-RacDate([datetime]$Dt) {
  return $Dt.ToString('yyyy-MM-ddTHH:mm:ss')
}

function Set-InfobaseSessionDeny {
  param(
    [Parameter(Mandatory = $true)][bool]$Deny
  )
  $args = @(
    'infobase', 'update',
    ('--cluster={0}' -f $script:ClusterId),
    ('--infobase={0}' -f $script:InfobaseId),
    ('--infobase-user={0}' -f $script:IbUser),
    ('--infobase-pwd={0}' -f $script:IbPassword)
  )
  if ($Deny) {
    $from = Get-Date
    $to = $from.AddHours($DenyWindowHours)
    $args += @(
      '--sessions-deny=on',
      '--scheduled-jobs-deny=on',
      ('--denied-from={0}' -f (Format-RacDate $from)),
      ('--denied-to={0}' -f (Format-RacDate $to)),
      '--denied-message=Backup in progress',
      ('--permission-code={0}' -f $PermissionCode)
    )
  } else {
    $args += @(
      '--sessions-deny=off',
      '--scheduled-jobs-deny=off',
      '--denied-from=',
      '--denied-to=',
      '--denied-message=',
      '--permission-code='
    )
  }
  [void](Invoke-Rac -RacArgs $args)
}

function Clear-InfobaseSessions {
  $round = 0
  while ($round -lt $TerminateRounds) {
    $round++
    $sessionText = Invoke-Rac -RacArgs @(
      'session', 'list',
      ('--cluster={0}' -f $script:ClusterId),
      ('--infobase={0}' -f $script:InfobaseId)
    )
    $sessionIds = @()
    foreach ($block in (Split-RacBlocks $sessionText)) {
      $sid = Get-RacField $block 'session'
      if ($sid) { $sessionIds += $sid }
    }

    $connText = Invoke-Rac -RacArgs @(
      'connection', 'list',
      ('--cluster={0}' -f $script:ClusterId),
      ('--infobase={0}' -f $script:InfobaseId)
    )
    $connections = @()
    foreach ($block in (Split-RacBlocks $connText)) {
      $cid = Get-RacField $block 'connection'
      $pid = Get-RacField $block 'process'
      if ($cid -and $pid) {
        $connections += [pscustomobject]@{ Connection = $cid; Process = $pid }
      }
    }

    if ($sessionIds.Count -eq 0 -and $connections.Count -eq 0) {
      Write-BackupLog ('No sessions/connections left (round {0}).' -f $round)
      return
    }

    Write-BackupLog ('Round {0}: terminate {1} session(s), disconnect {2} connection(s).' -f `
      $round, $sessionIds.Count, $connections.Count)

    foreach ($sid in $sessionIds) {
      try {
        [void](Invoke-Rac -RacArgs @(
          'session', 'terminate',
          ('--cluster={0}' -f $script:ClusterId),
          ('--session={0}' -f $sid)
        ))
      } catch {
        Write-BackupLog ("session terminate {0}: {1}" -f $sid, $_.Exception.Message)
      }
    }

    foreach ($c in $connections) {
      try {
        [void](Invoke-Rac -RacArgs @(
          'connection', 'disconnect',
          ('--cluster={0}' -f $script:ClusterId),
          ('--process={0}' -f $c.Process),
          ('--connection={0}' -f $c.Connection)
        ))
      } catch {
        Write-BackupLog ("connection disconnect {0}: {1}" -f $c.Connection, $_.Exception.Message)
      }
    }

    Start-Sleep -Seconds 2
  }

  throw 'Sessions/connections still present after terminate rounds — refuse DumpIB'
}

# --- bootstrap ---
if (-not $SecretPath) {
  $SecretPath = Join-Path $BackupRoot 'backup-1c.secret.ps1'
}
if (-not (Test-Path -LiteralPath $SecretPath)) {
  throw ("Secret file not found: {0} (copy backup-1c.secret.ps1.example)" -f $SecretPath)
}
. $SecretPath
if (-not $IbUser) { throw 'IbUser is empty in secret file' }
if ($null -eq $IbPassword) { throw 'IbPassword is missing in secret file' }

$script:IbUser = $IbUser
$script:IbPassword = $IbPassword
$script:ClusterUser = $ClusterUser
$script:ClusterPassword = $ClusterPassword

if (-not (Test-Path -LiteralPath $BackupRoot)) {
  New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
}
$script:LogPath = Join-Path $BackupRoot '1c.log'
Write-BackupLog '=== Backup-1C-Forma start ==='

if (-not (Test-Path -LiteralPath $DesignerExe)) {
  throw ("Designer not found: {0}" -f $DesignerExe)
}

$script:RacPath = Find-RacExe -Version $PlatformVersion -Explicit $RacExe
if (-not $script:RacPath) {
  throw 'rac.exe not found (install 1C server tools or pass -RacExe)'
}
Write-BackupLog ("rac: {0}" -f $script:RacPath)
Write-BackupLog ("designer: {0}" -f $DesignerExe)

if (-not $SkipClientKill) {
  foreach ($im in @('1cv8.exe', '1cv8c.exe')) {
    try {
      $procs = Get-Process -Name ($im -replace '\.exe$', '') -ErrorAction SilentlyContinue
      if ($procs) {
        Write-BackupLog ("Stopping local {0} ({1} process(es))" -f $im, @($procs).Count)
        $procs | Stop-Process -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Write-BackupLog ("Stop {0}: {1}" -f $im, $_.Exception.Message)
    }
  }
}

$clusterText = Invoke-Rac -RacArgs @('cluster', 'list')
$script:ClusterId = Get-RacField $clusterText 'cluster'
if (-not $script:ClusterId) {
  # multi-cluster: take first block
  $blocks = Split-RacBlocks $clusterText
  if ($blocks.Count -gt 0) {
    $script:ClusterId = Get-RacField $blocks[0] 'cluster'
  }
}
if (-not $script:ClusterId) {
  throw ("Cannot parse cluster id from rac cluster list:`n{0}" -f $clusterText)
}
Write-BackupLog ("cluster: {0}" -f $script:ClusterId)

$ibText = Invoke-Rac -RacArgs @(
  'infobase', 'summary', 'list',
  ('--cluster={0}' -f $script:ClusterId)
)
$script:InfobaseId = $null
foreach ($block in (Split-RacBlocks $ibText)) {
  $name = Get-RacField $block 'name'
  if ($name -and ($name -ieq $InfobaseName)) {
    $script:InfobaseId = Get-RacField $block 'infobase'
    break
  }
}
if (-not $script:InfobaseId) {
  throw ("Infobase '{0}' not found in cluster. rac output:`n{1}" -f $InfobaseName, $ibText)
}
Write-BackupLog ("infobase {0}: {1}" -f $InfobaseName, $script:InfobaseId)

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

$denied = $false
$dumpOk = $false
try {
  Write-BackupLog ('Deny sessions (permission-code={0}, window {1}h)...' -f $PermissionCode, $DenyWindowHours)
  Set-InfobaseSessionDeny -Deny $true
  $denied = $true

  Clear-InfobaseSessions

  Write-BackupLog 'Starting DESIGNER DumpIB...'
  # Quote paths for Start-Process (PS 5.1); keep /P unquoted (no spaces expected).
  $argLine = @(
    'DESIGNER',
    ('/S "{0}"' -f $ServerRef),
    ('/N "{0}"' -f $script:IbUser),
    ('/P "{0}"' -f $script:IbPassword),
    ('/UC "{0}"' -f $PermissionCode),
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
  if ($denied) {
    try {
      Write-BackupLog 'Clearing session deny / scheduled-jobs deny...'
      Set-InfobaseSessionDeny -Deny $false
      Write-BackupLog 'Session deny cleared.'
    } catch {
      Write-BackupLog ("CRITICAL: failed to clear session deny: {0}" -f $_.Exception.Message)
      Write-BackupLog 'Clear manually: rac infobase update --sessions-deny=off --scheduled-jobs-deny=off'
      if ($dumpOk) {
        # Prefer surfacing unlock failure after a good dump
        throw
      }
    }
  }
}

if (-not $dumpOk) {
  throw 'Backup-1C-Forma finished without dump'
}

Write-BackupLog '=== Backup-1C-Forma done ==='
exit 0
