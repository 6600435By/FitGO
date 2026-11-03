<#
.SYNOPSIS
  Night DumpIB for 1C infobase "forma" with exclusive lock.

.DESCRIPTION
  Compatible with Windows PowerShell 5.1 (Server 2016).

  Stop-Apache alone is NOT enough: rphost "background job" sessions stay alive
  and block /DumpIB exclusive lock (seen 2026-11-03 00:56).

  This script:
    1) ensures RAS listens on 1545 (starts ras.exe if needed)
    2) via rac: --sessions-deny=on + --scheduled-jobs-deny=on (code NightBackup)
    3) terminates sessions/connections (HTTP + background jobs)
    4) optionally stops Apache so HTTP does not reconnect mid-dump
    5) DESIGNER /DumpIB /UC NightBackup /DisableStartupDialogs
    6) always clears deny (+ restarts Apache) in finally

  Secrets: C:\BackUp\backup-1c.secret.ps1 (see backup-1c.secret.ps1.example).
  For night reliability register RAS as a service (Register-1C-RAS.ps1).

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
  [string]$RasExe = '',
  [string]$PlatformVersion = '8.3.17.1549',
  [string]$RasHost = 'localhost',
  [int]$RasPort = 1545,
  [string]$ApacheService = 'Apache2.4',
  [int]$DenyWindowHours = 2,
  [int]$TerminateRounds = 8,
  [int]$AfterStopWaitSec = 3,
  [switch]$SkipClientKill,
  [switch]$SkipApacheStop,
  [switch]$SkipRasStart
)

$ErrorActionPreference = 'Stop'
$script:RasStartedByUs = $false
$script:RasProcess = $null

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

function Test-TcpPortOpen([string]$HostName, [int]$Port, [int]$TimeoutMs = 800) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($HostName, $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
    if (-not $ok) {
      $client.Close()
      return $false
    }
    $client.EndConnect($iar)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Find-PlatformBin([string]$ExeName, [string]$Version, [string]$Explicit) {
  if ($Explicit -and (Test-Path -LiteralPath $Explicit)) {
    return $Explicit
  }
  $candidates = @(
    ("C:\Program Files\1cv8\{0}\bin\{1}" -f $Version, $ExeName),
    ("C:\Program Files (x86)\1cv8\{0}\bin\{1}" -f $Version, $ExeName),
    ("C:\Program Files\1cv8\common\{0}" -f $ExeName),
    ("C:\Program Files (x86)\1cv8\common\{0}" -f $ExeName)
  )
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) { return $c }
  }
  $cmd = Get-Command $ExeName -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Ensure-RasRunning {
  $endpoint = ('{0}:{1}' -f $RasHost, $RasPort)
  if (Test-TcpPortOpen -HostName $RasHost -Port $RasPort) {
    Write-BackupLog ("RAS already listening on {0}" -f $endpoint)
    return
  }
  if ($SkipRasStart) {
    throw ("RAS not listening on {0} and -SkipRasStart set. Start ras or Register-1C-RAS.ps1." -f $endpoint)
  }
  $rasPath = Find-PlatformBin -ExeName 'ras.exe' -Version $PlatformVersion -Explicit $RasExe
  if (-not $rasPath) {
    throw ("ras.exe not found. Install 1C tools or pass -RasExe. Need RAS on {0}." -f $endpoint)
  }
  Write-BackupLog ("Starting RAS: {0} cluster --port={1}" -f $rasPath, $RasPort)
  $script:RasProcess = Start-Process -FilePath $rasPath -ArgumentList @('cluster', ("--port={0}" -f $RasPort)) `
    -WindowStyle Hidden -PassThru
  $script:RasStartedByUs = $true
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPortOpen -HostName $RasHost -Port $RasPort) {
      Write-BackupLog ("RAS ready on {0} (pid {1})" -f $endpoint, $script:RasProcess.Id)
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw ("RAS started but port {0} still closed after 20s" -f $endpoint)
}

function Invoke-Rac {
  param(
    [Parameter(Mandatory = $true)][string[]]$RacArgs
  )
  $endpoint = ('{0}:{1}' -f $RasHost, $RasPort)
  $all = @($endpoint)
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

function Format-RacDate([datetime]$Dt) {
  return $Dt.ToString('yyyy-MM-ddTHH:mm:ss')
}

function Set-InfobaseSessionDeny {
  param(
    [Parameter(Mandatory = $true)][bool]$Deny
  )
  $racArgs = @(
    'infobase', 'update',
    ('--cluster={0}' -f $script:ClusterId),
    ('--infobase={0}' -f $script:InfobaseId),
    ('--infobase-user={0}' -f $script:IbUser),
    ('--infobase-pwd={0}' -f $script:IbPassword)
  )
  if ($Deny) {
    $from = Get-Date
    $to = $from.AddHours($DenyWindowHours)
    $racArgs += @(
      '--sessions-deny=on',
      '--scheduled-jobs-deny=on',
      ('--denied-from={0}' -f (Format-RacDate $from)),
      ('--denied-to={0}' -f (Format-RacDate $to)),
      '--denied-message=Backup in progress',
      ('--permission-code={0}' -f $PermissionCode)
    )
  } else {
    $racArgs += @(
      '--sessions-deny=off',
      '--scheduled-jobs-deny=off',
      '--denied-from=',
      '--denied-to=',
      '--denied-message=',
      '--permission-code='
    )
  }
  [void](Invoke-Rac -RacArgs $racArgs)
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
      # Do NOT use $PID - automatic read-only var in PowerShell
      $procId = Get-RacField $block 'process'
      if ($cid -and $procId) {
        $connections += [pscustomobject]@{ Connection = $cid; Process = $procId }
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

  throw 'Sessions/connections still present after terminate rounds - refuse DumpIB'
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
$designerOut = Join-Path $BackupRoot '1c-designer.out.log'
Write-BackupLog '=== Backup-1C-Forma start ==='

if (-not (Test-Path -LiteralPath $DesignerExe)) {
  throw ("Designer not found: {0}" -f $DesignerExe)
}

$script:RacPath = Find-PlatformBin -ExeName 'rac.exe' -Version $PlatformVersion -Explicit $RacExe
if (-not $script:RacPath) {
  throw 'rac.exe not found (install 1C server tools or pass -RacExe)'
}
Write-BackupLog ("rac: {0}" -f $script:RacPath)
Write-BackupLog ("designer: {0}" -f $DesignerExe)

Ensure-RasRunning

if (-not $SkipClientKill) {
  foreach ($im in @('1cv8', '1cv8c')) {
    try {
      $procs = Get-Process -Name $im -ErrorAction SilentlyContinue
      if ($procs) {
        Write-BackupLog ("Stopping local {0}.exe ({1})" -f $im, @($procs).Count)
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
$apacheWasRunning = $false

try {
  Write-BackupLog ('Deny sessions + scheduled jobs (permission-code={0}, window {1}h)...' -f $PermissionCode, $DenyWindowHours)
  Set-InfobaseSessionDeny -Deny $true
  $denied = $true

  Clear-InfobaseSessions

  if (-not $SkipApacheStop) {
    $svc = Get-Service -Name $ApacheService -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') {
      $apacheWasRunning = $true
      Write-BackupLog ("Stopping {0}..." -f $ApacheService)
      Stop-Service -Name $ApacheService -Force
      Start-Sleep -Seconds $AfterStopWaitSec
      # HTTP may have left sessions; clear again after Apache stop
      Clear-InfobaseSessions
    } elseif ($svc) {
      Write-BackupLog ("{0} already stopped (status={1})" -f $ApacheService, $svc.Status)
    } else {
      Write-BackupLog ("Apache service '{0}' not found - skip stop" -f $ApacheService)
    }
  }

  Write-BackupLog 'Starting DESIGNER DumpIB...'
  $argLine = @(
    'DESIGNER',
    ('/S "{0}"' -f $ServerRef),
    ('/N "{0}"' -f $script:IbUser),
    ('/P "{0}"' -f $script:IbPassword),
    ('/UC "{0}"' -f $PermissionCode),
    '/DisableStartupDialogs',
    ('/Out "{0}"' -f $designerOut),
    ('/DumpIB "{0}"' -f $dumpPath)
  ) -join ' '
  $p = Start-Process -FilePath $DesignerExe -ArgumentList $argLine -Wait -PassThru -NoNewWindow
  $exit = $p.ExitCode
  Write-BackupLog ("DESIGNER exit code: {0}" -f $exit)
  if (Test-Path -LiteralPath $designerOut) {
    $tail = Get-Content -LiteralPath $designerOut -Tail 30 -ErrorAction SilentlyContinue
    if ($tail) {
      Write-BackupLog '--- designer out (tail) ---'
      foreach ($t in $tail) { Write-BackupLog $t }
      Write-BackupLog '--- end designer out ---'
    }
  }
  if ($exit -ne 0) {
    throw ("DumpIB failed with exit code {0}. See {1} and {2}" -f $exit, $script:LogPath, $designerOut)
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
      Write-BackupLog 'Clear manually: rac localhost:1545 infobase update --sessions-deny=off --scheduled-jobs-deny=off'
      if ($dumpOk) { throw }
    }
  }
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
  # Leave RAS running if we started it - next night needs 1545.
  if ($script:RasStartedByUs) {
    Write-BackupLog 'RAS left running (started by this script). Prefer Register-1C-RAS.ps1 as a Windows service.'
  }
}

if (-not $dumpOk) {
  throw 'Backup-1C-Forma finished without dump'
}

Write-BackupLog '=== Backup-1C-Forma done ==='
exit 0
