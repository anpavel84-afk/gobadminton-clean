import { useEffect, useSyncExternalStore } from 'react';
import { AppState, View } from 'react-native';
import { useAuth } from '../auth.tsx';
import { nativeAuth } from '../auth-runtime.ts';
import {
  COURT_BOOKING_DISCLAIMER, COURT_BOOKING_LABELS, COURT_BOOKING_STATUSES,
  canSaveCourtBooking, type CourtBookingStatus,
} from '../game-court-booking.ts';
import { colors } from '../theme.ts';
import { DiscoveryChip, Label, Loading, PrimaryButton, TextButton, styles } from './ui.tsx';

/** Bounded «Договорённость о корте» panel — web GameCourtBooking texts + native card tokens. */
export function GameCourtBookingPanel({
  gameId,
  proof,
}: {
  gameId: string;
  /** Managed summary already resolved membership; game detail must re-check. */
  proof: 'managed' | 'detail';
}) {
  const auth = useAuth();
  const owner = nativeAuth.gameCourtBooking;
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const participation = useSyncExternalStore(
    auth.participation.subscribe,
    auth.participation.getSnapshot,
    auth.participation.getSnapshot,
  );
  const actor = state.actor;
  const focused = state.focus?.gameId === gameId;
  const detail = proof === 'detail'
    && participation.actor?.actorId === auth.me?.id
    && participation.actor?.sessionId === auth.me?.session.id
    ? participation.details[gameId]
    : undefined;
  const detailReady = proof === 'managed' || (!!detail && detail.status !== 'loading');

  useEffect(() => {
    owner.setForeground(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', next => {
      owner.setForeground(next === 'active');
    });
    return () => { sub.remove(); };
  }, [owner]);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !gameId || !detailReady) return;
    const release = owner.focus(gameId, proof);
    void owner.load();
    return release;
  }, [
    owner, auth.status, gameId, proof, detailReady,
    actor?.actorId, actor?.sessionId, actor?.generation,
    detail?.status,
  ]);

  if (auth.status !== 'authenticated') return null;
  if (!detailReady) return null;
  if (!focused) return null;
  if (state.status === 'denied') return null;
  if (state.status === 'idle' && !state.booking && !state.command) return null;

  const locked = !!state.command || state.status === 'stale' || state.status === 'loading';
  const canUpdate = Boolean(state.booking?.allowedActions.canUpdate);
  const saveEnabled = !locked && state.status === 'ready' && canSaveCourtBooking(state.draft, state.booking);
  const unknownForGame = state.command?.status === 'unknown' && state.command.packet.gameId === gameId;

  return <View style={styles.card} accessibilityLabel="Договорённость о корте">
    <Label accessibilityRole="header" style={styles.subtitle}>Договорённость о корте</Label>
    <Label style={{ color: colors.secondary, fontSize: 13, lineHeight: 18 }}>{COURT_BOOKING_DISCLAIMER}</Label>
    {state.status === 'loading' && !state.booking && <Loading title="Загружаем статус…" />}
    {state.status === 'error' && !state.command && <>
      <Label accessibilityLiveRegion="polite">{state.notice ?? 'Не удалось загрузить статус. Попробуйте ещё раз.'}</Label>
      <TextButton title="Обновить" onPress={() => { void owner.load(); }} />
    </>}
    {(state.status === 'ready' || state.status === 'stale' || !!state.command || (state.status === 'error' && state.booking)) && state.booking && <>
      {canUpdate ? <>
        <Label style={{ color: colors.secondary, fontSize: 13, lineHeight: 18 }}>Статус (со слов организатора)</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {COURT_BOOKING_STATUSES.map(status => (
            <DiscoveryChip
              key={status}
              title={COURT_BOOKING_LABELS[status]}
              selected={state.draft === status}
              onPress={() => { if (!locked) owner.updateDraft(status as CourtBookingStatus); }}
            />
          ))}
        </View>
        <PrimaryButton title="Сохранить статус" disabled={!saveEnabled} onPress={() => { void owner.save(); }} />
      </> : (
        <Label>{`${COURT_BOOKING_LABELS[state.booking.status]} · со слов организатора`}</Label>
      )}
    </>}
    {state.command?.status === 'sending' &&
      <Label accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">Сохраняем статус…</Label>}
    {unknownForGame &&
      <PrimaryButton title="Повторить ту же отправку" onPress={() => { void owner.reconcile(); }} />}
    {state.status === 'stale' && !state.command &&
      <PrimaryButton title="Обновить данные" onPress={() => { void owner.refreshAuthoritative(); }} />}
    {state.notice && <Label accessibilityLiveRegion="polite">{state.notice}</Label>}
  </View>;
}
