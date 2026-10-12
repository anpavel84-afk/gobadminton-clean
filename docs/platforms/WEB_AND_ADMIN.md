# Web и admin

Статус: **TECH_SELECTED**.

## Public web

Canonical origin:
- `https://gobadminton.ru`
- `https://www.gobadminton.ru` redirects/canonicalizes according to final nginx rule.

Current physical web host:
- Moscow/Rucloud `ruvds-68jzd` / `194.87.214.217`.

## Browser → API

Preferred and current target:

`browser → https://gobadminton.ru/v1/* → Moscow nginx → https://dev-api.gobadminton.ru/v1/* → Germany API`.

For production naming the upstream becomes `https://api.gobadminton.ru` without changing frontend business code.

Benefits:
- same-origin cookies/CSRF model;
- no backend IP in browser code;
- backend can move by DNS/upstream;
- Moscow web can survive backend topology changes without rewrite.

Do not proxy DB traffic. Only HTTP application API crosses the WAN boundary.

## Performance

Avoid request waterfalls across Moscow↔Germany:
- batch/shape API responses for screens;
- parallelize independent reads;
- use short safe public caching where contracts allow;
- mutations always reach authoritative backend.

The physical distance is acceptable for normal JSON API traffic if the request graph is shallow. Measure rather than assume.

## Admin

Admin remains a separate origin/session audience. Final physical placement is decided before F-05.

## Shared design

Engineering uses current approved project design/specs; it does not invent a visual system or inherit BadmintonOpen.
