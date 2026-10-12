# GoBadminton nginx virtual hosts (F-01)

Install only the file that belongs on each host. Do not overwrite unrelated sites.

| File | Host | Role |
|---|---|---|
| `germany-dev-api.bootstrap-http.conf` | Germany | HTTP bootstrap before first cert |
| `germany-dev-api.gobadminton.ru.conf` | Germany | TLS for `dev-api.gobadminton.ru` → `127.0.0.1:18080` |
| `moscow-gobadminton.bootstrap-http.conf` | Moscow | HTTP bootstrap before first cert |
| `moscow-gobadminton.http-interim.conf` | Moscow | Historical interim HTTP edge (AAAA-era); keep for rollback only |
| `moscow-gobadminton.ru.conf` | Moscow | **Active** TLS config; www→apex; HTTP→HTTPS; `/v1/` proxy to Germany |

ACME webroot: `/var/www/letsencrypt`.

Certificates:
- Germany: `/etc/letsencrypt/live/dev-api.gobadminton.ru/`
- Moscow: `/etc/letsencrypt/live/gobadminton.ru/` (covers apex + www via certbot `-d`) — issued 2026-10-02 after Owner removed obsolete AAAA

Known DNS hazard: if `gobadminton.ru` has an AAAA that does not terminate on the Moscow VPS, Let's Encrypt HTTP-01 fails even when IPv4 ACME works.
