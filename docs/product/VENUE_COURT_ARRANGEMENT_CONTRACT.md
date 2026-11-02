# Venue court arrangement · #386 combined D1 / T0a-2 / T0a-4

Status: **DEV candidate contract** · Authority: Owner #373 OD-018 + #175 / #386
Application candidate: `0.1.0-alpha.14` · API contract: `0.24.0`

## Product intent

Help organizers arrange a court **outside** the platform while creating a game, and
let organizers declare a private status of that arrangement for participants.
No booking engine, no payments, no provider verification.

## Surfaces

1. **Create game (known venue)** — show only real `publicContacts`; closed checklist;
   user-click copy of a plain-Russian enquiry draft built from complete local
   venue/date/time/duration + city timezone. Never private `contactPhone` /
   `contactWebsite` / `bookingNote`. New venue without contacts stays honest empty.
2. **Owned summary + authorized game detail** — compact court-booking panel.
   Manager can update; confirmed participant is read-only. Capabilities come from
   the server (`allowedActions.canUpdate`), never client role guessing.

## API · `GET|PUT /v1/games/{gameId}/court-booking`

Singleton DTO:

```json
{
  "gameId": "<uuid>",
  "status": "unspecified|arranging|organizer_confirmed|not_arranged",
  "version": 0,
  "updatedAt": null,
  "declarationSource": "organizer_declared",
  "allowedActions": { "canUpdate": true }
}
```

| status | UI label |
|---|---|
| `unspecified` | Не указано |
| `arranging` | Договариваемся |
| `organizer_confirmed` | Подтверждено организатором |
| `not_arranged` | Не удалось договориться |

All visible labels explicitly **«со слов организатора»**. Initial missing row →
`unspecified` / version `0` / `updatedAt` null. No automatic migration of existing
games to confirmed.

- **GET**: active session + current active owner/manager **or** confirmed
  participation (same audience as private game venue contacts). `Cache-Control: no-store`.
  Foreign/missing → indistinguishable private 404. No anonymous/list/map projection.
  Access check and private row read share one short transaction under Game
  `FOR SHARE` (same fence used by revoke/participation transitions) so a revoked
  sole-access role cannot observe a stale private projection. Revoked manager who
  remains a confirmed participant retains readonly.
- **PUT**: current active owner/manager via `GameAuthority` +
  `requireCookieMutation` / Origin / CSRF + `MutationRunner.runIdempotent` with
  `expectedVersion`. Lock order Game → manager. Same-key same-body recovers one
  effect; stale version → conflict; revoked role revalidated on execute and replay.

Migration: additive `0050_game_court_booking` singleton table. Rollback refuses
when populated rather than destructive cleaning.

## Out of scope

Parent VenueGallery / Admin / data import, full #373 catalogue, #394 public
comments, PROD, C5, booking providers, payments, capacity/participation rule changes.
