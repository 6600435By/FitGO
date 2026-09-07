# FitGO — диагностика + подъём Apache :8445 (запускать на WS2016 в PowerShell от admin)
# Не трогает VirtualHost :444 / публикацию forma.
# Сохранить как C:\fitgo-probe\enable-apache-8445.ps1 и: powershell -ExecutionPolicy Bypass -File .\enable-apache-8445.ps1

$ErrorActionPreference = 'Continue'
$ApacheRoot = 'C:\Apache24'
$Conf = Join-Path $ApacheRoot 'conf\httpd.conf'
$FitgoDir = Join-Path $ApacheRoot 'htdocs\fitgo'
$Vrd = Join-Path $FitgoDir 'default.vrd'
$Ts = Get-Date -Format 'yyyyMMdd-HHmmss'

Write-Host "=== 1. Paths ===" -ForegroundColor Cyan
@(
  $ApacheRoot, $Conf, $FitgoDir, $Vrd
) | ForEach-Object { Write-Host ("{0}  exists={1}" -f $_, (Test-Path $_)) }

Write-Host "`n=== 2. Listen / VirtualHost mentions ===" -ForegroundColor Cyan
Get-ChildItem (Join-Path $ApacheRoot 'conf') -Recurse -Include *.conf |
  Select-String -Pattern 'Listen\s+8445|Listen\s+445|\*:8445|\*:445|\*:444|/fitgo' |
  ForEach-Object { '{0}:{1}: {2}' -f $_.Path, $_.LineNumber, $_.Line.Trim() }

Write-Host "`n=== 3. default.vrd enable= ===" -ForegroundColor Cyan
if (Test-Path $Vrd) {
  Select-String -Path $Vrd -Pattern 'enable=' | Select-Object -First 5 |
    ForEach-Object { $_.Line.Trim() }
} else {
  Write-Host 'NO default.vrd — need 1C publish to htdocs\fitgo\' -ForegroundColor Yellow
}

Write-Host "`n=== 4. Apache service ===" -ForegroundColor Cyan
Get-Service | Where-Object { $_.Name -match 'Apache|httpd' } |
  Format-Table Name, Status, StartType -AutoSize

Write-Host "`n=== 5. Ports listening ===" -ForegroundColor Cyan
netstat -an | findstr 'LISTENING' | findstr ':444 :445 :8445'

Write-Host "`n=== NEXT (manual) ===" -ForegroundColor Green
Write-Host @'
A) If Listen 8445 / VirtualHost *:8445 missing:
   - Backup conf: Copy-Item httpd.conf httpd.conf.bak-TIMESTAMP
   - Copy VirtualHost *:444 block → *:8445 (same SSL, DocumentRoot/handlers as 444)
   - Ensure Alias or path serves htdocs\fitgo for /fitgo
   - httpd -t && Restart-Service Apache2.4

B) In 1C Configurator → publish fitgo:
   - Publication enable = true (root enable="true" in default.vrd)
   - Do NOT publish into htdocs root (only htdocs\fitgo\)
   - Keep forma on :444 untouched

C) From this server:
   curl.exe -sk -o NUL -w "%{http_code}\n" https://127.0.0.1:8445/fitgo/hs/api/v3/
   Expected: not 000 (401/404/200 all mean Apache+pub reached)

D) Then install FitGOIntegration extension (see 1C_CONFIGURATOR_INSTALL.md)
'@
