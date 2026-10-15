# Hoster.by WordPress 2 → FitGO proxy

Copy **only** these files into the docroot of `app.ffs.by` (empty site, not ffs.by WordPress):

- `index.php`
- `.htaccess`
- `maintenance.html` — Russian “updating” page for 502/503 (PWA auto-retry)

Full steps, Apache on the club server, smoke tests: [docs/DEPLOY_WP_PROXY.md](../../docs/DEPLOY_WP_PROXY.md).

## Defaults

| Variable | Default |
|----------|---------|
| Upstream host (SNI / Host) | `app.ffs.by` |
| Upstream port | `444` (Forma port — hoster often blocks outbound `:8445`) |
| Upstream IP (CURLOPT_RESOLVE) | `86.57.152.242` |
| Timeout | `180` s |

Override via environment if the club public IP changes (`FITGO_UPSTREAM_IP`).
Do **not** set port to `8445` on WordPress 2 unless support confirms outbound 8445 works.

## Maintenance page

When the club Next/API is down (typical during `Update-FitGO.ps1`), browser navigations get `maintenance.html` instead of Apache’s English “Service Unavailable”. API paths (`/api/*`) keep raw status codes.

On the club Apache, also deploy the same HTML as `C:\Apache24\htdocs\fitgo-maintenance.html` and enable `ErrorDocument 503` in the FitGO vhost (see template + DEPLOY_WP_PROXY §2a).
