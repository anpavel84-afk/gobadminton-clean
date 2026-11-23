import { useEffect, useSyncExternalStore } from 'react';
import { Modal, Platform, Pressable, Switch, TextInput, View } from 'react-native';
import { useAuth } from '../auth.tsx';
import {
  TOPIC_LABEL,
  VENUE_TOPIC_OPTIONS,
  exactGameMaySubmitBasis,
  isVenueExperiencePacketKind,
  postgameIdempotencyReplayBlocked,
  venueReviewEligibilityHelp,
  POSTGAME_RETENTION_EXPIRED_NOTICE,
  type VenueAudience,
  type VenueReviewTopic,
} from '../venue-reviews.ts';
import { Choice } from './postgame.tsx';
import { iosModalOrientations, Label, Loading, PrimaryButton, TextButton, Page, styles } from './ui.tsx';

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
  const surface = s.venueExperience;
  const open = !!surface && surface.gameId === gameId && surface.venueId === venueId;
  const draft = open ? s.venueDraft : null;
  const eligibility = open && s.venueEligibility.status === 'ready' ? s.venueEligibility.data : null;
  const basis = exactGameMaySubmitBasis(eligibility, gameId);
  const help = venueReviewEligibilityHelp(
    eligibility?.bases.find(b => b.gameId === gameId) ?? (s.venueEligibility.status === 'ready' ? undefined : null),
  );
  const command = s.command && isVenueExperiencePacketKind(s.command.packet.kind) ? s.command : null;
  const locked = !!command || !!s.venueReceipt;
  const busy = command?.status === 'sending';
  const unknown = command?.status === 'unknown';
  const retentionBlocked = unknown && postgameIdempotencyReplayBlocked(command?.firstDispatchedAt);
  const previewHash = open ? s.venueConsentHash : null;
  const canSubmit = open && !locked && !!basis && !!draft
    && draft.text.trim().length >= 1 && draft.text.trim().length <= 500
    && (draft.audience === 'self_draft' || (!!draft.consent && !!previewHash));

  if (!open || !draft) return null;

  const close = () => {
    // Close/Back always hide the surface; immutable UNKNOWN/sending stays in the journal.
    owner.closeVenueExperience();
    onClose();
  };

  return (
    <Modal visible animationType="none" presentationStyle="fullScreen"
      supportedOrientations={iosModalOrientations}
      onRequestClose={close}>
      <Page keyboard header={<View style={{ gap: 8 }}>
        <TextButton title="Закрыть" onPress={close} />
        {!s.venueReceipt && !retentionBlocked ? (
          <PrimaryButton
            title={unknown ? 'Проверить отправку' : 'Сохранить'}
            disabled={busy || (!canSubmit && !unknown)}
            onPress={() => void owner.submitVenueExperience()}
          />
        ) : null}
        {busy ? <Label accessibilityLiveRegion="polite">Сохраняем…</Label> : null}
      </View>}>
        <View style={{ gap: 16 }}>
          <Label accessibilityRole="header" style={{ fontWeight: '700' }}>Как вам площадка?</Label>
          <Label>По умолчанию текст только вам. Публичный отзыв — без профиля, игры и состава.</Label>
          {retentionBlocked ? <Label accessibilityRole="status">{POSTGAME_RETENTION_EXPIRED_NOTICE}</Label> : null}
          {s.venueEligibility.status === 'loading' ? <Loading title="Проверяем допуск по этой игре…" /> : null}
          {s.venueEligibility.status === 'error' || s.venueEligibility.status === 'unavailable'
            ? <Label accessibilityRole="alert">{s.venueNotice ?? 'Не удалось проверить допуск.'}</Label>
            : null}
          {s.venueEligibility.status === 'ready' ? <>
            <Label style={{ fontWeight: '700' }}>
              {basis ? 'Можно поделиться опытом' : 'Пока нельзя отправить'}
            </Label>
            <Label>
              {draft.audience === 'self_draft' ? 'Только вам' : 'Публично на странице площадки'}
              {basis?.gameTitle ? ` · игра: «${basis.gameTitle}»` : ''}
            </Label>
            <Label>Отзыв относится только к этой игре. В публичном отзыве не будет названия игры, состава и точного времени.</Label>
            {help ? <Label accessibilityRole="status">{help}</Label> : null}
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
            <Label>Не указывайте имена и контакты — так отзыв останется без лишних деталей.</Label>
            <Label style={{ fontWeight: '700' }}>Кому видно</Label>
            <AudienceChoice
              value={draft.audience}
              disabled={locked}
              onChange={audience => owner.patchVenueDraft({ audience })}
            />
            {draft.audience === 'public_venue' ? (
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
          {s.venueNotice ? <Label accessibilityRole="status">{s.venueNotice}</Label> : null}
          {s.venueReceipt ? (
            <View style={styles.card}>
              <Label>
                {s.venueReceipt.status === 'self_draft'
                  ? 'Сохранено только вам. Эти изменения видите только вы.'
                  : s.venueReceipt.status === 'submitted_waiting' || s.venueReceipt.status === 'submitted'
                    ? 'Новая публичная версия отправлена и ожидает проверки. Пока она не опубликована.'
                    : s.venueReceipt.status === 'revision_waiting'
                      ? 'Новая версия ожидает проверки. Ранее опубликованная версия может оставаться видимой.'
                      : 'Отправка принята. Актуальный статус смотрите на сайте.'}
              </Label>
              <Label>
                {s.venueReceipt.publicVisible
                  ? 'Публичная версия отзыва доступна на странице площадки.'
                  : draft.audience === 'public_venue'
                    || s.venueReceipt.status === 'submitted_waiting'
                    || s.venueReceipt.status === 'submitted'
                    || s.venueReceipt.status === 'revision_waiting'
                    ? 'Эта новая версия ещё не опубликована. Более ранняя опубликованная версия может оставаться видимой.'
                    : 'Только вам — без публикации на странице площадки.'}
              </Label>
              {s.venueReceipt.receiptToken
                ? <Label>Квитанция: {s.venueReceipt.receiptToken}</Label>
                : null}
              <Label>Актуальный статус отзыва о площадке можно посмотреть на сайте.</Label>
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

/** Exact-game results entry — may_submit only; guest returns to results after sign-in. */
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
  const venueId = game?.venue?.id ?? null;
  const composerOpen = !!s.venueExperience
    && s.venueExperience.gameId === gameId
    && !!venueId
    && s.venueExperience.venueId === venueId;
  const pendingSame = !!venueId && !!s.command && isVenueExperiencePacketKind(s.command.packet.kind)
    && s.command.packet.actor.actorId === s.actor?.actorId
    && s.command.packet.gameId === gameId
    && s.command.packet.venueId === venueId;
  const probeMatch = !!venueId
    && s.venueProbe?.gameId === gameId
    && s.venueProbe.venueId === venueId;
  const eligibility = probeMatch && s.venueEligibility.status === 'ready' ? s.venueEligibility.data : null;
  const basis = exactGameMaySubmitBasis(eligibility, gameId);
  const phase = probeMatch ? s.venueEligibility.status : 'idle';
  const help = venueReviewEligibilityHelp(eligibility?.bases.find(b => b.gameId === gameId));

  useEffect(() => {
    if (!current || !venueId || results?.status !== 'ready') return;
    owner.probeVenueEligibility(gameId, venueId);
  }, [current, venueId, results?.status, results?.data, owner, gameId]);

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
  if (!venueId) {
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
    <>
      <View style={styles.card}>
        <Label style={{ fontWeight: '700' }}>Отзыв о площадке после игры</Label>
        {composerOpen ? <Label accessibilityRole="status">Открыт отзыв по этой игре.</Label>
          : pendingSame ? (
            <TextButton
              title="Проверить отправку"
              onPress={() => owner.openVenueExperience(gameId, venueId)}
            />
          )
            : phase === 'loading' || phase === 'idle' ? <Label>Проверяем допуск по этой игре…</Label>
              : phase === 'error' || phase === 'unavailable' ? <>
                <Label>{s.venueNotice ?? 'Не удалось проверить допуск по этой игре.'}</Label>
                <TextButton title="Обновить допуск" onPress={() => owner.probeVenueEligibility(gameId, venueId)} />
              </>
                : basis ? (
                  <TextButton
                    title="Оставить отзыв о площадке"
                    onPress={() => owner.openVenueExperience(gameId, venueId)}
                  />
                ) : <Label>{help ?? 'Сейчас нельзя оставить отзыв по этой игре.'}</Label>}
      </View>
      {composerOpen
        ? <VenueExperienceComposer gameId={gameId} venueId={venueId} onClose={() => owner.closeVenueExperience()} />
        : null}
    </>
  );
}
