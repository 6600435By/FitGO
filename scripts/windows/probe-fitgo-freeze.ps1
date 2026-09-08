# Probe POST /membership/freeze (FitGOIntegration)
# Usage: cd C:\fitgo-probe ; .\probe-fitgo-freeze.ps1
. (Join-Path $PSScriptRoot 'Load-EnvProbe.ps1')

$curl = $env:CURL
if (-not $curl -or -not (Test-Path -LiteralPath $curl)) {
    Write-Error "CURL not found. Set CURL= full path in .env.probe"
    exit 1
}

$base = $env:FORMA_FITGO_URL.TrimEnd('/')          # .../fitgo/hs/fitgo/v1 — as Nest uses it
$hsRoot = $base -replace '/v1$', ''                 # .../fitgo/hs/fitgo — to detect a template without /v1
$extId = $env:FORMA_TEST_EXTERNAL_ID
if (-not $extId) { $extId = 'ff94bf6a-b4d2-11e8-80e9-7085c20c362e' }
$H = @(
    '-H', "apikey: $($env:FORMA_API_KEY)",
    '-H', "Authorization: Basic $($env:FORMA_BASIC_AUTH)",
    '-H', 'Content-Type: application/json'
)
$body = "{`"externalId`":`"$extId`",`"days`":1,`"fromDate`":`"2026-09-08`"}"
$resultsDir = Join-Path $PSScriptRoot 'results'
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

Write-Host "BASE $base" -ForegroundColor Cyan
Write-Host "BODY $body"

$targets = @(
    @{ label = 'v1 (what Nest calls)';      url = "$base/membership/freeze" },
    @{ label = 'no /v1 (template mistake)'; url = "$hsRoot/membership/freeze" }
)
$codes = @{}
foreach ($t in $targets) {
    Write-Host "=== POST $($t.url)  [$($t.label)] ===" -ForegroundColor Cyan
    $out = Join-Path $resultsDir ("fitgo_freeze_" + ($t.label -replace '[^a-z0-9]+', '_') + ".txt")
    $code = & $curl -sk -m 90 -o $out -w '%{http_code}' -X POST @H -d $body $t.url 2>&1 |
        ForEach-Object { "$_" } | Select-Object -Last 1
    $code = $code.ToString().Trim()
    $codes[$t.label] = $code
    Write-Host "HTTP $code"
    Write-Host "--- body (first 20 lines) ---"
    if (Test-Path $out) {
        Get-Content -LiteralPath $out -TotalCount 20 -ErrorAction SilentlyContinue
    }
}

Write-Host ""
if ($codes['v1 (what Nest calls)'] -eq '404' -and $codes['no /v1 (template mistake)'] -ne '404') {
    Write-Host "DIAGNOSIS: template is published WITHOUT /v1. In Configurator set Шаблон = /v1/membership/freeze, F7, republish 'fitgo'." -ForegroundColor Yellow
}
if ($codes.Values -contains '500') {
    Write-Host "DIAGNOSIS: handler runs but 1C raised an error. If body says 'Предупреждение безопасности ... WinHttp' -> Configurator: Расширения конфигурации -> uncheck 'Защита от опасных действий' for the extension." -ForegroundColor Yellow
}
if (($codes.Values | Where-Object { $_ -ne '404' }).Count -eq 0) {
    Write-Host "Both 404: check function FreezePOST exists, handler name = FreezePOST, F7, republish 'fitgo', restart Apache :8445." -ForegroundColor Yellow
}
