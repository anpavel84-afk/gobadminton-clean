# GoBadminton MVP Compose (F-01 split)

Isolated Docker Compose project `gobadminton_mvp` for ADR-0010 split topology.

## Profiles

| Profile | Host | Services |
|---|---|---|
| `backend` | Germany `vmi3510488` | `db`, `migrate`, `api` |
| `web` | Moscow `ruvds-68jzd` | `web` |

```bash
# Germany
docker compose --profile backend up -d

# Moscow
docker compose --profile web up -d
```

## Bindings

- API host bind: `127.0.0.1:18080` (Germany only; nginx TLS terminates `dev-api.gobadminton.ru`)
- Web host bind: `127.0.0.1:18082` (Moscow only; nginx TLS terminates `gobadminton.ru`)
- PostgreSQL/PostGIS: internal compose network only (never published)
- DB image pin: `postgis/postgis:18-3.6@sha256:60f6ad1d21ea86a67d47780b9a0d1e1d200500f62b19293fa834d0dea80b8677`

## Origins

- `PUBLIC_API_ORIGIN` / `API_BASE_URL` use hostnames (`dev-api.gobadminton.ru`), never VPS IPs.
- Browser same-origin path: `https://gobadminton.ru/v1/*` → Moscow nginx → Germany API.

Not PROD. Independent rollback per host — see handoff after deployment.

## Owned avatar media (non-PROD Germany only)

The backend API mounts `gobadminton_mvp_avatars` at `/var/lib/gobadminton/avatars`
(uid 10001; image creates the mount point with matching ownership). Docker copies
the image directory ownership into a newly created named volume. Keep this volume
when recreating API containers; include it with database backups. Web/Moscow has
no media volume. Do not mount originals, static nginx aliases or a shared host path.

`AVATAR_MEDIA_ROOT` is explicit: absent means uploads return 503, never an ephemeral
container directory. `/v1/media/avatars/<opaque>.png` passes through the existing
same-origin `/v1` proxy (8 MiB edge limit; API accepts <=5 MiB). API serves only a
current sanitized derivative for an active account, with no-store/nosniff.

Replacement/removal/account deletion status transition journals cleanup transactionally. API startup
and each minute retry the journal. Staged files abandoned before DB commit become
collectable after one hour. Originals are never stored. Restore DB+media together;
missing derivatives return 404 and UI falls back. A missing/unwritable volume must
be repaired before enabling upload. No runtime was changed by this implementation.

Rollback is previous API/web image plus retained additive schema and volume. Never
`down -v` for a code rollback. Production deployment and real-data storage policy
remain separately gated.
