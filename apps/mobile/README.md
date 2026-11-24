## #522 APK52 accepted-web optional game photo during initial creation before publish (source only) · APK52

SOURCE ONLY preQA Root FIX5 (#522 Owner assignment revision `b891de56…`; counter **52** unchanged). Replaces FIX4 mirror/`vm` fake selection test with real production `gamePhotoSelectionLive` admission (generation + asset/crop/preview identity) used by `GamePhotoSelection`; same-scope pick/crop/reset retires stale confirm before parent mutation; late pick does not drop a fresher `pickerArmed`; scope-change file cleanup stays in effect (no render side-effect). Preserve FIX3 lifetime/preview/recovery + omit create→publish + accepted51 cover locks. Focused `create-game-ui` regression (no author test run). Behavior contract R-18 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/OTA/iOS/full522 unfinished; UAT=NOT_TESTED; #522 remains PARTIAL; not READY/ACTIVE; not independent QA.

## #522 APK51 accepted-web managed game photo select/preview/save/replace/remove including private draft (source only) · APK51

SOURCE ONLY preQA FIX9 (#522 Owner assignment revision `c5118cb1…`; counter **51** unchanged). Independent QA2 sole P2 on exact `91c3ac2a…`: owned picker cache retirement no longer lives inside `setDraft` updaters (React may discard them on unmount). `ownedPickerRef` installs synchronously on accepted selection; route/unmount/background/replace/cancel/reset/success retire directly from the ref (scope-fenced; expected picker handoff retained; `releaseOwnedPickerAsset` still app-owned only). Preserve QA1 three fixes + FIX1–FIX4/baseline/`retainSource` repeated-crop; no tests/build/network. Behavior contract R-17 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/OTA/iOS/full522 unfinished; UAT=NOT_TESTED; #522 remains PARTIAL; not READY/ACTIVE.

SOURCE ONLY preQA FIX6 (#522 Owner assignment revision `ff824f7d…`; counter **51** unchanged). Independent QA1 three P2: (1) crop `retainSource` keeps Expo picker cache for draft lifetime + retire cleanup; (2) receipt `loadDetail` soft-refresh + editor mount outside loading flash so save/remove close once; (3) CURRENT remove with `hasCover=true` honest own-slot copy (no removal success/close). Preserve FIX1–FIX4/baseline; no auto-publish. Focused `game-cover.test.ts` + `game-management.test.ts` + `profile-avatar.test.ts` + `auth.test.ts` (Root owns checks). Behavior contract R-17 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/OTA/iOS/full522 unfinished; UAT=NOT_TESTED; #522 remains PARTIAL; not READY/ACTIVE.

## #522 APK50 compact public venue community rating summary on native game detail (source only) · APK50

Accepted source50 (#522 Owner assignment revision `80ba50ed…`; counter **49→50**). Accepted-web `GameVenueContacts` public compact rating section on native `/games/[id]` for signed-in viewers: read-only venue-keyed `GET /venue-community-summaries` via existing `publicApi.communitySummary` (credentials omit + optional AbortSignal) and `parseSummaries`; honest loading/error+retry/unavailable/empty/available average·count using existing native community copy/tokens; link to `/venues/[id]?from=game` (no `#ratings` claim). Independent of private contacts / `NativeVenueCommunity` owner (no votes/comments/photos/actions). No backend/deps. Focused `game-venue-community-summary.test.ts`. Behavior contract R-16 **DEV_ACCEPTED_SOURCE** — Source50 **DEV ACCEPTED** (SHA `e4f124980abe6ca1109bc9b5102f37cb62ed393a`, release `r45430150776-a1`, PR693) per Owner assignment for Source51 base. Device/OTA/iOS/full parity PARTIAL; UAT=NOT_TESTED; #522 remains PARTIAL.

## #522 APK49 accepted-web private game venue contacts for current authorized actor (source only) · APK49

Accepted source49 (#522 Owner assignment revision `e79af0b9…`; counter **48→49**). Accepted-web `GameVenueContacts` on native `/games/[id]`: separate authenticated GET `/games/:id` private projection (never via `parseAuthenticatedGame` / shared Game / public caches); server omission authoritative for owner/manager/confirmed; safe phone/http(s)/plain booking note; focus/foreground/session/actor/game/venue/rendered-callback permits clear stale private data; retired link handlers are no-ops. No new API/deps/business policy. Focused `private-game-venue-contacts.test.ts` + `auth.test.ts` + bounded `native-participation.foundation` contacts case. Behavior contract R-15 **DEV_ACCEPTED_SOURCE** — Source49 **DEV ACCEPTED** `r45422919035-a1` SHA `554eaf0143d419c2f305b985e10c9a45ded1a83d` per Owner assignment (contacts unchanged by Source51). Device/OTA/iOS/full parity NOT_COMPLETE; UAT=NOT_TESTED; #522 remains PARTIAL.

## #522 APK48 accepted-web native court arrangement status read + manager update parity (source only) · APK48

SOURCE ONLY (#522 Owner assignment revision `79dc0286…`; counter **47→48** numeric-only across pins). Accepted-web `GameCourtBooking` on native game detail + managed summary: four organizer-declared statuses + exact disclaimer; eligibility before private GET (confirmed participation or paginated `/me/games`); `allowedActions.canUpdate` gates edit; root-owned immutable UNKNOWN packet with actor/game/view/focus/foreground fences; GET/PUT opt into `requirePrincipal` / `requirePrincipalMutation` (cookie Origin/CSRF preserved); OpenAPI NativeBearer on those two ops only; court-record CAS/idempotency/replay unchanged. Focused `game-court-booking.test.ts` + `auth.test.ts`; API unit mock rename + `native-game-management.foundation` native court case (Root owns DB). Behavior contract R-14 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. No device/binary/OTA/iOS/PROD claim; UAT=NOT_TESTED; Independent QA and DEV/binary/device gates remain pending; #522 remains PARTIAL.

## #522 APK47 accepted-web invitation → accessible native game navigation parity (source only) · APK47

SOURCE ONLY (#522 Owner assignment revision `0c5880ad…`; counter **46→47** numeric-only across pins). Accepted-web `InvitationDetail` «Открыть игру» whenever the matching game GET is readable — independent of invitation status / current manager / accepted participation. Native Messages + inline MyGames reuse `ParticipationCoordinator` public→private404 game read; view/actor/focus/foreground fence; no cached prior-game flash; loading/error hide only the link; accept/decline/revoke and manager eligibility unchanged; UNKNOWN exact packet retained. No backend/contracts/deps. Focused `invitation-game-navigation.test.ts` + Messages/MyGames wiring. Behavior contract R-13 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. No device/binary/OTA/iOS/PROD claim; UAT=NOT_TESTED; #522 remains PARTIAL.

## #522 APK46 accepted-web invitation detail manager revoke + Open game parity (source only) · APK46

SOURCE ONLY (#522 Owner assignment revision `d4aaa743…`; counter **45→46** numeric-only across pins). Accepted-web `InvitationDetail` manager-only «Отозвать приглашение» + «Открыть игру» on native invitation detail: current `/me/games` managed projection (never inviter/createdByMe); fail-closed rights; selected revoke with latest version + UNKNOWN exact manual retry; recipient accept/decline preserved; Open game via native `/games/:id` for manager or accepted+participation. `POST /invitations/:id/revoke` opts into `requirePrincipalMutation` (cookie Origin/CSRF preserved); organizer list GET stays cookie-only; service/idempotency/manager/version unchanged. Focused `messages.test.ts` + `invitation-authoring` wiring; API revoke case in `native-messages.foundation` (Root owns DB). Behavior contract R-12 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. No device/binary/OTA/iOS claim; UAT=NOT_TESTED; full #522 remains PARTIAL.

## #522 APK45 native DM peer game invitation chooser + explicit create parity (source only) · APK45

SOURCE ONLY (#522 Owner assignment revision `50438386…`; counter **44→45** numeric-only across eight pins). Accepted-web DM «Пригласить на игру» → managed open-game chooser → fresh game GET → explicit `POST /games/:gameId/invitations` with frozen UNKNOWN exact retry; peer/actor/surface fences; safety-held peers blocked; create opts into `requirePrincipalMutation` (cookie Origin/CSRF preserved); outgoing list GET stayed cookie-only at APK45 (revoke opted in APK46). Focused `invitation-authoring.test.ts` + `auth.test.ts`; API create case in `native-messages.foundation` (Root owns DB). Behavior contract R-11 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. No device/binary/OTA/iOS claim; UAT=NOT_TESTED; full #522 remains PARTIAL.

## #522 APK44 native saved game-contact preference read/save/remove parity (source only) · APK44

SOURCE ONLY (#522 Owner assignment revision `bc170773…`; counter **43→44** numeric-only across eight pins). Bounded native own «Контакт для игр» parity with accepted web `GameContactPreference`: GET already admitted; PATCH `/v1/me/game-preferences` opts into `requirePrincipalMutation` (cookie Origin/CSRF preserved); coordinator CAS/idempotency/UNKNOWN exact retry + actor/session fence; profile card uses existing tokens; does not push into edited creation form. Focused `game-contact-preference.test.ts` + `auth.test.ts`; API case in `native-game-management.foundation.test.ts` (Root owns DB). Behavior contract P-07 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. No device/binary/OTA/iOS claim; UAT=NOT_TESTED; full #522 remains PARTIAL. `native-messages.foundation` closed-neighbor retargeted to cookie-only `GET /v1/me/discovery-preference`; retargeted-neighbor validation pending fresh isolated DB/CI — no PASS claim.

## #522 APK43 direct game details public organizer/trainer history read (source only) · APK43

SOURCE ONLY (#522 Owner assignment revision `8e0becfe…`; counter **42→43** numeric-only across eight pins). Native `/games/:id` public role-history read parity with accepted web: organization always; training only `trainer_led` with specified trainer; separate lanes even when same person; guest credential-omit read; no «Поделиться опытом» on details (`canWrite={false}`) while Discovery author entry preserved; reply/report keeps gameId origin; reuse existing coordinator/UI. Focused `role-reputation.test.ts` + `public-role-reviews` pin. Behavior contract R-10 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Source cannot claim device proof; APK43 not built here; UAT=NOT_TESTED. #522 remains open.

## #522 APK42 own attendance source/late/version + clarification navigation (source only) · APK42

SOURCE ONLY (#522 Owner assignment revision `619ee358…`; counter **41→42** numeric-only across eight pins). MyGames own attendance shows value, late if true, human Russian source, version, and pending notice (`needsAttention`); open `attendance.dispute.status=open` offers «Уточнение открыто →» → exact-game results `section=clarification` (gameId+section only). Results reuses APK41 layout-driven reveal for clarification with actor/session/game/section fencing; preserves feedback reveal and ordinary entry. No API/DB/deps/writes. Focused `my-games.test.ts` + `postgame-feedback.test.ts` + `postgame-disputes.test.ts`. Behavior contracts R-04/R-06 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Source cannot claim device proof; APK42 not built here; UAT=NOT_TESTED. #522 remains open.

## #522 APK40 private-row feedback reveal repair (source only) · APK41

SOURCE ONLY (#522 Owner assignment revision `df034e28…`; counter **40→41** numeric-only across eight pins). Repair actual APK40 Android defect: hub private-history row → results `section=feedback` stayed at top (BackLink/participants/outcome/attendance) with «Как вам встреча?» offscreen — RAF `measureLayout(findNodeHandle(ScrollView))` was not a reliable native reveal. Replace with stable content-relative `onLayout` + `collapsable={false}` on FeedbackSection (direct Page ScrollView child), gated by settled results + one visit key + live-target fence; no speculative delays/extra features/backends. Focused `my-games.test.ts` + `postgame-feedback.test.ts`. Behavior contracts R-06/R-07 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Source cannot claim device proof; APK41 not built here; UAT=NOT_TESTED. #522 remains open.

## #522 MyGames private feedback history + exact feedback navigation (source only) · APK40

SOURCE ONLY (#522 Owner assignment revision `22afd404…`; counter **39→40** numeric-only across eight pins). Accepted web `GameReviewsHistory` native parity: My Games «Отзывы» → «Обратная связь» received/sent via existing `PostgameCoordinator.loadReviews` (limit20/exact cursor, loaded count, per-row reply, honest empty/unavailable/error); row → `/my-games/[gameId]/results` with `section=feedback` only (never comment/name in URL); results deep-link prefers visible feedback history lane without writing draft.mode. No backend/journal/transport/coordinator writes; preserve public role history and per-game reply/report/create. Focused `my-games.test.ts` + `postgame-feedback.test.ts`. Behavior contracts R-06/R-07 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED; APK40 not built from this source. #522 remains open.

## #522 native public venue reviews full list + cursor pagination (source only) · APK39

SOURCE ONLY (#522 Owner assignment revision `46881131…`; counter **38→39** numeric-only across eight pins). Accepted web parity for public gallery only: preview5 + CTA «Все отзывы · N» when `publishedCount > preview.length`; DiscoverySheet «Отзывы о площадке» with independent first page limit=20; «Ещё» passes exact server `nextCursor`; `PublicVenueReviewsGallery` production owner with reviewHandle dedupe, double-tap/consumed-cursor busy fence, late close/venue-change epoch retirement, more-error retry without dropping rows/cursor. Existing credential-omit `publicApi.experienceReviews` only — no backend/deps/providers/report/appeal/write. Preserve private owner journal/history. Focused `r4-parity.test.ts` exercises injected transport. Behavior contract R-09 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED; APK39 not built from this source. #522 remains open.

## #522 native own venue history/detail/edit/withdraw (source only) · APK38

SOURCE ONLY exact final23 (#522 Owner assignment revision `1ee9c13a…`; counter **37→38** numeric-only across eight pins). Profile entry «Отзывы о площадках» reproduces web OwnVenueReviews + selected VenueReviewComposer loop: incomplete latest-50 list, refresh, statuses, private text, venue open, public quotation via existing public GET (≤3×20). Bearer opt-in only for owner list/detail + `submit_revision`/`withdraw` (appeal/resubmit/report stay cookie); OpenAPI three operation-local dual-auth updates; disposable 6th native case replaces obsolete owner-route denials and appends true bearer coverage (five original cookie cases exact). Distinct `venue-experience-command` packets on the same PostgameCoordinator journal (create packet unchanged); fresh revision re-GETs selected id/versions/consent before dispatch; withdraw is action+expectedVersion only (no game admission); UNKNOWN immutable + 24h fence; Profile owns recovery (no results CTA). New `own-venue-reviews.tsx` + `own-venue-reviews.test.ts`. Source only — no author test/build/DB/provider/commit/push. No device/UAT/full #522 claim. Root owns validation/delivery after APK37 gate. Behavior contract R-09 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 venue independent QA2 address10: post-token fresh authority fence (source only) · APK37

SOURCE ONLY exact7delta/cumulative **23** (#522 independent Codex QA2 address10 P1; counter **37** unchanged; six APK pins untouched; API/packages/fixture/nativeAPI/auth transport/protocol/entry/storage exact41bd). Fresh venue create captures actor/session/surfaceGen/editor/consent/basis/eligibilityGen into local `venueFreshDispatchBind` (never on wire); AuthCoordinator post-token `mayDispatchRetention` fails closed when auth hydrate, surface retire/close, editor/consent, or admission/read gen retire — even if packet key/inFlight/age still match. Does not rebuild permission from restored reauth snapshot or frozen body. Preserves UNKNOWN original packet/key/body/firstDispatchedAt/global lock + honest notice; explicit `reconcileVenueExperience` remains retention-only (distinct from fresh). Deferred-token regressions: simulated adapter + real AuthCoordinator+PostgameCoordinator (retire/close → 0POST; same-account quarantine → 0 autoPOST then explicit retry 1POST; legitimate private/public still work; prior TTL/race/consent/route retained). Mark source pending — no QA/device/release claim. Root owning/freshDB/independent QA/CI/DEV/APK still mandatory. Behavior contract R-09 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 venue Root address8: route lifecycle capture + deferred original-allow (source only) · APK37

SOURCE ONLY exact6delta/cumulative **23** (#522 Root address8; counter **37** unchanged; six APK pins untouched; API/packages/fixture/auth transport exact). Entry blur/unmount retires **captured** `VenueExperienceRouteOwner` for THIS focused lifetime (`captureVenueExperienceRouteOwner` / `noteVenueExperienceRouteOwner` / `ownedRouteRef`) — not a live `getSnapshot()` gen/actor at cleanup; open-after-focus still retires pending prepare; stale same-game/actor cleanup cannot close a newer surface; ordinary rerender does not close. P3 eligibility port uses per-call ordinal so deferred submit still returns original `may_submit` after newer deny/version — deny/version remains, zeroPOST/no new key. Production lifecycle + original-allow-after-newdeny regressions; preserve address7 P1/P2 safe fixes + UNKNOWN/24h/actor/session/notice/focus/private-public. Mark source pending — no QA/device/release claim. Root owning/freshDB/independent QA/CI/DEV/APK still mandatory. Behavior contract R-09 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 venue independent QA address7: route retire + basis consent + eligibility fence (source only) · APK37

SOURCE ONLY exact7delta/cumulative **23** (#522 independent Codex FAIL three findings; counter **37** unchanged; six APK pins untouched; API/packages/fixture/auth transport exact). Route `useFocusEffect` blur/unmount calls gen-scoped `retireVenueExperienceSurface` (surface/eligibility/preview/prepare only; UNKNOWN lock preserved; stale cleanup cannot close newer same-game surface; no return-focus on departed route). `loadVenueEligibility` compares `venueExperienceBasisAuthority` and retires hash/consent on changed/missing/unusable basis without destroying text/topics/audience; deferred preview cannot restore. `submitVenueExperience` joins `venueEligibilityGen` so a newer load deny/version wins — stale allow paints nothing and zeroPOST; old finally cannot clear newer prepare. Deferred coordinator regressions in `venue-experience-author.test.ts`. Preserve prior units/global24h/post-token/UNKNOWN/notice. Root owning/freshDB/independent QA/CI/DEV/APK still mandatory. Behavior contract R-09 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 venue type/lint root address6: Packet guards + own-key reasons + live focus (source only) · APK37

SOURCE ONLY exact7delta/cumulative **23** (#522 owning FAIL2of14; counter **37** unchanged; six APK pins untouched; API/contracts/fixture/auth transport exact f844). Proper `isVenueExperienceCreatePacket` discriminant for TS2339 (no `as any`/`@ts-ignore`/test deletion/lint weaken); meaningful expected-kind guards in author stubs; mechanical `prefer-const`. Closed own-key Map reason copy — prototype keys neutral; pending UNKNOWN Russian copy without internal key/application terms; Entry `openerRef`/`liveRef` returns focus to remounted control after Composer unmount, fenced by actor+game. Preserve all 760 units / 168 focused + race/global24h/post-token/notice/fixture semantics. Root owning/freshDB/independent QA/CI/DEV/APK still mandatory. Behavior contract R-09 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 Astra UX a49: private receipt / pending recovery / UNKNOWN / reason copy (source only) · APK37

SOURCE ONLY exact7repairdelta/cumulative **23** (#522 Astra High sourceUX4findings; counter **37** unchanged; six APK pins untouched; API/contracts/fixture/auth transport exact E161). Private null-token `revision_waiting` receipt = saved-only-you (no moderation); public pending truthful awaiting-review; success notice not duplicated beside receipt. One functional original-operation recovery for verified actor + route game from immutable packet `gameId`/`venueId`, independent of live venue/results; entry «Посмотреть отправку»; hide dead CommandReview private-modal CTA for venue (MyGames → results). Explicit UNKNOWN heading + «Повторить исходную отправку»; expired no send; local heading/escape/return-focus. Closed Russian eligibility reason map / neutral fallback — never raw codes. Preserve race/global24h/post-token/notice/fixture + regressions. Root owning/freshDB/independent QA/CI/DEV/APK still mandatory. Behavior contract R-09 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 venue business-notice preserve + native fixture exact denials (source only) · APK37

SOURCE ONLY exact5 repairdelta/cumulative **23** (#522 Root address4; counter **37** unchanged; six APK pins untouched; no UI/API controller/contract/deps). Conclusive venue 422 business reject keeps `venueNotice` through automatic eligibility reread via existing `preserveNotice` (mirrors public create); fresh admission + explicit reconfirm; latest draft text preserved; deferred reread regression added. Appended native disposable 6th case only: exact CREDENTIALS_CONFLICT/BEARER_NOT_ALLOWED/ORIGIN_REJECTED/CSRF_*/IDEMPOTENCY_KEY_REUSED; honest mixed cookie+bearer rename; genuine rawHeaders×2 `INVALID_AUTHORIZATION` via DI `ConsumerAuthService.requirePrincipal` (inject normalize ≠ raw-duplicate); valid unknown 43-opaque + dedicated issued→logout revoked 401; public_venue ineligible 422 `VENUE_EXPERIENCE_DENIED` with assessReviewTexts call-through spy 0; replay revision/intake DB counts unchanged; cookie preview+create Origin/CSRF exact + 200. Old five cookie case bodies/env/guards exact. Race/close/retention/post-token permits preserved. Root focused→owning/freshDB/independent QA/CI/DEV/APK still mandatory. Behavior contract R-09 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 venue pending-write race/close/receipt/fixture + pre-send retention (source only) · APK37

SOURCE ONLY exact12repairdelta (#522 Root address; cumulative **23**; counter **37** unchanged; six APK pins untouched; API controller exact3 guards unchanged). Global `writePrepare` ownership before eligibility await prevents double fresh POST / UNKNOWN overwrite; stale draft/audience/topics/consent/basis invalidates pending send without losing current input; Close/Back hides composer while immutable journal packet/key/age/lock remain; same-origin reopen + explicit replay only; late ACK does not paint a replaced surface. AuthCoordinator local retention permit after token await (all Postgame kinds). Truthful private/public revision copy (older publication may remain); blank/whitespace public intake token stays UNKNOWN; missing `firstEligibleAt` fail-closed. Native disposable fixture extended (key/replay/mismatch/ineligible/siblings/public GET/cookie CSRF/disabled); OpenAPI only three venue ops — GET/preview no key vs create required key + operation-local private/public oneOf. Deferred coordinator + retention adapter cases. Owning/full/freshDB/independent QA/CI/DEV/APK still Root gates. Behavior contract R-09 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 Postgame journal 24h UNKNOWN retention fence private/public/venue (source only) · APK37

SOURCE ONLY exact11 (#522 / #372 Root repair; cumulative **23**; counter **37** unchanged). Confirmed defect: private/public UNKNOWN reconcile redispatched original packet after server 24h idempotency TTL; venue age was stamped but missing timestamp bypassed expiry. Root `PostgameCoordinator` now stamps `firstDispatchedAt` once on first actual dispatch for every journal packet; action-time + predispatch fail-closed for boundary/expired/missing/invalid/backwards; no key rotation, autosend, GET-success claim, or UNKNOWN lock release. Honest Russian expired recovery copy in existing UI. New `postgame-retention.test.ts` (production coordinator + controllable clock). Public-role suite title restored to accepted APK36 wording; numeric pin stays 37. API/contracts/fixture/Appconfig unchanged. Behavior contract R-09 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 native exact-game venue experience private save + consented public (source only) · APK37

SOURCE ONLY exact21 (#522 / a39877 base; counter **36→37**; six APK pins only). Exact current results game with matching game-detail venue + eligibility `may_submit`: private-default `self_draft` save or explicitly consented public preview/create; no broad venue CTA/picker. Three API guards → `requirePrincipal` / `requirePrincipalMutation`; three operation-local OpenAPI dual-auth contracts (Origin/CSRF cookie-conditional); services/migrations/privacy/siblings unchanged. Same root `PostgameCoordinator` journal with distinct `venue-experience-create` kind; immutable UNKNOWN; 24h first-dispatch fence blocks unsafe late POST (web profile status until native own-history). Deferred entry/consent/race/recovery author tests + disposable NativeSessionService HTTPS harness case (original five cookie bodies/env preserved). Honest unfinished: native own-history/edit/withdraw/pagination, physical UAT/iOS/OTA, full #522. Preserve d8 cold-auth + fullnative regressions. Behavior contract R-09 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED; APK37 not built from this source. #522 remains open.

## #522 cold auth Root ABA address4 claim-navigation revival (source only) · APK36

SOURCE ONLY address4 (counter **36** unchanged; cumulative **19** unchanged; allowlist 5 paths). Fixes confirmed claim-phase ABA: when claim starts already on the expected game, SecureStore await + Messages→Back same game bumps navGen while `currentPath === goalPath` must not revive consumed selection — `coldClaimStillOwnsNavigation` no longer accepts solely on path===goal. Unchanged claim-start path still owns; own single expected generation hop from a different start onto goal still owns; multi-hop / already-at-goal leave→return retires. Host still uses the production helper (not a test-only map). Prior QA3 three fences + QA1/QA2 + family1–6 + UNKNOWN/consent/origin-port/frozen-basis preserved. No AuthCoordinator/protocol/Postgame/API/packages/deps/permission changes. Not built / not accepted / no author success claim. Behavior contract R-06/R-08 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 cold auth independent QA3 address3 three host navigation findings (source only) · APK36

SOURCE ONLY QA3 repair (counter **36** unchanged; cumulative **19** unchanged; allowlist 5 paths). Addresses three independent host navigation promise-boundary findings: capture claim-phase path+navGen before SecureStore await and drop without `router.replace` when unrelated navigation (including ABA) intervenes while auth/actor/surface stay equal — own expected goal-path commit still restores; retire unmatched `pendingResume` on intervening unrelated pathname via `waitFromPath` so a later ordinary origin visit cannot reopen a consumed goal; eventual-open `isLive` synchronously requires `pathnameRef.current === pending.path` (not only after passive cleanup). Small pure host seams `coldClaimStillOwnsNavigation` / `coldPendingResumePathPhase` / `coldPendingResumeEventualLive` in `public-role-reviews.ts` are used by the host; deferred seam tests cover delayed-claim drop, superseded-before-match retire, matched-then-navigate delayed validation no-open, positive own restore once, and auth/surface retirement. Prior QA1/QA2 + family1–6 + UNKNOWN/consent/origin-port/frozen-basis fences preserved. No AuthCoordinator/protocol/Postgame/API/packages/deps/permission changes. Not built / not accepted / no author success claim. Behavior contract R-06/R-08 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 cold auth independent QA2 address2 five findings (source only) · APK36

SOURCE ONLY QA2 repair (counter **36** unchanged). Addresses five independent findings with a new origin-port approach (not handle-wide eligibility alone): credential-omit `publicApi.gameRoleReputation` / `playerRoleReputation` via optional PostgameCoordinator ports wired by AuthCoordinator validate current game/profile role→handle before resumed open (missing port fail-closes resumed only); resumed author `resumeFrozenGameId` persists across eligibility reloads and later basis loss → unavailable (no silent fallback); host waits for actual `usePathname` match after `router.replace`, fences eventual open with `isLive` + eligibility/surface gen (navigate-away / reader/history replacement); cold expiry cleanup SecureStore write failure propagates into existing hydrate fail-closed storage path (not guest+notice=null while expired goal remains durable). Prior QA1 six fixes + family1–6 + UNKNOWN/consent fences preserved. Deferred coordinator+host seam tests for denied/replaced origin, frozen basis removal, lifetime/surface replacement, storage-fail. Not built / not accepted / no author success claim. Behavior contract R-06/R-08 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 cold auth independent QA1 address1 six findings (source only) · APK36

SOURCE ONLY QA1 repair (counter **36** unchanged). Addresses six independent findings: synchronous at-most-once claim reservation (concurrent delayed clear → one non-null); `hydratedEntryRoute` restores bare `/players/:id` before host handoff; resumed author/reader revalidate exact origin/role (no handle-wide fallback basis); matching cancel fences in-flight exchange after pending consume; deadline recheck after durable claim clear; warm validate + cold hydrate durably retire expired pending/goal bytes via existing writer. Root host restores `publicRoleGoalPath` then `openResumedPublicComposer`/`openResumedPublicReader`; stale claim work retired on unmount/auth change. Prior family1–6 + UNKNOWN/consent fences preserved. Not built / not accepted / no author success claim. Behavior contract R-06/R-08 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 cold interrupted auth public-role goal persistence (source only) · APK36

SOURCE ONLY: durable selected public-role destination through interrupted sign-in and cold restart (counter **35→36**; cumulative admission 22 preserved). Guest author/reader taps admit a closed local goal into the existing serialized SecureStore pending (role + 32-hex handle + typed game/profile origin only) before browser launch; verified session carries the same actor/session/generation/deadline-bound unclaimed goal; root `PublicRoleReviewHost` claims once via existing writer before opening blank composer/reader (fresh eligibility, unchecked consent, zero automatic business writes). Cancel/expiry/failure/busy/unavailable/replacement login/logout/account change clear matching warm+durable goals; obsolete cancel cannot delete a newer generation; old v1 and unknown future envelopes stay fail-closed; goal metadata never enters browser transaction/callback/routes. Player-detail return `/players/:id` admitted beside reserved `/players/browse`. Six deferred coordinator restart/race/parser families added; other native intents and UNKNOWN packets immutable. Physical/iOS/OTA/device and remaining #522 surfaces unfinished — not claimed. Behavior contract R-06/R-08 cold-goal rows **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED; APK36 not built from this source. #522 remains open.

## #522 public reply/report independent QA4 address13 (source only) · APK35

SOURCE ONLY independent QA4 correction (counter **35** unchanged; cumulative admission 22). Hard authorization denial on reply/report (port `private` or HTTP 401/403/404) keeps the immutable UNKNOWN original packet/body/method/path/key/actor and retires only the originally owning reader private projection — ready page/allowedActions/report editor/consent/hash/painted private ACKs gone; late pending reader GET invalidated; dirty reply text kept with consent false until a fresh typed read + renewed consent (no autosend / no free-key). Matching reply consent-preview hard denial retires the same write authority. Delayed A denial after B open does not clear B rows/cursor/drafts/authority (same QA3 surface gen + full origin fence). Ordinary business 409/422 follow-up GET path unchanged. Prior QA1/2/3 fixes/API/whole5fixture/counter35/cumulative22 preserved. Not built / not accepted / no author success claim. Behavior contract R-08 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 public reply/report independent QA3 address10 (source only) · APK35

SOURCE ONLY independent QA3 correction (counter **35** unchanged; cumulative admission 22). Delayed reply/report business rejection settles the original journal but paints notice/clears hash/bumps preview/follow-up GET only when the live surface still matches the original dispatch generation + role + full game/profile origin — A→B (same roleHandle) no longer refreshes or mutates B's rows/cursor/draft. Same-actor null quarantine preserves the original `publicMutationBind` (including origin); close/reopen PROFILE or identical-origin replacement cannot inherit ACK authority; legitimate still-open original reader rebinds session/gen for explicit reconcile paint; packet body/key/method unchanged, no autosend. Prior QA1/2 fixes/API/whole5fixture/counter35/cumulative22 preserved. Not built / not accepted / no author success claim. Behavior contract R-08 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 public reply/report independent QA2 address8 (source only) · APK35

SOURCE ONLY independent QA2 correction (counter **35** unchanged; cumulative admission 22). Root-read authority loss (network/mismatch/unavailable) retires public reply consent/hash and in-flight preview while preserving draft text; append transient failure keeps prior rows + consent + same nextCursor. Retry after non-authoritative read treats missing oldItem as version move — no preview/send without explicit renewed consent; fresh consent on the new revision works. Binds painted report receipts to original packet `expectedRevision` for paint+retire across ACK/GET orderings: same-revision repeats stay deduped; N→N+1 retires block so canReport N+1 may open; deferred old ACK after newer GET does not paint stale receipt or erase new-revision report draft. Prior reply-receipt gates/API/whole5fixture/UNKNOWN/a11y preserved. Not built / not accepted / no author success claim. Behavior contract R-08 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 public reply/report independent QA1 address6 (source only) · APK35

SOURCE ONLY independent QA1 correction (counter **35** unchanged; cumulative admission 22). Splits reader UI reply/report receipt gates so a successful reply ACK does not disable reporting and a report ACK does not disable the reply editor (active/UNKNOWN journal still serializes). Binds painted reply receipts to original packet `expectedReviewRevision` for paint+retire: GET retires on published-revision change even when reply aggregate is unchanged; deferred ACK after newer published revision does not paint stale acceptance or erase new-revision draft/consent; fresh consent+preview+explicit Send required. Production-coordinator regressions cover post-success independence both directions and both ACK/GET orderings. Prior race/UNKNOWN/UX/API/whole5fixture preserved. Not built / not accepted / no author success claim. Behavior contract R-08 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 public recipient reply/report actual owning +Astra address3 (source only) · APK35

SOURCE ONLY exact5 repair (counter **35** unchanged; cumulative admission 22). Fixes four TS errors in `public-role-reviews.test.ts` via one stable command snapshot + kind discriminant (no assertion weaken) and moves `ScrollView` to a type-only import in the reader sheet. Open report editor retires when the current typed row loses `canReport` or changes published revision (refresh/append); form gated on live permission; already-dispatched UNKNOWN packet/body/key untouched (no cancel/replay/autosend); auto-retire a11y focus goes to the visible row or reader heading when the trigger is gone (explicit Cancel keeps trigger focus when mounted). Meaningful coordinator regression covers refresh + duplicate-append `canReport:false`. Not built / not accepted / no author success claim. Behavior contract R-08 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 public reader AstraHigh UX address2 (source only) · APK35

SOURCE ONLY repair of three Astra High P2 reader UX findings on exact6 paths (counter **35** unchanged; cumulative admission 22 via optional `Page.scrollRef`). Selected report form renders under its row trigger (handle+publishedRevision) with same-row draft preserved on repress; heading gets a11y focus and unanimated scroll reveal after layout without keyboard; Cancel uses disabled-capable OutlineButton and ignores cancel while the report packet is in flight. Transient append failure keeps prior ready rows and retries the same nextCursor (loadingMore/moreError distinct from root page error); auth/visibility denial retires rows/forms. Not built / not accepted / no author success claim. Behavior contract R-08 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 public recipient reply/report Root preflight address1 (source only) · APK35

SOURCE ONLY repair of Root F6 preflight defects on exact12 paths (counter **35** unchanged). Consent retires on newer typed publishedRevision/replyAggregateVersion while dirty text stays; append merges duplicate handles with version/permission fences; deferred older reply ACK cannot paint over newer typed aggregate; guest `rememberPendingPublicReader`/`resumePendingPublicReader` restores chosen reader/origin after auth (profile returnPath may stay null; game reuses `/games/:id`); reply/report receipts bind to owned reviewHandle and no longer freeze the whole thread; `subjectOwnReplyLabel` uses Russian human labels without raw status codes; OpenAPI reply-commands/reports Origin+CSRF are cookie-conditional (`required:false`) like other NativeBearer mutations; disposable fixture asserts exact `IDEMPOTENCY_KEY_INVALID` 400 and adds genuine profile-origin actor/outsider negatives. Root reader sheet owns canReply/canReport actions (disclosure only opens entry). Not built / not accepted / no author success claim. Behavior contract R-08 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 native public recipient reply/report (source only) · APK35

Ports accepted WEB `RoleReviewsDialog` actor-aware read/reply/report into native game+profile: signed-in root `PublicRoleReviewHost` reader sheet via `PostgameCoordinator`; guest game/profile PublicApi lanes stay credential-free and private-field-free. By-handle GET opts into Authorization→`requirePrincipal` else `optionalSession`; reply-commands/reports use `requirePrincipalMutation` + OpenAPI NativeBearer (cookie Origin/CSRF retained). Reply: unchecked public consent, preview `targetKind:reply`, submit_revision with both versions + hash; ACK only `{version,status:submitted,receiptToken}`. Report: independent canReport, reason enum, private ACK `{reportId,receiptToken,status:submitted}`, game query only for game origin. Same journal UNKNOWN original packet; no autosend; no public text from ACK. Source counter **34→35** only (six APK counter gates + README). Disposable native bearer subject/outsider reply/report appended; whole prior cookie CASE bodies preserved. Behavior contract R-08 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED; APK35 not built from this source. #522 remains open.

## #522 public role Root address3 single persistent host (source only) · APK34

Mounts exactly one `PublicRoleReviewHost` at the existing RootLayout `AuthProvider` seam (SafeArea/Preferences, sibling to route children) — no second owner/provider/auth protocol. Removes per-card and `PostgameSurface` host mounts and module-global host arbitration. Root host calls `resumePendingPublicAuthor` once when authenticated current actor matches: consumes bounded pending role/game, opens composer with empty draft (consent false / text empty), no autosend / no inherited consent. Auth return path stays `/games/:id`. Shared focus remember/clear for catalog + MyGames (private CommandReview `FocusContext` untouched). App-kill / cold interrupted pending persistence not implemented — unfinished, not claimed. Source counter stays **34** (no increment). Source wiring unit only; no tests/build/DB/install/network/commit/push in this pass. Behavior contract R-06 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Fresh owning QA / CI / DEV remain future. Device/Owner UAT=NOT_TESTED. #522 remains open.

## #522 native PUBLIC role-review author loop (source only) · APK34

Ports accepted WEB `RoleReviewComposer` / `RoleReviewsHistory` + Astra native placement into native: game role card «Поделиться опытом», guest auth return with bounded role/game only (existing `/games/:id` path), MyGames compact «Отзывы» → «Мои публичные отзывы о ролях» after «Обновить мои игры», eligibility → explicit public audience + consent preview → PENDING create → own status + withdraw. Five routes opt into `requirePrincipal` / `requirePrincipalMutation` + OpenAPI NativeBearer (eligibility/consent-preview/create/listMine/ownCommand); reply-commands/report stay cookie-only. Same root `PostgameCoordinator` owns public mutations/UNKNOWN journal (no second queue); public sheet confirms — private CommandReview excluded. Public multiline LF text (not private control-char validator). Source counter **33→34** only (existing five APK counter gates + README); Root f64b address1 keeps counter **34** (no increment): type-safe publicBusy, consent-separate send, monotonic withdraw GET/ACK fences, late-create surface generation, Russian business notices, disposable training/revoked/disabled exact codes. Address3 replaces reactive multi-host handoff with one RootLayout host under AuthProvider. Focused `public-role-reviews` / my-games / role-reputation author-entry adaptation + disposable native bearer author loop (original two cookie cases preserved). Behavior contract R-06 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Device/Owner UAT=NOT_TESTED; APK34 not built from this source. #522 remains open.

## #522 native private organization/training feedback (source only) · APK33

Ports accepted WEB private «Организатору лично» / «Тренировка» modes (Astra High UX on actual WEB) into native Results feedback beside peer: `canCreateOrganization`/`canCreateTraining`/`organizationRecipientDisplay` with current `writesEnabled`; organization score1–5 or comment≤500; training comment required, no score/tags/peer fields; server-derived recipient; kind-separated drafts; discrepancy omit/optional + FEEDBACK_DISCREPANCY_REQUIRED/UNEXPECTED field messages; explicit experience assertion + CommandReview; own sent/received history shows all three private kinds with labels; reply uses reply.version\|0 for all kinds; exact-revision report stays received peer only. Same root `PostgameCoordinator` — no second owner/framework; no backend/OpenAPI/schema/deps/OTA; public role authoring still unfinished. Source counter **32→33** only (existing five APK counter gates + README). Focused `postgame-feedback` unit + disposable PG-3 8th native organization/training lifecycle (first 7 bodies retained). Behavior contract R-07 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Full app still **PARTIAL** (#522). Device/Owner UAT=NOT_TESTED; APK33 not built from this source. #522 remains open.

## #522 native private peer feedback (source only) · APK32

Ports accepted WEB `GameFeedbackPanel` peer create/received/sent + Astra High review into native «Участники / Итоги»: create from current `peerSubjects`/`canCreatePeer` with explicit `experienceAssertion` and ratings play_again|neutral|difficulties (no preselect); own directional `GET /me/reviews` history with cursor (works when full Results/roster denied); received reply uses `reply.version` or 0; exact-revision report with initially-off consent and receipt bound to original packet. Same root `PostgameCoordinator` + `postgame-feedback` helpers; four ops opt into `requirePrincipal`/`requirePrincipalMutation` + OpenAPI NativeBearer (create/listMine/reply/report); PATCH review stays cookie-only; notes guards unchanged. Shared routes still accept other private kinds server-side; native UI emits peer only; non-peer history rows parse but are not rendered as peer. Report remains available when create/reply writes are off. Source counter **31→32** only (existing five APK counter gates + README). Focused `postgame-feedback` unit + disposable PG-3 7th native peer lifecycle case. Behavior contract R-06 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Full app still **PARTIAL** (#522). Device/Owner UAT=NOT_TESTED; APK32 not built from this source. #522 remains open.

## #522 native private Postgame notes CRUD (source only) · APK31

Ports accepted WEB `GameFeedbackPanel` personal notes into native «Участники / Итоги» after attendance/clarification: section when `canCreateNote` or own notes exist; copy private/not review/not complaint; create/edit/delete with expectedVersion 0 / current / positive DELETE + irreversible tombstone confirm; same root `PostgameCoordinator` + typed feedback/notes DTOs (reviews not consumed). Three existing note ops opt into `requirePrincipal`/`requirePrincipalMutation` + OpenAPI NativeBearer; all other feedback/review/report/reply handlers stay cookie-only. Actor-bound known own-note contexts enable direct GET/edit/delete when results 403/404 after nonparticipating manager revoke; cold start without retained refs cannot discover notes (existing WEB/API limit, documented unfinished). Source counter **30→31** only (existing five APK counter gates + README). Focused `postgame-notes` unit + disposable PG-3 native notes lifecycle (nonplaying secondary manager). Behavior contract R-05 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Full app still **PARTIAL** (reviews/report/reply unfinished). Device/Owner UAT=NOT_TESTED; APK31 not built from this source. #522 remains open.

## #522 native PG-2 consumer attendance disputes (source only) · APK30

Ports accepted WEB GameResultsComposition clarification lifecycle into native «Участники / Итоги»: create/missing-mark v0, detail/history, manager respond+optional correction (stays OPEN), withdraw (no ACK), help (requested ≠ case linked), resolving ACK with strict `resolvedDispute` receipt. Same root `PostgameCoordinator` + typed `postgame.ts` DTOs; six attendance-dispute ops opt into `requirePrincipal`/`requirePrincipalMutation` + OpenAPI NativeBearer while cookie Origin/CSRF retained. Ordinary ACK unchanged; open-row edit block remains; respond/ack rights from selected dispute detail. Source counter **29→30** only (existing five APK counter gates + README). Focused `postgame`/`postgame-disputes` units + disposable PG-2 native bearer loop. Behavior contract R-04 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Preserve profile/trainer/Looking/visibility/MyGames/maps. Device/Owner UAT=NOT_TESTED; APK30 not built from this source. #522 remains open.

## #522 native own catalog visibility / directoryVisible (source only) · APK29

Ports accepted WEB ProfilePage «Показывать профиль в каталоге» into native own-profile via existing `ProfileCoordinator`: discriminated visibility packet + narrow `PUT /me/social-profile/visibility` port (not PATCH/profileWireBody). Controller `requirePrincipalMutation`; OpenAPI NativeBearer + cookie semantics on that op only. Switch after «Ищу игру», before «Личные сообщения»; five preview rows; consent only when ON+stored; city not a gate (Owner #448); no autowrite; serialize with text/contactPolicy/Looking/avatar/cover/trainer peers. Source counter **28→29** only (existing five APK counter gates + README). Focused `visibility` unit + `native-players.foundation` bearer on/off/replay/stale/consent/provenance + authority gates. Behavior contract P-06 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Preserve trainer/Looking/contactPolicy/MyGames. Device/OTA/iOS UAT=NOT_TESTED; APK29 not built from this source. #522 remains open.

## #522 native own trainer profile create/edit/deactivate/reactivate (source only) · APK28

Ports accepted WEB ProfilePage «Я тренер» / TrainerProfileEditPage into native own-profile: self-declare, create, edit, deactivate, reactivate. Controller PUT+POST deactivate use `requirePrincipalMutation`; OpenAPI NativeBearer alternatives on those two ops only (GET already admitted). Root-shared `TrainerProfileCoordinator` owns full TrainerProfile DTO + immutable UNKNOWN packets across unmount/same-actor reauth; no auto-write on mount/refresh/reauth; stale409 keeps draft and requires authoritative refresh; after ACK refreshes social.trainer via rebase and invalidates game-create ownTrainer context. Native inputs name≤80 / bio≤1000. Source counter **27→28** only (existing five APK counter gates + README). Focused `trainer-profile` unit + `native-game-management.foundation` native create/edit/off/reactivate + ten LOCAL fixture routes. Behavior contract P-05 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Preserve Looking/contactPolicy/MyGames/rolepanels/MapLibre. Device/OTA/iOS UAT=NOT_TESTED; APK28 not built from this source. Independent APK27 archive untouched. #522 remains open.

## #522 native MyGames invitations filter + in-card accept/decline (source only) · APK27

Restores «Приглашения» inside native «Мои игры» to accepted WEB composition: `GET /me/invitations` NativeBearer opt-in (cookie preserved); actor-fenced invitations source in PostgameCoordinator; HubRow union by real gameId; invites filter stays on MyGames (no Messages redirect); pending loaded-count/+ while cursor partial; single active inline invitation panel reuses root MessagesCoordinator detail/accept/decline + original idempotency packet; private/inaccessible game keeps safe invite terms without Game GET bypass. Manage/participate keep native reminder/own-result eligibility (not silent WEB narrowing). Source counter **26→27** only (existing five APK counter gates + README). Focused my-games/messages/postgame units + `native-messages.foundation` list cases. Behavior contract R-03 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Trainer-profile not in this slice. Device/OTA/iOS/populated UAT=NOT_TESTED; APK27 not built from this source. #522 remains open.

## #522 native own «Ищу игру» enable/edit 1h|3h/stop (source only) · APK26

Ports accepted WEB looking-for-game intent (`ProfilePage` changeLooking PUT/DELETE) into native own-profile. Controller ops opt into `requirePrincipalMutation`; OpenAPI NativeBearer alternatives on PUT+DELETE `/me/looking-for-game` only. Native closed `mutateOwnLooking` + `ProfileCoordinator` lookingPut/lookingDelete packets; TTL always explicit 60|180; looking receipt updates nested lookingForGame only (not SocialProfile version / unsaved draft); no auto enable/renew; DELETE empty `{}` / inactive version0 valid. Obsolete profile footer «Игровые действия требуют отдельного native-допуска сервера» removed. Source counter **25→26** only (existing five APK counter gates + README). Focused `looking-for-game` unit + `native-players.foundation` bearer looking cases. Behavior contract P-04 **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. Preserve role-history/compact-nav25 + contactPolicy24. Device/OTA/iOS UAT=NOT_TESTED; APK26 not built from this source. #522 remains open.

## #522 native profile public role history + compact bottom nav (source only) · APK25

Ports accepted WEB public organizer/trainer role history on `PublicPlayerProfile` into native player detail after profile+contact, before safety. Direct dual `RoleLaneView` (no gamecard disclosure wrapper). PUBLIC GET `GET /players/:publicPlayerId/role-reputations/:role` via typed `playerRoleReputation` (credentials omit); pagination stays on the same player+role path with role/roleHandle binding. Game card provenance (`gameId` required) unchanged. Compact bottom nav: equal cells at baseline; intrinsic-width flex when equal content width &lt; ~70×fontScale so «Сообщения» fits at 360dp/font 1.3 without ellipsis/font cap. Source counter **24→25** only (existing five APK counter gates + README). Behavior contract rows **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. No auth/backend/contract/migration/deps/PROD; no role write/reply/report UI; device/OTA/iOS UAT=NOT_TESTED. #522 remains open.

---

## #522 native contactPolicy personal-message permission (source only) · APK24

Ports accepted WEB explicit «Разрешать личные сообщения» (`ProfilePage` contactPolicy requests↔closed) into native own-profile settings via existing `PATCH /v1/me/social-profile` bearer path. `ProfileCoordinator` gains policy-only packet/command with minimal wire `{expectedVersion,contactPolicy}`; serializes with name/avatar/cover writers; policy receipt updates authoritative policy/version without wiping dirty name/level/area/bio draft. Version≥1 required; no auto-toggle on mount/login; closed blocks new incoming while history retained — same WEB helper. Catalog visibility / trainer / looking / Radar / consent excluded. Source counter **23→24** only (existing five APK counter gates + README). Focused `contact-policy` unit + optional disposable `native-players.foundation` bearer policy case. Behavior contract row **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. No API/auth/contract/migration/deps/PROD change; device/OTA/iOS UAT=NOT_TESTED.

---

## #522 native swipe bounded next-card media warmup (source only) · APK23

Ports accepted WEB browse neighborhood media preparation (`PlayerBrowseMedia` current + up to 4 ahead + previous) into native swipe using existing `Image.prefetch` only. New small owner `player-browse-media.ts`; hooked from `player-browse.tsx`. Prefetch never blocks gestures/match commands and never commits a previous peer image into the visible card. Only media already on the loaded peer DTO via unchanged `playerMediaUrl`; no speculative profile GET, no new cache/service/dependency. Source counter **22→23** only (four APK counter literals + README). Behavior contract row added as **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**. No latency claim without measured readiness; Owner/S23/device UAT=NOT_TESTED. Gestures, interest submission, backend/auth/contracts/API/SDK/lock/role-history unchanged.

---

## #522 public role-history native card parity (source only) · APK22

Ports accepted web public organizer/trainer role reviews and confirmed history into native discovery `GameCard` inline disclosure. Authority: accepted web `DiscoveryGameCard` / `RoleReputationPanel` + `RoleReputationCardActions` and existing PUBLIC READ `RoleReputationController` routes. Source counter **21→22** only (same six APK literals as prior bump pattern). No cancellation/capacity work; draft PR664 / C3aca not used.

Native card order matches accepted web: TRAINER → ORGANIZER → «Отзывы и история» → details/share. Expand-gated lazy PUBLIC GET (`credentials:omit`, fixed DEV origin): `GET /games/:gameId/role-reputations/:role` then paginated `GET /role-reputations/:roleHandle?gameId&cursor&limit`. Honest unavailable/empty/loading/error+retry; `basis_under_review` keeps published text with qualifier; null held count is never shown as zero. No write/report/reply CTAs, no Bearer opt-in, no backend/catalog/deps/permission mutations.

**#522 PARTIAL** — auth-bound role review authoring/replies/reports/private context remain unfinished. Behavior rows are **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**; no build/device/DEV ACCEPTED claim in this author step.

---

## #522 P-02 — Own profile avatar change/remove (source only)

Implements change/remove of the own avatar inside the existing native profile editor (web `AvatarEditor` composition authority). Manifest pins only: `expo-image-picker@58.0.10`, `expo-image-manipulator@58.0.16`, `expo-file-system@58.0.13`. **Do not treat this source as ready for native-module tests/build** until the trusted parent generates a genuine lock/deps child (isolated store, ignore-scripts, unrelated importers frozen). Author did not install/fetch/hand-edit `pnpm-lock.yaml`, run package scripts/network, or upgrade Expo/RN/React.

Android `versionCode` source counter **21** (historical P-02 pin; current counter is **22** above); verified picker plugin `photosPermission/cameraPermission/microphonePermission: false`; existing `blockedPermissions` preserved. Closed raw-binary native port PUT/DELETE `/me/avatar`; AvatarController uses `requirePrincipalMutation`; OpenAPI NativeBearer on those two operations only (API **0.44.0**, schema inventory **72**, wholeNative **74** + selected **32** inherited). Behavior/parity rows are **SOURCE_PENDING_FRESH_OWNING_QA_BINARY_DEVICE**, not VERIFIED_SOURCE.

ADDRESS1 (Root-review prep): AuthContext projects `avatar` coordinator; UNKNOWN Retry reachable via `!busy` while `blocksEdits` fences replacement/text; oriented crop uses EXIF-normalized size (device/Glide gap preserved); derivative oversize stays inside compression ladder; local deadline retires ownership and cleans late app-owned outputs; authoritative GET rebase preserves dirty draft fields; live runtime uses `typeof import` SDK types; plain Russian transparency guidance; API unit mock uses `requirePrincipalMutation`.

Bounded blockers retained honestly: iOS picker silent PNG fallback (original-container/animation/size parity unproved); native white-flatten unproven (transparent sources fail closed); Android Glide EXIF auto-apply UNKNOWN from loader package alone (no guessed double rotate). No preview waiver, device, iOS, OTA, build, sign, PR, deploy, publication or DB run by author.

---

## #522 R3 — My Games / postgame core (source only)

This source slice adds the native My Games hub and `/my-games/[gameId]/results` using the existing shell, GameCard and visual tokens. Management, participation, own results and reminders remain independent sources; rows preserve their relation/context facts, buckets, selected filter and loaded own-result pages. Invitations are omitted from this bounded core; no invented invitation data or empty-coverage claim.

The results surface reads actual outcome/revisions, own attendance and the authorized manager roster. Explicit reviewed actions cover outcome, individual attendance/correction/late, an exact selected bulk-present set, acknowledgement of a known external undisputed mark, and reminder Later. Creator without a seat has no own attendance panel. Self-authored marks retain self_attested provenance and never fabricate acknowledgement. Open disputes remain read-only here.

Eight selected API operations opt into existing cookie OR native-bearer authentication. Other endpoints and cookie Origin/CSRF guards remain unchanged. A bounded root PostgameCoordinator owns immutable pending commands across navigation; uncertain writes retain method/path/key/body/actor/game/context/version and require explicit original-packet reconciliation. Reads/login never resend or settle them. Unverified identity hides private state; authoritative same-actor recovery restores pending identity, while account B/explicit logout forgets it. Exact hub/results cold auth returns retain Entry ordering and reject query/hash/encoded/external/action variants.

Source self-checks are recorded separately from independent QA. No DB harness, native build/signing, publication or DEV delivery was performed for this slice. API 0.44 / schema inventory 72 / native code 8 and application metadata are unchanged.

Mandatory remainder: full invitations, recommendations, reviews/notes, court booking and dispute create/respond/withdraw/help/history/resolution; remaining photo/profile parity, device/visual acceptance, OTA and iOS. This source slice does not complete #522, establish full native parity, supersede prior FAIL/UNKNOWN/timeout receipts, or authorize a public binary. Owner UAT / native visual / physical device: NOT_TESTED for this slice.

---

# #522 Native swipe — same-author source continuation from 491b9e9

Authorized base: `491b9e9b820659e66eae8e1230e48b11129293f3`; scope is the original 22 paths plus only `src/auth-coordinator.ts`. The previous partial work and its history are retained below. This private export has no usable Git metadata, so no new candidate SHA, commit or source acceptance is asserted.

This delta connects the Players floating «Свайп» entry to the actual filtered catalog and `/players/browse`. MainNavigation mounts one stable PlayInterestProvider above its unchanged Stack children; `_layout.tsx`, Auth/Radar/Messages ownership and native configuration remain unchanged. Closed typed AuthCoordinator read/mutation ports use the same private participationRead gate. The mutation permit is checked after token acquisition immediately before the existing native API call; actor/session/epoch fences and 401 auth failure remain in force, without automatic retry.

The native deck uses the retained WEB2a dp/ms helpers with measured card dimensions, a stable RN PanResponder, Animated exits/return, explicit buttons, details/bio/games-availability pages, approved cover/real avatar fallbacks, tutorial completion per actor/guest, pagination/retry/empty states, Reduce Motion and safe edges. Guest login/cancel keeps the public filters/selected card and never sends an interest. Returning to the mounted Players list reuses its catalog/query and retained FlatList scroll. Actual scroll/layout behavior still requires device testing.

The root owner keeps immutable in-flight/UNKNOWN packets across card/route changes. Current catalog/safety removal retires capabilities and event context; stale callbacks cannot target the next peer. Only a validated explicit mutual send receipt mounts the two-person «Дружеский матч» / «Партнёр найден» composition. Close/background/account changes retire the event. «Написать» explicitly rechecks the existing ordinary contact owner and routes to a validated conversation or the existing composer, without sending a DM or borrowing Radar proof.

Author deterministic Node24 checks: **126/126 PASS**, zero failed/skipped/cancelled: auth 44, entry 5, play interests 8, gesture/catalog 5, unchanged contact 20, Radar 36 and native contract 8. The 62 swipe/auth/entry checks include real component handler → owner → closed auth ports → native API wiring, token-wait actor/permit races, post-reply rotation, 401/no resend, once-only receipt events, Back/undo, tutorial completion, ordinary contact reads and no automatic messages. RN hooks/layout/animation in handler tests use host stubs: these are not rendered-device proof or independent QA.

Typecheck/lint could not start: dependencies and pnpm payload are absent; Corepack registry access fails EAI_AGAIN. Contracts check cannot start without @apidevtools/swagger-parser. The genuine disposable PlayInterest fixture and API unit suite are NOT_RUN (missing dependencies; Docker socket denied); no live database was used. Product CI, independent QA, Astra actual UI review, Android S23 binary evidence, DEV acceptance, APK/OTA/iOS and Owner UAT remain unverified. The prior selected-handler/controller/OpenAPI/fixture work is preserved, not claimed freshly qualified here.

**SOURCE CONTINUATION / PUBLIC DELIVERY HOLD / DEVICE_NOT_TESTED / UAT=NOT_TESTED.** No source, DEV, APK, store or full #522 completion/acceptance claim. Owner APK7 FAIL, costs and every prior FAIL/UNKNOWN remain. No merge/deploy/PROD, dependency/config/version/lockfile change, model subcall or extra source helper occurred. All 491 README bytes follow unchanged.

---

# #522 Native swipe / friendly match — incomplete source continuation

Authorized base supplied by Root: `d667139ec5f8e7d80227dd669aeb265aeaf31929`; focused Radar QA receipt `20d00659af92c11c44c05c7d37635c2fe894ca5eb7e588a8955677a94ba8e1ac`; source capsule `49451e8fdd6e447e41914b8fc5314bf09e730fd588696c2c496738aebd65d1d1`. This private export has no usable Git metadata; no new candidate SHA or source receipt is asserted.

Independent source work here: native pure WEB2a gesture math in measured dp/ms, strict positional play-interest state/receipt parsers, closed bearer API operations, root-lifetime command coordinator with immutable packet/key/version, UNKNOWN retention and retired-context match suppression, ordinary-contact overlay component, exact bare browse auth/entry recovery and exact-path navigation predicate. Only the three selected API handlers opt in to existing principal guards; matching OpenAPI security entries and focused API tests are updated. Existing WEB, services, contact/Radar owners, native configuration, dependencies and lockfile are unchanged.

BLOCKED / NOT A COMPLETE SWIPE CANDIDATE: the authorized 22-file set excludes `src/auth-coordinator.ts`. Its sole existing bearer/session/generation gate, `participationRead`, is private. A narrow scope addition for read/send wrappers was requested; no private-member bypass, credential extraction or alternative auth owner was introduced. The fullscreen card component, route, floating CTA and root runtime mounting are not implemented/connected. The overlay component is not mounted and has no runtime evidence. Exact browse return support therefore does not establish usable deck completion. Do not merge or release this partial continuation as #522 parity.

Author deterministic Node24 verification: **54/54 PASS**, zero skipped/cancelled, covering gesture math/cancel/reversal, parser refusal, owner→actual API wire, UNKNOWN and lifecycle races, historical mutual suppression, actual login/hydration/callback/cancel and entry ordering. These are author checks, not independent QA. API unit/disposable DB tests were added but NOT RUN. Mobile typecheck could not start: dependencies/package-manager payload are absent and Corepack registry resolution fails (`EAI_AGAIN`). No successful typecheck, lint, Product CI, native build/export or device test is asserted.

**SOURCE INCOMPLETE / PUBLIC DELIVERY HOLD / DEVICE_NOT_TESTED / UAT=NOT_TESTED.** No merge, deploy, APK, OTA, iOS parity or full #522 completion. Owner APK7 FAIL and all historical FAIL/UNKNOWN, costs and prior evidence remain. No live DB or PROD operation occurred. All old README bytes follow unchanged.

# #522 Radar — native close/cancel late-ACK safety correction

Admitted base: `1b69455ef9c1399f12f574b190a9c64c5be7bae9`; source receipt `442bda4cc6a5a61f9fec2eb6736c846a46c301e531a8204fd512d8b8f815af1d`; actual parent PASS `d6802b7dabb00b58c3ec76a49dc445a63e8dfeff4122367b71d4da201fb4e971`. Independent focused FAIL `3aa664850ba8e124effa8d61439bdef1791e3adf9c9b936d94d45b13edcb6a42` has one remaining cancel P1; this author correction awaits Root packet review, fresh owning gates and independent focused acceptance. First whole FAIL `cd791219d730f33a7ca53c040d70d7330449a809915b4b7e62a7eda16f48835a` and focused FAIL remain permanent history. Root diagnostic `1e8a8a28bf3f1e5acfaa64a1230d6eeb3caa727782307ff31dcea10a4179dc61` is input, not independent QA.

`cancel()` now establishes existing safety cleanup for owned publication or an unsettled command BEFORE retiring its serial. Private rows/pins/query clear immediately. Existing late-receipt handling can settle the exact original accepted packet and capture its owned activation for the existing frozen DELETE cleanup. Pending cleanup remains honest UNKNOWN with the existing server-lease fallback until its actual ACK; no guaranteed instant stop is claimed. No new owner, workflow or transport. GET cannot acknowledge the original write; lost-response UNKNOWN remains intact. Failed cleanup retries the same packet/key, original commands never auto-replay, and actor/session authority fences remain unchanged. Confirmed cleanup allows fresh explicit consent/enable without automatic activation.

Author validation: fresh Node24 radar/contact/auth/maps/native-contract **118/118 PASS**, zero failures/skips/cancellations. All prior 114 cases remain byte-for-byte; four new tests exercise the actual read-only native close handler plus real coordinator: deferred start ACK then delayed cleanup ACK and explicit reentry; owned-publication cancel/private-context retirement and failed same-packet cleanup retry; lost start response/status discovery retaining UNKNOWN; actor/session rotation with an old ACK and new pending command. The first new-test run had two fixture/assertion failures (116/118); these were corrected without changing production logic or old tests. Targeted four-case rerun and final five-file run pass. This is author validation; native rendering is not tested.

Fresh TypeScript, affected lint and Android/iOS Expo export entrypoints were attempted offline but could not start: this private export has no local typescript/eslint/expo modules. These gates are NOT_RUN, not PASS; no install or resolution. Fresh archive/source inventory verifies only these three allowed files changed and old README bytes remain the exact suffix. Supplied unchanged backend/API_DB80 and Astra UI closure `5ba23647d427d5898997531da5842266b8c548efab2b30a86b054a7ef5e643d4` are reused evidence, not fresh checks. Next independent QA is focused on the remaining cancel P1, related delta and retained prior findings, after owning gates and Root review; no second whole QA or model subcall occurred.

Prior 14/15 normal-run history, timeout 1, carryover, FAIL/UNKNOWN and costs remain intact; no new source receipt/count/SHA is invented in this Git-less export. **SOURCE ONLY / PUBLIC DELIVERY HOLD / DEVICE_NOT_TESTED.** Owner APK7 FAIL, full parity unfinished and swipe22 HOLD remain. No network, DB, install, native build, merge, deploy, APK, OTA, PROD or completion claim. All old README bytes follow unchanged.

---

# #522 Radar — actual late ACK and explicit reentry correction

Admitted base: `c53772cea7d8bf5e0acf977d86fcba2601b83a4c`; prior normal source receipt `ed753a404d1df4b8663be92468095c5a4b819a7490a743fa5c49ee19045db2ca`. Actual owning parent **FAIL** `e4ed17cb07ad36b1cca011e4059bde970d54777631f057abfdef5204b57cbd84` is retained: 111 units/lint/Expo2/archive passed, but production TypeScript failed at coordinator 192/193/197/200. FIRST whole CodeQA FAIL `cd791219d730f33a7ca53c040d70d7330449a809915b4b7e62a7eda16f48835a` remains open for focused acceptance. Root diagnostic `016147beae8efc96b6722eadf90938c1ea454db617cc4a651719df0c7c3540e7` is supplied read-only evidence, not independent QA.

Source correction: only the actual response to the exact frozen original command can acknowledge it after UI serial retirement, under unchanged actor/session and authority. A matched start/update/heartbeat ACK retires that command while separate cleanup remains independently pending until its real receipt. A matched original stop ACK settles its corresponding safety intent without another DELETE. Settled cleanup keeps foreground restoration suppressed until fresh explicit consent; consent then releases that guard and a new explicit enable can create a fresh packet. Late receipts do not restore private rows/pins/query or replay original packets. Already attempted cleanup is not automatically retried by a late ACK; stale discovery cannot recapture settled cleanup. GET/status discovery and genuinely lost/network replies still cannot acknowledge original UNKNOWN; existing failure/same-packet retry and actor rotation fences remain.

Production typing: a bounded `currentCleanup(): Cleanup | null` read observes lifecycle mutation after the transport await, avoiding TypeScript's stale null narrowing. No casts, suppressions, fabricated debt or packet/key reordering were added. Existing P1 background safety and P2 map membership/list independence are retained; API, UI, dependencies, config and application version are unchanged.

Author validation: **114/114 PASS**, zero skips/cancellations, from fresh Node24 radar/contact/auth/maps/native-contract runs. Existing 111 meanings are retained with only incorrect actual-ACK UNKNOWN expectations corrected. Controllable real coordinator coverage includes all four command kinds, original ACK then cleanup ACK (the original stop receipt itself settles stop cleanup), off/empty private state, no write/query before fresh explicit intent, successful consent/enable, unchanged old packet/key/body, reverse ACK ordering and an old actor ACK while a new actor command is pending. True lost-response/GET-only UNKNOWN, cleanup failure/retry and map regressions still pass.

Full mobile TypeScript, affected lint, Expo2 and owning archive/source checks are **NOT_RUN here**: this private export has no node_modules or tsc/eslint/expo; no install or dependency resolution. Fresh owning parent gates must pass before independent focused original P1/P2 + related late-ACK delta QA. No second whole QA or model/provider/subagent call was made. Supplied API_DB80 and Astra UI source closure `5ba23647d427d5898997531da5842266b8c548efab2b30a86b054a7ef5e643d4` are retained evidence, not fresh checks.

Prior 14 normal source runs, timeout 1, carryover, FAIL/UNKNOWN and costs remain history; no new normal receipt/count or source SHA is invented in this Git-less export. **SOURCE ONLY / PUBLIC DELIVERY HOLD / DEVICE_NOT_TESTED.** Owner APK7 FAIL, full parity unfinished and swipe22 hold remain. No network, DB, build, install, merge, deploy, APK, OTA, PROD or iOS completion is claimed. All old README bytes follow unchanged.

---

# #522 Radar FIRST CodeQA — bounded P1/P2 source repair

Base: `60d4400815906d9189026242774e3ac2eda3b46a`. FIRST independent CodeQA **FAIL** `cd791219d730f33a7ca53c040d70d7330449a809915b4b7e62a7eda16f48835a` is retained; the two findings are addressed in author source and await independent focused acceptance. Supplied parent PASS `3575562048329e185a91304fbbb442b43311ca40ea521d14ff258725887125a9`, 13 normal source runs and last source receipt `ca13336e4eceb6860ae6ab88a31ed81a3cc1a1f478c5130927749a47b85dac83` remain history. Timeout/carryover and previous FAIL/UNKNOWN records below remain intact.

P1: background immediately retires private rows/pins and records one safety-stop debt for the authoritative actor/session. A confirmed owned activation supplies one frozen cleanup DELETE packet; late accepted start/update/heartbeat responses can supply that identity after UI request retirement. A bounded status read can discover an activation after a lost response, but cannot acknowledge the original write. Cleanup cannot replace its UNKNOWN packet, body or key, and cannot replay start/update/heartbeat. Failed cleanup remains pending with lease fallback; restore/explicit stop uses the same cleanup packet before any ordinary publication/query can resume. An original stop UNKNOWN is never replaced or automatically replayed; only explicit retry uses its original packet, and only that actual retry receipt acknowledges it. Session/account changes retire cleanup permits and late callbacks. Returning to foreground alone never enables publication; a fresh explicit enable intent is required after confirmed cleanup.

P2: each map window has a separate retirement epoch, captured from actual owner membership. Refresh/next-window/error retires pins immediately; a map proof requires the original epoch, current row membership, peer/ref and map expiry, plus existing actor/session/query/activation fences. Separately parsed list rows keep their contexts when only the map changes. Map errors preserve a still-valid list/query; mandatory privacy expiry still clears private data. No caller parameter, UI bypass, API/SQL/policy/dependency or architecture change.

Author check: **111/111 PASS**, zero skips/cancellations, in radar/contact/auth/maps/native-contract: original 94 retained plus 17 targeted real-coordinator regressions. Deferred transport tests cover late acceptance, lost responses/status discovery, restore debt, cleanup failure/same-key retry, actor/session rotation, stale composer/late preview, replacement windows and list retention. This is author validation, not independent QA. Fresh mobile TypeScript, affected lint and both Expo exports are **NOT_RUN** in this export: node_modules and tsc/eslint/expo are absent; no installation/resolution. The normal parent must run those gates before independent focused P1/P2 + related-delta QA. Unchanged backend/API_DB80 evidence is reused, not rerun.

Astra UI source closure `5ba23647d427d5898997531da5842266b8c548efab2b30a86b054a7ef5e643d4` is retained: this delta only changes coordinator/test/README, preserving the reviewed UI bytes. Source closure, CodeQA, native/device evidence and Owner acceptance remain separate. **SOURCE ONLY / PUBLIC DELIVERY HOLD / DEVICE_NOT_TESTED.** Owner APK7 FAIL, full parity unfinished, swipe admission paused and future-only drafts remain unchanged. No APK/full parity/OTA/iOS done claim, merge, deploy or publication. No new source SHA is claimed: this export has no usable Git history.

---

# #522 Radar — focused R2/R3 + actual test typing correction

Admitted base: `fd392ea892babcb0810504531d78526de4c6902d`; Root capsule `7614552b203bbad6891dd1a30cfa8e8f11a1c79ff5ce3d4cb664dd068ea3231d`. Actual owning parent `4adb94f25e4e1b07f95b14c5c691e5370a47a1afbef37acb8d8fe44ac1e693b7` remains FAIL (test TypeScript). Final Astra review `dc6dda91309abaa2c24a6e12662fc7786635014e0d5b907c856900b98188ac44` closed R1/R4/R5 and retained these two P2; this correction awaits independent acceptance. Private export has no usable Git metadata; no new source SHA is claimed.

R2 source: compact Header/map Radar is glyph/progress/attention only with an exact 48x48 touch area. Status caption remains in the accessible label and existing management dialog; the accepted noncompact Players text/switch and enable-only feedback remain.

R3 source: collapsed person inspection contains only the fresh preview avatar/name/level/trainer/approximate-distance row and expand arrow. Expansion reads authorized detail through the existing scoped `auth.players.loadDetail(peer,true)` and renders the existing read-only PlayerProfile. The boolean isolates expected 404 from ordinary catalog clearing; it does not skip auth, privacy, generation, sequence or target validation. Unavailable/error detail shows the honest preview-only state. No guest fallback, cached private fallback or inferred public visibility. Owner/route/filter/query/selection/session/expiry checks reject retired responses, including replacement of the shared detail request. Contact/unavailable actions appear only expanded with fresh Radar capability; the existing explicit contact handler/proof fences remain unchanged and opening never sends a message. Existing sheet measurements and attribution clearance are unchanged; maps.test.ts is unchanged.

Actual test typing: fixture activation returns UnifiedActivation; invalid state/model are explicit unknown parser inputs. The preview-read assertion checks count, asserts the retrieved call exists and narrows its kind before payload assertions. Original 91 tests retain their assertions/meaning, with the public-detail prohibition updated to the explicitly admitted scoped read.

Author validation in this export: **94/94 PASS**, zero skips/cancellations, across radar/contact/auth/maps/native-contract. Added checks cover compact/expanded composition, genuine PlayersCoordinator hidden-404 catalog isolation, authorized detail, wrong target, selection/scope retirement, competing detail and expiry. Full TypeScript/lint/Expo exports are NOT_RUN here: dependencies/compiler are absent; no installation/resolution. Prior parent 91 units/lint/two exports/archive PASS and unchanged API/DB80 are retained supplied evidence, not fresh checks. First cumulative Code QA remains pending the actual normal parent PASS and must review 907de013 through the new cumulative candidate, including Location lock and UI5.

**SOURCE ONLY / PUBLIC DELIVERY HOLD.** Native visual/device fit and Owner UAT remain NOT_TESTED; Owner APK7 FAIL is retained. Radar upcomingGames projection still drops games to []: populated upcoming-game parity remains mandatory OPEN. Real swipe/mutual flow, UGC and full native parity remain unfinished. No build, signing, install, merge, deploy, APK/OTA or PROD publication. All previous README bytes/FAIL/UNKNOWN history follow unchanged as historical records.

---

# #522 Radar / Players — bounded UI5 source correction

Source base supplied for this export: `365ab6435dbd357f219b0a4a8591f8f6b48aef2d` (trusted generated Location lock child of model candidate `b4f1ed8b489f44d92bb735132fd801e9de66bf39`). Root capsule `36d43b5e` admits only the nine paths; actual static parent `d7099b37` FAIL and Astra UI5 `b7a728ea` remain historical evidence. This export has no usable Git metadata; no new candidate SHA is claimed here.

R1–R5 source changes: Players uses shared fullscreen NativeMap, floating labelled Back/filter capsules with measured status offset, top-right real Radar control, existing filter-sheet layer choices, and a measured floating white/lime/purple map action with list scroll reserve. Public venues still require no Radar consent. Real PlayerAvatar markers retain safe media fallback and selected-person identity. List/card activation opens an authorized proof-scoped inspection, including contact-denied peers; it does not use public-profile lookup. Inspection shows avatar/name/level/trainer/approximate distance and expands available information. Separate contact actions require row capability and fresh preview before the existing explicit proof composer; no message is sent by opening a card.

Radar glyph/progress/caption use authoritative ownership, finite effective authority and confirmed session expiry. The local second clock only renders UI; it cannot enable, publish, renew or request GPS. Enable-search feedback is plain accessible text in the list, still gated solely by the existing enabling episode. Venue and person sheets share mapControlBottom: measured outer height, actual compact/expanded bottom position and safe inset plus 8dp clearance. Owner revisions include route/city/filters/selection type+id/expanded/window/font scale/all insets and reject retired callbacks.

Actual parent repairs: native-api read dispatch explicitly narrows query/map before reading body, retaining transport/error semantics; fixture URLs use NodeURL; maps type imports are top-level. Native contract expectations now bind foreground-only expo-location 58.0.22 and exact rationale/false background/Always/motion/service/full-accuracy options, preserving unused-permission guards and stable AuthProvider/RadarProvider/MessagesOwner/MainNavigation/Stack ownership.

Author validation: 91/91 direct Node tests PASS across Radar, maps, native-contract and unchanged auth/contact suites. Five focused tests execute actual UI projections/callbacks and owner transitions; they are not native rendering evidence. Full mobile typecheck/lint are NOT_RUN here: dependencies/compiler are absent; no installation/resolution was performed. The earlier parent failures are addressed in source, not declared fresh parent PASS. Independent functional QA, separate Astra five-finding closure, mandatory CI/security checks and DEV acceptance remain pending. Old365 disposable-DB work is independent; no DB PASS is inferred.

**SOURCE ONLY / NO PUBLIC DELIVERY.** Native 360/390/S23, large font, safe areas, map attribution/gestures and binary evidence remain DEVICE_NOT_TESTED. Owner APK7 FAIL is retained. Mandatory real swipe/play-interest/mutual flow, UGC and full native parity remain unfinished; OTA compatibility and iOS signing/device gates remain open. No APK build, install, signing, merge, deploy, OTA or PROD publication was performed. Prior README bytes and all timeout/carryover/UNKNOWN history below are preserved.

---

# #522 C1c / RadarR2 — continuation source, PARTIAL / HOLD

Supplied source base: `907de013bca31775e7a2a28a5ff62a737edc000e`. This private export has no usable Git object history. The retained prior source delta was continued, not restarted; the previous timeout/HOLD receipt remains `b0cf2e7b81868c7af1f0a1cb38ef8b3a4c2a2c3e03186599cf3f6c3530f84c31`. No prior author PASS, candidate SHA or usage is inferred. VersionCode remains **8**. APK7 Owner UAT remains **FAIL**; full native parity/public delivery remain **HOLD**.

Prepared: one foreground Radar owner shared by Header/Players; explicit current disclosure consent; fresh/coarse location; unified list/map windows; lifecycle/expiry fences; immutable UNKNOWN; proof-bearing contact composer re-previewing the original reference. Ordinary contact retains its three-field body. People use server coarse positions on the existing MapLibre renderer/citypacks/venue layer.

Continuation fixes the four audience predicates in `unified-selection.ts`, `unified-origin.ts`, `unified-proof.ts` to accept exactly consumer_browser + consumer_native, preserving all other SQL fences. Safety receipt rereads retain explicit Radar context. Fresh preview may deny a new request while a validated existing conversation opens without sending. Owning integration fixtures include native/native and browser/native discovery, session/proof refusals, and zero conversation/message writes on denied proofs; these DB tests were NOT_RUN here.

**Confirmed contract limitation, outside the 31-file scope:** `ProfilesService.contactableTargets` and `MessagingService.assertContactEligible` require directory visibility for first contact, even with discoveryProof. Radar-only peers therefore return canRequestContact=false and remain unavailable for first contact. No permission bypass/service change was made. The native-messages fixture now preserves that refusal and tests successful proof contact with a directory-visible, eligible peer. Any requirement to contact Radar-only/private peers needs separate bounded server-policy review. This source is not end-to-end acceptance of that requirement.

Author checks: **78 passing tests** across direct Node mobile Radar (6), contact (20), auth/Header/runtime (36), and existing shared-map (16) suites. API security unit, disposable-DB integration, full typecheck/lint and contract tooling are NOT_RUN: this export has no node_modules/compiler. Independent QA, Product CI, generated native manifest inspection, signed Android binary/device evidence, and iOS signing/device checks remain NOT_TESTED. No network, install/resolution, DB, provider/model, build, signing, deploy or publication was performed.

expo-location is pinned exactly **58.0.22** using supplied SDK58.0.25 evidence. Only foreground permission is configured; Always/background/motion/foreground-service/full-accuracy options are explicitly false. Existing map plugin/assets/lock remain unchanged. Trusted resolver generates the lock after author terminal; app.json is not native manifest proof.

Swipe/play-interest/mutual and remaining #522 parity are separate mandatory unfinished slices. No APK/OTA/full-product/PROD completion is claimed.

---

# #522 R1b address4 — type-only ScrollView ref correction

Base: 4666b3e491f7f4656d055ccec8f72e9de2294103. Import React ComponentRef as a type and use useRef<ComponentRef<typeof ScrollView>>(null) for the instance; scrollTo/ref wiring is unchanged. Root TSC and changed-file lint are PENDING; no fresh TSC/lint, tests, exports, build or native PASS is claimed here.

ADDRESS3 parent 6cf91f7c remains historical FAIL (mobile TSC). Its 70 owning units, lint, two Expo exports and archive PASS are retained as history, subject to Root's exact outside-two-path/type-erasure proof. Astra closure eb654bd2 marks five findings FIXED_IN_SOURCE only, without device acceptance. Original Code FAIL 6aa3e46e and raw Astra review 4df8c864 remain unchanged; focused Code closure is PENDING.

Device/native scroll, map gestures, attribution and physical Back remain NOT_TESTED. Owner APK7 FAIL, mandatory real Header/Players Radar C1c OPEN P1 and source-continuation delivery/publication HOLD remain. No Owner GO or full parity claim. All prior README bytes follow unchanged.

# #522 R1b address3 — bounded source correction, DEVICE_NOT_TESTED

Base supplied: eabed0464493adab25c44d08f6e369e00768468e. This private export contains only the eight admitted source/document/test deltas. No build/signing, install/resolution, DB/network operation, metadata, merge, release or publication. Existing 11.5.1 dependency/lock reuse remains model f56bdafe9611b6224360cabf9ca83a1bd5966cd0 / generated 15f0796228fd5ef02a668988686f10a1f641ef33; lock SHA256 d69f0e8f732ad0d28c4ae2aa0f664259abb2119f902806ac86859232bb355f84.

Raw independent results remain OPEN, unmodified and not reclassified as PASS:
- FIRST R1b CodeQA FAIL: 6aa3e46e06a62a1a6cb86a64e83a2f131b938789130a8190529b51f3167b911f (two P2).
- Astra High UI source review: 4df8c864d889ca540932bc8b8d5ab1e76f8f1336a7fe6ce1ca43faa9df1c9037 (three P1, two P2). Compact source credit overlaps CodeQA: six unique material items.

Changes follow the accepted WEB 2a0b8207b8cc28d0e56a1ec5abecc604e934faed references supplied in the task: separate white Back/purple inset and labelled filter capsules; onLayout places status/error below their actual height. Expanded map-only venue content leads with a responsive 16:9 gallery, then description/identity/info/contacts. An explicit action opens the real venue-local date-grouped schedule; it does not append full Games cards to information. Standalone VenueDetail keeps its original presentation. Create stays expanded-only, outside body scrolling, in the existing typed auth/profile/create flow. Compact uses 12dp inset, rounded corners, 64/copy/44 geometry, 17/14/13 typography, a visible illustration badge and verified primary catalog-source link. Text may grow and the body remains scrollable. Expanded X collapses; compact X dismisses.

Outer-sheet onLayout supplies the actual obstruction plus safe-bottom anchoring to the real MapLibre attribution/compass positions. Context/selection/expansion generations fence late callbacks and reject stale measurements; no nominal 172dp clearance or replacement attribution overlay. Native renderer placement/readability is NOT_VERIFIED.

List return preserves the existing Stack route/resource/pages/cursor. Only a bookmark captured by that mounted list can request its real scroll offset; external map entry returns to safe /games, and query changes reject the old bookmark. No offset-driven page fetching or global store. Primary framework receipt 47009139f36a0d143988ff7a4b8dcb5fdfcb297b04a43394cf4432967921f6e8 is reducer/source evidence only; supplied probe was not executed. Pagination finding disposition remains OPEN_PENDING_FOCUSED_REVIEWER_ASSESSMENT, not false-positive/closed.

Self-checks: maps 16/16 and venues 7/7 passed, zero skips. They exercise the actual resource hook/cursor handler, second/third pages, end/error/abort/new-query, measured obstruction/callback fences, X handlers and timezone grouping. This is JS/source evidence only. Typecheck attempted: tsc not found; export:check attempted: expo not found. Cached dependencies are absent in this export; lint/typecheck/exports remain gates, with no installation attempted.

Next: Root fresh checks, focused CodeQA for the two Code P2 + five UI items (overlap explicit) and related eight-file delta; separate bounded Astra UI closure later. All earlier normal/HOLD/exact-recovery/parent FAIL/UNKNOWN history remains below unchanged. C1a whole FAIL e5e892a14c52db13f711e286b2c7964bf2d4c917752058e3bf62fbaf8f0fb825 retained. Real Header/Players Radar P1 C1c stays mandatory OPEN. Owner APK7 FAIL, full parity, device 360/390/large text/gestures/attribution/return, Radar, swipe, UGC, OTA and iOS remain unfinished. UAT=NOT_TESTED; no delivery or acceptance claim.

# #522 R1b address2 · TSC/marker source correction · delivery HOLD

Bounded author continuation from Root-bound candidate
`15f0796228fd5ef02a668988686f10a1f641ef33`. This private export has no
usable Git metadata. Only Games map, native-map, maps.test and this README
were edited. All prior 15f README bytes, including the historical 3214/5797-byte
prefixes, follow unchanged; historical qualifications below are not new results.

The actual ADDRESS1 parent `344aaa498e310b4a5105e9fd93bf928b2949aaf3149f20a07f710525c49dd9b3`
remains FAIL (mobile TSC). Its 132/132 units, lint, two Expo exports and archive
PASS remain historical. The original 17-minute author HOLD `2202ab79`, unchanged
Root recovery `14b63504`/README exception `34cce018`, normal ADDRESS1
`f56bdafe`/receipt `70ec9d75`, generated-lock receipt `0220bd25`, candidate 15f
and genuine lock `d69f0e8f` are retained, not replayed or reclassified.

GamesMap now owns a ComponentRef<typeof Pressable> ref attached to its real map
filter trigger and passes that same ref to DiscoverySheet for close-focus return.
The shared sheet contract is unchanged. Expo SHA-256 now receives an owned
ArrayBuffer copy of exactly the input view's bytes, including offset/shared views;
style hash-before-parse and resource rejection guards are unchanged. maps.test
uses the supported any-throw/message overload with the original URL diagnostic
and node:url URL for Node PathLike; all existing cases/assertions remain.

Manual SOURCE parity correction follows WEB2a venueMarkerPresentation,
GamesVenueMap, radar-geographic.css and NavIcon.shuttlecockElement: zero/unknown
use a white 44px circle with the exact purple 28px shuttlecock SVG path; unknown
keeps the honest unavailable label. Positive counts remain actual counts with
WEB Games lime/ink, white border and purple selection outline. No fake count or
new dependency/icon system; press/drag, coordinates, camera and generation owners
remain intact. This does not close a QA finding or prove native appearance.

Actual author self-check: Node 24.21.0 maps.test, 12/12 PASS, zero failed/skipped;
extracted owning digest checked against real Node SHA-256 for offset/shared and
empty inputs, owned buffer and mutation independence, PASS. These are author
checks only. No cached node_modules are available here; fresh full TSC/lint,
Expo checks, native build and independent QA were NOT_RUN. No install/resolution,
package/lock/config/versionCode8 change, build/sign/publication or DB operation.

Root must strictly reuse the genuine 11.5.1 package+lock+graph, create the new
archive and run fresh owning checks, then FIRST WHOLE independent R1b QA over
e29 -> final + Root lock, ALL19+lock (not focused QA). No independent R1b QA has
been called. Native basemap/tiles/glyphs/attribution/gesture/device gate:
NOT_TESTED. REAL Radar P1 stays OPEN; first whole C1a FAIL e5e892a1, Owner APK7
FAIL, unfinished full parity and source-continuation/publication HOLD remain.
No delivery/full C1a PASS, DEV acceptance or PROD authorization is claimed.

All prior 15f README bytes follow unchanged as historical evidence.

# #522 R1b address1 · recovered source correction · delivery HOLD

This bounded source continuation starts from recovered `e1892d8747e8778f98e7cb35b381f0e1fccd1104`,
not an original normal completion. The original 19-file author operation completed
its CLI turn but ended in operator `HOLD_NO_AUTOMATIC_REPLAY`; Root recovered those
bytes unchanged, with zero new model calls for that recovery. Its reviewed 5797-byte
README exception and all e189 README bytes remain the exact suffix below. This
address operation does not replay the original map implementation or erase history.

Addressed the supplied manual findings using the embedded exact package 11.5.1
declarations: Marker `lngLat`, Camera `initialViewState` center/zoom, `maxZoom`, flat
`[west,south,east,north]` maxBounds, NativeSyntheticEvent nativeEvent center/zoom,
and attribution corner offsets. Invalid camera updates are ignored, preserving the
last camera; selected-pack bounds, initial-camera validation, style/resource/hash/
absolute-PMTiles/attribution guards, marker drag and load-generation fences remain.

Games now uses the accepted WEB white bordered/shadowed capsule, lime 36px inset
and purple existing DiscoveryIcon map path. Shared icon geometry/defaults remain.
The compact sheet has a handle, close icon, 64px cover, identity/schedule and open
arrow, without generic text bars or expanded credits/gallery/conditions. Expanded
VenueContent retains real gallery/source credits and contacts; create stays in its
expanded-only safe-bottom footer. Existing query/route/scroll/Back, city/day/activity,
schedule-unavailable/UNKNOWN and actor rules are retained. Local WEB map/preview/
sheet components and styles were inspected; no final Astra gallery artifact was
available in this export. This is source composition, not visual/device acceptance.

Actual author self-check: Node 24.21.0 ran the five historical owning suites listed
below with `--test-isolation=none`: 66 tests, 66 passed, zero failed/skipped/cancelled.
All previous 65 tests/assertions remain; one pure native camera-event regression was
added for actual event shape, invalid/nonfinite/out-of-pack values and zoom limits.
This does not qualify source independently or prove native rendering.

FIRST WHOLE independent R1b QA is still required for cumulative e29 -> address-final
plus the trusted Root lock. No R1b QA/typecheck/native build has run here. Root owns
genuine dependency/lock/types/owning checks after this source cut; old 7d36 evidence
cannot qualify the new module. SDK 13.6.1 capability is documentary, not native
linkage/device proof. Hardware/emulator gate: NOT_TESTED. No deps/install/network,
lock/config/versionCode8/auth/native-intent/backend/permission changes, build/sign,
merge, deploy or publication were performed in this address scope.

Retained FIRST whole C1a FAIL: e5e892a14c52db13f711e286b2c7964bf2d4c917752058e3bf62fbaf8f0fb825.
REAL Radar Header/Players P1 remains OPEN for mandatory C1c; Owner APK7 UAT remains
FAIL and full parity is unfinished. This is neither focused-P2 closure nor full
C1a PASS. Public delivery/APK remains HOLD; PROD is not authorized.

All recovered e189 README bytes follow unchanged as historical evidence.

# #522 R1b · public native Games/venue map source candidate · delivery HOLD

Bounded source continuation from the supplied C1a working-source capsule:
base `e29cb616d7b73819e36c62fd74e27d65a56a5eb3`, capsule SHA-256
`1db023c43ed6fef86d2a89e5091a7735893527558fc57aab04ed16185408df55`.
This private export has no usable Git metadata; the base binding comes from the
Root-supplied immutable task, not a locally reconstructed receipt. The retained
FIRST whole C1a verdict is FAIL (`e5e892a14c52db13f711e286b2c7964bf2d4c917752058e3bf62fbaf8f0fb825`).
The supplied parent and focused two-P2 PASS permit this source continuation only.
REAL Header/Players Radar P1 remains OPEN for C1c. Owner APK7 UAT remains FAIL;
C1d swipe and remaining full parity remain mandatory. No full C1a PASS, delivery,
DEV acceptance, binary readiness or new Owner acceptance is claimed.

Source now declares only `@maplibre/maplibre-react-native` **11.5.1** and its Expo
config plugin. Map uses the actual named `Map` export, Camera and Marker; no
WebView, browser PMTiles protocol, canvas, image substitute, GPS request or Radar
activation is introduced. Closed Moscow/SPb/regional pack descriptors match the
accepted WEB catalog. The loader hashes the original response bytes before UTF-8
JSON parsing, then copies/adapts only approved in-pack resources. PMTiles remains
absolute `pmtiles://https://...`; glyph placeholders, sprite suffix bases, source
layers, attribution, bounds and zoom data survive adaptation. Load/error/timeout,
retry and a real venue-catalog fallback are wired; markers attach only following
the native load event. These are source paths, not evidence of tiles rendered.

A separate public-coordinate projection preserves the existing create catalog
`venues()` shape. Map data consumes all real venue/game cursor pages under one
abort/generation owner and frozen query time, deduplicates immutable IDs, proves
older aliases through the existing public venue endpoint, and applies WEB public/
published/availability/deadline/venue-local-day/activity eligibility. Partial or
failed schedules stay unavailable, never a verified zero. All/with-games layers
keep unknown schedules visible. Public venue coordinates must be finite EPSG4326
and bound to the selected city; out-of-pack pins are not plotted.

Games now accepts its bounded public query context, exposes the map pill, retains
list cursor/scroll ownership on push, and restores current city/day/activity/level
and offset on map-to-list return. Only exact `/games/map` hides global tabs. Exact
public Games map intents are adapted without changing verified callback ownership;
unsupported protocols, malformed contexts and arbitrary return destinations fail
back to Games. Back closes filters, expanded sheet, selection, then the origin
list. The shared renderer/helpers are reusable for future Players work.

The sheet reuses the existing safe venue gallery/body/contacts and filtered real
schedule. Its collapsed 64px-cover preview has no create/rate/discussion actions;
only expanded verified venue detail exposes explicit sticky typed venue-create
navigation, with a separately reserved safe bottom and scroll-body padding. No
automatic writes or global preference mutation were added. Venue ratings,
comments/discussion and other unfinished UGC are **absent and still mandatory**.
The standalone venue screen and existing auth/profile/create ownership remain.

Author deterministic self-check (Node 24.21.0, not independent QA): **65 tests
PASS**, zero failures/skips/cancellations in the final run:

```sh
node --experimental-strip-types --test --test-isolation=none \
  apps/mobile/test/maps.test.ts apps/mobile/test/public-api.test.ts \
  apps/mobile/test/venues.test.ts apps/mobile/test/compact-layout.test.ts \
  apps/mobile/test/auth.test.ts
```

The initial focused run found and repaired URL-encoded glyph placeholders; an
incorrect dedup expectation and the owning-callback test wrapper were also fixed.
All prior assertions in the owning suites remain. These tests cover resource
transforms/refusal/hash ordering, coordinates, cursor/abort/race behavior, unavailable
versus zero schedules, alias binding, query/list/scroll/Back callbacks, expanded-only
create intent and old auth/UNKNOWN fences. They do not render native components.

**Pending trusted checks:** there are no cached project dependencies in this
export. Typecheck, lint, Expo exports, the actual 11.5.1 Camera/Marker prop contract,
genuine generated lock/package graph, native linking, new standalone Android
binary, manifest inspection and independent source QA are NOT_TESTED here. A
read-only official documentation lookup failed DNS; no package installation,
network dependency resolution or handwritten lock was attempted. The verified
package export summary is not a substitute for checking the installed declarations.
Root must run the existing trusted lock/deps and binary route on this actual source
and address any reported binding/type errors before source qualification.

Device/emulator basemap tiles/glyphs/sprites/attribution, gestures, marker→sheet→game
return, compact safe areas/font scale, resource failure/retry and offline behavior
are **NOT_TESTED**. No hardware was accessed and no screenshot is offered as native
proof. iOS linking/device proof remains separate NOT_TESTED. No offline pack-download
promise is made. No DB/backend/schema/service, build/sign/DEV/publication/model call,
public APK or metadata release was performed. VersionCode **8**, app version/package,
permissions/intents/deep links and assets remain as supplied, apart from the exact
required plugin entry. Root owns genuine lock generation after this author cut;
`pnpm-lock.yaml` is untouched.

All previous README bytes follow unchanged as historical context.

# #522 C1a ADDRESS2 · PARTIAL source correction · public APK HOLD

The two P2 findings from the retained FIRST whole C1a QA are addressed in
source, pending independent focused closure of those two findings and related
delta. The FIRST whole QA remains FAIL (evidence SHA-256
`e5e892a14c52db13f711e286b2c7964bf2d4c917752058e3bf62fbaf8f0fb825`).
Its P1 for REAL Header/Players Radar remains OPEN for mandatory C1c and blocks
delivery/full shell acceptance. No fake or disabled Radar entry was added.
Owner APK7 UAT remains FAIL; publication HOLD and incomplete native parity remain.

GameCard now renders one composed settlementTerms paragraph, matching accepted
WEB2a: ordinary games show only supplied terms; trainer games show the agreed
external-payment wording plus those terms, without adding an amount or unit.
Existing settlementLabel consumers outside the card and their assertions remain.
Games city/date selectors now use proportional 45/55 flex weights with the
existing gap, minWidth, text scaling and focus/keyboard behavior. Filter/query,
pagination, async fencing, title navigation, data, rights and actions are unchanged.
Source geometry is not Android visual proof.

Author self-check: 30/30 tests PASS, zero failures/skips/cancellations, using
Node 24.21.0 from apps/mobile:
`node --experimental-strip-types --test --test-isolation=none
 test/presentation.test.ts test/public-api.test.ts test/compact-layout.test.ts
 test/native-contract.test.ts`.
Three pure formatter regressions cover ordinary, by-agreement and fixed-price
settlements; all previous meaningful assertions are retained. This is not
independent QA or a rendered-card/device check. Typecheck, lint and Expo exports
are unavailable in this private export without dependencies; none is claimed PASS.
No installation or package-manager download was attempted.

Only app/games/index.tsx, src/components/game-card.tsx, src/presentation.ts,
test/presentation.test.ts and this README are changed. VersionCode remains 8.
No API/dependency/config/metadata, DB, build, signing, binary, publication or native
device changes were made. No device/build/maps/Radar/swipe PASS is claimed;
native visual and Owner recheck are NOT_TESTED. Next: trusted Root fresh
typecheck/lint/owning units/exports, then independent focused two-P2/related-delta
review retaining OPEN P1; no second whole QA or completed-shell claim.

All previous README bytes follow unchanged.

# #522 C1a ADDRESS1 · source correction only · public APK HOLD

Bounded repair of supplied candidate
`3345057ef1213b5c2b4b046e465cecec0f965f34` in this private source export.
Pressable trigger/return refs and the sheet heading now use React ComponentRef
instance types. The discovery bounds return type exposes optional startsBefore
without changing date behavior. The existing async resource test reads fresh
getSnapshot results after load, preserving its exact item/cursor expectations
and every prior assertion.

Game titles open the real game through onOpen; title, details, trainer disclosure
and share remain separate interactive controls. Both ordinary and trainer cards
use the same organizer-left/actions-right footer. Only the trainer band shows
the unavailable reviews/role-history note; no reputation data or API is invented.
Existing public-link sharing, cancellation/error notice and copyable fallback stay.

Author verification: 50/50 existing tests PASS, no failures/skips/cancellations:
`node --experimental-strip-types --test --test-isolation=none
 test/public-api.test.ts test/presentation.test.ts test/auth.test.ts`
from apps/mobile using Node 24.21.0. This covers query bounds, stale page fencing,
refresh item/cursor replacement, factual roles, share eligibility and the existing
Header/profile-return behavior; it is not a rendered GameCard or focus test.
Typecheck/lint are unavailable in this export: no node_modules, tsc or eslint.
No installation or package-manager download attempted. The retained parent FAIL
was a typecheck failure, not an independent C1a QA failure. No new parent, QA,
device or visual PASS is claimed.

Changed files in this correction: app/games/index.tsx, src/components/ui.tsx,
src/presentation.ts, test/public-api.test.ts, src/components/game-card.tsx and
this README. src/public-api.ts needs no edit: its existing destructuring uses
the corrected bounds return type. All other source bytes and previous README
bytes are retained. VersionCode remains 8; no config/dependency/backend/API,
build/Expo/device, publication, merge, deployment or history changes performed.
Fresh parent checks and the FIRST whole cumulative independent C1a review remain
pending. Owner APK7 UAT FAIL/publication HOLD is retained; this correction's
native/UAT status is NOT_TESTED, and full native parity remains unfinished.

All previous README bytes follow unchanged.

# #522 C1a · source candidate only · public APK HOLD

Private export of the supplied venue ADDRESS2 base
`3233531b96e5a410744b448acf41643d810042aa`; there is no accessible Git history
here, so the export's base/new source SHA and current DEV receipt cannot be
independently verified or minted by this author. The embedded Root admission
and final design handoff PASS are supplied evidence, not a new source QA PASS.
Final audit `1df25ab5…`, implementation cuts `4757b22b…`, independent design
handoff `1264051c…` are the supplied design references; original receipt paths,
RootACK and remaining null admission bindings must be verified by trusted parent.
Actual WEB PNGs were not exported here; their embedded receipt and the final
HTML/CSS specifications were available, with no new visual evidence claimed.

C1a implements white Onest shell, real own-name initials/profile action, four-tab
geometry, Games hero → equal city/When selectors → actual create banner →
activity chips/compact filters → count/refresh/cards, and compact 46dp Players
avatars/cards with real profile navigation. Games selected day/activity use the
existing public query in the catalog city's timezone; filter changes get a fresh
resource/cursor and existing generation fences. Refresh replaces populated data.
Players areaKey reaches both existing public and native query ports; explicit
reset clears city/name/area/looking/trainer, preserving separate identity scopes.

The native filter Modal has explicit level choice, WEB skill copy/disclaimer,
Back dismissal and trigger focus restoration wiring. Level filters only the loaded
upcoming list using exact ntrp v1 membership, never profile prefill/write or a
server level query. Raw pagination stays intact; counts show `+` for nextCursor
and loaded totals when level is active, including zero-match paging/reset.
Game roles remain separate factual trainer/organizer bands; available organizer
media uses the existing URL policy. Reviews/history are explicitly unavailable,
with no clickable placeholder, invented score or stock cover.

Author checks: 128 named tests PASS, zero failures/skips/cancellations with Node
24.21.0 `--experimental-strip-types --test --test-isolation=none` over
`public-api`, `players`, `presentation`, `compact-layout`, `auth`, `contact`,
`messages`, `safety`, `native-contract`, `upcoming` and `resource` test files.
Eight focused additions cover normalization/membership, local zero/count/reset,
city/DST boundaries, actual query mapping, cursor/generation/refresh, area mapping/
reset/fencing and role facts. The required Header test still invokes the actual
avatar handler and profile save/return; all original refusal/zero-write assertions
remain. Earlier 56-test and final affected/readonly 72-test author runs also passed.
Mobile/API typecheck and affected lint are BLOCKED: no node_modules/tsc/eslint;
pnpm's Corepack shim attempted an unavailable pnpm download (EAI_AGAIN). No package
was installed; no further download attempted. These are NOT typecheck/lint passes.

VersionCode remains **8**, with app.json and native-contract.test.ts unchanged.
C1b real shared maps/venue map, C1c unified Radar and C1d actual swipe/receipt-backed
mutual match remain mandatory before a public repaired binary. No map/Radar/swipe
placeholder control is exposed. Full profile/media, role reviews/history and all
remaining accepted parity, native 360/390 ordinary/trainer/Players + long-text/
fontScale/keyboard/Back/TalkBack evidence, independent QA, Product/security CI,
DEV acceptance/smoke, signed OTA and iOS gates remain pending. APK7 Owner UAT
**FAIL** is retained; this source candidate's native/UAT checks are **NOT_TESTED**.
No provider, build, DB, push, merge, install, deploy or public APK action performed.

Exact changed paths (16, within the 17-path allowlist):

```text
apps/mobile/src/theme.ts
apps/mobile/src/components/ui.tsx
apps/mobile/src/components/main-navigation.tsx
apps/mobile/src/components/game-card.tsx
apps/mobile/src/components/player-card.tsx
apps/mobile/src/components/discovery-icon.tsx
apps/mobile/app/games/index.tsx
apps/mobile/app/players/index.tsx
apps/mobile/src/public-api.ts
apps/mobile/src/players.ts
apps/mobile/src/presentation.ts
apps/mobile/test/public-api.test.ts
apps/mobile/test/players.test.ts
apps/mobile/test/presentation.test.ts
apps/mobile/test/auth.test.ts
apps/mobile/README.md
```

All prior README content/history follows unchanged.

# #522 native venue ADDRESS2 · SOURCE_CANDIDATE · PARTIAL

Three-finding source repair on `7ca526e29678d36af09cbe88f73939d0914d3159`:
Continue now resumes the ordinary mount without reload/reset using actor/session,
context-generation and observed search-city fences; explicit city changes reload.
Failed catalog/network selection retains prior ready form/preview and reports a
retry notice; authoritative invalid/setup still blocks writes. Header preserves
only the exact typed venue-create return alongside its previous game returns.
No automatic selection/create/publish/reconcile or global city/preferences writes.

Author offline owning units: 66 passed, zero failures/skips/cancellations in the
final game-management/auth runs, including actual CTA + ordinary mount/effect and
Header → profile save → typed return handlers. Initial new regressions exposed
two fixture errors (catalog city and incomplete own-profile DTO/cities mock),
corrected before these final runs. This is author verification, not independent QA.
No dependencies installed; fresh parent checks and focused independent closure of
three findings/related delta remain pending; no second whole-review claim.

First whole venue QA FAIL `d142c4a31a85c981da3293d60e51f160efa34be61b032c54faed892d23adecae`,
parent PASS `00927510229e3a7ecefb0c523b8bcc5ee45e6036bbec3fbb88d322907c132b10`
(85 units), two completed venue source runs, V1 e18/address1 cancellation closure,
manual FAIL `a352e4e586281723d73088bca2b47cd6949611d2deeb2c1cbfc29cf4be84493d`
and all prior backend/safety/FAIL/UNKNOWN history remain retained below/in supplied
evidence. Accepted DEV alpha.92 `2a0b8207b8cc28d0e56a1ec5abecc604e934faed`
is unchanged. Owner APK7 visual/function FAIL (different UI, maps/swipe missing)
and S23 FAIL remain; Astra alignment is pending. No redesign, APK8 build,
metadata93, publication or deploy. Native visual NOT_VERIFIED; full native parity,
signed OTA and iOS remain mandatory and unfinished. UAT NOT_TESTED for this repair.
All prior README bytes/history follow unchanged.

# #522 native venue ADDRESS1 · SOURCE_CANDIDATE · PARTIAL

Bounded cancellation repair on `e18d7dec9afba0a9687ce42890ce90dcef868216`.
Venue context is read locally and committed only for the current actor/session/view,
unchanged form/preview and latest selection. Leaving a pending selection preserves
the mounted ordinary form's usable context, draft and preview without focus reload.
Later edits, created references and immutable UNKNOWN packets remain protected;
no automatic create/publish/reconcile or global city/preferences writes.

Author offline: 30 owning unit checks completed; the final four focused regressions
have zero failures/skips/cancellations and execute actual component hook wiring.
A focused added check first failed on an incorrect published-state fixture expectation;
its existing authoritative detail refresh returns draft v7. That assertion is corrected.
Original normal source receipt `17617a1d…` / RootOBS `656cc0a6…` and manual P2 FAIL
`a352e4e5…` are retained; that manual check is not independent QA. Original first
parent and independent QA remain unrun; final cumulative review remains pending.
Accepted DEV alpha.92 is unchanged. Source PARTIAL; S23 Owner FAIL retained;
native visual NOT_VERIFIED; full parity, signed OTA and iOS remain unfinished.
All prior README bytes/history follow unchanged.

# #522 native venue detail/schedule · SOURCE_CANDIDATE · PARTIAL

Based on actual accepted alpha.92 source `2a0b8207b8cc28d0e56a1ec5abecc604e934faed`.
Native versionName/package/owned signing identity remain unchanged; versionCode
7 → 8 is the exact admitted literal-only source bump, not a built or accepted APK8.

- Native game → public venue facts/gallery/public contacts/credited sources →
  upcoming public schedule → native game. The fixed create footer uses the exact
  local `/games/create/venue/<UUID>` intent; no additional tab or browser screen.
- Venue identity/city/timezone and allowlisted projections are validated. Optional
  older fields remain absent honestly. Media uses only accepted venue-cover PNGs;
  ordered max8 and attributed legacy covers retain photo/logo/illustration labels.
  Pure accepted WEB authority/contact/credit rules precede explicit native linking.
- Schedule freezes refresh scope/time, proves distinct older aliases through real
  public venue reads, preserves cursors through filtered/expired-empty pages,
  deduplicates, rejects loops and fences stale reads. Existing foreground expiry
  removes started cards; schedule failure leaves venue facts usable.
- Selection requires an explicit press and authoritative catalog/timezone match in
  the venue's local city. Existing fields survive switching and stale preview is
  invalidated only on validated selection. Existing created references and UNKNOWN
  packets remain in their reconciliation UI. Auth/profile returns preserve the
  exact typed intent; no mount/login/return creates, publishes or reconciles.

Author offline owning checks: **71 passed, 0 failed/skipped/cancelled** across
venues/public-api/game-management/auth. The first run retained a FAIL from the
old static profile-return expectation; it was adapted to check the new typed
return and existing generic fallback. Verified begin/callback/restart/cancel return
and zero auto-writes, catalog selection, UNKNOWN preservation, aliases, paging,
expiry, stale responses, contacts/media/credits. Node 24 used
`--experimental-strip-types --test --test-isolation=none` with these four files.
No dependencies were installed. Types/lint/Expo2, independent QA, Product CI7,
DEV/readback, APK build/sign/publication and device checks remain Root-owned and
have not run for this candidate. No network/GitHub/provider/DB/runtime action.

Actual safety facts remain separate: source `8cb33c634cb0f840ae3f2dc9f7ad330cda9057dc`,
four completed author runs (not four different authors), retained whole FAIL plus
focused closure PASS; Product CI `43654442331`; DEV `0.1.0-alpha.92` accepted
`2026-11-15T00:10:09Z`, release `r43655345631-a1`; public owned binary `0.1.0`/7.
The platform SOURCE-now matrix reconciles only the supplied actual summary.

PARTIAL; Owner FAIL_RECHECK_PENDING and prior Samsung S23 FAIL retained;
native visual NOT_VERIFIED; physical venue journey NOT_TESTED;
full native parity MANDATORY_NOT_COMPLETE; real signed OTA and iOS NOT_DONE.
Maps/Radar/friendly matches/friends/ratings/comments/reviews/uploads/venue creation
and remaining #522 parity are unfinished. PROD is not authorized.
All previous README bytes/history are preserved verbatim below.

# #522 native safety ADDRESS3 · SOURCE_CANDIDATE · PARTIAL

Bounded repair on C3 `c78caf422480483e8674d18f0c1e967b748eaa88`.
C3 parent remains FAIL (`410c86d8028a17290ffcfff02fd47bdddd3002330cad7317e739927f919a9ece`):
mobile TS2769 at the owning safety test; its 85 units/lint/Expo/archive PASS and
retained API 8/contracts evidence are historical, not rerun here. The owning test
now imports genuine Node URL, retaining runtime assertions. Root manual related
findings `2d898512af306be945dd92cf0e04ab315480908df59860cb7835ab1d79a13927` and
controlled private404 repro `f616b537819d35f7bf4b441fb663b6a173c766edc7197424be1d6cbe05023e89`
are addressed as source findings, not independent QA.

- Explicit safety replay finishes the original immutable command, retains its
  receipt as history and invokes separate read-only contact/messages/players
  authority reads. It never applies a historical relationship fence or claims a
  current block/unblock. Fresh verified first-action fences remain.
- Authoritative safety-only 401/403/404 hides private message DTOs and invalidates
  stale reads/results while retaining actor-owned UNKNOWN packets and drafts.
  Network failures retain still-authorized history. Authorized same-owner reads
  recover the view; only explicit original-packet reconciliation retries a write.
  Ordinary HOLD, bounded/coalesced GETs and actor/session/focus/logout fences remain.

Author-only Node 24 owning run: 63/64 passed; the new recovery test's malformed
mock send receipt failed. After correcting that test fixture, targeted followup
passed 3/3 (recovery plus added stale replay/denial boundaries); the other 63
accepted checks are reused. Logs retain the failure. No dependency resolution,
TypeScript/lint/Expo, CI, independent QA, device/build, DB or runtime checks ran here.
No focused C3 QA ran; Root fresh mobile checks and focused independent original
three plus related-delta/manual/type closure remain pending, not a second whole QA.

Three prior source runs, manual/protection evidence, first whole FAIL
`6821f5f535d89ab13d015b3de0af0c622ad113ee7bd2bb79ad672cb3600adea6` and C2 parent
PASS `cc0f8c81b4b0b52713bfa7d320ac23c07423be7a02a6b54a151abde18087dec5` remain retained.
Wrapper PARTIAL; full parity MANDATORY_NOT_COMPLETE; Owner FAIL / S23 FAIL;
native visual NOT_VERIFIED; iOS/real OTA unfinished. Accepted DEV
`53eafa4cd7013993a4be016c5bf87ee209cae4c3` and app code 7 remain unchanged.
Only seven admitted paths change; all other export bytes and every earlier README
byte remain intact. No GitHub/CI/merge/deploy/PROD/runtime action; Root ACK pending.

# #522 native safety ADDRESS2 · SOURCE_CANDIDATE · PARTIAL

Bounded author repair on supplied C2 `210537db62fad94455ac8b84bd60a778d8aa8d5f`.
The first independent whole safety QA remains **FAIL** (one P1, two P2), evidence
SHA-256 `6821f5f535d89ab13d015b3de0af0c622ad113ee7bd2bb79ad672cb3600adea6`.
This note records an author candidate for focused three-finding/related-delta review,
not a second whole review, independent QA PASS or release acceptance.

- A validated player URL exposes explicit «Снять мою блокировку» even after cold
  startup with no local receipt, profile 404 and no DM. The fallback person label is
  neutral «Игрок»; 404 never proves existence or block state. Opening/confirmation
  selection does not write; only explicit submission uses the existing DELETE and
  server rights/idempotency. Invalid route/focus identifiers are rejected safely.
- Same-owner reauthentication retains lastBlocks only as action history. It never
  reapplies those receipts as peer fences or current UI send gates. Current verified
  action fences still apply; reopened profile/contact/direct views use existing
  authoritative reads. No block-state endpoint or inferred state is introduced.
  Original UNKNOWN packets and the unsent form/focus restoration fix are retained.
- Verified safety events grant one bounded GET-only reread of inbox/counts and the
  exact affected direct detail even while any original message packet is UNKNOWN.
  Occupied lanes coalesce and then issue a fresh followup; actor/session, view,
  foreground, peer and request fences reject stale results. Ordinary polling/read
  HOLD remains. Packets/key/body, drafts and loaded history survive; no automatic
  resend, inbox deletion, friendship or pending-request restoration is fabricated.

Author-only deterministic owning units: **61 passed, 0 failed/skipped/cancelled**
(29 auth, 24 messages, 8 safety), including the existing 53 tests and eight added
regressions. Run with Node 24.21.0:
`node --experimental-strip-types --test --test-isolation=none apps/mobile/test/safety.test.ts apps/mobile/test/messages.test.ts apps/mobile/test/auth.test.ts`.
Mock transport exercises actual NativeApi/AuthCoordinator GET/DELETE handling and
changed message views during UNKNOWN; coordinator tests cover occupied-lane
followups and stale responses. UI source wiring is checked without React/native
rendering. These units do not constitute TypeScript, independent QA, device, build,
CI, DB, smoke or runtime evidence. Dependencies were not resolved or installed.

Both completed normal safety source runs remain retained, including ADDRESS1
receipt `bb2896f89b7aead0dbf9b0f90d6731400ac2d057f43dc8219f08556972559d15`.
Prior parent PASS `cc0f8c81b4b0b52713bfa7d320ac23c07423be7a02a6b54a151abde18087dec5`
(77 native / 8 DB source evidence) is retained, not rerun or relabelled.
Root manual precheck `be5237f9c37aa51e62a0891c4fd1a6a6f2a356b61e7ab4282f542e02b9bd15a8`
and protection `ef0b41cb2b41b23500de6592e0f1efc2f36cb45966866ad982de5c15e975c38d`
remain distinct from independent QA FAIL. Historical contact qualification and
FAIL/UNKNOWN/cost history remain. Root's fresh mobile-only checks and focused
independent three-finding/related-delta review are still pending.

Source wrapper remains PARTIAL; full native parity is MANDATORY_NOT_COMPLETE,
Owner FAIL / S23 FAIL remain, native visual is NOT_VERIFIED, iOS/real OTA unfinished.
Accepted DEV `53eafa4cd7013993a4be016c5bf87ee209cae4c3` is unchanged. Existing
code-7 build preparations remain ineligible; no new APK/device/build/source-whole
PASS is claimed. No GitHub/CI/deploy/PROD/runtime operations were performed.
Only the nine admitted mobile paths change; API/contracts, fixture, app version,
dependencies/assets and all other supplied export bytes remain untouched.
Every earlier README byte follows as an unchanged suffix.

# #522 native safety ADDRESS1 · 2026-11-14 · SOURCE_CANDIDATE

Addresses retained Root manual P2 SAFETY-UNSENT-REAUTH-FOCUS on supplied source
`e3ee70846e00f24d07b1c4772712c826768707ee`: same-owner verified reauthentication
followed by the same mounted screen's focus/open retains unsent detail/reason/dialog.
Each open still advances the view fence and clears message selection/sharing consent;
account B and explicit logout erase private form state. No automatic send, disk draft
or process-death restoration is added; UNKNOWN packets/reconciliation remain unchanged.

Two added regressions failed before the fix. Author-only Node 24 owning units then
passed **33 tests (27 auth + 6 safety), 0 failures/skips**, using mocked transport:
`node --experimental-strip-types --test --test-isolation=none apps/mobile/test/safety.test.ts apps/mobile/test/auth.test.ts`.
This includes real AuthCoordinator validation/login plus the mounted screen's status-driven
focus cleanup/open sequence; it is not React/native rendering or device evidence.
No parent checks or independent QA have run. DB, CI, builds and DEV acceptance are
NOT_TESTED here; supplied accepted DEV `53eafa4cd7013993a4be016c5bf87ee209cae4c3`
is unchanged. Full native parity remains UNFINISHED, Owner FAIL / S23 FAIL remain,
and native visual status remains NOT_VERIFIED. All earlier README bytes follow intact.

# #522 native communication safety · SOURCE_CANDIDATE

Bounded private-export source candidate on actual accepted alpha91 base
`53eafa4cd7013993a4be016c5bf87ee209cae4c3`, after the admitted owned APK6.
This source delta is NOT a DEV release, APK7 publication, independent QA PASS,
physical-phone acceptance or whole-native parity claim.

Native player profile and direct conversation now expose explicit block/unblock
confirmation naming the player, player reports, and reports of one explicitly
selected already-loaded live incoming message from the displayed peer. Message
sharing consent starts off and resets on selection/context changes. Exact reason
labels, optional trimmed/null detail (max 1000), Cancel/Back, native scrollable
modal/safe-area/keyboard controls and existing black-on-green CTAs are retained.
Opening, authentication, restoration, selection and refreshing never send a safety
command. Blocking does not cancel game participation or remove common game-chat
rights; unblocking does not restore ended friendship or closed pending requests.

The bounded Auth-owned safety coordinator freezes original actor/context/action,
method/path/body/key and retains uncertain commands across navigation. Verified
same-owner reauthentication restores quarantined state without replay; only an
informed explicit reconciliation sends the identical packet under current
verified authority. Logout/account B erase safety state and fence late callbacks.
Invalid receipts, network/timeout/5xx and COMMAND_IN_PROGRESS stay UNKNOWN. A
reconciliation denial also retains the original UNKNOWN. Block receipts bind
both target and boolean; report receipts validate actual ID/status/date without
inventing a target echo. No GET block state is invented: UI labels a retained
receipt as the last confirmed action, not fresh state after another operation.

Verified peer blocks fence stale contact/direct writes, including pending pre-wire
work and late callbacks after a later unblock. Existing Contact/Messages UNKNOWN
packets, drafts and accepted history survive that fence. Affected authorized
views reread through existing endpoints; no inbox deletion or privilege restoration
is fabricated. Target-profile safety 404 does not clear unrelated player rows.
Profile, Participation and GameManagement owners remain independent.

Only BlocksController PUT/DELETE and ReportsController POST opt into
requirePrincipalMutation; only their OpenAPI operation security fields add
cookieSession/NativeBearer. Existing cookie Origin/CSRF, services, idempotency and
receipts remain unchanged. NativeApi adds closed PUT/safety projections only:
no arbitrary URL/method, cookie/Origin, automatic private text or evidenceRefs.
API contract remains 0.44.0; schema inventory remains 72. app.json changes only
versionCode 6 -> 7, with only the matching expected literal changed in the native
contract test. VersionName 0.1.0, package ru.gobadminton.mobile.dev, dependencies,
assets, configuration flags and existing native registry remain unchanged.

Author deterministic verification: safety 5, contact 16, messages 20 and auth 26
unit cases passed with Node 24.21.0, mocked fetch and no network/device execution.
The first author run exposed unsupported strip-only parameter properties; these
were replaced with ordinary fields. The new root fixture initially missed the
history query string and was corrected; final owning runs pass. All old tests,
assertions and prior README bytes remain intact. Existing isolated self-migrating
native Messages DB fixture gains two focused safety cases for the three routes,
transport containment, cookie guards, idempotency, block/send/history privacy,
player reports and authoritative consent-bound message reports. DB fixture
execution is NOT_DONE by author; no new harness/environment was introduced.

Parent-owned types/lint/contracts, owning DB, Expo exports, independent QA,
Product CI7, DEV acceptance/readback, APK7 build/signing/publication and physical
Android keyboard/Back/safe-area/font-scale/block/report recheck remain NOT_DONE.
Owner_UAT=FAIL_RECHECK_PENDING; native_runtime_visual=NOT_VERIFIED;
full_native_parity=MANDATORY_NOT_COMPLETE; iOS and real OTA remain NOT_DONE.
Game-member safety, venue reports and remaining native parity are mandatory
unfinished scope. No runtime, GitHub, DB, dependency resolution, build, signing,
publishing or live actions were performed by this author.

Retained qualification is the first whole contact FAIL plus focused two-P2 PASS,
not a whole-source PASS. Four normal source receipt lineages remain:

- First contact: 2407a0867a65dca4b56d13e54d7f76ec4a460713907c0fb5d1f6998937cecc3e.
- ADDRESS1: 3dde4144a24103b2265c3ea2ca6bbb4b86da8d7a1a4e85a3badf074e7f51844a.
- ADDRESS2: d44256ec6b989854993fb24c8f803c7dc19ed85674e34999774923c2cfe644f8.
- ADDRESS3 P2: 88e17937d55ad1706b74e18fcd81782e10f46230e4e43b388aeb0570f020c66d.

Raw Owner FAIL, costs, historical UNKNOWN and all earlier qualification/release
limitations are preserved. Every previous README byte follows verbatim as history.

---

# #522 CONTACT ADDRESS3 · two P2 source repairs

This bounded author delta addresses both P2 findings from the FIRST whole
independent review of base `b5b7328ab55d5f6effec16fc4444d0681abc09e5`.
Contact success receipts now reject `seq > conversation.lastMessageSeq` with
`MessagesError('invalid')`; equal sequences and older duplicate receipts remain
valid. HTTP 200 with an inconsistent receipt retains the original frozen UNKNOWN
packet, draft, key and body until explicit same-packet reconciliation succeeds.

The editor's draft/send/reconcile callbacks carry their rendered view generation.
Open, blur, authoritative actor changes and forget invalidate that generation;
typing and dispatch updates keep it stable so rapid current-screen input works.
Authoritative actor/session/peer fences, same-owner private unsent-draft quarantine,
immutable UNKNOWN packets and explicit reconciliation without auto-send remain.

Author offline verification: all 15 owning contact unit tests passed, including
real NativeApi HTTP 200 inconsistent-receipt/reconciliation and same-peer,
same-actor, same-session stale edit/send/reconcile regressions. Fetch is mocked;
no external network or device execution is claimed. Existing assertions remain.
Only the five admitted paths changed. Source versionCode 6 and the native registry,
API/contracts, DB/schema, dependencies and configuration are unchanged.

Immutable history remains retained, not replaced by this repair:

- Three prior normal source receipts: first contact
  `2407a0867a65dca4b56d13e54d7f76ec4a460713907c0fb5d1f6998937cecc3e`,
  ADDRESS1 `3dde4144a24103b2265c3ea2ca6bbb4b86da8d7a1a4e85a3badf074e7f51844a`,
  ADDRESS2 `d44256ec6b989854993fb24c8f803c7dc19ed85674e34999774923c2cfe644f8`.
- Manual Root precheck FAIL
  `8fb77611a1168cb1c0ed83bb6f891caf76ea76cf03f93980e45a11224d502ea7`;
  parent FAIL `44bca0364446541483d2e25c655b899d1265f00546fd548c0ff228315eae77fe`;
  qualified prior parent composite
  `c2d72c2f0a2c61c9158dc09fa56a678a0c4412219429aa2ba05ac82e60e1cd70`.
- FIRST whole independent QA: FAIL with two P2 findings,
  `8f44d703e99236c0325fc965cad31280bd49ce1f0e05381a6049a9c768f18d84`.

Fresh parent gates and focused independent QA of both findings plus related delta
are NOT_DONE. Parent must run fresh mobile TSC, affected lint, contact/auth/native-
contract units and both Expo exports, retaining unchanged API/contracts/DB6 evidence.
No new whole-source PASS is claimed. Build, signing, publication, device checks and
DEV acceptance are NOT_DONE here. Owner FAIL_RECHECK_PENDING, native visual
NOT_VERIFIED, unfinished mandatory full native parity and prior FAIL/UNKNOWN history
remain. Every previous README byte is preserved verbatim below as history.

---

# #522 CONTACT ADDRESS2 · test expectation and README history correction

The test-only anonymous case now follows the existing auth contract: without
Authorization, GET returns exactly 401; POST without Origin takes the cookie
mutation path and returns exactly 403 with code `ORIGIN_REJECTED`. All four
explicit malformed Authorization cases still require 401 on both selected routes;
mixed/disabled/revoked, cookie Origin/CSRF, message-count and other fixture checks
are unchanged. Production auth behavior is unchanged.

Current fixture SHA-256: `d46a6bf09f22b427460c44b385c65dc5a7c87d0f807356f1b410c1b3816a8cca`.
The older `04329fc9e9a0c4c9956199168bee5dca33125b96ede44dc24a5ebf9dc4434182`
and unchanged-fixture statement in ADDRESS1 below describe historical source only.
All previous README bytes are preserved verbatim below as history.

API typecheck and fixture lint are NOT_RUN here: project dependencies are absent;
no dependency resolution was attempted. Earlier supplied compiled-mobile evidence
remains earlier evidence. Root must fully read this fixture and README, bind the
new fixture hash, then run fresh API typecheck, fixture lint and the single owning
Messages DB fixture. The retained parent FAIL and manual Root findings remain
history; independent QA has not been called. Fresh DB PASS, phone/visual, build,
signing, native binary and DEV acceptance are not claimed. Source versionCode 6,
API 0.44.0, schema72 and registry1 remain unchanged; cumulative scope remains 18.

---

# #522 CONTACT ADDRESS1 · bounded source correction

FC-RETURN: both guest contact CTAs now retain `/messages/new/<peer>`. The native
return whitelist adds only that exact typed local route; old game/direct/game-chat/
invitation forms and malformed/encoded/query/hash/external path rejections remain.
Actual AuthCoordinator begin/callback and secure pending-login restart tests return
the selected peer only after verified identity, with zero automatic contact sends.

FC-DRAFT: unsent draft dictionaries and selected context are quarantined privately
under the original authoritative actorId, even without a command. Repeated null
boundaries hide private state; verified same-owner reauth/new session restores a
usable draft. Account B and explicit logout/forget erase it; stale reads/rendered
actions remain fenced. Existing UNKNOWN packets keep their original actor, key,
body and clientMessageId and require explicit same-packet reconciliation. Draft
retention is in-memory only, with no process-death/private-draft persistence claim.

Author offline checks: 35 named auth/contact units passed (24 auth, 11 contact),
including retained 503/invalid-receipt/UNKNOWN cases; focused reruns of the strengthened
real-login logout regression and four return/CTA checks also passed. Typecheck is NOT_RUN: this export
has no project node_modules or installed tsc; no dependency resolution was attempted.
Only the six admitted paths changed; cumulative source scope is 18, including
native-auth-protocol.ts. Source versionCode remains 6, with no version bump.

Root's retained two-finding precheck FAIL is not independent QA or a parent FAIL.
Parent gates, owning Messages DB fixture, first cumulative independent QA and DEV
acceptance remain pending with Root/trusted process. The owning fixture is unchanged
at SHA-256 `04329fc9e9a0c4c9956199168bee5dca33125b96ede44dc24a5ebf9dc4434182`.
Owner S23 FAIL_RECHECK_PENDING, native visual NOT_VERIFIED, mandatory unfinished full
native parity, unfinished iOS/OTA and all previous FAIL/UNKNOWN history remain.
All previous README bytes are preserved below as history.

---

# #522 CURRENT · native first-contact source candidate

This bounded source slice adds **Написать** on an existing native player profile,
a composer at `/messages/new/[publicPlayerId]`, explicit **Отправить**, and entry
into the existing `/messages/direct/[id]` thread. It reuses the accepted WEB
contact behavior and existing native inbox, conversation parser and thread UI.
Opening/reopening performs reads only. Authoritative contact state and matching
peer headers select existing accepted or legacy pending conversations. Ordinary
directory contact needs no friendship, mutual play interest, Radar proof or game
context; its exact body is `{targetPublicPlayerId,text,clientMessageId}`.

The separate root ContactCoordinator rechecks contact/player eligibility before
sending, prevents double taps, and keeps the frozen key/body/clientMessageId and
original actor on network, timeout, any 5xx, invalid receipt or in-progress UNKNOWN.
Explicit reconciliation uses that same packet under verified same-owner authority;
navigation/auth never sends automatically. Existing-conversation 409 races use
contact/header reads without a replacement message. Generation fences discard old
responses; logout/account B erase private pending/context. Profile, Participation,
GameManagement and Messages retain their own command owners and private states.

Only GET `/me/contact-state` and POST `/conversations/requests` gain the existing
native principal guards and explicit OpenAPI cookieSession/NativeBearer security.
Cookie Origin/CSRF, service rules, privacy, response projections, API 0.44.0,
contracts, dependencies and the existing native registry stay intact. The owning
`native-messages.foundation.test.ts` is extended; its other five closed-neighbor
tuples and assertions remain exact. Source Android versionCode and the existing
contract-test literal change only from 5 to 6; versionName remains 0.1.0.

Author source checks: 105 tests passed (8 contact, 21 auth, 17 Messages, 13 Profile,
14 Participation, 24 GameManagement, 8 native-contract). Exact config/test-literal,
OpenAPI full-document restoration, guard-only controller changes, unchanged
closed-neighbor assertions, pinned readonly references and lock were checked.
These are author checks, not independent QA. The DB fixture is **NOT_RUN** here:
Root must fully read the actual candidate and run that owning isolated fixture.
Typecheck/lint are **NOT_RUN**: this export has no installed TypeScript/ESLint or
project node_modules; no dependency resolution was performed.

This is a first-contact source handoff only. Independent QA, Product CI, DEV
acceptance, actual build/sign/publication and Owner UAT remain pending. Phone
keyboard, Back, compact layout, font scale and the device first-contact journey
are **NOT_VERIFIED**. Full native parity remains **MANDATORY_NOT_COMPLETE**;
swiper/deck, Давай сыграем, friendship/invitations and broader native parity remain
mandatory later. Owner S23 **FAIL_RECHECK_PENDING** and all prior FAIL/UNKNOWN and
cost history are preserved. Real OTA and iOS remain unfinished. No release,
acceptance, device parity or APK delivery is claimed by this source candidate.

---

# #522 CURRENT · native own profile name/city source candidate

Root-admitted base supplied with this task: `0104a264f0ae97b9639fd46ab0c10a91304d5a31`
(alpha.89). This private export has no accessible Git history; live admission,
release/readback/history seed and public APK4 proofs were supplied by Root and
were not independently reread by this author. All historical source, FAIL,
UNKNOWN, cost, metadata and Owner S23 FAIL records below remain preserved.

Existing `/profile` now edits the authoritative own social-profile name and
catalog city with explicit Save and Cancel. It uses the existing white shell,
Onest, safe-inset keyboard page, navigation and green CTA with black text. Empty
200 is editable; malformed required DTO/version is rejected. No account display
name/email fallback, automatic city/geolocation or search-city update is used.
Create setup links to this editor with the existing local `/games/create` return;
explicit return rereads readiness without creating, joining or publishing.
Existing direct owned/delegated draft publication still revalidates profile.

Only PATCH `/me/social-profile` gains `requirePrincipalMutation` and explicit
OpenAPI cookieSession/NativeBearer security. GET, visibility, server DTO/policies,
service code, API 0.44.0, schema72, auth/session/restriction code and the existing
enabled native registry remain unchanged. The native transport exposes one fixed
PATCH and projects exactly expectedVersion, trimmed nonblank displayName (max80)
and catalog cityId. Privacy, eligibility, visibility, contact/Radar consent,
looking intent, level, bio, area and identifiers are omitted from the payload;
completion grants no consent or activation. Cookie Origin/CSRF stays enforced.

A bounded root ProfileCoordinator owns the frozen key/body/original identity and
selected city label across route unmounts. Double taps cannot dispatch twice.
Network/5xx/invalid receipt/COMMAND_IN_PROGRESS remains UNKNOWN; unverified guests
see no private draft/packet. Only authoritative same-actor identity restores the
packet; explicit informed reconciliation uses the unchanged original key/body
with current authenticated authority. Logout and account B erase active and
quarantined private data; generation fences reject old completions. Stale409
blocks new edits/saves until explicit authoritative reread and review. Controlled
moderation rejection/unavailability keeps the form and neutral retry guidance.
Profile saves leave Participation, Messages and management packets/references
independent. No generic mutation framework or automatic write was introduced.

Android source versionCode changes **4 → 5** only; versionName **0.1.0**, package,
permissions/blockedPermissions, intent filters, callbacks, icons/assets/plugins
and the frozen dependency lock remain unchanged. The native-contract file differs
only by its mandated expected literal **4 → 5**. The legacy Messages fixture
changes only its closed PATCH neighbor to `/v1/me/game-preferences`, retaining
its `{}` payload, [401,403] containment and all other old assertions.

Actual author verification (Node 24.21.0, no dependency installation):

```sh
node --experimental-strip-types --test --test-isolation=none apps/mobile/test/profile.test.ts apps/mobile/test/auth.test.ts apps/mobile/test/game-management.test.ts apps/mobile/test/native-contract.test.ts
```

**61 named tests PASS, 0 FAIL, 0 skipped**, including the full unchanged
native-contract suite apart from its authorized version literal. This is author
selfcheck, not independent QA. Deterministic comparison confirms only the selected
OpenAPI operation security changes (including original absent security-field
presence); app.json, native-contract and legacy Messages match their exact
permitted substitutions. Lock SHA-256 remains
`7d36b3b79e8137012a3246e1ef0625298320eab10dd5b118a0017f15f17ad80a`.

The existing native-players fixture retains both prior cases and its fresh
loopback DB/migration guards, adding own save/read/replay/new-session replay,
conflict, authority, cookie Origin/CSRF, privacy/provenance/unknown-level
preservation, invalid city, moderated name and private-identity rejection checks.
**Both owning DB fixtures are NOT_TESTED here.** Root owns execution through the
existing disposable harness; no new DB, env variable, CI case or workflow is added.
Typecheck, lint and both Expo exports are **NOT_TESTED** (dependencies absent;
installation/resolution forbidden). Mandatory CI/security, independent QA,
binary build/sign/publication and DEV acceptance remain for the trusted process.
No alpha.90 receipt/source/date/APK URL or release-history acceptance is invented.

Physical phone rendering/keyboard/cancel/offline/account-switch flow and Owner
UAT remain **NOT_TESTED / FAIL_RECHECK_PENDING**; native visual **NOT_VERIFIED**.
Full native parity remains **MANDATORY_NOT_COMPLETE**. Photo/cover upload, crop
and moderation, accepted NTRP/pilot/none/keep/full-identity level guidance, bio,
area, privacy/Radar/looking/trainer controls and all other parity remain mandatory
unfinished. iOS and real OTA remain **NOT_DONE**. No device, store, PROD or full
parity acceptance is claimed. Source delivery is a candidate pending Root gates.

## Historical source/QA/harness lineage (preserved verbatim)

# #522 CURRENT · address3 source maintenance

Supplied actual address2 base: `b2af9342288449261b09d5d74993f78a70c3a451`.
Address1 `e5a7ca9784a658a99a0c6302a5288b4d0619d8b7` fixed same-owner UNKNOWN
quarantine while retaining the immutable command key/body. Type-only address2
`b2af9342288449261b09d5d74993f78a70c3a451` has actual mobile TSC and exact-file
lint **PASS**, per supplied receipt
`ba3d544f636e5089f019af96fcd03e4bf931324f86d702ab19b135401d32cf65`.
Retained evidence: **103/103 mobile units**, **2 Expo exports** (Android/iOS),
**4/4 management DB cases** and **2/2 Players DB cases**; not rerun by this author.

Positive native coverage for the selected **8** operations is retained, including
authorized private roster/confirm in the actual management cases. This static
legacy regression maintenance moves only two old negative sentinels to remaining
cookie-only neighbors: GET `/v1/me/discovery-preference` keeps **401** and POST
`/v1/games/:id/cancel` keeps **403**, bearer owner and `{ expectedVersion: 1 }`.
This avoids premature positive-confirm mutation before the unchanged browser
confirm, withdraw, capacity and version assertions. No earlier legacy runtime
failure is claimed; fresh legacy-fixture lint/DB verification remains for Root.

Independent whole-source QA (original B through address3, all four normal source
attempts), Product/security CI, build/APK4 and a new DEV release remain **NOT_DONE**;
delivery is **PARTIAL**, Owner UAT **FAIL_RECHECK_PENDING**, native visual
**NOT_VERIFIED**, full native parity **MANDATORY_NOT_COMPLETE**. Earlier FAIL,
UNKNOWN and attempt history remains preserved. Native 0.1.0/code4, API 0.44.0,
schema72, owned5208 and the existing enabled native registry remain unchanged.

## HISTORICAL original a366 source text — preserved verbatim below

The old **Known CI blocker** and check/status statements below describe original
`a366` source history; the CURRENT prefix above records subsequent evidence and
this repair. They are not current blocker or release claims.

---

# #522 native create/publish and game management · source candidate on accepted alpha.88

Bounded source work in the private export only, admitted base
`d8dcb45607fa99c79ec983c511fc569cc5897449`. This export has no accessible Git history;
base/strict release/APK3 evidence is supplied by Root, not locally reverified.
Android source versionCode **4**, versionName **0.1.0**, same package. No binary,
signing/certificate validation, registry, runtime configuration, OTA, deployment or
new application release receipt is claimed. Existing code3/APK3/alpha.88 history below
is frozen; Owner S23 UAT **FAIL_RECHECK_PENDING**, native visual **NOT_VERIFIED**.

`/games/create` uses authoritative OwnSocialProfile city/trainer context, game
preferences (including initial version 0), the manually selected city and paginated
canonical public venues with each selected venue's timezone. Missing profile/city
requires profile setup; native profile editing remains a mandatory follow-up, with
no invented profile write or inert setup CTA. Trainer data is read only when the own
profile says trainer; legitimate absent/inactive trainer permits ordinary games.
Strict calendar/DST/duration/future helpers are copied from accepted WEB without
web/DOM/server imports. External reservation is the accepted literal 0. The form
uses accepted format, visibility, NTRP range, contact and settlement labels.

Preview → explicit **Опубликовать** owns the normal draft-create → publish chain.
The separate root GameManagement owner keeps immutable keys/bodies and canonical
IDs/versions across navigation and UNKNOWN. Only explicit same-packet reconciliation
retries an uncertain command; reconciliation never auto-publishes. Same-owner auth
return retains only a known canonical game reference, clears form/contact/private
DTOs, and requires fresh reads and explicit publication. Logout removes the reference;
account/generation fences discard late responses. No new disk schema or auth-envelope
migration. Existing Messages/Participation owners and their UNKNOWN packets remain
independent. A published receipt allows an explicit new-game action.

`/games/manage/:id`, reachable from My Games, checks actual paginated `/me/games`
authority for creator owners or delegated noncreator managers before authorized
game/roster reads. Participant pagination, loading/empty/error, draft publication and
explicit confirm/reject/remove use current versions, reasons, rights and counts.
Revoked access removes private game/roster projections. Capacity editing/cancel are
unavailable, matching accepted WEB. Existing four-tab chrome and root owners remain.

Exactly **8** existing operations gain NativeBearer security and principal guards;
API remains **0.44.0**, 72 migrations unchanged. Browser Origin/CSRF, services, global
auth, default flags, locks and idempotency stay unchanged. Only the old Players closed
neighbor URL moves to `/me/discovery-preference`, retaining its exact 401 assertion.
All eight supplied operation preimage hashes match when only the security additions
are removed (game-preferences previously had explicit cookie-only security).

New `native-game-management.foundation.test.ts` owns a random
`native_game_management_*` loopback database through dedicated
`NATIVE_GAME_MANAGEMENT_TEST_DATABASE_URL` ending in `/postgres`, self-migrates and
gracefully drops only its owned DB. It uses synthetic OAuth/moderation and a distinct
synthetic fingerprint secret. The existing db-ci per-suite environment case passes
that variable only to this fixture and unsets it for every other fixture, preserving
the existing Messages case, reports and no-skips gates.

Author checks: earlier full mobile unit run **95/95 PASS**; after related repairs the
named game-management/auth/native-contract suites **36/36 PASS** (10 new management,
18 auth, 8 contract). Existing unchanged checks are reused. TypeScript strip-parser
checks passed for the new coordinator/DB fixture and changed auth/API clients; an
initial direct Node --check on the API CommonJS fixture could not parse its valid TS
inline type import and was replaced with the explicit TypeScript parser. This is
syntax checking, not typechecking. Contract structural rules: **276 operations PASS**;
Game/Friendship/Unified generated types unchanged; Admin protocol **56 operations
PASS**; `bash -n scripts/chatops/db-ci.sh` PASS. Author checks are not independent QA.

**Known CI blocker outside this allowlist:**
`apps/api/test/integration/native-participation.foundation.test.ts:104–105` still
expects native manager roster GET 401 and confirm POST 403 for an actual owner.
Those routes now intentionally opt in; their proper outcomes are authorized reads
and confirm. The file is not authorized for this pass and remains untouched.
Trusted Root must admit the exact stale-expectation repair before a full db-ci PASS
can be claimed. No production guard/test gate was weakened to satisfy old assertions.

**NOT_TESTED:** real DB fixture, API/contracts/mobile typecheck, changed-file lint,
Swagger validator, Expo Android/iOS exports, independent QA, Product/security CI,
DEV acceptance/smoke, device/auth lifecycle and visual QA. No dependencies are present
in this export; no install, download, Corepack resolution or provider call was made.
Full native parity remains **MANDATORY_NOT_COMPLETE**, with mandatory future work:
new venue creation and optional candidate photo; game cover/media/private court
booking; invitation create/revoke and contact initiation; full postgame/maps/Radar;
UGC/social preferences/moderation; signed OTA; iOS, physical device and App Links
acceptance. No stubs/inert controls or full-native/DONE claim.

Prior source, release, FAIL/rollback, UNKNOWN and paid-attempt history follows unchanged.

---

# #522 native Messages source candidate on accepted alpha.87

Source routes: `/messages`, `/messages/direct/:id`, `/messages/game/:id`,
`/messages/invitations/:id`. All four existing inbox kinds open native screens;
all/unread/attention, pagination/refresh, direct request decisions, text send,
older/catchup history, game members and invitation decisions use closed bearer APIs.
Main navigation follows the accepted WEB white bar, soft lime icon circle and
30×3 lime underline. Root Messages state keeps immutable UNKNOWN packets and drafts
across tab changes without resetting the existing participation owner. Retry is
explicit and reuses the exact packet; logout/access loss clears private state.
Focused foreground DM catches up every 3 seconds; game chats and inbox/counts refresh
every 15 seconds. Polling pauses on blur, background and any unresolved Messages
packet, retains loaded thread history/cursors, and never sends or retries commands.
Read mutations require incoming RN-viewable rows, focus, foreground and near-bottom.

Exactly 17 existing operations opt into native principals. Cookie Origin/CSRF,
Idempotency-Key, existing mutation services/locks and neighboring cookie-only routes
remain. GET invitation adds recipient-only pending acceptance context, including
current gameVersion and actual terms, without granting public/unlisted game access.
API stays 0.44.0; native versionName 0.1.0 / Android versionCode 3. No registry,
activation, signing, deployment, provider, dependency or migration change.

Author selfcheck: **77/77 mobile units PASS** (68 retained + 9 Messages/auth tests),
using `node --experimental-strip-types --test --test-isolation=none
apps/mobile/test/*.test.ts`. Author tests are not independent QA. The isolated DB
suite requires `RUN_DB_INTEGRATION=1` and a dedicated loopback admin
`NATIVE_MESSAGES_TEST_DATABASE_URL` ending in `/postgres`; it creates, self-migrates
and drops only a random `native_messages_*` database. It uses fake OAuth/moderation,
HTTP PKCE/session issuance and real service guards. **DB, typecheck, lint, contract
validator, Android/iOS bundles, device/auth smoke and runtime visual: NOT_TESTED**
in this dependency-free export. Root must run the owning gates and independent QA.
The contract-only Foundation rules found no errors across 276 operations; existing
Friendship/Game/Unified generated types verified unchanged; existing Admin protocol check passed (56 operations). Full Foundation static
check returned **FAIL** solely for omitted `AGENTS.md` files/references in this export;
no gate or missing source was reconstructed. No Git metadata is exposed here; canonical admission/alpha.87 acceptance are supplied
Root evidence, not locally reverified or replaced by a new release claim.

Source only. Full native parity remains MANDATORY_NOT_COMPLETE; new contact,
invitation create/revoke, hide/report/block/preferences/social-matched UI and the
remaining accepted WEB surfaces remain mandatory later slices. Existing DEV native
registry stays enabled; no activation replay. Owner Samsung S23 FAIL_RECHECK_PENDING,
native visual NOT_VERIFIED, prior FAIL/timeouts/UNKNOWN/cost evidence and all earlier
source/release history below remain unchanged. No phone PASS, fullnative or DONE claim.

---

## Current bounded #522 source on alpha.86 (2026-11-14)

Adds real native Игры → Игроки → Мои игры navigation, with Profile in the header;
`/players` and `/players/:publicPlayerId` use the current public projection, city/name/
looking/trainer filters, cursor pages, read retry and unavailable states. Auth and
participation owners remain above the Stack; authenticated icon entry waits for both
storage owners and skips intro. Only the two Players GETs gain native principal opt-in.
Android source `versionCode` is 2 (`versionName` remains 0.1.0); this is separate from
server alpha.86. No APK was patched, built or published here.

Author deterministic checks: 57 cases across the eight affected/related pure suites
passed using Node 24 directly (including preserved UNKNOWN/participation fences). Typecheck/lint/DB integration/Expo export/build/device visual:
NOT_TESTED (no dependencies in this private export). A typecheck invocation reached
Corepack's missing-pnpm download and failed DNS; no package was installed and no
retry was made. The new isolated DB suite self-migrates its fresh disposable CI DB.
Independent QA/CI/DEV acceptance remain the trusted parent's work. Samsung S23 Owner
UAT remains FAIL_RECHECK_PENDING; native rendering NOT_VERIFIED. Full parity remains
MANDATORY_NOT_COMPLETE: Messages, Players private actions, full MyGames management,
invites/recommendations/postgame, maps/Radar, UGC/updates and iOS remain mandatory.

Earlier passes and their historical status/evidence follow unchanged.

# #522 bounded Games → explicit application → My Games source candidate

This pass adds only native participation request, own pending/confirmed withdrawal,
all-page own participation reads and managed-game reads. Four existing API controller
operations opt into verified native principals; manager/applicant-list routes keep
cookie-only authority and browser mutations keep Origin/CSRF. Public catalog/detail
requests remain credential-free. Existing auth protocol, services, MutationRunner,
registry, flag defaults, migrations, dependencies, assets and release files are unchanged.

- Game detail rereads current public conditions and every own participation cursor page.
  Login returns to the same game without POST. A separate review and explicit confirmation
  sends expectedGameVersion and a random idempotency key. Pending does not reserve a place.
  Own pending/confirmed withdrawal reviews the action and sends expectedVersion.
- Root-owned participation state survives route unmount/navigation. Sending/UNKNOWN holds
  one frozen actor/session/game/participation/body/key packet; reads cannot replay it or
  create a new key. No unresolved retry is offered. Rereads may reveal pending/confirmed
  request or withdrawn result; otherwise the packet remains honestly unresolved and blocked.
  Unsent review intent stays with its game. Logout, account switch and authority loss clear
  private rows/commands; stale reads and callbacks cannot restore them. This route-state
  memory is not a durable offline command journal or a claim of process-kill recovery.
- `/my-games`, reachable in the existing product header, combines owner/manager projection
  from `/me/games` with applications, deduped by gameId. Real filters cover all, managed,
  applications, pending and confirmed. Existing native cards render actual available data;
  unavailable public details remain unavailable, including private/unlisted detail reads.
  Partial/failed cursor sources remain explicit and never become an empty list. Managed
  cards are read-only; organizer.id does not grant management. No fake management or chat.

Author selfchecks: `node --experimental-strip-types --test --test-isolation=none
apps/mobile/test/*.test.ts` — **47/47 PASS**, including 10 targeted participation tests
and all retained assertions. A focused initial run found incorrect 401 error classification;
it was corrected and the focused/full units passed. Final related auth/participation
rerun after session-fence hardening: **21/21 PASS**. OpenAPI JSON/source selfcheck
confirmed exactly four opt-ins, preserved cookie/manager boundaries and unchanged 0.44.0. API integration source uses fake OAuth
and the existing disposable PostGIS pattern; it is **NOT_TESTED** here. No `.git`,
node_modules, tsc or eslint is available in this export. No install/download/Corepack,
real DB/SMTP/DEV/provider/device/network call or baseline reconstruction was performed.
Parent must run actual API integration, contracts/security/Product CI, mobile typecheck,
lint/exports, independent QA, builds, DEV acceptance/smoke and release stage.

**Source only; no alpha86 release receipt.** Accepted server remains supplied
`fd9c4cfa2a14694fc6cf3d1f4d8b3f60c0a8d210` / alpha85 / API0.43; source native auth API0.44
and migration72 remain undeployed/disabled. Default native flag0; PROD unavailable.
Samsung S23 Owner FAIL / recheck pending and native visual NOT_VERIFIED remain.
Mandatory full Android-first/iOS parity is unfinished: management/create, invitations,
recommendations, postgame, Players/Messages, full discovery/date/filters/map, profile
editing/link/reauth, venues/Radar and other accepted surfaces still require later ports.
Actual Android/iOS binary, verified associations/provider lifecycle, store/OTA proof,
independent QA/CI and Owner device/UAT are not established by these unit tests.

All prior attempts, timeout/QA lineage and limitations are retained below as history.

---

# GoBadminton native #522 · current auth/profile SOURCE ONLY · 2026-11-14

This bounded candidate adds one persistent root AuthProvider/session coordinator,
system-browser PKCE sign-in source, real NativeMe/profile and owned-session lifecycle,
exact HTTPS callback handling and Android association source. It uses qualified backend
`05602db92f3c864d263218992d10963f2650d31b`; supplied Root focused security PASS closes the
two retained backend whole FAIL findings without deleting their history. **Not deployed,
not independently reviewed, not full product parity.** Native flag remains default0,
registry/live auth/PROD are unavailable. **Samsung S23 Owner FAIL remains; native visual
NOT_VERIFIED; full Android-first/iOS native parity MANDATORY_NOT_COMPLETE.**

Current working source destinations: optional intro, manual city, real upcoming public
games with pagination/errors/retry, direct public game conditions and `/profile`.
One canonical SVG replaces the separate product wordmark; E lockup remains intro only.
Header provides city/profile access and contextual Back. Card source now has overlay
activity badge when genuine media exists, actual available/total seats, Trainer before
Organizer, accepted arrow and user-initiated RN Share of the canonical public game URL.
Share cancellation/failure is honest; manual selectable URL fallback contains no current
queries. No fake photos, reputation, counts, application action or inert root tabs.

The coordinator stores refresh and version1 pending PKCE in SecureStore
`gobadminton.mobile.auth.v1`, never AsyncStorage; access remains in memory. Legacy city/
story preferences are unchanged. Unknown secure versions are preserved and fail closed.
There is no disk Me cache. Identity/session rows are exposed only for the exact verified
secure actor/session after durable refresh commit. Hydration has an allocated placeholder.
Refresh is singleflight; durable one-use consumption before dispatch means lost response,
process death or commit failure requires fresh sign-in. Generation fences cover callbacks,
rotation, private reads and serialized secure writes. Logout clears private memory at once,
queues secure clear and attempts one bounded remote revoke; remote/storage failure is
explicitly unconfirmed, with no persisted credential retry queue.

Sign-in requests truthful GET `/auth/methods`, then native `/transactions`; native default-off
returns unavailable and keeps the game intent. Only the exact Root-reviewed HTTPS tuple
`gobadminton-native-dev` / `https://dev.gobadminton.ru/auth/native/callback` is accepted.
Crypto is expo-crypto random32 + S256; callback checks unique code/state, expiry and pending
generation, and duplicate Linking/WebBrowser delivery exchanges once. Router native-intent
consumes callback before navigation; sanitized callback screen never reads credentials.
Native never calls browser bind/complete/cancel, sets Origin, adds cookies or bypasses guards.
Login returns to the SAME canonical game and rereads public conditions; zero auto-join/
apply/create. Current bearer operations are ONLY `/me` and owned sessions list/revoke/
revoke-others. Profile shows actual id-derived identity displayName/locale/linkedProviders
and session lifecycle, with no invented email/photo/edit capability.

Android exact-path autoVerify + source assetlinks use package `ru.gobadminton.mobile.dev`
and ONLY owned public SHA256
`5208faba0b474c6c94e4c237cbc345a10c7d3d0f5b3eb285ac8e271f9bd8c051`.
This is not live association/registry/signing/device verification. iOS Team/AASA is absent:
no fake entitlement or custom-scheme auth fallback; verified iOS callback runtime is HOLD.
The web callback fallback does not read/render/log raw URL/code and removes its query.
No credentials, providers, SMTP, live writes, browser/device actions or package downloads
were used by this author. The private export has no .git or dependencies; no source SHA,
commit, lock resolution, release, merge or DEV acceptance is claimed.

Dependency manifest only: Crypto ~58.0.8, SecureStore ~58.0.3, WebBrowser ~58.0.8; installed
baseline Linking58.0.17/Expo58.0.25/RN0.88.1/React19.3.0/Router58.0.31 retained. These new
ranges are supplied installed SDK compatibility, not exact resolved patches. Trusted
parent generates the lock and verifies binary integration. `@gobadminton/contracts/native-auth`
is a pure type-only subpath with typesVersions; root node:fs never enters mobile.
No expo-updates dependency/config/remote config/OTA implementation in this auth slice.
The mandatory next standard signed-update foundation, backward compatibility, four eventual
roots and scenario table are reconciled in `docs/platforms/IOS_ANDROID.md` and
`docs/integrations/AUTH.md`, retaining historical text. Owned service/account/trust readiness
is UNKNOWN; default disabled, embedded last-working fallback, next-natural-cold-launch-only
policy, no hot auth/form replacement. Owner same-binary signed OTA A→B proof is **NOT_DONE**.

## Current author checks and remaining gates

- PASS: Node24.21.0 dependency-free units, **37 named tests (26 retained + 11 new), 0 failures**:
  `node --experimental-strip-types --test --test-isolation=none apps/mobile/test/*.test.ts`.
  New tests cover RFC S256, exact/duplicate/expired callback, actual NativeMe wire fields,
  storage version/restart, singleflight rotation, lost exchange/refresh response, stale actor/
  logout/private completion, secure write ordering/failure and same-game return with zero mutation.
- PASS: direct deterministic JSON assertions for exact Android callback/package/owned certificate,
  absent fake iOS association, SDK58 manifest ranges, pure contracts export/typesVersions,
  and no expo-updates implementation. This is source consistency, not association/device proof.
- Initial new-test execution FAIL: Node strip-only rejected a TypeScript parameter property.
  Replaced it with an ordinary typed field; subsequent focused and full named tests PASS.
  This failed author attempt remains recorded; it was not a provider/model call or independent QA.
- NOT_TESTED: typecheck, lint, Expo Android/iOS exports, native builds, existing backend/security
  runtime suites, Product/security CI, DEV smoke and real auth lifecycle. No node_modules,
  tsc or eslint is installed here; installation/download/lock/SDK actions are forbidden.
- NOT_DONE: independent QA, CI, trusted generated lock, verified Android registration/sign-in/
  restart/logout, actual device visual/UAT. No ready/active/release claim follows unit PASS.

Mandatory concrete product gaps: working Players/My Games/Messages roots; game applications,
withdraw/organizer/create, full discovery date/filters/map; explicit bearer ports for each
private operation; profile edits/reauth/link/email/avatar; venues/maps/Radar; UGC/results and
remaining accepted consumer behavior. Card avatar and real role-reputation/history disclosure
are not ported; no invented replacement controls were added. Full card/disclosure/layout parity
and Samsung S23 recheck remain required. iOS Team/AASA/signing/macOS readiness, store compliance
and actual signed OTA service/A→B proof are external holds, not waived requirements.

Exact changed paths for this bounded client pass (22; no lock/backend/CI/OPS/old asset edits):

```text
apps/mobile/package.json
apps/mobile/app.json
apps/mobile/README.md
apps/mobile/app/_layout.tsx
apps/mobile/app/+native-intent.tsx
apps/mobile/app/auth/native/callback.tsx
apps/mobile/app/profile.tsx
apps/mobile/app/games/[id].tsx
apps/mobile/src/native-auth-protocol.ts
apps/mobile/src/native-api.ts
apps/mobile/src/auth-coordinator.ts
apps/mobile/src/auth-runtime.ts
apps/mobile/src/auth.tsx
apps/mobile/src/components/ui.tsx
apps/mobile/src/components/game-card.tsx
apps/mobile/src/components/discovery-icon.tsx
apps/mobile/test/auth.test.ts
packages/contracts/package.json
apps/web/public/.well-known/assetlinks.json
apps/web/src/app/auth/native/callback/page.tsx
docs/platforms/IOS_ANDROID.md
docs/integrations/AUTH.md
```

Repository instruction lookup found no root or scoped AGENTS.md in this private export.
Web fallback follows the supplied hash-pinned installed Next page guide; no unavailable
original worktree, baseline reconstruction, secret or live runtime was accessed.

## Historical source/QA/harness lineage (preserved below)

# GoBadminton native M1 · #522 · E «Траектория»

React Native + managed Expo Router foundation on accepted alpha84
`8bf111018170ae6200bbb56fa24ff2af9dc61c4a`. This source candidate implements
optional stories → manual city → public DEV games → public game conditions.
It is not a release receipt, independent QA result or device acceptance.

- Entry `/`: restores only story completion and selected city ID from AsyncStorage.
  Skip and Continue Guest immediately finish stories. Returning entry bypasses them.
- `/city`: actual GET city catalog, manual search and all available cities. Missing,
  removed and unsupported cities never select Moscow or request an unfiltered feed.
- `/games`: upcoming public city feed with explicit cursor pagination, retry and
  honest empty states. Every request sends the supported `startsFrom` lower bound;
  strict `startsAt > now` is reapplied on receipt, page merge and cached display.
  A local expiry timer and native foreground event remove games as they start,
  without polling the API. Empty loaded pages retain the server's next cursor.
  City selection remains reachable during every request state. Stale city,
  pagination and detail responses are fenced by request generation, even if abort
  is ignored by transport. Back from details preserves the mounted feed and city.
- `/games/[id]`: direct route without onboarding/city gating. Server 404/410, null
  or absent response becomes unavailable. Conditions show actual server values,
  including capacity, reservations, levels, trainer fees, deadlines and timezone.
  Formats use accepted discovery labels; levels use exact NTRP v1 half-steps or
  gb-social-pilot v1 labels. Unknown formats are omitted; unknown levels ask the
  organizer, without exposing internal IDs or guessing another scale/version.
  Trainer names use the simple «Тренер» label. Direct details may truthfully show
  completed games; the upcoming filter applies only to the catalog.
  No fabricated ratings, players, availability or results. Joining is explicitly
  unavailable; no authentication or mutation requests exist.

Only `https://dev.gobadminton.ru/v1` is configured. The adapter exposes GET `/meta`,
`/cities`, `/games?cityId=…&limit=20&startsFrom=…&cursor=…`, `/games/:id`; screens use the latter
three. Requests omit cookies and have no auth/Origin/CSRF headers. Meta is available
for trusted diagnostics; the UI does not block on it. No production endpoint,
location/Radar, provider login, private API, push, maps, media upload or store flow.
The development URL scheme provides route entry; HTTPS app/universal links are
**not verified or claimed**. DEV bundle/package identifiers are development-only.

E uses approved purple `#7945DE`, lime `#A7F447`, pure black `#000000` on every
primary label, including disabled with opacity 1. Approved assets are unchanged;
SHA-256 values are recorded in `assets/provenance.json`. `brand-mark.ts` is the
lossless XML string of `go-badminton.svg` for `react-native-svg`'s `SvgXml`, not a new
mark. The lockup has one accessibility label and Onest 700/500 text. Native launch
shell uses only the existing sign. The OS splash has a plain white background
(no advertising or timed wait); no replacement app icon has been drawn.

M1 targets phones only (`ios.supportsTablet: false`); no iPad layout is introduced.
Native safe areas, wrapping scalable text, scrolling below the bottom inset,
48-point minimum secondary targets and 52-point primary targets are used.
City entry supports the keyboard (iOS avoidance / Android resize). Artwork,
orbits and loading placeholders are static; Reduce Motion is read and subscribed
to. Actual Dynamic Type, font weight rendering, assistive readers, keyboard,
edge-to-edge, hardware Back and artwork decoding require native device checks.

## Dependency and validation handoff

The author is prohibited from network access and dependency installation. No
lockfile was manually edited. Trusted parent must resolve the exact manifest
pins and generate `pnpm-lock.yaml`, preserving app source hashes and recording a
receipt before frozen-lockfile CI can run. Mobile pins React/ReactDOM 19.3.0,
React Native 0.88.1, React Native Web 0.21.4 and React/ReactDOM types 19.3.0 for
the supplied SDK 58 peer requirements. Web/admin manifests remain unchanged at
React 19.1.1; this manifest edit does not prove the regenerated peer graph.
No global
hoisting or custom Metro configuration is introduced; use Expo's default monorepo
support. Node 24.21.0 is required (installed author binary:
`/home/agentagency-dev/.local/node-v24.21.0/bin/node`).

After trusted resolution, from repo root:

```sh
pnpm --filter @gobadminton/mobile run typecheck
pnpm --filter @gobadminton/mobile run lint
pnpm --filter @gobadminton/mobile run test:unit
pnpm --filter @gobadminton/mobile run export:check
```

Dependency-free author tests can run directly with Node 24:

```sh
node --experimental-strip-types --test apps/mobile/test/*.test.ts
python3 -B scripts/chatops/tests/test_ci_workflow.py
```

Address1 author check in this private export: Node 24.21.0 with
`node --experimental-strip-types --test --test-isolation=none apps/mobile/test/*.test.ts`
reports **20 tests, 20 pass, 0 fail** (the original 15 plus five focused regressions).
The ordinary isolated invocation here reports only six passing file subtests;
the nonisolated invocation above verifies the actual named assertions. New cases
cover accepted labels and unsupported identities, strict expiry, delayed server
responses, cached/page expiry with cursor retention, deduplication and city races.
This is author verification, not independent QA or native rendering evidence.

Historical lineage is retained: first source `d42ae139a74844f965d9839f6ef244ab72d84a28`
→ trusted generated-lock child/base `e5ef4a25656e170f237ef64d38aad97d947a2ad6`.
The supplied parent evidence records 15 units and both native Expo exports passing,
but typecheck and lint **FAIL**. Address1 repairs the Node `URL` type identity and
uses two justified line-local lint exceptions for Metro's literal native asset
requires. Historical lock-guard failure, peer-graph adoption and parent FAIL remain
history; historical passes are not current post-repair passes. No source QA has
been performed. Accepted server84 remains the supplied `8bf1110…` baseline.

Unit tests exercise public request URLs/credentials, unavailable/empty/network
retry, story/returning entry, unsupported cities, stale city/pagination responses,
and server condition presentation. Source/style checks cover native font/assets,
primary colors, scaling, safe area and Reduce Motion wiring; they do not claim
rendered/device accessibility proof. The Product CI mobile checks execute inside
existing `source (web)`; the other matrix entries and seven Product CI jobs remain.

`export:check` exports Android and iOS JS/assets only. It proves neither an APK nor
an iOS binary. Native `expo run:android` / `expo run:ios` scripts are for the trusted
parent build archive. Do not commit generated android/ios/dist trees.

| Stage | Author handoff status |
|---|---|
| SOURCE | IMPLEMENTED_CANDIDATE; independent QA/CI pending; not SOURCE_READY |
| Address1 author units | PASS: 20 named tests using Node `--test-isolation=none`; original 15 retained |
| Owning CI workflow definitions | PASS: 4 existing `test_ci_workflow.py` tests; not a Product CI execution |
| typecheck / lint / Expo export | NOT_TESTED: dependencies absent; installation forbidden in author |
| ANDROIDBUILD | NOT_BUILT; trusted Node/dependencies, JDK and Android SDK/build tools needed |
| IOSBUILD | NOT_BUILT; external macOS/Xcode/signing access unverified |
| DEVICE / Owner UAT | NOT_TESTED |
| STORE | NOT_READY; outside M1 |

No install, native build, push, merge, deploy, DEV acceptance or release-history
update was performed by this author. API target 0.43.0 is the supplied probe fact,
not a live API check performed here. The existing issue remains open.

Address1 changed files (all relative to `apps/mobile/`): `package.json`, `app.json`,
`app/_layout.tsx`, `app/games/index.tsx`, `app/games/[id].tsx`,
`src/components/ui.tsx`, `src/hooks.ts`, `src/public-api.ts`, `src/presentation.ts`,
`src/upcoming.ts`, `test/native-contract.test.ts`, `test/public-api.test.ts`,
`test/presentation.test.ts`, `test/upcoming.test.ts`, and this README. The private
export has no `.git`; no new commit SHA or branch verification is claimed.

## #522 bounded compact correction · 2026-11-14

The Owner rejected M1 product scope and compact rendering on Samsung S23.
Historical compiler/QA/CI/APK/server evidence above remains historical technical
evidence; it is **not full native product acceptance**. This source repair follows
the fully read Root compact specification
`ab7f3dd8d50c216afaf1b65ed36317f8d7f203939b51cf3e8d899c0809baa529`.
The exact S23 logical viewport, font scale, density and navigation mode are unknown.

E is now **intro only**. Its approved assets, wordmark, purple surface and black
labels on green primary buttons remain. Skip shares the persistent brand header;
three progress marks, centered two-part title/lime emphasis and grouped actions
replace the separate nine-child composition. Artwork consumes the space left
by the measured text and actions below the measured header, with logical window
width/height/fontScale and all four safe edges. Decoration may disappear on short
windows; enlarged text and actions retain natural sizing and scroll in the purple
surface. This sizing policy is not a rendered fit/device PASS.

Existing guest screens use accepted mobile-web hierarchy and tokens directly
read from these owning references (read-only):

- `apps/web/src/components/consumer/{ConsumerShell,RootNav,NavIcon,Logo}.tsx`, `nav-items.ts`
  and `styles/{consumer-tokens,foundation,mobile-controls}.css`: white persistent
  header, 16dp product gutters, ink/secondary text, line colors and bordered controls.
- `pages/GamesDiscoveryPage.tsx`, `discovery/{DiscoveryComposition,DiscoveryGameCard}.tsx`
  and `styles/discovery.css`: compact copy without E art, city/current date scope,
  210dp cover when published media exists, date/time/title/venue/terms/host hierarchy.
- `games/GameCover.tsx` and `venues/VenueCover.tsx`: only server-projected
  `/v1/media/game-covers/<64 lowercase hex>.png` and venue equivalents are accepted.
  The detail CTA arrow ports the exact path from `apps/web/public/discovery/arrow.svg`
  through native SVG primitives. Relative paths resolve only against the fixed DEV API origin. No arbitrary remote
  URL, provider image or stock illustration is introduced. Missing media renders no
  fabricated photo; failed images have a real retry, with game-to-venue fallback.

The city input is near the top, below fixed chrome, and selection dismisses the
keyboard. The catalog owns one FlatList with stable IDs, explicit pagination and
existing request/expiry fences; Back keeps the existing mounted feed. Direct
public detail remains independent of entry/city preferences. No private API,
authentication, mutation, fake actions, tabs or new destinations were added.
The “Когда / Все ближайшие” block is a static description of the real query,
not a date-picker control. Full date/filter behavior is still missing parity.

The original **22 named tests remain**, with assertions adapted for persistent
chrome/FlatList and stronger presence checks. Four additional pure regressions
cover compact layout allocation, short/enlarged layouts, the safe media policy
through real DTO parsing, and card date/city presentation. Synthetic group sizes
are function inputs, not recorded native measurements. Source assertions are not
rendering proof. No tests/builds were run in this bounded author pass: the parent
owns execution, and this private export has no node_modules or .git. No installation,
network, SDK/Gradle, provider, GitHub, publication or deployment call was made.

| Current compact handoff | Status |
|---|---|
| Source | BOUNDED_CANDIDATE; independent QA pending |
| 22 existing + 4 added tests | NOT_TESTED by this author; parent execution required |
| Typecheck / lint / Expo exports / native builds | NOT_TESTED; parent execution required |
| Native compact 360×780, 393×~850 at 1.0/1.3/2.0; short landscape | NOT_TESTED |
| Keyboard, Cyrillic font weights, gesture/3-button navigation contrast | NOT_TESTED |
| Samsung S23 visual recheck / Owner product validation | NOT_TESTED / existing FAIL retained |
| Full native parity / #522 | UNFINISHED / OPEN, InProgress |

Next mandatory work remains real four-tab navigation and its destinations, native
auth/profile, Players, My games, Messages, full game filters/date/map/create/share,
join/participation/organizer flows, venues/Radar and accepted UGC behavior, with
existing privacy/role boundaries. Profile is not a fifth bottom tab. This compact
patch cannot establish full parity or close #522. Trusted parent still owns native
captures (with actual logical dimensions, scale, density, safe edges and OS/nav-mode
metadata), independent QA/CI, build/import/commit and any accepted DEV release.

Exact changed paths for this compact source pass (no generated/release files):

```text
apps/mobile/app/+not-found.tsx
apps/mobile/app/city.tsx
apps/mobile/app/games/[id].tsx
apps/mobile/app/games/index.tsx
apps/mobile/app/story.tsx
apps/mobile/src/components/discovery-icon.tsx
apps/mobile/src/components/game-card.tsx
apps/mobile/src/components/ui.tsx
apps/mobile/src/layout.ts
apps/mobile/src/media.ts
apps/mobile/src/presentation.ts
apps/mobile/src/public-api.ts
apps/mobile/src/theme.ts
apps/mobile/test/compact-layout.test.ts
apps/mobile/test/media.test.ts
apps/mobile/test/native-contract.test.ts
apps/mobile/test/presentation.test.ts
apps/mobile/README.md
```
