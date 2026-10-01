# Install FitGO hall snapshot agent as a Windows service (NSSM).
# Requires: Node 20+, ffmpeg in PATH, C:\FitGO\hall-cameras.json, HALL_SNAPSHOT_AGENT_TOKEN on API.
#
#   .\Install-HallAgent.ps1

param(
  [string]$NodeExe = 'C:\Program Files\nodejs\node.exe',
  [string]$AgentDir = '',
  [string]$ConfigPath = 'C:\FitGO\hall-cameras.json',
  [string]$ServiceName = 'FitGO-HallAgent'
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

$nssmCmd = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssmCmd) {
  throw 'nssm not in PATH. Install NSSM (same as FitGO-API) then retry.'
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Service $ServiceName already exists - restarting"
  Restart-Service $ServiceName
  Get-Service $ServiceName
  return
}

New-Item -ItemType Directory -Force -Path 'C:\FitGO\logs' | Out-Null

& nssm install $ServiceName $NodeExe
& nssm set $ServiceName AppParameters "`"$agentJs`" `"$ConfigPath`""
& nssm set $ServiceName AppDirectory $AgentDir
& nssm set $ServiceName Start SERVICE_AUTO_START
& nssm set $ServiceName AppStdout 'C:\FitGO\logs\hall-agent.out.log'
& nssm set $ServiceName AppStderr 'C:\FitGO\logs\hall-agent.err.log'
& nssm start $ServiceName

Write-Host "Started $ServiceName"
Get-Service $ServiceName
Write-Host "Logs: C:\FitGO\logs\hall-agent.out.log"
