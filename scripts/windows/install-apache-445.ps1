# Apache :445 helper - run as Administrator on WS2016
$ErrorActionPreference = 'Stop'
$ApacheConf = 'C:\Apache24\conf\httpd.conf'
$SslConf = 'C:\Apache24\conf\extra\httpd-ssl.conf'
$Template = Join-Path $PSScriptRoot 'apache-vhost-445.conf.template'

if (-not (Test-Path $ApacheConf)) {
    Write-Error "Apache not found: $ApacheConf"
}

$ts = Get-Date -Format yyyyMMdd-HHmm
Copy-Item $ApacheConf "$ApacheConf.bak-$ts"
if (Test-Path $SslConf) {
    Copy-Item $SslConf "$SslConf.bak-$ts"
}

Write-Host "Backup created (*.bak-$ts)" -ForegroundColor Green

$listen445 = Select-String -Path $ApacheConf -Pattern '^\s*Listen\s+445\s*$' -Quiet
if (-not $listen445) {
    Add-Content -Path $ApacheConf -Value "`nListen 445"
    Write-Host "Added Listen 445 to httpd.conf" -ForegroundColor Yellow
} else {
    Write-Host "Listen 445 already present" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "NEXT: copy VirtualHost *:444 to *:445 manually. Template:" -ForegroundColor Cyan
Write-Host "  $Template"
Write-Host "  Select-String -Path C:\Apache24\conf\*.conf -Pattern '444' -Recurse"
Write-Host "  C:\Apache24\bin\httpd.exe -t"
Write-Host "  Restart-Service Apache2.4"
