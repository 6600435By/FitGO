# Hoster.by WordPress 2 → FitGO proxy

Copy **only** these files into the docroot of `app.ffs.by` (empty site, not ffs.by WordPress):

- `index.php`
- `.htaccess`

Full steps, Apache on the club server, smoke tests: [docs/DEPLOY_WP_PROXY.md](../../docs/DEPLOY_WP_PROXY.md).

## Defaults

| Variable | Default |
|----------|---------|
| Upstream host (SNI / Host) | `app.ffs.by` |
| Upstream port | `8445` |
| Upstream IP (CURLOPT_RESOLVE) | `86.57.152.242` |
| Timeout | `180` s |

Override via environment if the club public IP changes (`FITGO_UPSTREAM_IP`).
