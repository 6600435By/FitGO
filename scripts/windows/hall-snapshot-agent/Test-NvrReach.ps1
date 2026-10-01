# Quick network check: can THIS PC reach Dahua NVR?
#   .\Test-NvrReach.ps1
#   .\Test-NvrReach.ps1 -NvrHost 192.168.1.108
#   .\Test-NvrReach.ps1 -HttpPort 8080

param(
  [string]$NvrHost = '192.168.1.108',
  [int]$HttpPort = 0
)

Write-Host "=== Local addresses ==="
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' } |
  Select-Object InterfaceAlias, IPAddress, PrefixLength |
  Format-Table -AutoSize

Write-Host "=== Ping $NvrHost ==="
ping.exe -n 2 $NvrHost

Write-Host ""
Write-Host "=== TCP port scan (common Dahua HTTP / web) ==="

# If -HttpPort given, test only that; else try usual candidates.
$ports = if ($HttpPort -gt 0) {
  @($HttpPort)
} else {
  @(80, 8080, 8000, 88, 8008, 443, 8443, 554, 37777)
}

$open = @()
foreach ($p in $ports) {
  $tnc = Test-NetConnection -ComputerName $NvrHost -Port $p -WarningAction SilentlyContinue
  $ok = [bool]$tnc.TcpTestSucceeded
  $mark = if ($ok) { 'OPEN ' } else { 'closed' }
  Write-Host ("  {0,-5}  {1}" -f $p, $mark)
  if ($ok) { $open += $p }
}

Write-Host ""
if ($open.Count -eq 0) {
  Write-Host "RESULT: ping OK, but no common HTTP port is open from this PC."
  Write-Host "On NVR monitor: SETTING -> NETWORK -> CONNECTION (look at HTTP Port)."
  Write-Host "Then: .\Test-NvrReach.ps1 -HttpPort <that_number>"
  Write-Host "Also check NVR / firewall ACL: allow source 192.168.1.20 to NVR HTTP."
  return
}

Write-Host ("RESULT: open ports: {0}" -f ($open -join ', '))
Write-Host "Use the HTTP port from NVR CONNECTION page (often 80 or 8080)."
Write-Host "Prove snapshot example:"
Write-Host ("  .\Prove-Snapshot.ps1 -Password '***' -HttpPort {0}" -f $open[0])
Write-Host "In hall-cameras.json urls use: http://${NvrHost}:PORT/cgi-bin/snapshot.cgi?channel=12"
