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
$H = @('-H', "apikey: $($env:FORMA_API_KEY)", '-H', "Authorization: Basic $($env:FORMA_BASIC_AUTH)")

foreach ($ep in @(
    @{ n = 'health'; p = '/health' },
    @{ n = 'client'; p = "/client?phone=$phone" },
    @{ n = 'membership'; p = "/membership?phone=$phone" },
    @{ n = 'visits'; p = "/visits?phone=$phone&from=2026-01-01&to=2026-06-16" },
    @{ n = 'card'; p = "/card?phone=$phone" }
)) {
    Write-Host "=== $($ep.n) ===" -ForegroundColor Cyan
    $out = Join-Path $resultsDir "fitgo_$($ep.n).json"
    $code = & $curl -sk -o $out -w '%{http_code}' @H "$base$($ep.p)" 2>&1 |
        ForEach-Object { "$_" } | Select-Object -Last 1
    Write-Host "HTTP $($code.ToString().Trim())"
}
