# OWNER DIRECTION — Google Sign-In + Development Test Session v001

Status: **OWNER_DIRECTION — FUTURE AUTH WORK, NOT CURRENT FR-03 BLOCKER**
Date: 2026-10-04

## Direction

GoBadminton will need a production login path through **Google Sign-In** (user described this as Gmail login).

Separately, development needs a convenient deterministic **test account/session** so authenticated flows can be exercised without waiting for production OAuth provider setup.

## Current critical-path decision

Do **not** widen the current FR-03 backend compatibility blocker into Google OAuth work.

The immediate blocker is narrower and already covered by existing Owner authority:
- anonymous Players directory read;
- anonymous public Player profile read.

Fix those public reads first so FR-03 can continue.

## Development test account direction

Use a deterministic synthetic development/demo identity and the ordinary GoBadminton session machinery.

Requirements when admitted:
- disabled by default;
- never caller-selectable arbitrary user/role;
- synthetic provenance only;
- fail closed outside explicitly allowed dev/DEMO_PUBLIC context;
- no fake Google/VK/Yandex provider branding;
- ordinary session/CSRF/logout semantics after bootstrap.

Prefer reusing the already Owner-authorized DEMO_PUBLIC synthetic-session concept rather than inventing a second auth system.

## Google Sign-In direction

Google OAuth is a separate future production provider slice.

It should:
- use a real Google OAuth/OIDC integration;
- map verified Google identity into the existing external-identity/session model;
- expose truthful provider capabilities;
- preserve account collision/linking rules;
- have its own credentials/redirect configuration gate;
- receive independent auth/security QA.

Do not implement Google in the current public-read compatibility slice.

## Priority

1. Public Players/Profile reads — now, to unblock FR-03.
2. Continue canonical frontend rebase.
3. Add deterministic development test session when authenticated browser testing requires it.
4. Add Google Sign-In as a dedicated production auth slice.
