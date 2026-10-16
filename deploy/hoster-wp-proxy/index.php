<?php
/**
 * FitGO — thin reverse proxy for WordPress shared hosting (hoster.by).
 *
 * Browser → https://app.ffs.by → this script → https://app.ffs.by:444
 * (resolved to club public IP via CURLOPT_RESOLVE so Apache NameVirtualHost
 * matches ServerName app.ffs.by; MikroTik whitelist already allows hoster egress).
 *
 * Port 444 (not 8445): shared WordPress hosting often blocks outbound :8445;
 * Forma schedule already uses :444 from the same hoster IP.
 *
 * Do NOT put WordPress in this docroot. Copy index.php + .htaccess + maintenance.html.
 *
 * Env overrides (optional, via putenv / .user.ini / panel):
 *   FITGO_UPSTREAM_HOST   default app.ffs.by
 *   FITGO_UPSTREAM_PORT   default 444
 *   FITGO_UPSTREAM_IP     default 86.57.152.242
 *   FITGO_PROXY_TIMEOUT   default 180 (seconds)
 */

declare(strict_types=1);

$upstreamHost = getenv('FITGO_UPSTREAM_HOST') ?: 'app.ffs.by';
$upstreamPort = (int) (getenv('FITGO_UPSTREAM_PORT') ?: '444');
$upstreamIp = getenv('FITGO_UPSTREAM_IP') ?: '86.57.152.242';
$timeout = (int) (getenv('FITGO_PROXY_TIMEOUT') ?: '180');

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$query = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_QUERY);
$target = 'https://' . $upstreamHost . ':' . $upstreamPort . $path;
if ($query !== null && $query !== '') {
    $target .= '?' . $query;
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

/**
 * Browser document navigations get the Russian maintenance page on 502/503.
 * API / JSON clients keep status + original (or short plain) body.
 */
function fitgo_wants_maintenance_html(string $path): bool
{
    if ($path === '/api' || strncmp($path, '/api/', 5) === 0) {
        return false;
    }
    $accept = strtolower($_SERVER['HTTP_ACCEPT'] ?? '');
    if ($accept !== ''
        && strpos($accept, 'application/json') !== false
        && strpos($accept, 'text/html') === false
    ) {
        return false;
    }
    return true;
}

function fitgo_send_maintenance(int $status, string $method): void
{
    $file = __DIR__ . '/maintenance.html';
    http_response_code($status);
    header('Cache-Control: no-store');
    header('Content-Type: text/html; charset=utf-8');
    if ($method === 'HEAD') {
        return;
    }
    if (is_readable($file)) {
        readfile($file);
        return;
    }
    echo '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">'
        . '<meta http-equiv="refresh" content="12"><title>FitGO</title></head>'
        . '<body><p>FitGO обновляется. Подождите и откройте снова.</p></body></html>';
}

/** Club misconfig: ErrorDocument /app-maintenance.html hits 1C VRS → JSON 404. */
function fitgo_is_1c_vrs_body(string $body): bool
{
    return strpos($body, 'v8.1c.ru/8.2/virtual-resource-system') !== false;
}

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
    if (fitgo_wants_maintenance_html($path)) {
        fitgo_send_maintenance(502, $method);
        exit;
    }
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'FitGO proxy: curl_init failed';
    exit;
}

$opts = [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 20,
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
    if (fitgo_wants_maintenance_html($path)) {
        fitgo_send_maintenance(502, $method);
        exit;
    }
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'FitGO proxy upstream error (' . $curlErrno . '): ' . $curlErr
        . ' → ' . $upstreamHost . ':' . $upstreamPort . ' @ ' . $upstreamIp;
    exit;
}

$rawHeaders = substr($response, 0, $headerSize);
$rawBody = substr($response, $headerSize);

if ($status < 100) {
    $status = 502;
}

if (fitgo_wants_maintenance_html($path)) {
    if ($status === 502 || $status === 503) {
        fitgo_send_maintenance($status === 503 ? 503 : 502, $method);
        exit;
    }
    // ErrorDocument target missing on club, or fell through Alias /fitgo → 1C.
    if ($path === '/app-maintenance.html'
        && ($status === 404 || $status >= 500)
    ) {
        fitgo_send_maintenance(503, $method);
        exit;
    }
    if (($status === 404 || $status >= 500) && fitgo_is_1c_vrs_body($rawBody)) {
        fitgo_send_maintenance(503, $method);
        exit;
    }
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
    if ($lower === 'content-length') {
        continue;
    }
    header($name . ': ' . $value, false);
}

if ($method !== 'HEAD') {
    echo $rawBody;
}
