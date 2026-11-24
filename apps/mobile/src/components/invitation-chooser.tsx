import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ComponentRef, RefObject } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { nativeAuth } from '../auth-runtime.ts';
import {
  inviteCalendarParts,
  inviteWhenLabel,
  isGameOpenForInvitation,
  nextInvitationEligibilityBoundary,
} from '../invitation-authoring.ts';
import type { ManagedGame } from '../participation.ts';
import { colors } from '../theme.ts';
import { DiscoverySheet, Label, OutlineButton, PrimaryButton, TextButton, styles } from './ui.tsx';

/** Accepted-web Russian chooser copy — own future published/open games only; explicit send. */
export function InvitationChooser({
  conversationId,
  peerId,
  visible,
  onClose,
  returnFocusRef,
}: {
  conversationId: string;
  peerId: string;
  visible: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<ComponentRef<typeof Pressable> | null>;
}) {
  const owner = nativeAuth.invitationAuthoring;
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const router = useRouter();
  const opened = useRef(false);

  useEffect(() => {
    if (!visible) {
      if (opened.current) {
        opened.current = false;
        owner.close();
      }
      return;
    }
    opened.current = true;
    owner.open(conversationId, peerId);
    void owner.load();
  }, [visible, conversationId, peerId, owner]);

  useEffect(() => {
    if (!visible) return;
    const receipt = owner.takeReceiptForSurface(conversationId, peerId);
    if (!receipt) return;
    onClose();
    router.push(`/messages/invitations/${receipt.id}` as '/messages');
  }, [visible, conversationId, peerId, state.receipt, owner, onClose, router]);

  useEffect(() => {
    if (!visible || state.listStatus !== 'ready') return;
    const open = state.games.filter(g => isGameOpenForInvitation(g, state.now));
    const boundary = nextInvitationEligibilityBoundary(open, state.now);
    if (boundary == null) return;
    const delay = Math.min(2147483647, Math.max(0, boundary - Date.now()));
    const timer = setTimeout(() => {
      void owner.load();
    }, delay);
    return () => clearTimeout(timer);
  }, [visible, state.games, state.now, state.listStatus, owner]);

  const locked = owner.blocksMutations();
  const offered = state.listStatus === 'ready'
    ? state.games.filter(g => isGameOpenForInvitation(g, state.now))
    : [];
  const ctaText = state.checking ? 'Проверяем игру…' : state.command?.status === 'sending' ? 'Отправляем…' : 'Отправить приглашение';
  const statusText = state.checking ? 'Проверяем игру…' : state.command?.status === 'sending' ? 'Отправляем…' : null;
  const canClose = !state.checking && state.command?.status !== 'sending';

  return <DiscoverySheet
    visible={visible}
    title="Пригласить на игру"
    onClose={() => { if (canClose) onClose(); }}
    returnFocusRef={returnFocusRef}
  >
    <Label nativeID="gb-invitation-hint">Приглашение не резервирует место.</Label>
    {statusText ? <Label accessibilityLiveRegion="polite">{statusText}</Label> : null}
    {state.listStatus === 'loading' && !offered.length ? <Label>Загружаем игры…</Label> : null}
    {state.listStatus === 'error' ? <>
      <Label>Не удалось загрузить игры</Label>
      <TextButton title="Повторить" onPress={() => { void owner.load(); }} />
    </> : null}
    {state.listStatus === 'ready' && offered.length === 0 ? (
      <Label>Нет предстоящих игр, открытых для приглашений.</Label>
    ) : null}
    {offered.map(game => (
      <InvitationGameCard
        key={game.id}
        game={game}
        disabled={locked}
        ctaText={ctaText}
        onInvite={() => { void owner.invite(game.id); }}
      />
    ))}
    {state.nextCursor ? (
      <OutlineButton
        title={state.listStatus === 'loading' ? 'Загружаем…' : 'Ещё игры'}
        disabled={locked || state.listStatus === 'loading'}
        onPress={() => { void owner.load(true); }}
      />
    ) : null}
    <OutlineButton
      title="+ Создать новую игру"
      disabled={locked}
      onPress={() => {
        if (!canClose) return;
        onClose();
        router.push('/games/create' as '/games/create');
      }}
    />
    {state.notice ? <Label accessibilityRole="alert">{state.notice}</Label> : null}
    {state.command?.status === 'unknown' ? (
      <PrimaryButton title="Проверить тем же запросом" onPress={() => { void owner.retry(); }} />
    ) : null}
  </DiscoverySheet>;
}

function InvitationGameCard({
  game,
  disabled,
  ctaText,
  onInvite,
}: {
  game: ManagedGame;
  disabled: boolean;
  ctaText: string;
  onInvite: () => void;
}) {
  const when = inviteWhenLabel(game);
  const badge = inviteCalendarParts(game);
  return <View style={[styles.card, { gap: 12 }]}>
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <View accessible={false} style={{
        width: 52, minHeight: 52, borderRadius: 12, backgroundColor: colors.limeSoft,
        alignItems: 'center', justifyContent: 'center', padding: 6,
      }}>
        <Label style={{ fontWeight: '700', fontSize: 18, lineHeight: 22 }}>{badge.day}</Label>
        <Label style={{ fontSize: 12, lineHeight: 14, color: colors.secondary }}>{badge.month}</Label>
      </View>
      <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
        <Label style={{ fontWeight: '700' }}>{game.title}</Label>
        <Label>{when}</Label>
        <Label style={{ color: colors.secondary }}>Часовой пояс: {game.timezone}</Label>
      </View>
    </View>
    <PrimaryButton
      title={ctaText}
      disabled={disabled}
      onPress={onInvite}
    />
  </View>;
}
