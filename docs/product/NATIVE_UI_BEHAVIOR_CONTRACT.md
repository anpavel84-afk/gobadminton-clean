# Native UI behavior contract · H-01 / V-01 / V-02 / V-03

Bounded #522 record. Authority order: Owner decision → `SITEWIDE_UI_STYLE_GUIDE.md` → `VENUE_GALLERY.md` → accepted web `VenuePopup` / `VenueGallery` / `RootNav` → native adapters. Route inventory is source-presence evidence, not finished-screen acceptance.

Status labels: **VERIFIED_SOURCE** (inspected code/docs), **GAP** (confirmed missing/different native behavior before this repair), **UNVERIFIED_DEVICE** (no emulator/device proof in this source step).

## H-01 · Shared header actions

| Field | Content |
| --- | --- |
| Authority | Web `RootNav.tsx` topbar actions + `foundation.css` mobile `gap: 8`; native `ui.tsx` Header + `theme.ts` `interaction` 48×48 |
| Entry | Ordinary screens with brand left; Radar then profile in one trailing group |
| Trigger | Layout only; Radar/profile keep independent press targets and existing callbacks |
| Expected | Fixed 8 logical-unit gap inside the trailing group; remaining width between brand and group; profile omitted on `/profile`; light/story custom `action` still works; Radar open does not auto-enable/publish |
| Accessibility | Named individual controls; no group-level accessible wrapper that hides children |
| Evidence | Scenario H1; screenshot `01-header` |
| Status | **VERIFIED_SOURCE** web grouped actions; native Header now groups Radar→profile (**was GAP** space-between across separate children); **UNVERIFIED_DEVICE** painted-circle spacing / large-font clip |

## V-01 · Venue sheet state and ownership

| Field | Content |
| --- | --- |
| Authority | Owner map-popup decision; web `VenuePopup.tsx` compact/handle thresholds; native `maps.ts` Back/close hierarchy |
| Entry | Games/Players map venue selection (no venue-route navigation merely to expand) |
| States | none → compact → expanded; expanded info/schedule; selected media owned above branches |
| Gestures | Compact UP expands with live height growth toward measured/available expanded (web VenuePopup); compact DOWN dismisses; expanded HANDLE DOWN collapses via translateY; expanded BODY keeps ScrollView. Axis lock 8dp; compact origin is touch-down even after delayed grant; dy≤−56 / dy≥64 with terminal release sample; handle half measured/available travel or ≥0.5 dp/ms (same native event clock; stale >100ms ignored). Handle panHandlers live on a host `View` (not `Pressable` — RN Pressability overrides responder callbacks); ordinary tap/a11y activate remain on the Pressable child. Follow-on tap suppress is gesture-local; control origins retire on press-out/cancel; gallery second finger irrevocably retires until new grant; retired generation ignores late release |
| Close hierarchy | Filter Back → expanded collapse → compact deselect → map exit; X expanded collapses, compact closes |
| Layout | One expanded body scroll; sticky Create only expanded verified venue; compact has no Create; safe bottom reserved once; compact overflow ScrollView without a new gallery strip below the settled row |
| Accessibility | Named expand/collapse/close; expanded state exposed; local Modal + obscured-background isolation when expanded; escape/Back; focus to handle on expand, compact control on collapse, and host `returnFocusRef` opener/fallback on final dismiss via `createReturnFocusLifecycle` (intentional dismiss restore survives sheet unmount; obsolete nav/scope cancels) |
| Evidence | Scenarios V1–V6 |
| Status | **VERIFIED_SOURCE** close/measurement owners; native responders + local Modal lifecycle (**was GAP** tap-only / entry-only focus); **UNVERIFIED_DEVICE** real touch/scroll/safe-area/TalkBack/keyboard |

## V-02 · Venue gallery axis and continuity

| Field | Content |
| --- | --- |
| Authority | `VENUE_GALLERY.md`; web `VenueGallery.tsx` axis lock 10 / commit 48 |
| Trigger | Horizontal swipe on gallery/compact image; expanded explicit previous/next ≥44dp + counter; compact accessible paging on the established image region (no extra strip below settled compact row) |
| Expected | Left→next / right→previous modulo wrap; zero/one image no pretend paging; horizontal never expands sheet or opens credits; vertical compact image yields sheet; expanded image vertical keeps body scroll; load/error/retry scoped to selected media identity |
| Continuity | Selected media survives compact↔expanded and info↔schedule; refresh keeps surviving URL/id; removed falls back to main/first; new venue/city does not inherit |
| Evidence | Scenario V7 |
| Status | **VERIFIED_SOURCE** web gallery; native controlled selection + swipe + media-identity errors (**was GAP** button-only local index); **UNVERIFIED_DEVICE** axis arbitration on device |

## V-03 · Venue ratings and comments (expanded only)

| Field | Content |
| --- | --- |
| Authority | Accepted web StyleGuide + existing native primitives; API venue-community public targets; Owner #522 / OD-017 carryforward |
| Entry | Expanded verified venue only — after contacts and schedule; compact preview has **no** UGC and keeps the current compact shape |
| Surfaces | Inline community rating summary/own vote + public comments/replies; report subject/reason/detail freeze; anonymous guest read; native bearer closed to venue-community public targets before lookup (never global private player/game enable) |
| Writes | Exact explicit review → commit; UNKNOWN retain frozen human context across venue switch/back and pagination omission; retry exact packet only; no GET-inferred success; refresh never sends or settles a write |
| Authority retirement | Explicit logout or actor/session/generation change removes private frozen text/report/context from root history; late ACK/error must not reinsert retired operations or repaint/reload for a new actor; same-id reentry does not resurrect retired context; no auto replay |
| Edits | Compatible collapse/schedule/cancel/reopen retains edit drafts; authoritative revision/deletion/private/permission or actor retirement clears incompatible edits; successful masked edit clears only its matching draft (photos preserved via existing photoIds) |
| Non-scope | Photos authoring and verified postgame reviews remain separate unfinished scope; no generic ShareExperience CTA; cookie/guest/CSRF/server moderation rights unchanged |
| Evidence | Scenarios V8–V10; mobile unit `venue-community` / auth community ports |
| Status | **VERIFIED_SOURCE** coordinator + expanded host seam + native venue principal opt-in; **UNVERIFIED_DEVICE** Owner UI / Xiaomi; code12 is TARGET SOURCE ONLY until genuine gates/build/delivery |

## P-01 · Own profile level / район-метро / О себе

| Field | Content |
| --- | --- |
| Authority | Accepted web `ProfilePage.tsx` editor fields + `LevelGuide` / `lib/level-guide.ts` identities; native `profile.ts` / `ProfileEditor` / existing Label·chip·sheet·keyboard patterns |
| Entry | Authenticated `/profile` existing «Игровой профиль» editor (name/city already present) |
| Trigger | Explicit level choice (Keep / Не знаю / pilot / ntrp half-step), район/метро ≤64, О себе ≤500; one Save / Cancel |
| Expected | Unknown scale/version preserved until explicit change; wire omits unchanged level/area/bio; explicit null clears; saving these fields does not mutate visibility/contact/consent/trainer/looking; frozen packet + exact retry; actor/session retirement unchanged |
| Accessibility | Labelled controls; multiline bio; level sheet uses existing DiscoverySheet focus return |
| Evidence | Scenario P1; mobile unit `profile.test.ts` |
| Status | **SOURCE_ONLY** implementation/source for this slice pending actual owning review, independent QA, and device gates; parse/selftest is not independent QA or device PASS; **UNVERIFIED_DEVICE** no current device/emulator PASS; photos/privacy/linked identity remain unfinished; contactPolicy see P-03 |

## P-02 · Own profile avatar change/remove

| Field | Content |
| --- | --- |
| Authority | Accepted web `ProfilePage.tsx` + `AvatarEditor.tsx` composition; native `profile-avatar.ts` / `profile-avatar-runtime.ts` / existing `ProfileEditor` |
| Entry | Authenticated `/profile` existing «Игровой профиль» editor — Change/Delete precede text fields |
| Trigger | OS photo-library still image (no camera/mic); Cancel; Delete when uploadedUrl present; explicit retry/refresh only |
| Expected | Approved uploadedUrl or initials only (`providerUrl:null`); on-device 512 derivative ≤512KiB; text draft preserved across photo ops; duplicate taps one dispatch; ambiguous write reconciles via GET `/me/social-profile` |
| Accessibility | Labelled photo controls; busy status while saving |
| Evidence | Scenario P2; mobile unit `profile-avatar.test.ts`; API `native-avatar.foundation.test.ts` (DB harness) |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — ADDRESS1 source repair against Astra/Root findings; genuine lock/native modules/binary/device remain Root/QA; iOS original-container fallback and native white-flatten are bounded blockers, not parity claims; not VERIFIED_SOURCE |

## R-01 · Discovery card public role history (#522 PARTIAL)

| Field | Content |
| --- | --- |
| Authority | Accepted web `DiscoveryGameCard` + `RoleReputationCardActions` / `RoleReputationPanel` / `RoleReviewsDialog` read path; backend `RoleReputationController` PUBLIC GET; Style Guide; no new design concept |
| Entry | Native `GameCard` people band — TRAINER → ORGANIZER → «Отзывы и история» → details/share (ordinary: organizer actions stay on host row; trainer-led actions after disclosure) |
| Trigger | Explicit expand only; no eager per-card fetch, polling, or synthetic counts |
| Expected | Lazy `GET /games/:gameId/role-reputations/:role` then cursor `GET /role-reputations/:handle?gameId`; separate organization/training lanes; confirmed-history label never invents 0 from null; published review text + public reply; `basis_under_review` keeps text with «Основание на проверке»; empty/unavailable/loading/error+retry; pagination append/dedupe with game/role/handle provenance; late callbacks retired on collapse/game switch |
| Non-scope | Auth-bound authoring/replies/reports/private context; cancellation/capacity; Bearer broadening; profile identity projection; PROD |
| Evidence | Mobile unit `role-reputation.test.ts`; source APK counter 22 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 PARTIAL; not VERIFIED_SOURCE / not device PASS |

## R-06 · Native PUBLIC role-review author loop (#522)

| Field | Content |
| --- | --- |
| Authority | Accepted web `RoleReviewComposer` / `RoleReviewsHistory` / `RoleReputationPanel` author entry + Astra native MyGames «Отзывы» placement; existing `/me/role-reviews*` service/DTO; Root address3 single AuthProvider host seam |
| Entry | Game role card «Поделиться опытом» (guest → existing auth return `/games/:id` + bounded pending role/game); MyGames «Отзывы» → «Мои публичные отзывы о ролях»; receipt link to same own-history sheet |
| Trigger | Explicit public audience + unchecked consent; consent-preview then create; withdraw at current version only |
| Expected | Exactly one `PublicRoleReviewHost` under RootLayout `AuthProvider` (not per-card / not PostgameSurface); guest author admits closed local goal into SecureStore pending + verified-session unclaimed (role/handle/game only); host `claimPublicRoleGoal` (sync at-most-once + post-clear deadline recheck) restores bare origin, waits for actual pathname match, then `openResumedPublicComposer` after credential-omit public game/role projection + exact eligibility with frozen original game (no silent fallback basis; later basis loss → unavailable); claim-phase path+navGen captured before SecureStore await so intervening unrelated navigation (incl. ABA / already-at-goal leave→return) drops without old-origin `replace` even when path again equals goal, while unchanged claim-start and own single expected goal-path commit still restore; unmatched pending resume retires on intervening unrelated pathname (`waitFromPath`) so later ordinary origin visit cannot reopen a consumed goal; eventual-open `isLive` requires current pathname === pending origin sync (not only after passive cleanup); host lifetime/`isLive` + surface/eligibility gen fence navigate-away and reader/history replacement; warm `resumePendingPublicAuthor` remains secondary; cancel fences in-flight exchange; warm/cold expiry durably retires pending/goal and cold cleanup write failure fail-closes storage; server eligibility `may_submit` bases; PENDING receipt ≠ publication; own list ≤50; consent reset on text/topics/audience/game/role/subject/session; multiline LF public text; original-key UNKNOWN replay; private CommandReview never opens for public packets; same `PostgameCoordinator` mutation owner; per-review withdraw version/status fences; late create receipt owned by surface/editor generation; shared focus remember/clear for catalog+MyGames; Russian actionable notices (no raw server CODE) |
| Unfinished | Physical device / iOS / OTA / VoiceOver clearance unverified; process death between durable claim and visible UI may require reselect (at-most-once); remaining #522 surfaces outside this cold-goal slice |
| Non-scope | Private→public promotion; score/public skill; new backend design; PROD |
| Evidence | Mobile unit `auth.test.ts` six cold-goal families + QA1/QA2 concurrent/cancel/deadline/expiry/storage-fail regressions; `entry.test.ts` player-detail cold return; `public-role-reviews.test.ts` resumed origin/lifetime/frozen-basis + QA3 host navigation seams + address4 already-at-goal ABA + root-host wiring; source APK counter 36 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 public author cold-goal source slice + QA1 address1 + QA2 address2 + QA3 address3 host navigation + address4 claim ABA; not VERIFIED_SOURCE / not device PASS / not product acceptance |


## R-08 · Native PUBLIC role recipient reply/report (#522)

| Field | Content |
| --- | --- |
| Authority | Accepted web `RoleReviewsDialog` + Astra High #522 parity; `GET /role-reputations/:handle`, `POST .../reply-commands`, `POST .../reports`; Root `PublicRoleReviewHost` + same `PostgameCoordinator` journal |
| Entry | Game/profile role lane «Ответить или пожаловаться» (guest → closed local reader goal + bare `/games/:id` or `/players/:publicPlayerId` auth return; signed-in opens root reader sheet); profile binds `publicPlayerId` (no invented gameId); reserved `/players/browse` not a detail; cold `hydratedEntryRoute` restores player-detail |
| Trigger | Explicit reply consent + preview/submit; explicit report reason/submit; cancel sends nothing while idle; in-flight report Cancel disabled/guarded (shell Close + UNKNOWN reconcile remain) |
| Expected | Typed `canReply`/`canReport`/`subjectOwnReply` from current actor page only (actions on root reader sheet, not disclosure rows); guest cold goal claimed once after verified session; host restores bare origin, waits for actual pathname match, then `openResumedPublicReader` after credential-omit public game/profile role→handle binding plus current typed by-handle projection (denial/replaced origin/mismatch/missing origin port suppresses sheet); same QA3/address4 claim-phase navGen (incl. already-at-goal ABA) / unmatched `waitFromPath` retire / eventual `isLive` pathname fences as R-06; host lifetime/`isLive` + surface gen fence navigate-away; cancel/expiry/replacement login drop stale goals (no warm inheritance; cancel fences post-consume exchange); consent retires on newer typed review/reply versions without silent rebase; **root-read authority loss** (network/mismatch/unavailable) retires reply consent/hash + in-flight preview while preserving draft text (append transient keeps prior rows/consent/same cursor); retry after non-authoritative read requires fresh consent before preview/send; append merges duplicate handles with version/permission fences; transient append failure keeps prior rows + same nextCursor retry (loadingMore/moreError ≠ root error); auth/visibility denial retires rows/forms; selected report form under its row with same-row draft preserve + a11y focus/scroll reveal via optional `Page.scrollRef`; open report editor retires when live row loses `canReport` or changes published revision (form gated on current permission; already-dispatched UNKNOWN packet independent; auto-retire focus → visible row/reader heading); reply/report ACK paint scoped to owned handle (no whole-thread freeze) with **separate UI receipt gates** (successful reply must not disable report and vice versa; active/UNKNOWN journal still serializes); reply receipt bound to original packet `expectedReviewRevision` for paint+retire across ACK/GET orderings (unchanged aggregate + newer published revision retires; stale ACK must not paint or erase new-revision draft/consent; fresh consent+preview+explicit Send required); **report receipt bound to original packet `expectedRevision`** for paint+retire (same-revision dedupe; N→N+1 retires so canReport N+1 may open; deferred old ACK after newer GET must not paint or erase new-revision report draft); **deferred business rejection** settles original journal only — notice/hash/preview/follow-up GET require original dispatch surface gen + role + full game/profile origin (A→B must not refresh/mutate other reader); **hard authorization denial** on reply/report (port private or 401/403/404) keeps immutable UNKNOWN original packet and retires only the owning reader private projection/editor/consent/hash/painted ACKs (late pending GET cannot resurrect; A→B delayed denial must not clear B; fresh typed read + renewed consent required, no autosend); matching reply consent-preview hard denial retires the same write authority; **UNKNOWN same-actor null quarantine** preserves original dispatch bind/origin (replacement/close-reopen cannot inherit ACK authority; still-open original may rebind session/gen; packet immutable; explicit reconcile only); deferred older ACK cannot paint over newer typed aggregate; Russian `subjectOwnReplyLabel` without raw status codes; OpenAPI Origin/CSRF cookie-conditional on reply/report; guest projection private-field-free |
| Unfinished | Physical device / iOS / OTA / VoiceOver/TalkBack/hardware-keyboard clearance unverified; process death between durable claim and visible UI may require reselect; remaining #522 surfaces outside this cold-goal slice |
| Non-scope | Reply-withdraw UI; report-on-reply UI; PROD; OTA; C5 |
| Evidence | Mobile unit `auth.test.ts` cold-goal families + QA1/QA2 regressions; `entry.test.ts` player-detail; `public-role-reviews.test.ts` QA3 host navigation seams + address4 already-at-goal ABA / `role-reputation.test.ts`; API disposable native bearer reply/report + profile-origin; source APK counter 36 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 public reply/report cold-goal + QA1 address1 + QA2 address2 + QA3 address3 host navigation + address4 claim ABA fences retained; not VERIFIED_SOURCE / not device PASS / not product acceptance / not built |

## S-01 · Swipe bounded next-card media warmup (#522)

| Field | Content |
| --- | --- |
| Authority | Accepted web `PlayerBrowseMedia.browseMediaNeighborhood` / `PlayerBrowseDeck` prepare window; native `player-browse-media.ts` + `player-browse.tsx`; existing `playerMediaUrl` + RN `Image.prefetch` |
| Entry | «Свайп» browse episode with already-loaded eligible peers |
| Trigger | Selected card / episode / actor / filter / focus / foreground changes |
| Expected | Warm cover+avatar for current + up to 4 ahead (+ previous); strict cap/dedupe by publicPlayerId+mediaKey; current priority; abort/retire on filter/logout/actor/blur/background/close; never block swipe or match commands; never commit previous peer image into the visible card; only DTO-authorized media (no speculative profile GET); load/error/fallback remain honest |
| Non-scope | Gesture/match redesign; new cache framework/dependency; revocation guarantees beyond platform image cache; latency claims without measured readiness; PROD |
| Evidence | Mobile unit `player-browse-media.test.ts` / `players-swipe-inline` / `player-browse`; source APK counter 23 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 media-warmup source slice; not VERIFIED_SOURCE / not device PASS / no latency claim |

## P-03 · Own profile personal-message permission / contactPolicy (#522)

| Field | Content |
| --- | --- |
| Authority | Accepted web `ProfilePage.tsx` «Разрешать личные сообщения» + `PATCH /v1/me/social-profile` `{expectedVersion,contactPolicy}`; native `profile.ts` / `own-profile.tsx` Switch; existing bearer own-profile port |
| Entry | Authenticated `/profile` own-profile card — «Личные сообщения» section (settings composition) |
| Trigger | Explicit Switch only; checked iff authoritative `contactPolicy === 'requests'`; disabled while version&lt;1, command/peer busy, or not ready |
| Expected | Policy-only wire; serialize with name/avatar/cover; receipt confirms server policy+version; dirty name/level/area/bio draft preserved; closed blocks new incoming / history retained; no catalog visibility, trainer, looking, Radar, consent, or identity side effects; UNKNOWN exact-packet retry; late ACK cannot repaint new actor; version0 not faked |
| Accessibility | Named Switch + helper; busy/unknown pending copy; large-text row layout |
| Non-scope | Directory visibility PUT (separate P-06); trainer/looking activation; first-message admission policy; new consent defaults; PROD |
| Evidence | Mobile unit `contact-policy.test.ts` / profile·auth; optional API `native-players.foundation` bearer policy case; source APK counter 24 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 contactPolicy native parity source; not VERIFIED_SOURCE / not device PASS |

## P-06 · Own profile catalog visibility / directoryVisible (#522)

| Field | Content |
| --- | --- |
| Authority | Accepted web `ProfilePage.tsx` «Показывать профиль в каталоге» + `PUT /v1/me/social-profile/visibility`; native `profile.ts` / `own-profile.tsx` Switch; Owner #448 city not prerequisite; consent only when ON+stored |
| Entry | Authenticated `/profile` own-profile card — «Видимость профиля» after «Ищу игру», before «Личные сообщения» |
| Trigger | Explicit Switch only; checked iff authoritative `directoryVisible`; disabled while version&lt;1, command/peer busy, or not ready; no autowrite on mount/login/reauth/foreground/refresh |
| Expected | Visibility-only PUT wire `{directoryVisible,expectedVersion,consentPolicyVersion?}`; never via profileWireBody/PATCH; serialize with text/contactPolicy/Looking/avatar/cover/trainer peers; OFF retains Radar consent and leaves contact/Looking/trainer untouched; UNKNOWN exact-packet retry; 409/consent-invalid → rebase refresh; success copy from adopted DTO |
| Accessibility | Named Switch + five preview rows (Показывается/Скрыто); busy/unknown pending copy with intent-named retry; no city-required helper |
| Non-scope | New coordinator/framework; fabricated consent; PROD; store permissions |
| Evidence | Mobile unit `visibility.test.ts` / own-profile·profile·contact·looking; API `native-players.foundation` bearer visibility case; source APK counter 29 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 catalog visibility native parity source; not VERIFIED_SOURCE / not device PASS |

## R-03 · MyGames invitations filter + in-card decisions (#522)

| Field | Content |
| --- | --- |
| Authority | Accepted web `MyGamesPage` invitations composition + existing native Messages invitation detail/accept/decline; `GET /me/invitations` requirePrincipal + OpenAPI NativeBearer on that list only |
| Entry | Authenticated `/my-games` relation chip «Приглашения» (stays on MyGames; not Messages redirect) |
| Trigger | Idle load of invitations source; explicit chip filter; one selected inline panel leases Messages focus; accept/decline only with fresh detail acceptanceContext |
| Expected | Invite rows union by real gameId with managed/parts/own/reminders; invites in `all`; invites filter invitations-only; pending loaded-count/+ while cursor open; accepted/declined/expired visible without fake participation; private game GET 404 keeps safe invite card; UNKNOWN keeps original key; post-receipt reloads invitations+participations once |
| Accessibility | Chip badge for loaded pending; single active decision panel; Russian status/action labels; large-text/safe-area retained |
| Non-scope | Trainer profile; create/revoke/organizer invitation lists; PROD; full parity/OTA/iOS claims |
| Evidence | Mobile unit `my-games.test.ts` / messages·postgame; API `native-messages.foundation` list NativeBearer cases; source APK counter 27 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 MyGames invitations source; not VERIFIED_SOURCE / not device PASS / empty account ≠ invite action UAT |

## R-04 · Postgame attendance clarification / PG-2 disputes (#522)

| Field | Content |
| --- | --- |
| Authority | Accepted web `GameResultsComposition` clarification tab + existing attendance-dispute API; native `postgame` / `postgame-coordinator` / `postgame-disputes` on `/my-games/[gameId]/results` |
| Entry | Authenticated results screen section «Уточнение» beside attendance; own «К уточнению» / roster «Открыть уточнение»; organizer multi-select by display name |
| Trigger | Explicit create («Оспорить отметку» / «Попросить уточнение»), respond/correct, withdraw, help, resolving ACK, history; no silence/auto-help/auto-ACK |
| Expected | Server `canDispute`/`canRespond`/`canWithdraw`/`canRequestHelp`/`canAcknowledgeCurrent` + writesEnabled only; missing-mark `challengedVersion` 0; correction keeps OPEN; withdraw ≠ agreement; help requested ≠ case linked; resolving ACK requires both dispute fields and matching `resolvedDispute` receipt; ordinary ACK unchanged; selection/draft fences; UNKNOWN exact-packet retry; bounded history limit, no cursor |
| Accessibility | Named participant/action/result; keyboard-safe scroll; focus return to initiating control; busy/error/UNKNOWN announced |
| Non-scope | Public comments/peer feedback/admin case resolution UI; PROD; APK30 binary/device claim |
| Evidence | Mobile unit `postgame.test.ts` / `postgame-disputes.test.ts`; API `game-attendance-disputes.disposable` cookie + native bearer; source APK counter 30 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 native PG-2 disputes source; not VERIFIED_SOURCE / not device PASS / UAT=NOT_TESTED |

## R-05 · Postgame private personal notes (#522 PARTIAL)

| Field | Content |
| --- | --- |
| Authority | Accepted web `GameFeedbackPanel` notes + Astra High review; existing `PUT/GET/DELETE /games/{id}/notes/{context}`; native same root `PostgameCoordinator` |
| Entry | Authenticated `/my-games/[gameId]/results` section «Заметки» after attendance/clarification when `canCreateNote` or own notes exist (incl. known direct GET after results denial) |
| Trigger | Explicit create/edit/delete only; participant select «Выберите»; irreversible tombstone confirm; no auto-write on mount/reauth |
| Expected | Text max 500 trimmed nonempty; expectedVersion 0 create / current edit / positive DELETE; `note.allowedActions` after manager revoke independent of roster/create; UNKNOWN exact packet/key; conflict keeps draft + «Обновить заметку»; logout/different actor wipe private drafts/text; same-account reauth restores known refs without autowrite; absent/`installed=false` feedback disables Notes honestly; cold start without retained own-note refs cannot discover notes (existing unfinished product limit) |
| Accessibility | Named participant/actions; keyboard-safe scroll; busy/UNKNOWN announced; large font / safe areas via existing Page |
| Non-scope | Public review/report/reply/Cases/trainer/rating/media; listing `/me/notes`; results ACL widening; PROD; APK31 binary/device claim |
| Evidence | Mobile unit `postgame-notes.test.ts` / postgame; API `game-feedback.disposable` native notes lifecycle (nonplaying secondary manager); source APK counter 31 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 native private notes source; full app still PARTIAL; not VERIFIED_SOURCE / not device PASS / UAT=NOT_TESTED |

## R-06 · Postgame private peer feedback (#522 PARTIAL)

| Field | Content |
| --- | --- |
| Authority | Accepted web `GameFeedbackPanel` peer + Astra High review; `POST /games/{id}/reviews`, `GET /me/reviews`, `PUT /reviews/{id}/reply`, `POST /reviews/{id}/report`; native same root `PostgameCoordinator` + `postgame-feedback` |
| Entry | Authenticated `/my-games/[gameId]/results` section «Как вам встреча?» — modes Игроку / Полученные / Отправленные; history also when full Results denied |
| Trigger | Explicit create (review confirm + experienceAssertion), reply, report with initially-off share consent; no auto-write on mount/reauth; UNKNOWN exact packet retry only |
| Expected | Create only from current `peerSubjects`/`canCreatePeer`; ratings without preselect; comment≤500 + tags; reply `expectedVersion` = reply.version\|0; report exact `review.version` + `gameId` + `shareReviewWithSupport:true`; canReport independent of writesEnabled; consent reset on revision/409 with detail preserved; non-peer rows parsed not rendered; honest empty/loading/error/cursor; no public rating/skill/attendance change |
| Accessibility | Named recipient/rating/consent/result; keyboard-safe scroll; busy/UNKNOWN announced; existing tokens/safe areas |
| Non-scope | PATCH edit UI; org/training create UI; public review/Cases; note listing; PROD; APK32 binary/device/iOS/OTA claim |
| Evidence | Mobile unit `postgame-feedback.test.ts` / notes·postgame; API `game-feedback.disposable` 7th native peer lifecycle; source APK counter 32 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 native peer feedback source; full app still PARTIAL; not VERIFIED_SOURCE / not device PASS / UAT=NOT_TESTED |

## R-09 · Native exact-game venue experience private/public (#522 PARTIAL)

| Field | Content |
| --- | --- |
| Authority | Accepted web `GameResultsComposition` + `VenueReviewComposer`; `GET /me/venue-reviews/eligibility`, `POST .../consent-preview`, `POST /me/venue-reviews`; native `venue-experience-composer` + same root `PostgameCoordinator` |
| Entry | Authenticated `/my-games/[gameId]/results` after feedback — exact current game + matching game-detail venue for **fresh** create; guest returns to same results path after sign-in; pending original-operation recovery uses immutable packet gameId/venueId on that route (independent of live venue/results readiness) |
| Trigger | Explicit «Оставить отзыв о площадке» when eligibility basis for this game is `may_submit`; private Save or public consent-preview then Save; no autosend; pending reopen «Посмотреть отправку» (open only, zero POST) |
| Expected | Private `self_draft` default; public shows exact projection + initially unchecked consent; create binds venueId/gameId/audience/text/topics/basis versions (+ consent hash for public); receipt private null token / public non-blank intake token — private incl. `revision_waiting` = saved-only-you (no moderation claim); public pending = awaiting review; older published may remain; success copy on receipt card only (no duplicate contradictory notice); UNKNOWN original packet with explicit «Результат отправки неизвестен» + deliberate «Повторить исходную отправку» (plain Russian same text/action + closable pending — no internal key/application terms); expired retention = status + no send; eligibility help closed own-key Russian Map reasons / neutral fallback (never raw codes; prototype keys `__proto__`/`constructor`/`toString` stay null); global prepare ownership + draft/consent fence across eligibility await; conclusive business 422 keeps venueNotice through automatic eligibility reread (`preserveNotice`, fresh admission + explicit reconfirm, latest input kept); Close/Back hides pending view without dropping journal; same-origin reopen + explicit replay only; route blur/unmount retires only **THIS focused lifetime's** captured `VenueExperienceRouteOwner` (actor/session/game/venue/gen via `captureVenueExperienceRouteOwner` / `ownedRouteRef`) through gen-scoped `retireVenueExperienceSurface` — cleanup must not rebuild expected from a live `getSnapshot()`; open-after-focus still retires pending prepare; UNKNOWN lock kept; stale same-game/actor cleanup cannot close newer surface; ordinary rerender does not close; no return-focus on departed route; eligibility reread compares `venueExperienceBasisAuthority` and drops hash/consent on changed/missing/unusable basis without destroying text/topics/audience (deferred preview cannot restore); submit eligibility awaits join `venueEligibilityGen` so newer load deny/version wins — deferred original allow after newer deny still zeroPOST with deny retained; journal-wide 24h first-dispatch age fence (private/public/venue) incl. AuthCoordinator post-token recheck — fail-closed on boundary/expired/missing/invalid/backwards; **fresh venue post-token authority fence** (`venueFreshDispatchBind` / `freshVenue` on local permit): after awaited token and before `postgameMutation`, retired auth/surface/editor/consent/basis/read gen fail closed even when key/inFlight/age still match — no permission rebuild from reauth snapshot or frozen body; preserves UNKNOWN packet/key/body/age/lock; explicit original UNKNOWN retry is retention-only (distinct from fresh); close/reopen alone never retries; no late POST/key rotate; missing eligibility anchor fail-closed; result unknown, status on site; no optimistic publication; CommandReview never shows dead private-modal CTA for venue (MyGames navigates to original results); Packet access via `isVenueExperienceCreatePacket` discriminant (not kind-string-only) |
| Accessibility | Named topics/audience/consent; keyboard-safe modal; busy/UNKNOWN announced; heading focus onShow; accessibilityEscape/Back; return focus to live Entry opener (`openerRef`/`liveRef`) after Composer unmount/commit — actor+game scoped, no cross-context privacy jump; FocusContext still remembered on open; no return-focus after route blur/unmount retirement |
| Unfinished | Native own-history/edit/withdraw/pagination/report/appeal; physical UAT/iOS/OTA; full #522 venue parity |
| Evidence | Mobile unit `venue-experience-author.test.ts` + `postgame-retention.test.ts` (receipt/private-vs-public + own-key reason copy + recovery/UNKNOWN wiring + Packet typeguards; journal-wide 24h fence + deferred prepare/close + post-token retention + business-notice preserve; address7 P1/P2 safe route-retire / basis-consent; address8 production lifecycle capture ownership + deferred original-allow-after-newdeny / changed-version; address10 post-token fresh authority + real AuthCoordinator deferred-token regressions); API `venue-reviews.disposable` native bearer harness exact f844; source APK counter 37 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 address10 post-token fresh authority fence source; not VERIFIED_SOURCE / not device PASS / UAT=NOT_TESTED / not full #522 |

## R-07 · Postgame private organization/training feedback (#522 PARTIAL)

| Field | Content |
| --- | --- |
| Authority | Accepted web `GameFeedbackPanel` organization/training + Astra High UX; same `POST /games/{id}/reviews` (`kind=organization\|training`), `GET /me/reviews`, `PUT /reviews/{id}/reply`; native same root `PostgameCoordinator` + `postgame-feedback` |
| Entry | Authenticated `/my-games/[gameId]/results` «Как вам встреча?» — modes Организатору лично / Тренировка beside peer; history Полученные/Отправленные show all three private kinds |
| Trigger | Explicit create (CommandReview + `experienceAssertion=i_experienced_this_game`); no public consent; no auto-write on mount/reauth/login; UNKNOWN exact packet retry only |
| Expected | Caps from current `canCreateOrganization`/`canCreateTraining`/`organizationRecipientDisplay` + `writesEnabled`; org score1–5 unset initially or comment≤500; training comment required, no score/peerRating/tags; recipient server-derived; kind-separated drafts; discrepancy omit when present/not_participant_manager, optional otherwise; FEEDBACK_DISCREPANCY_REQUIRED/UNEXPECTED preserve draft + Russian field message + re-review; reply reply.version\|0 all kinds; report remains received peer only; no public reputation/skill copy |
| Accessibility | Named mode/recipient/score/comment/discrepancy; keyboard-safe scroll; busy/UNKNOWN announced; existing tokens/safe areas |
| Non-scope | Public role authoring/consent; PATCH edit UI; backend/OpenAPI/schema; PROD; APK33 binary/device/iOS/OTA claim |
| Evidence | Mobile unit `postgame-feedback.test.ts`; API `game-feedback.disposable` 8th native organization/training lifecycle (cases 1–7 bodies exact); source APK counter 33 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 native private role feedback source; full app still PARTIAL; public role authoring unfinished; not VERIFIED_SOURCE / not device PASS / UAT=NOT_TESTED |

## P-04 · Own profile «Ищу игру» enable/edit 1h|3h / stop (#522)

| Field | Content |
| --- | --- |
| Authority | Accepted web `ProfilePage.tsx` changeLooking + `PUT/DELETE /v1/me/looking-for-game`; native `profile.ts` / `looking-for-game` / `own-profile` LookingForGameCard; narrow NativeBearer on those two ops only |
| Entry | Authenticated `/profile` own-profile card — «Игровое намерение / Ищу игру» after public data, before messaging |
| Trigger | Explicit Изменить/Включить/Выключить only; form area draft from looking\|profile area; TTL chips 60\|180 (default 180); no auto enable/renew on mount/login/foreground/expiry |
| Expected | Profile city mandatory (no catalog city/GPS); PUT always sends ttlMinutes 60\|180; looking version CAS separate from SocialProfile version; DELETE empty `{}` / inactive version0 valid; receipt updates nested lookingForGame only; dirty name/level/area/bio preserved; serialize with profile/avatar/cover/policy; UNKNOWN exact packet/key retry; 409 → fresh GET + reconfirm; genuine expiry from server expiresAt + local clock/foreground display |
| Accessibility | Status + CTA group; sheet form; busy/unknown pending copy; large-text row layout |
| Non-scope | Radar/GPS; catalog visibility; socialEligible repair; trainer; formatKeys UI; PROD; APK26 binary |
| Evidence | Mobile unit `looking-for-game.test.ts` / profile·auth; API `native-players.foundation` bearer looking cases; source APK counter 26 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 looking-for-game native parity source; not VERIFIED_SOURCE / not device PASS |

## P-05 · Own trainer profile create/edit/deactivate/reactivate (#522)

| Field | Content |
| --- | --- |
| Authority | Accepted web `ProfilePage.tsx` «Я тренер» + `TrainerProfileEditPage`; `PUT /me/trainer-profile` + `POST /me/trainer-profile/deactivate`; native `trainer-profile.ts` / `own-profile` card + `/profile/trainer` editor; narrow NativeBearer on those two ops only (GET already admitted) |
| Entry | Authenticated `/profile` own-profile card — «Тренерский профиль» immediately after «Личные сообщения» |
| Trigger | Explicit Switch (off→editor; on→deactivate), «Редактировать» / editor Save / «Отключить»; no auto write on mount/refresh/reauth |
| Expected | Full TrainerProfile DTO for CAS (not thin OwnTrainer); create omits expectedVersion; edit/reactivate/deactivate use trainer version; `selfDeclared:true` only on user save; name≤80 / bio≤1000; disclosure «Информация заполнена пользователем»; saving activates; deactivate leaves existing game management/history; after ACK refresh social.trainer + invalidate game-create ownTrainer; UNKNOWN exact packet/key retry; 409 keeps draft + requires authoritative refresh; genuine 404 = absent; competing mutations disabled while command/stale |
| Accessibility | Named Switch + helper; card/editor error+retry; busy/unknown pending copy with reconcile CTA; system live region |
| Non-scope | Certification; private contact; catalog-consent expansion; gameplay/role history changes; PROD; APK27 binary |
| Evidence | Mobile unit `trainer-profile.test.ts` / own-profile·game-management; API `native-game-management.foundation` native create/edit/off/reactivate + ten LOCAL fixture routes; source APK counter 28 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 trainer-profile native parity source; not VERIFIED_SOURCE / not device PASS |

## R-02 · Public player profile role history (#522 PARTIAL)

| Field | Content |
| --- | --- |
| Authority | Accepted web `PublicPlayerProfile` dual `RoleReputationPanel` + PUBLIC `GET /players/:publicPlayerId/role-reputations/:role`; native profile gate then direct lanes |
| Entry | Native `/players/[publicPlayerId]` after `PlayerProfile` + contact, before safety — only when peer detail already loaded |
| Trigger | Mount on authorized loaded peer; peer/scope change clears prior reviews immediately |
| Expected | Separate organization then training lanes; confirmed-history / published-review wording unchanged; null/unavailable ≠ 0; player-scoped cursor pagination with role/roleHandle binding; preserve safe list on paging failure; clear on privacy/unavailable/peer change; no write/reply/report CTA; no fake gameId |
| Non-scope | Role-review authoring; game-card disclosure redesign; auth/backend/contracts; PROD |
| Evidence | Mobile unit `role-reputation.test.ts` / `public-api` / players composition; source APK counter 25 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — #522 PARTIAL profile read parity; not VERIFIED_SOURCE / not device PASS |

## N-01 · Compact bottom navigation large-text captions (#522)

| Field | Content |
| --- | --- |
| Authority | Astra compact-nav recommendation on accepted native `MainNavigation`; four WEB-parity labels |
| Entry | Shared bottom tab row on ordinary main routes |
| Trigger | Window width + horizontal safe-area + fontScale → equal-cell content width vs ~70×fontScale |
| Expected | Baseline equal `flex:1` cells; compact intrinsic `flexBasis:auto`/`grow`/`shrink` so «Сообщения» fits single-line at 360dp/font 1.3; min 48×64 tap; wrap only when larger font genuinely cannot fit; no ellipsis/font cap/rename; Messages spoken name includes meaningful unread count |
| Non-scope | Tab rename; redesign; fontScale disable; test-only geometry framework; PROD |
| Evidence | Mobile unit `compact-layout.test.ts` / nav source; source APK counter 25 |
| Status | **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE** — source layout contract; device/emulator proof still required |

## Explicit non-claims

- Candidate APK URL/SHA remain NULL until Root binds a future build — unit/export success is not UI PASS.
- Emulator success is not Xiaomi success; Owner Xiaomi FAIL stays separate.
- This scope does not close full native parity for the rest of #522.
- code14 is planned source `versionCode` only — new native modules require a fresh code14 binary; code13 cannot gain modules through OTA/export; no build/device/iOS/OTA acceptance claim.
- R-01 role-history is source-only PARTIAL; authoring and private surfaces remain unfinished.
