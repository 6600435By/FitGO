. (Join-Path $PSScriptRoot 'Load-EnvProbe.ps1')

$required = @(
    'FORMA_LEGACY_BASE_URL', 'FORMA_CLUB_ID', 'PROBE_START_DATE',
    'PROBE_END_DATE', 'FORMA_API_KEY', 'FORMA_BASIC_AUTH', 'CURL'
)
foreach ($name in $required) {
    $val = (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue).Value
    if ([string]::IsNullOrWhiteSpace($val)) {
        Write-Error "Missing env $name in .env.probe"
        exit 1
    }
}

$resultsDir = Join-Path $PSScriptRoot 'results'
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

$start = [uri]::EscapeDataString($env:PROBE_START_DATE)
$end = [uri]::EscapeDataString($env:PROBE_END_DATE)
$url = "$($env:FORMA_LEGACY_BASE_URL)/classes/?club_id=$($env:FORMA_CLUB_ID)&start_date=$start&end_date=$end"
$curl = $env:CURL
$out = Join-Path $resultsDir 'regression_forma_444.json'

Write-Host "=== REGRESSION forma :444 ===" -ForegroundColor Cyan
Write-Host "URL: $url"
Write-Host "CURL: $curl"

if (-not (Test-Path -LiteralPath $curl)) {
    Write-Error "curl not found: $curl"
    exit 1
}

$httpCode = & $curl -sk -o $out -w '%{http_code}' `
    -H "apikey: $($env:FORMA_API_KEY)" `
    -H "Authorization: Basic $($env:FORMA_BASIC_AUTH)" `
    $url 2>&1 | ForEach-Object { "$_" }
$httpCode = ($httpCode | Select-Object -Last 1).ToString().Trim()

Write-Host "HTTP $httpCode"

if ($httpCode -eq '200') {
    Write-Host 'PASS' -ForegroundColor Green
    exit 0
}

Write-Host 'FAIL' -ForegroundColor Red
if (Test-Path $out) {
    Write-Host 'Response body (first lines):'
    Get-Content $out -TotalCount 8 -ErrorAction SilentlyContinue
}
exit 1
