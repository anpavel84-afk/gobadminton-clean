import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import { nativeAuth } from '../auth-runtime.ts';
import type { GameChatEntryRenderedPermit } from '../game-chat-entry.ts';
import { Label, TextButton, styles } from './ui.tsx';

/**
 * Accepted-web «Чат игры →» on native game detail — eligibility before private chat GET;
 * navigates to existing `/messages/game/[id]` without focusing Messages to probe.
 */
export function GameChatEntryPanel({
  gameId,
  status,
  endsAt,
}: {
  gameId: string;
  status: string;
  endsAt: string;
}) {
  const auth = useAuth();
  const router = useRouter();
  const owner = nativeAuth.gameChatEntry;
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const participation = useSyncExternalStore(
    auth.participation.subscribe,
    auth.participation.getSnapshot,
    auth.participation.getSnapshot,
  );
  const leaseRef = useRef<number | null>(null);
  const detail = participation.actor?.actorId === auth.me?.id
    && participation.actor?.sessionId === auth.me?.session.id
    ? participation.details[gameId]
    : undefined;
  const detailReady = !!detail && detail.status !== 'loading';
  const focused = state.focus?.gameId === gameId && state.focus.viewGen === leaseRef.current;

  useFocusEffect(useCallback(() => {
    if (auth.status !== 'authenticated' || !gameId || !detailReady) {
      leaseRef.current = null;
      return;
    }
    const release = owner.focus(gameId, { status, endsAt });
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
    owner, auth.status, gameId, status, endsAt, detailReady,
    state.actor?.actorId, state.actor?.sessionId, state.actor?.generation,
    detail?.status,
  ]));

  useEffect(() => {
    if (focused) owner.updateWindow(gameId, { status, endsAt });
  }, [owner, focused, gameId, status, endsAt]);

  if (auth.status !== 'authenticated') return null;
  if (!detailReady) return null;
  if (!focused) return null;
  if (state.status === 'denied' || state.status === 'closed') return null;
  if (state.status === 'idle' && !state.available) return null;
  if (state.status === 'loading') return null;

  const permit: GameChatEntryRenderedPermit | null = state.actor && state.focus && state.foreground
    && state.focus.gameId === gameId
    && state.focus.viewGen === leaseRef.current
    ? Object.freeze({
      actor: Object.freeze({ ...state.actor }),
      gameId,
      viewGen: state.focus.viewGen,
      foregroundGen: state.foregroundGen,
    })
    : null;

  if (state.status === 'error') {
    return <View style={styles.card} accessibilityLabel="Чат игры">
      <Label accessibilityLiveRegion="polite">
        {state.notice ?? 'Не удалось проверить чат игры. Попробуйте ещё раз.'}
      </Label>
      <TextButton title="Повторить" onPress={() => { if (permit) void owner.load(permit); }} />
    </View>;
  }

  if (!state.available || state.status !== 'ready') return null;

  return <View style={styles.card} accessibilityLabel="Чат игры">
    <TextButton
      title="Чат игры →"
      onPress={() => {
        if (!permit || !owner.mayNavigate(permit)) return;
        router.push({ pathname: '/messages/game/[id]', params: { id: gameId } });
      }}
    />
  </View>;
}
