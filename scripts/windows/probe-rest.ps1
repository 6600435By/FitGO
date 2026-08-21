. (Join-Path $PSScriptRoot 'Load-EnvProbe.ps1')

$curl = $env:CURL
if (-not $curl -or -not (Test-Path -LiteralPath $curl)) {
    Write-Error "curl not found in .env.probe (CURL=...)"
    exit 1
}

$resultsDir = Join-Path $PSScriptRoot 'results'
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

$H = @(
    '-H', "apikey: $($env:FORMA_API_KEY)",
    '-H', "Authorization: Basic $($env:FORMA_BASIC_AUTH)",
    '-H', 'Content-Type: application/json'
)
$start = [uri]::EscapeDataString($env:PROBE_START_DATE)
$end = [uri]::EscapeDataString($env:PROBE_END_DATE)
$club = $env:FORMA_CLUB_ID

function Invoke-CurlProbe {
    param([string]$Label, [string]$Url, [string]$OutFile, [string]$Method = 'GET', [string]$BodyFile = '')
    Write-Host "=== $Label ===" -ForegroundColor Cyan
    $args = @('-sk', '-o', $OutFile, '-w', '%{http_code}') + $H
    if ($Method -eq 'POST') { $args += @('-X', 'POST', '--data-binary', "@$BodyFile") }
    $code = & $curl @args $Url 2>&1 | ForEach-Object { "$_" } | Select-Object -Last 1
    $code = $code.ToString().Trim()
    Write-Host "HTTP $code"
    return $code
}

$url1 = "$($env:FORMA_BASE_URL)/classes/?club_id=$club&start_date=$start&end_date=$end"
Invoke-CurlProbe -Label 'classes' -Url $url1 -OutFile (Join-Path $resultsDir '01_classes.json') | Out-Null

$auth = Join-Path $PSScriptRoot 'auth_body.json'
Invoke-CurlProbe -Label 'auth_client' -Url "$($env:FORMA_BASE_URL)/auth_client/" `
    -OutFile (Join-Path $resultsDir '02_auth_client.json') -Method 'POST' -BodyFile $auth | Out-Null

$j = Get-Content (Join-Path $resultsDir '02_auth_client.json') -Raw -ErrorAction SilentlyContinue
if ($j -match '"user_token"\s*:\s*"([^"]+)"') {
    $token = $Matches[1]
    Write-Host '=== client_info (expect 2004) ===' -ForegroundColor Cyan
    $extraH = $H + @('-H', "usertoken: $token")
    $out3 = Join-Path $resultsDir '03_client_info.json'
    $code = & $curl -sk -o $out3 -w '%{http_code}' @extraH "$($env:FORMA_BASE_URL)/client_info/" 2>&1 |
        ForEach-Object { "$_" } | Select-Object -Last 1
    Write-Host "HTTP $($code.ToString().Trim())"
}
