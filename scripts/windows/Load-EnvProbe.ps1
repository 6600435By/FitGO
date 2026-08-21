param([string]$EnvFile = (Join-Path $PSScriptRoot '.env.probe'))
if (-not (Test-Path $EnvFile)) {
    Write-Error "Missing $EnvFile - run: copy env.probe.example .env.probe"
    exit 1
}
Get-Content $EnvFile -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $name = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim()
    Set-Item -Path ("Env:" + $name) -Value $value
}
if (-not $env:CURL) { $env:CURL = 'curl.exe' }
Write-Host "OK: $EnvFile" -ForegroundColor Green
