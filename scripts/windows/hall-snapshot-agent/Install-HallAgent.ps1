# Optional NSSM installer for FitGO hall snapshot agent (run on club Windows server).
# Requires: Node 20+, C:\FitGO\hall-cameras.json already filled, API token set.

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
if (-not (Test-Path $ConfigPath)) { throw "Config missing: $ConfigPath (copy hall-cameras.example.json)" }

$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) {
  throw 'nssm not in PATH. Install NSSM or register the service manually (see README.md).'
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Service $ServiceName already exists — restarting"
  Restart-Service $ServiceName
  return
}

& nssm install $ServiceName $NodeExe
& nssm set $ServiceName AppParameters "`"$agentJs`" `"$ConfigPath`""
& nssm set $ServiceName AppDirectory $AgentDir
& nssm set $ServiceName Start SERVICE_AUTO_START
& nssm set $ServiceName AppStdout 'C:\FitGO\logs\hall-agent.out.log'
& nssm set $ServiceName AppStderr 'C:\FitGO\logs\hall-agent.err.log'
New-Item -ItemType Directory -Force -Path 'C:\FitGO\logs' | Out-Null
& nssm start $ServiceName
Write-Host "Started $ServiceName"
