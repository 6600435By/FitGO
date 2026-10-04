<?php
/**
 * FitGO — thin reverse proxy for WordPress shared hosting (hoster.by).
 *
 * Browser → https://app.ffs.by → this script → https://app.ffs.by:8445
 * (resolved to club public IP via CURLOPT_RESOLVE so Apache NameVirtualHost
 * matches ServerName app.ffs.by; MikroTik whitelist already allows hoster egress).
 *
 * Do NOT put WordPress in this docroot. Copy only this file + .htaccess.
 *
 * Env overrides (optional, via putenv / .user.ini / panel):
 *   FITGO_UPSTREAM_HOST   default app.ffs.by
 *   FITGO_UPSTREAM_PORT   default 8445
 *   FITGO_UPSTREAM_IP     default 86.57.152.242
 *   FITGO_PROXY_TIMEOUT   default 180 (seconds)
 */

declare(strict_types=1);

$upstreamHost = getenv('FITGO_UPSTREAM_HOST') ?: 'app.ffs.by';
$upstreamPort = (int) (getenv('FITGO_UPSTREAM_PORT') ?: '8445');
$upstreamIp = getenv('FITGO_UPSTREAM_IP') ?: '86.57.152.242';
$timeout = (int) (getenv('FITGO_PROXY_TIMEOUT') ?: '180');

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$query = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_QUERY);
$target = 'https://' . $upstreamHost . ':' . $upstreamPort . $path;
if ($query !== null && $query !== '') {
    $target .= '?' . $query;
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

$hopByHop = [
    'host' => true,
    'connection' => true,
    'keep-alive' => true,
    'proxy-authenticate' => true,
    'proxy-authorization' => true,
    'te' => true,
    'trailers' => true,
    'transfer-encoding' => true,
    'upgrade' => true,
    'content-length' => true,
    'expect' => true,
];

$headers = [];
foreach (function_exists('getallheaders') ? getallheaders() : [] as $name => $value) {
    $lower = strtolower((string) $name);
    if (isset($hopByHop[$lower])) {
        continue;
    }
    $headers[] = $name . ': ' . $value;
}
$headers[] = 'Host: ' . $upstreamHost . ':' . $upstreamPort;
$headers[] = 'X-Forwarded-Proto: https';
$headers[] = 'X-Forwarded-Host: ' . ($_SERVER['HTTP_HOST'] ?? $upstreamHost);
$headers[] = 'X-Forwarded-For: ' . ($_SERVER['REMOTE_ADDR'] ?? '');
$headers[] = 'X-Real-IP: ' . ($_SERVER['REMOTE_ADDR'] ?? '');

$body = null;
if (!in_array($method, ['GET', 'HEAD'], true)) {
    $body = file_get_contents('php://input');
    if ($body === false) {
        $body = '';
    }
}

$ch = curl_init($target);
if ($ch === false) {
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'FitGO proxy: curl_init failed';
    exit;
}

$opts = [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_TIMEOUT => $timeout,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => 0,
    CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
    CURLOPT_ENCODING => '',
    CURLOPT_RESOLVE => [
        $upstreamHost . ':' . $upstreamPort . ':' . $upstreamIp,
    ],
];

if ($body !== null) {
    $opts[CURLOPT_POSTFIELDS] = $body;
}

curl_setopt_array($ch, $opts);

$response = curl_exec($ch);
$curlErr = curl_error($ch);
$curlErrno = curl_errno($ch);
$status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

if ($response === false) {
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'FitGO proxy upstream error (' . $curlErrno . '): ' . $curlErr;
    exit;
}

$rawHeaders = substr($response, 0, $headerSize);
$rawBody = substr($response, $headerSize);

if ($status < 100) {
    $status = 502;
}
http_response_code($status);
header('Cache-Control: no-store');

foreach (explode("\r\n", $rawHeaders) as $line) {
    if ($line === '' || stripos($line, 'HTTP/') === 0) {
        continue;
    }
    $colon = strpos($line, ':');
    if ($colon === false) {
        continue;
    }
    $name = trim(substr($line, 0, $colon));
    $value = trim(substr($line, $colon + 1));
    $lower = strtolower($name);
    if (isset($hopByHop[$lower]) || $lower === 'content-encoding') {
        continue;
    }
    // Let PHP set Content-Length for the proxied body.
    if ($lower === 'content-length') {
        continue;
    }
    header($name . ': ' . $value, false);
}

if ($method !== 'HEAD') {
    echo $rawBody;
}
