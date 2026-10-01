# Install FitGO hall snapshot agent as a Windows service (NSSM).
# Requires: Node 20+, ffmpeg in PATH, C:\FitGO\hall-cameras.json, HALL_SNAPSHOT_AGENT_TOKEN on API.
#
#   .\Install-HallAgent.ps1
#   .\Install-HallAgent.ps1 -NssmExe C:\FitGO\tools\nssm\nssm.exe

param(
  [string]$NodeExe = 'C:\Program Files\nodejs\node.exe',
  [string]$AgentDir = '',
  [string]$ConfigPath = 'C:\FitGO\hall-cameras.json',
  [string]$ServiceName = 'FitGO-HallAgent',
  [string]$InstallRoot = 'C:\FitGO',
  [string]$NssmExe = ''
)

$ErrorActionPreference = 'Stop'

if (-not $AgentDir) {
  $AgentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$agentJs = Join-Path $AgentDir 'agent.mjs'
if (-not (Test-Path $NodeExe)) { throw "Node not found: $NodeExe" }
if (-not (Test-Path $agentJs)) { throw "agent.mjs not found: $agentJs" }
if (-not (Test-Path $ConfigPath)) {
  throw "Config missing: $ConfigPath (copy hall-cameras.example.json)"
}

# Resolve nssm: explicit param -> FitGO tools (same as Install-FitGO) -> PATH
if (-not $NssmExe) {
  $candidate = Join-Path $InstallRoot 'tools\nssm\nssm.exe'
  if (Test-Path $candidate) {
    $NssmExe = $candidate
  }
  else {
    $cmd = Get-Command nssm -ErrorAction SilentlyContinue
    if ($cmd) { $NssmExe = $cmd.Source }
  }
}
if (-not $NssmExe -or -not (Test-Path $NssmExe)) {
  throw "nssm.exe not found. Expected $InstallRoot\tools\nssm\nssm.exe (FitGO install) or nssm in PATH."
}

Write-Host "Using nssm: $NssmExe"

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Service $ServiceName already exists - restarting"
  Restart-Service $ServiceName
  Get-Service $ServiceName
  return
}

New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'logs') | Out-Null

& $NssmExe install $ServiceName $NodeExe
& $NssmExe set $ServiceName AppParameters "`"$agentJs`" `"$ConfigPath`""
& $NssmExe set $ServiceName AppDirectory $AgentDir
& $NssmExe set $ServiceName Start SERVICE_AUTO_START
& $NssmExe set $ServiceName AppStdout (Join-Path $InstallRoot 'logs\hall-agent.out.log')
& $NssmExe set $ServiceName AppStderr (Join-Path $InstallRoot 'logs\hall-agent.err.log')
& $NssmExe start $ServiceName

Write-Host "Started $ServiceName"
Get-Service $ServiceName
Write-Host "Logs: $(Join-Path $InstallRoot 'logs\hall-agent.out.log')"
