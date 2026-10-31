# GoBadminton release notes

## #435 — PROD public feature parity (Friends / play interest / Moscow maps)

Owner-approved source repair so exact canonical PROD (`NODE_ENV=production`, `APP_ENV=prod`, `PUBLIC_WEB_ORIGIN`/`PUBLIC_API_ORIGIN` = `https://gobadminton.ru`) can use the same public Friends, recommendations (via `friendsEnabled`), play-interest, and registered Moscow map preview paths already admitted on DEV, without relaxing directory/TTL/rate/eligibility/privacy/bounds or map resource prefix/style integrity. Basemap bytes remain the existing public immutable DEV asset bundle URLs; trusted integrator must set the PROD map preview flag after install and add bounded CORS for exact `https://gobadminton.ru` on that static route only.

- Source: pending trusted publisher import
- CI: pending
- Deployment: pending (DEV/PROD receipts and UAT to be filled by trusted integrator after install/check)
- Functional PROD qualification: not claimed before installed/checked
