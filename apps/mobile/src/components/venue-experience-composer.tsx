import { useCallback, useContext, useEffect, useRef, useSyncExternalStore, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Platform, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../auth.tsx';
import {
  TOPIC_LABEL,
  VENUE_TOPIC_OPTIONS,
  captureVenueExperienceRouteOwner,
  exactGameMaySubmitBasis,
  isVenueExperienceCreatePacket,
  isVenueExperiencePacketKind,
  noteVenueExperienceRouteOwner,
  postgameIdempotencyReplayBlocked,
  venueExperienceEntryProbeTarget,
  venueExperienceReceiptSummary,
  venueReviewEligibilityHelp,
  POSTGAME_RETENTION_EXPIRED_NOTICE,
  type VenueAudience,
  type VenueExperienceRouteOwner,
  type VenueReviewTopic,
} from '../venue-reviews.ts';
import { Choice, FocusContext } from './postgame.tsx';
import { iosModalOrientations, Label, Loading, OutlineButton, PrimaryButton, TextButton, Page, styles } from './ui.tsx';

type FocusTarget = ComponentRef<typeof Pressable>;

/**
 * Exact-game venue experience composer. Private self_draft is default;
 * public_venue requires fresh preview + unchecked→explicit consent. No picker.
 */
export function VenueExperienceComposer({
  gameId,
  venueId,
  onClose,
}: {
  gameId: string;
  venueId: string;
  onClose: () => void;
}) {
  const auth = useAuth();
  const owner = auth.postgame;
  const s = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const trigger = useContext(FocusContext);
  const heading = useRef<ComponentRef<typeof Text>>(null);
  const wasOpen = useRef(false);
  const surface = s.venueExperience;
  const open = !!surface && surface.gameId === gameId && surface.venueId === venueId;
  const editing = open && !!surface?.reviewId;
  const draft = open ? s.venueDraft : null;
  const eligibility = open && s.venueEligibility.status === 'ready' ? s.venueEligibility.data : null;
  const basis = exactGameMaySubmitBasis(eligibility, gameId);
  const help = venueReviewEligibilityHelp(
    eligibility?.bases.find(b => b.gameId === gameId) ?? (s.venueEligibility.status === 'ready' ? undefined : null),
  );
  const command = s.command && isVenueExperiencePacketKind(s.command.packet.kind) ? s.command : null;
  const locked = !!command || !!s.venueReceipt || (editing && s.ownVenueReadRequired && !s.venueReceipt);
  const busy = command?.status === 'sending';
  const unknown = command?.status === 'unknown';
  const retentionBlocked = unknown && postgameIdempotencyReplayBlocked(command?.firstDispatchedAt);
  // Explicit selected reread after edit conflict — usable without receipt; fenced while sending/UNKNOWN.
  const showSelectedReread = editing && s.ownVenueReadRequired && !!surface?.reviewId && !busy && !unknown;
  const previewHash = open ? s.venueConsentHash : null;
  const canSubmit = open && !locked && !!basis && !!draft
    && !s.ownVenueReadRequired
    && draft.text.trim().length >= 1 && draft.text.trim().length <= 500
    && (draft.audience === 'self_draft' || (!!draft.consent && !!previewHash));
  const receiptSummary = s.venueReceipt && draft
    ? venueExperienceReceiptSummary(s.venueReceipt, draft.audience)
    : null;

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) {
        const frame = requestAnimationFrame(() => {
          trigger?.current?.focus();
          const node = findNodeHandle(trigger?.current ?? null);
          if (node) AccessibilityInfo.setAccessibilityFocus(node);
        });
        wasOpen.current = false;
        return () => cancelAnimationFrame(frame);
      }
      return;
    }
    wasOpen.current = true;
  }, [open, trigger]);

  if (!open || !draft) return null;

  const close = () => {
    // Close/Back always hide the surface; immutable UNKNOWN/sending stays in the journal.
    owner.closeVenueExperience();
    onClose();
  };

  const headingTitle = retentionBlocked
    ? 'Результат отправки неизвестен'
    : unknown
      ? 'Результат отправки неизвестен'
      : busy
        ? 'Сохраняем…'
        : s.venueReceipt
          ? (editing ? 'Редакция сохранена' : 'Отзыв сохранён')
          : (editing ? 'Изменить отзыв о площадке' : 'Как вам площадка?');

  return (
    <Modal visible animationType="none" presentationStyle="fullScreen"
      supportedOrientations={iosModalOrientations}
      onRequestClose={close}
      onShow={() => {
        const node = findNodeHandle(heading.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      }}>
      <Page keyboard header={<View style={{ gap: 8 }}>
        <TextButton title="Закрыть" onPress={close} />
        {!s.venueReceipt && !retentionBlocked ? (
          <PrimaryButton
            title={unknown ? 'Повторить исходную отправку' : 'Сохранить'}
            disabled={busy || (!canSubmit && !unknown)}
            onPress={() => void owner.submitVenueExperience()}
          />
        ) : null}
        {busy ? <Label accessibilityLiveRegion="polite">Сохраняем…</Label> : null}
      </View>}>
        <View accessibilityViewIsModal onAccessibilityEscape={close} style={{ gap: 16 }}>
          <Text
            ref={heading}
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            allowFontScaling
            style={[styles.text, styles.subtitle, { fontWeight: '700' }]}
          >
            {headingTitle}
          </Text>
          {unknown ? (
            retentionBlocked
              ? <Label accessibilityRole="status">{POSTGAME_RETENTION_EXPIRED_NOTICE}</Label>
              : <Label accessibilityRole="status">
                Результат исходной отправки пока неизвестен. «Повторить исходную отправку» снова отправит тот же текст и то же действие. Можно закрыть экран и вернуться к этой отправке позже.
              </Label>
          ) : null}
          {busy ? <Loading title="Отправляем исходное действие…" /> : null}
          {!s.venueReceipt && !unknown ? (
            <Label>
              {editing
                ? (draft.audience === 'self_draft'
                  ? 'Эти изменения увидите только вы.'
                  : 'Чтобы отправить изменения на публикацию, подтвердите согласие ещё раз.')
                : 'По умолчанию текст только вам. Публичный отзыв — без профиля, игры и состава.'}
            </Label>
          ) : null}
          {!unknown && !s.venueReceipt && s.venueEligibility.status === 'loading'
            ? <Loading title={editing ? 'Загружаем отзыв…' : 'Проверяем допуск по этой игре…'} />
            : null}
          {!unknown && !s.venueReceipt && (s.venueEligibility.status === 'error' || s.venueEligibility.status === 'unavailable')
            ? <Label accessibilityRole="alert">{s.venueNotice ?? 'Не удалось проверить допуск.'}</Label>
            : null}
          {/* Fresh form when eligible; pending UNKNOWN/sending shows readonly original body. */}
          {(unknown || busy || s.venueEligibility.status === 'ready' || s.venueReceipt) ? <>
            {!unknown && !busy && !s.venueReceipt && s.venueEligibility.status === 'ready' ? <>
              <Label style={{ fontWeight: '700' }}>
                {basis ? (editing ? 'Можно сохранить редакцию' : 'Можно поделиться опытом') : 'Пока нельзя отправить'}
              </Label>
              <Label>
                {draft.audience === 'self_draft' ? 'Только вам' : 'Публично на странице площадки'}
                {basis?.gameTitle ? ` · игра: «${basis.gameTitle}»` : ''}
              </Label>
              <Label>
                {editing
                  ? 'Отзыв относится к той же игре.'
                  : 'Отзыв относится только к этой игре. В публичном отзыве не будет названия игры, состава и точного времени.'}
              </Label>
              {help ? <Label accessibilityRole="status">{help}</Label> : null}
            </> : null}
            {(unknown || busy || s.venueReceipt) ? (
              <Label>
                {draft.audience === 'self_draft' ? 'Только вам' : 'Публично на странице площадки'}
                {' · исходный текст отправки'}
              </Label>
            ) : null}
            <Label>О чём хотите рассказать</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {VENUE_TOPIC_OPTIONS.map(topic => (
                <Choice
                  key={topic.value}
                  title={topic.label}
                  selected={draft.topics.includes(topic.value)}
                  disabled={locked}
                  onPress={() => {
                    if (locked) return;
                    const selected = draft.topics.includes(topic.value);
                    const topics: VenueReviewTopic[] = selected
                      ? draft.topics.filter(t => t !== topic.value)
                      : VENUE_TOPIC_OPTIONS
                        .filter(t => t.value === topic.value || draft.topics.includes(t.value))
                        .map(t => t.value);
                    owner.patchVenueDraft({ topics: topics.length ? topics : ['surface'] });
                  }}
                />
              ))}
            </View>
            <Label>Ваш опыт на площадке</Label>
            <TextInput
              editable={!locked}
              multiline
              scrollEnabled
              textAlignVertical="top"
              accessibilityLabel="Ваш опыт на площадке"
              value={draft.text}
              onChangeText={text => owner.patchVenueDraft({ text })}
              maxLength={500}
              autoCorrect={Platform.OS === 'ios' ? false : undefined}
              style={[styles.input, { minHeight: 100, maxHeight: 180 }]}
            />
            <Label>{draft.text.trim().length} / 500</Label>
            {!locked ? <Label>Не указывайте имена и контакты — так отзыв останется без лишних деталей.</Label> : null}
            {!locked ? <>
              <Label style={{ fontWeight: '700' }}>Кому видно</Label>
              <AudienceChoice
                value={draft.audience}
                disabled={locked}
                onChange={audience => owner.patchVenueDraft({ audience })}
              />
            </> : (
              <Label style={{ fontWeight: '700' }}>
                Кому видно · {draft.audience === 'self_draft' ? 'только вам' : 'публично на странице площадки'}
              </Label>
            )}
            {!locked && draft.audience === 'public_venue' ? (
              <View style={styles.card}>
                <Label style={{ fontWeight: '700' }}>Как увидят другие</Label>
                <Label>
                  Участник игры
                  {draft.topics.length
                    ? ` · ${draft.topics.map(t => TOPIC_LABEL[t]).join(', ')}`
                    : ''}
                </Label>
                <Label>{draft.text.trim() || '—'}</Label>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: draft.consent, disabled: locked || !draft.text.trim() }}
                  disabled={locked || !draft.text.trim()}
                  onPress={() => {
                    if (locked || !draft.text.trim()) return;
                    if (draft.consent) {
                      owner.patchVenueDraft({ consent: false });
                      return;
                    }
                    void owner.ensureVenueConsentPreview();
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
                >
                  <Switch
                    disabled={locked || !draft.text.trim()}
                    value={draft.consent}
                    onValueChange={next => {
                      if (locked) return;
                      if (!next) {
                        owner.patchVenueDraft({ consent: false });
                        return;
                      }
                      void owner.ensureVenueConsentPreview();
                    }}
                  />
                  <Label style={{ flex: 1 }}>
                    Подтверждаю публикацию этого текста без моего профиля, игры и состава.
                  </Label>
                </Pressable>
              </View>
            ) : null}
          </> : null}
          {/* Success copy lives only on the receipt card — avoid duplicate/contradictory notice. */}
          {s.venueNotice && !s.venueReceipt ? <Label accessibilityRole="status">{s.venueNotice}</Label> : null}
          {showSelectedReread && !s.venueReceipt ? (
            <OutlineButton
              title="Перечитать выбранный отзыв"
              onPress={() => void owner.loadOwnVenueSelected(surface!.reviewId!, { clearConflict: true })}
            />
          ) : null}
          {s.venueReceipt && receiptSummary ? (
            <View style={styles.card}>
              <Label>{receiptSummary.primary}</Label>
              <Label>{receiptSummary.visibility}</Label>
              {s.venueReceipt.receiptToken
                ? <Label>Квитанция: {s.venueReceipt.receiptToken}</Label>
                : null}
              <Label>Актуальный статус отзыва о площадке можно посмотреть на сайте.</Label>
              {showSelectedReread ? (
                <OutlineButton
                  title="Перечитать выбранный отзыв"
                  onPress={() => void owner.loadOwnVenueSelected(surface!.reviewId!, { clearConflict: true })}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </Page>
    </Modal>
  );
}

function AudienceChoice({
  value,
  disabled,
  onChange,
}: {
  value: VenueAudience;
  disabled: boolean;
  onChange: (value: VenueAudience) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Choice title="Оставить только себе" selected={value === 'self_draft'} disabled={disabled}
        onPress={() => onChange('self_draft')} />
      <Choice title="Всем на странице площадки" selected={value === 'public_venue'} disabled={disabled}
        onPress={() => onChange('public_venue')} />
    </View>
  );
}

/**
 * Remember invoking control for composer return-focus.
 * `liveRef` stays owned by Entry so close can focus the remounted control after Composer unmounts.
 */
function VenueRecoveryButton({
  title,
  onPress,
  liveRef,
}: {
  title: string;
  onPress: () => void;
  liveRef: RefObject<FocusTarget | null>;
}) {
  const trigger = useContext(FocusContext);
  return (
    <Pressable
      ref={(node) => {
        liveRef.current = node;
      }}
      accessibilityRole="button"
      onPress={() => {
        if (trigger) trigger.current = liveRef.current;
        onPress();
      }}
      style={styles.textButton}
    >
      <Label>{title}</Label>
    </Pressable>
  );
}

/** Shared Entry card + optional owned composer — one modal surface, no duplicate layouts. */
function VenueExperienceEntryFrame({
  gameId,
  cardBody,
  composerVenueId,
  onCloseComposer,
}: {
  gameId: string;
  cardBody: ReactNode;
  composerVenueId: string | null;
  onCloseComposer: () => void;
}) {
  return (
    <>
      <View style={styles.card}>
        <Label style={{ fontWeight: '700' }}>Отзыв о площадке после игры</Label>
        {cardBody}
      </View>
      {composerVenueId
        ? <VenueExperienceComposer gameId={gameId} venueId={composerVenueId} onClose={onCloseComposer} />
        : null}
    </>
  );
}

/**
 * Exact-game results entry — may_submit only for fresh create; guest returns to results after sign-in.
 * Pending original-operation recovery uses immutable packet gameId/venueId and does not require
 * live venue match or ready results (those gates remain for fresh admission only).
 */
export function VenueExperienceEntry({ gameId }: { gameId: string }) {
  const auth = useAuth();
  const owner = auth.postgame;
  const s = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const p = useSyncExternalStore(auth.participation.subscribe, auth.participation.getSnapshot, auth.participation.getSnapshot);
  const actor = auth.me?.id;
  const session = auth.me?.session.id;
  const current = auth.status === 'authenticated' && s.actor?.actorId === actor && s.actor?.sessionId === session;
  const results = current ? s.games[gameId] : undefined;
  const game = current ? p.games[gameId]?.game : undefined;
  const liveVenueId = game?.venue?.id ?? null;
  const pendingPacket = current && s.command && isVenueExperienceCreatePacket(s.command.packet)
    && s.command.packet.actor.actorId === s.actor?.actorId
    && s.command.packet.gameId === gameId
    ? s.command.packet
    : null;
  const pendingCommand = !!pendingPacket;
  const recoveryVenueId = pendingPacket?.venueId ?? null;
  const composerVenueId = s.venueExperience?.gameId === gameId ? s.venueExperience.venueId : null;
  const composerOpen = !!composerVenueId
    && !!s.venueExperience
    && s.venueExperience.gameId === gameId;
  const probeMatch = !!liveVenueId
    && s.venueProbe?.gameId === gameId
    && s.venueProbe.venueId === liveVenueId;
  const eligibility = probeMatch && s.venueEligibility.status === 'ready' ? s.venueEligibility.data : null;
  const basis = exactGameMaySubmitBasis(eligibility, gameId);
  const phase = probeMatch ? s.venueEligibility.status : 'idle';
  const help = venueReviewEligibilityHelp(eligibility?.bases.find(b => b.gameId === gameId));
  /** Live opener after close commit — Composer unmounts; button remounts with a new native handle. */
  const openerRef = useRef<FocusTarget | null>(null);
  const wasComposerOpen = useRef(false);
  const focusScopeRef = useRef(`${current && s.actor ? `${s.actor.actorId}:${s.actor.sessionId}` : ''}|${gameId}`);
  const actorKey = current && s.actor ? `${s.actor.actorId}:${s.actor.sessionId}` : null;
  /** Route still focused — return-focus must not target a blurred/departed results screen. */
  const routeFocused = useRef(false);
  /** Immutable owner for THIS focused route lifetime — cleanup must not read live gen/actor. */
  const ownedRouteRef = useRef<VenueExperienceRouteOwner | null>(null);
  /** Live auth identity for focus-return probe — never infer me/session from a stale focus closure. */
  const authIdentityRef = useRef({
    status: auth.status,
    actorId: auth.me?.id as string | undefined,
    sessionId: auth.me?.session.id as string | undefined,
  });
  authIdentityRef.current = {
    status: auth.status,
    actorId: auth.me?.id,
    sessionId: auth.me?.session.id,
  };

  // Focused fresh-admission probe — production gate fences hidden/open/pending; close→idle while focused.
  useEffect(() => {
    const target = venueExperienceEntryProbeTarget({
      routeFocused: routeFocused.current,
      authenticated: auth.status === 'authenticated',
      actor: current ? s.actor : null,
      meActorId: actor,
      meSessionId: session,
      gameId,
      liveVenueId,
      resultsStatus: results?.status,
      composerOpen,
      pendingVenueJournal: pendingCommand,
    });
    if (!target) return;
    owner.probeVenueEligibility(target.gameId, target.venueId);
  }, [
    current, liveVenueId, results?.status, results?.data, owner, gameId,
    pendingCommand, composerOpen, auth.status, actor, session, s.actor,
  ]);

  // While focused, remember latest matching surface (open after focus / close+reopen); no retire here.
  useEffect(() => {
    if (!routeFocused.current) return;
    ownedRouteRef.current = noteVenueExperienceRouteOwner(
      ownedRouteRef.current,
      captureVenueExperienceRouteOwner({
        gameId,
        actor: current ? s.actor : null,
        surface: s.venueExperience,
      }),
    );
  }, [current, s.actor, s.venueExperience, gameId]);

  // Route focus/blur: capture owner + fresh probe from CURRENT snapshots on return (stable deps).
  // Do not put results/composer/eligibility into deps — ordinary rerender must not retire the surface.
  useFocusEffect(useCallback(() => {
    routeFocused.current = true;
    const snap = owner.getSnapshot();
    const participation = auth.participation.getSnapshot();
    ownedRouteRef.current = noteVenueExperienceRouteOwner(
      ownedRouteRef.current,
      captureVenueExperienceRouteOwner({
        gameId,
        actor: snap.actor,
        surface: snap.venueExperience,
      }),
    );
    const me = authIdentityRef.current;
    const actorMatch = me.status === 'authenticated'
      && !!snap.actor
      && snap.actor.actorId === me.actorId
      && snap.actor.sessionId === me.sessionId;
    const game = actorMatch ? participation.games[gameId]?.game : undefined;
    const focusVenueId = game?.venue?.id ?? null;
    const focusResults = actorMatch ? snap.games[gameId] : undefined;
    const pendingPacket = actorMatch && snap.command && isVenueExperienceCreatePacket(snap.command.packet)
      && snap.command.packet.actor.actorId === snap.actor?.actorId
      && snap.command.packet.gameId === gameId
      ? snap.command.packet
      : null;
    const focusComposerOpen = !!snap.venueExperience && snap.venueExperience.gameId === gameId;
    const target = venueExperienceEntryProbeTarget({
      routeFocused: true,
      authenticated: me.status === 'authenticated',
      actor: actorMatch ? snap.actor : null,
      meActorId: me.actorId,
      meSessionId: me.sessionId,
      gameId,
      liveVenueId: focusVenueId,
      resultsStatus: focusResults?.status,
      composerOpen: focusComposerOpen,
      pendingVenueJournal: !!pendingPacket,
    });
    if (target) owner.probeVenueEligibility(target.gameId, target.venueId);
    return () => {
      routeFocused.current = false;
      const expected = ownedRouteRef.current;
      ownedRouteRef.current = null;
      if (!expected) return;
      owner.retireVenueExperienceSurface(expected);
    };
  }, [owner, gameId, auth.participation]));

  // Return focus to the remounted entry control after Composer unmounts; never cross actor/game.
  useEffect(() => {
    const scope = `${actorKey ?? ''}|${gameId}`;
    if (focusScopeRef.current !== scope) {
      focusScopeRef.current = scope;
      wasComposerOpen.current = composerOpen;
      return;
    }
    if (wasComposerOpen.current && !composerOpen) {
      wasComposerOpen.current = false;
      // Blur/unmount retirement closes the surface — do not focus a hidden/departed route.
      if (!actorKey || !routeFocused.current) return;
      const held = scope;
      const frame = requestAnimationFrame(() => {
        if (focusScopeRef.current !== held || !routeFocused.current) return;
        openerRef.current?.focus();
        const node = findNodeHandle(openerRef.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      });
      return () => cancelAnimationFrame(frame);
    }
    wasComposerOpen.current = composerOpen;
  }, [composerOpen, actorKey, gameId]);

  if (auth.status === 'hydrating') return null;

  if (!current) {
    return (
      <View style={styles.card}>
        <Label style={{ fontWeight: '700' }}>Отзыв о площадке после игры</Label>
        <Label>Войдите, чтобы поделиться опытом площадки.</Label>
        <TextButton title="Войти" onPress={() => void auth.signIn(`/my-games/${gameId}/results`)} />
      </View>
    );
  }

  const closeComposer = () => owner.closeVenueExperience();

  // Original pending recovery: same verified actor + route game; independent of live venue/results.
  if (pendingCommand && recoveryVenueId) {
    return (
      <VenueExperienceEntryFrame
        gameId={gameId}
        composerVenueId={composerOpen ? composerVenueId : null}
        onCloseComposer={closeComposer}
        cardBody={composerOpen
          ? <Label accessibilityRole="status">Открыт отзыв по этой игре.</Label>
          : (
            <VenueRecoveryButton
              title="Посмотреть отправку"
              liveRef={openerRef}
              onPress={() => owner.openVenueExperience(gameId, recoveryVenueId)}
            />
          )}
      />
    );
  }

  // Confirmed own receipt on active original composer — before fresh liveVenue/results admission gates.
  // Does not grant fresh submission rights or bypass auth/origin; closes only on user action.
  const confirmedOwnReceipt = !!s.venueReceipt
    && composerOpen
    && !!composerVenueId
    && !!s.venueDraft
    && s.venueExperience?.gameId === gameId
    && s.venueExperience?.venueId === composerVenueId;
  if (confirmedOwnReceipt && composerVenueId) {
    return (
      <VenueExperienceEntryFrame
        gameId={gameId}
        composerVenueId={composerVenueId}
        onCloseComposer={closeComposer}
        cardBody={<Label accessibilityRole="status">Открыт отзыв по этой игре.</Label>}
      />
    );
  }

  if (!liveVenueId) {
    return (
      <View style={styles.card}>
        <Label style={{ fontWeight: '700' }}>Отзыв о площадке после игры</Label>
        <Label>{venueReviewEligibilityHelp(undefined)}</Label>
      </View>
    );
  }
  if (results?.status !== 'ready') {
    return (
      <View style={styles.card}>
        <Label style={{ fontWeight: '700' }}>Отзыв о площадке после игры</Label>
        <Label>
          {results?.status === 'loading' || results?.status === 'idle'
            ? 'Проверяем допуск по этой игре…'
            : 'Не удалось проверить допуск по этой игре.'}
        </Label>
      </View>
    );
  }

  return (
    <VenueExperienceEntryFrame
      gameId={gameId}
      composerVenueId={composerOpen ? composerVenueId : null}
      onCloseComposer={closeComposer}
      cardBody={composerOpen ? <Label accessibilityRole="status">Открыт отзыв по этой игре.</Label>
        : phase === 'loading' || phase === 'idle' ? <Label>Проверяем допуск по этой игре…</Label>
          : phase === 'error' || phase === 'unavailable' ? <>
            <Label>{s.venueNotice ?? 'Не удалось проверить допуск по этой игре.'}</Label>
            <TextButton title="Обновить допуск" onPress={() => owner.probeVenueEligibility(gameId, liveVenueId)} />
          </>
            : basis ? (
              <VenueRecoveryButton
                title="Оставить отзыв о площадке"
                liveRef={openerRef}
                onPress={() => owner.openVenueExperience(gameId, liveVenueId)}
              />
            ) : <Label>{help ?? 'Сейчас нельзя оставить отзыв по этой игре.'}</Label>}
    />
  );
}
