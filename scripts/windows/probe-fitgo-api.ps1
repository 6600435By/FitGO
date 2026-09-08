. (Join-Path $PSScriptRoot 'Load-EnvProbe.ps1')

$curl = $env:CURL
if (-not $curl -or -not (Test-Path -LiteralPath $curl)) {
    Write-Error "curl not found in .env.probe (CURL=...)"
    exit 1
}

$resultsDir = Join-Path $PSScriptRoot 'results'
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

$base = $env:FORMA_FITGO_URL.TrimEnd('/')
$phone = $env:FORMA_TEST_PHONE
$extId = $env:FORMA_TEST_EXTERNAL_ID
if (-not $extId) { $extId = 'ff94bf6a-b4d2-11e8-80e9-7085c20c362e' }
$H = @('-H', "apikey: $($env:FORMA_API_KEY)", '-H', "Authorization: Basic $($env:FORMA_BASIC_AUTH)")

foreach ($ep in @(
    @{ n = 'health'; p = '/health' },
    @{ n = 'client_phone'; p = "/client?phone=$phone" },
    @{ n = 'client_guid'; p = "/client?externalId=$extId" },
    @{ n = 'membership_phone'; p = "/membership?phone=$phone" },
    @{ n = 'membership_guid'; p = "/membership?externalId=$extId" },
    @{ n = 'visits_guid'; p = "/visits?externalId=$extId&from=2026-01-01&to=2026-12-31" },
    @{ n = 'card_guid'; p = "/card?externalId=$extId" }
)) {
    Write-Host "=== $($ep.n) ===" -ForegroundColor Cyan
    $out = Join-Path $resultsDir "fitgo_$($ep.n).json"
    $code = & $curl -sk -o $out -w '%{http_code}' @H "$base$($ep.p)" 2>&1 |
        ForEach-Object { "$_" } | Select-Object -Last 1
    Write-Host "HTTP $($code.ToString().Trim())"
}

Write-Host ""
Write-Host "Note: client_phone 404 + empty phone in client_guid = телефон не заполнен в КИ контрагента в 1С." -ForegroundColor Yellow
Write-Host "FitGO after CRM link uses externalId — check membership_guid (expect ACTIVE + validUntil)." -ForegroundColor Yellow
Write-Host "Freeze: check freezeAllowed/freezeDaysRemaining in membership_guid; POST /membership/freeze only on test client." -ForegroundColor Yellow
