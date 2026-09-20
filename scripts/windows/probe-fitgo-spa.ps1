# Probe POST consume-service + spa/service-sale (FitGOIntegration)
# Usage: cd C:\fitgo-probe ; .\probe-fitgo-spa.ps1
. (Join-Path $PSScriptRoot 'Load-EnvProbe.ps1')

$curl = $env:CURL
if (-not $curl -or -not (Test-Path -LiteralPath $curl)) {
    Write-Error "CURL not found. Set CURL= full path in .env.probe"
    exit 1
}

$base = $env:FORMA_FITGO_URL.TrimEnd('/')
$hsRoot = $base -replace '/v1$', ''
$extId = $env:FORMA_TEST_EXTERNAL_ID
if (-not $extId) { $extId = 'ff94bf6a-b4d2-11e8-80e9-7085c20c362e' }
$H = @(
    '-H', "apikey: $($env:FORMA_API_KEY)",
    '-H', "Authorization: Basic $($env:FORMA_BASIC_AUTH)",
    '-H', 'Content-Type: application/json'
)
$resultsDir = Join-Path $PSScriptRoot 'results'
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

$consumeBody = "{`"externalId`":`"$extId`",`"serviceName`":`"Массаж классический общий`",`"bookingRef`":`"probe-consume-ps1`",`"occurredAt`":`"2026-09-17T12:00:00.000Z`",`"durationMin`":50}"
$saleBody = "{`"externalId`":`"$extId`",`"serviceName`":`"Классический спа-массаж 50 мин`",`"bookingRef`":`"probe-sale-ps1`",`"occurredAt`":`"2026-09-17T12:05:00.000Z`",`"priceMinor`":7500,`"currency`":`"BYN`",`"durationMin`":50}"

Write-Host "BASE $base" -ForegroundColor Cyan

function Probe-Post($label, $url, $body, $outName) {
    Write-Host "=== POST $url  [$label] ===" -ForegroundColor Cyan
    Write-Host "BODY $body"
    $out = Join-Path $resultsDir $outName
    $code = & $curl -sk -m 90 -o $out -w '%{http_code}' -X POST @H -d $body $url 2>&1 |
        ForEach-Object { "$_" } | Select-Object -Last 1
    $code = $code.ToString().Trim()
    Write-Host "HTTP $code"
    Write-Host "--- body (first 25 lines) ---"
    if (Test-Path $out) {
        Get-Content -LiteralPath $out -TotalCount 25 -ErrorAction SilentlyContinue
    }
    return $code
}

$codeConsumeV1 = Probe-Post 'consume v1' "$base/membership/consume-service" $consumeBody 'fitgo_consume_v1.txt'
$codeConsumeNo = Probe-Post 'consume no /v1' "$hsRoot/membership/consume-service" $consumeBody 'fitgo_consume_nov1.txt'
$codeSaleV1 = Probe-Post 'sale v1' "$base/spa/service-sale" $saleBody 'fitgo_sale_v1.txt'
$codeSaleNo = Probe-Post 'sale no /v1' "$hsRoot/spa/service-sale" $saleBody 'fitgo_sale_nov1.txt'

Write-Host ""
if ($codeConsumeV1 -eq '404' -and $codeConsumeNo -ne '404') {
    Write-Host "DIAGNOSIS consume: template WITHOUT /v1. Set Шаблон = /v1/membership/consume-service, F7, republish fitgo." -ForegroundColor Yellow
}
if ($codeSaleV1 -eq '404' -and $codeSaleNo -ne '404') {
    Write-Host "DIAGNOSIS sale: template WITHOUT /v1. Set Шаблон = /v1/spa/service-sale, F7, republish fitgo." -ForegroundColor Yellow
}
if ($codeConsumeV1 -eq '404' -and $codeSaleV1 -eq '404') {
    Write-Host "Both v1 = 404: add URL templates + handlers ConsumeServicePOST / SpaSalePOST, paste BSL, F7, republish." -ForegroundColor Yellow
}
if (@($codeConsumeV1, $codeSaleV1) -contains '500') {
    Write-Host "DIAGNOSIS 500: if body mentions WinHttp / Предупреждение безопасности -> uncheck 'Защита от опасных действий' on extension." -ForegroundColor Yellow
}
