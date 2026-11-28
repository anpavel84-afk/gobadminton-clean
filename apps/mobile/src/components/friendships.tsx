import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import {
  FRIEND_ACTION_LABELS, FRIENDS_TABS, FRIENDSHIP_UNKNOWN_NOTICE,
  friendCommand, friendStatus,
  type FriendAction, type FriendshipView,
} from '../friendships.ts';
import { useFriendships } from '../friendships-runtime.tsx';
import type { PublicPlayer } from '../players.ts';
import { colors } from '../theme.ts';
import { PlayerAvatar } from './player-card.tsx';
import { BackLink, Header, Label, Loading, Page, PrimaryButton, TextButton, styles } from './ui.tsx';

const iosModalOrientations = ['portrait'] as const;
type Trigger = ComponentRef<typeof Pressable>;

/** Ghost control — TextButton has no disabled; keep accepted textButton look with a11y. */
function SoftTextButton({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.textButton, { opacity: disabled ? 0.5 : 1 }, !disabled && pressed && { backgroundColor: colors.paper }]}>
    <Label style={{ color: colors.ink, textAlign: 'center' }}>{title}</Label>
  </Pressable>;
}

function peerAsPlayer(peer: NonNullable<FriendshipView['peer']>): PublicPlayer {
  return {
    publicPlayerId: peer.publicPlayerId,
    displayName: peer.displayName,
    cityId: null,
    areaKey: null,
    level: null,
    bio: null,
    trainer: false,
    lookingForGame: false,
    avatar: peer.avatar,
    cover: { uploadedUrl: null },
  };
}

function sameFriendCommand(
  view: FriendshipView, peerId: string | undefined, packet: { action: FriendAction; target: string | null; requestId: string | null; friendshipId: string | null },
) {
  if (packet.action === 'remove') return packet.friendshipId === view.friendshipId;
  if (packet.action === 'request') return packet.target === (peerId ?? view.peer?.publicPlayerId ?? null);
  return packet.requestId === (view.request?.id ?? null);
}

/** Unresolved post-unlock warning — survives reload; blocks new actions until ack. */
function OutstandingRetirementWarning() {
  const { owner, state } = useFriendships();
  if (!state.outstandingWarning) return null;
  return <View style={{ gap: 8 }}>
    <Label accessibilityLiveRegion="polite" accessibilityRole="status">
      {state.outstandingWarning}
    </Label>
    <TextButton title="Понятно" onPress={() => owner.acknowledgeOutstandingWarning()} />
  </View>;
}

/** Explicit UNKNOWN hold when the owning row left the loaded surface — omission ≠ result; never resend. */
function OrphanFriendRecovery() {
  const { owner, state } = useFriendships();
  const command = state.command;
  if (!command || command.status !== 'unknown' || !state.foreground) return null;
  if (owner.commandMatchesSurface(command.packet)) return null;
  const packet = command.packet;
  const onList = packet.peerLease === null && state.listActive;
  const onProfile = packet.peerLease !== null && state.profilePeerId === packet.peerLease;
  if (!onList && !onProfile) return null;
  const notice = state.notice ?? FRIENDSHIP_UNKNOWN_NOTICE;
  return <View style={{ gap: 8 }}>
    <Label accessibilityLiveRegion="polite" accessibilityRole="status">
      {notice}
    </Label>
    <TextButton title="Обновить состояние" onPress={() => owner.refreshUnknownRelationship()} />
    <TextButton title="Понятно" onPress={() => owner.unlockUnknown()} />
  </View>;
}

function ConfirmDialog({
  title, children, close, busy,
}: {
  title: string; children: ReactNode; close: () => void; busy: boolean;
}) {
  const cancel = useRef<Trigger>(null);
  return <Modal visible animationType="none" onRequestClose={() => { if (!busy) close(); }}
    supportedOrientations={iosModalOrientations}
    onShow={() => {
      cancel.current?.focus();
      const node = findNodeHandle(cancel.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }}>
    <Page header={<Pressable ref={cancel} accessibilityRole="button" accessibilityLabel="Отмена"
      disabled={busy} onPress={() => { if (!busy) close(); }}
      style={({ pressed }) => [{ minHeight: 44, justifyContent: 'center' }, pressed && { backgroundColor: colors.paper }]}>
      <Label style={{ color: colors.secondary, fontWeight: '600' }}>Отмена</Label>
    </Pressable>}>
      <View accessibilityViewIsModal onAccessibilityEscape={() => { if (!busy) close(); }} style={{ gap: 16 }}>
        <Label accessibilityRole="header" style={styles.subtitle}>{title}</Label>
        {children}
      </View>
    </Page>
  </Modal>;
}

export function FriendActions({
  view, peerId, listLease, peerLease,
}: {
  view: FriendshipView; peerId?: string; listLease: number; peerLease: string | null;
}) {
  const { owner, state } = useFriendships();
  const [confirm, setConfirm] = useState(false);
  const locked = !!state.command || !!state.outstandingWarning;
  const actions = (['request', 'accept', 'decline', 'cancel', 'remove'] as FriendAction[])
    .filter(action => friendCommand(view, peerId, action));
  function act(action: FriendAction) {
    if (locked) return;
    void owner.act(action, view, peerId, listLease, peerLease);
  }
  return <View style={{ gap: 8 }}>
    <Label accessibilityRole="status">{friendStatus[view.relationship]}</Label>
    <View style={{ gap: 8 }}>
      {actions.map(action => action === 'remove'
        ? <SoftTextButton key={action} title={FRIEND_ACTION_LABELS[action]} disabled={locked}
          onPress={() => setConfirm(true)} />
        : action === 'request' || action === 'accept'
          ? <PrimaryButton key={action} title={FRIEND_ACTION_LABELS[action]} disabled={locked}
            onPress={() => act(action)} />
          : <SoftTextButton key={action} title={FRIEND_ACTION_LABELS[action]} disabled={locked}
            onPress={() => act(action)} />)}
    </View>
    {state.notice && state.command && sameFriendCommand(view, peerId, state.command.packet)
      && <Label accessibilityLiveRegion="polite" accessibilityRole="status">{state.notice}</Label>}
    {state.command?.status === 'unknown' && state.foreground
      && sameFriendCommand(view, peerId, state.command.packet)
      && <>
        <TextButton title="Обновить состояние" onPress={() => owner.refreshUnknownRelationship()} />
        <TextButton title="Понятно" onPress={() => owner.unlockUnknown()} />
      </>}
    {state.command?.status === 'sending' && sameFriendCommand(view, peerId, state.command.packet)
      && <Label accessibilityState={{ busy: true }}>Отправляем…</Label>}
    {confirm && <ConfirmDialog title="Удалить из друзей?" busy={state.command?.status === 'sending'}
      close={() => setConfirm(false)}>
      <Label>Чтобы снова стать друзьями, понадобится новый запрос.</Label>
      <PrimaryButton title="Удалить из друзей" disabled={locked} onPress={() => {
        setConfirm(false);
        act('remove');
      }} />
      <SoftTextButton title="Оставить в друзьях" disabled={state.command?.status === 'sending'}
        onPress={() => setConfirm(false)} />
    </ConfirmDialog>}
  </View>;
}

export function ProfileFriendship({ peerId }: { peerId: string }) {
  const auth = useAuth();
  const { owner, state } = useFriendships();
  useFocusEffect(useCallback(() => {
    owner.openProfile(peerId);
    void owner.loadProfile();
    return () => owner.closeProfile();
  }, [owner, peerId, auth.status]));
  useEffect(() => {
    if (state.profilePeerId === peerId
      && state.foreground && (state.profileStatus === 'loading' || state.profileStatus === 'idle')) {
      void owner.loadProfile();
    }
  }, [auth.status, owner, peerId, state.profilePeerId, state.profileStatus, state.foreground, state.episode]);
  if (state.profilePeerId !== peerId) return <Loading title="Проверяем состояние дружбы…" />;
  return <View style={{ gap: 8 }}>
    <Label accessibilityRole="header" style={styles.subtitle}>Друзья</Label>
    {state.profileStatus === 'loading' && <Label accessibilityRole="status">Проверяем состояние дружбы…</Label>}
    {state.profileStatus === 'guest' && <>
      <Label>Войдите, чтобы управлять дружбой.</Label>
      <PrimaryButton title="Войти" onPress={() => { void auth.signIn(`/players/${peerId}`); }} />
    </>}
    {state.profileStatus === 'error' && <>
      <Label>Не удалось проверить дружбу</Label>
      <TextButton title="Повторить" onPress={() => { owner.refreshProfile(); void owner.loadProfile(); }} />
    </>}
    {state.profileStatus === 'unavailable' && <Label accessibilityRole="status">
      Друзья сейчас недоступны. Проверьте доступность игрового профиля и повторите попытку. Запрос на общение для дружбы не требуется.
    </Label>}
    {state.profileStatus === 'ready' && state.profileView && <FriendActions
      view={state.profileView} peerId={peerId} listLease={state.episode} peerLease={peerId} />}
    <OrphanFriendRecovery />
    <OutstandingRetirementWarning />
  </View>;
}

export function FriendsScreen() {
  const auth = useAuth();
  const router = useRouter();
  const { owner, state } = useFriendships();
  useFocusEffect(useCallback(() => {
    owner.enterList();
    return () => owner.exitList();
  }, [owner]));
  useEffect(() => {
    if (state.listActive && state.foreground
      && (state.listStatus === 'loading' || state.listStatus === 'idle')) {
      void owner.loadList();
    }
  }, [owner, state.listActive, state.listStatus, state.foreground, state.episode, state.tab, state.cursor]);
  const back = () => router.canGoBack() ? router.back() : router.replace('/profile');
  return <Page header={<Header />}>
    <BackLink title="← Мой профиль" onPress={back} />
    <Label accessibilityRole="header" style={styles.title}>Друзья</Label>
    <Label style={{ color: colors.secondary, fontSize: 15, lineHeight: 22 }}>
      Дружба и личная переписка управляются отдельно.
    </Label>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="tablist">
      {FRIENDS_TABS.map(([value, label]) => <Pressable key={value} accessibilityRole="tab"
        accessibilityState={{ selected: state.tab === value }}
        onPress={() => owner.setTab(value)}
        style={({ pressed }) => [{
          minHeight: 44, minWidth: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
          borderWidth: 1, borderColor: colors.line,
          backgroundColor: state.tab === value ? colors.limeSoft : pressed ? colors.paper : colors.card,
          justifyContent: 'center',
        }]}>
        <Label style={{ fontWeight: '600' }}>{label}</Label>
      </Pressable>)}
    </View>
    {state.listStatus === 'loading' && <Loading title="Загружаем друзей…" />}
    {state.listStatus === 'guest' && <View style={styles.card}>
      <Label>Войдите, чтобы увидеть друзей и запросы.</Label>
      <PrimaryButton title="Войти" onPress={() => { void auth.signIn('/friends'); }} />
    </View>}
    {state.listStatus === 'prerequisite' && <View style={styles.card}>
      <Label accessibilityRole="header" style={styles.subtitle}>Сначала настройте свой профиль</Label>
      <Label>Сохраните игровой профиль и включите видимость в каталоге.</Label>
      <TextButton title="Открыть профиль" onPress={() => router.push('/profile')} />
    </View>}
    {state.listStatus === 'unavailable' && <View style={styles.card}>
      <Label accessibilityRole="header" style={styles.subtitle}>Друзья сейчас недоступны</Label>
      <Label>Проверьте доступность игрового профиля и повторите попытку. Запрос на общение для дружбы не требуется.</Label>
    </View>}
    {state.listStatus === 'error' && <View style={styles.card}>
      <Label accessibilityRole="header" style={styles.subtitle}>Не удалось загрузить друзей</Label>
      <Label>Обновите список перед следующими действиями.</Label>
      <PrimaryButton title="Повторить" onPress={() => { owner.refreshList(); void owner.loadList(); }} />
    </View>}
    {state.listStatus === 'ready' && state.page && <>
      {!state.page.items.length && <View style={styles.card}>
        <Label accessibilityRole="header" style={styles.subtitle}>Здесь пока никого нет</Label>
        <Label>Запрос можно отправить из публичного профиля игрока.</Label>
      </View>}
      {state.page.items.map((view, index) => <View key={view.friendshipId ?? `row-${index}`}
        style={[styles.card, { gap: 12 }]}>
        {view.peer ? <Pressable accessibilityRole="button"
          accessibilityLabel={`Профиль: ${view.peer.displayName}`}
          onPress={() => router.push(`/players/${encodeURIComponent(view.peer!.publicPlayerId)}`)}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
            pressed && { backgroundColor: colors.paper }]}>
          <PlayerAvatar player={peerAsPlayer(view.peer)} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Label style={{ fontWeight: '700', fontSize: 17 }}>{view.peer.displayName}</Label>
            <Label style={{ color: colors.secondary }}>Профиль →</Label>
          </View>
        </Pressable> : <Label accessibilityRole="header" style={styles.subtitle}>Игрок недоступен</Label>}
        <FriendActions view={view} peerId={view.peer?.publicPlayerId} listLease={state.episode} peerLease={null} />
      </View>)}
      <View style={{ gap: 8 }}>
        <TextButton title="Обновить список" onPress={() => { owner.refreshList(); void owner.loadList(); }} />
        {state.page.nextCursor && <TextButton title="Следующая страница"
          onPress={() => { owner.nextPage(); }} />}
      </View>
    </>}
    <OrphanFriendRecovery />
    <OutstandingRetirementWarning />
    {state.notice && !state.command && !state.outstandingWarning
      && <Label accessibilityLiveRegion="polite">{state.notice}</Label>}
  </Page>;
}
