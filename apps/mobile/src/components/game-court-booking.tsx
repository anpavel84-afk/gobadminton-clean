import { useCallback, useRef, useSyncExternalStore } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../auth.tsx';
import { nativeAuth } from '../auth-runtime.ts';
import {
  COURT_BOOKING_DISCLAIMER, COURT_BOOKING_LABELS, COURT_BOOKING_STATUSES,
  canSaveCourtBooking, type CourtBookingRenderedPermit, type CourtBookingStatus,
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
  const leaseRef = useRef<number | null>(null);
  const detail = proof === 'detail'
    && participation.actor?.actorId === auth.me?.id
    && participation.actor?.sessionId === auth.me?.session.id
    ? participation.details[gameId]
    : undefined;
  const detailReady = proof === 'managed' || (!!detail && detail.status !== 'loading');
  // Lease identity — not bare gameId — so a covered sibling with the same game stays hidden.
  const focused = state.focus?.gameId === gameId && state.focus.viewGen === leaseRef.current;

  // Route focus lease + AppState foreground; covered Expo screens stay mounted so useEffect is wrong.
  useFocusEffect(useCallback(() => {
    if (auth.status !== 'authenticated' || !gameId || !detailReady) {
      leaseRef.current = null;
      return;
    }
    const release = owner.focus(gameId, proof);
    leaseRef.current = owner.getSnapshot().focus?.viewGen ?? null;
    owner.setForeground(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', next => {
      owner.setForeground(next === 'active');
    });
    void owner.load();
    return () => {
      sub.remove();
      release();
      leaseRef.current = null;
    };
  }, [
    owner, auth.status, gameId, proof, detailReady,
    actor?.actorId, actor?.sessionId, actor?.generation,
    detail?.status,
  ]));

  if (auth.status !== 'authenticated') return null;
  if (!detailReady) return null;
  if (!focused) return null;
  if (state.status === 'denied') return null;
  if (state.status === 'idle' && !state.booking && !state.command) return null;

  const permit: CourtBookingRenderedPermit | null = state.actor && state.focus && state.foreground
    && state.focus.gameId === gameId
    && state.focus.viewGen === leaseRef.current
    ? Object.freeze({
      actor: Object.freeze({ ...state.actor }),
      gameId,
      viewGen: state.focus.viewGen,
      foregroundGen: state.foregroundGen,
    })
    : null;

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
      <TextButton title="Обновить" onPress={() => { if (permit) void owner.load(permit); }} />
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
              onPress={() => {
                if (!locked && permit) owner.updateDraft(status as CourtBookingStatus, permit);
              }}
            />
          ))}
        </View>
        <PrimaryButton
          title="Сохранить статус"
          disabled={!saveEnabled || !permit}
          onPress={() => { if (permit) void owner.save(permit); }}
        />
      </> : (
        <Label>{`${COURT_BOOKING_LABELS[state.booking.status]} · со слов организатора`}</Label>
      )}
    </>}
    {state.command?.status === 'sending' &&
      <Label accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">Сохраняем статус…</Label>}
    {unknownForGame &&
      <PrimaryButton title="Повторить ту же отправку" onPress={() => { if (permit) void owner.reconcile(permit); }} />}
    {state.status === 'stale' && !state.command &&
      <PrimaryButton title="Обновить данные" onPress={() => { if (permit) void owner.refreshAuthoritative(permit); }} />}
    {state.notice && <Label accessibilityLiveRegion="polite">{state.notice}</Label>}
  </View>;
}
