import { NativeSafety } from './safety.tsx';
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentRef, PropsWithChildren } from 'react';
import { AppState, FlatList, Image, Platform, Pressable, RefreshControl, TextInput, View } from 'react-native';
import type { FlatListProps } from 'react-native';
import { useFocusEffect, usePathname, useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import type { MessagesCoordinator } from '../messages-coordinator.ts';
import { resourceKey } from '../messages-coordinator.ts';
import { inboxDestination } from '../messages.ts';
import type { DirectMessage, InboxFilter, MessagePeer, MessageResource } from '../messages.ts';
import { playerMediaUrl } from '../media.ts';
import { formatLabel, levelLabel } from '../presentation.ts';
import { colors } from '../theme.ts';
import { DiscoveryIcon } from './discovery-icon.tsx';
import { DiscoveryChip, DiscoverySheet, Header, Label, Page, PrimaryButton, ScreenFrame, TextButton, styles } from './ui.tsx';

/** Web-parity inbox date: day + short month in ru-RU (#604). */
export function formatInboxActivityDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
/** Client-side filter over already-loaded inbox rows; no extra API calls (#604). */
export function filterLoadedInbox<T extends { unreadCount: number; attention: boolean }>(items: readonly T[], filter: InboxFilter): T[] {
  if (filter === 'all') return [...items];
  if (filter === 'unread') return items.filter(item => item.unreadCount > 0);
  return items.filter(item => item.attention);
}
const inboxFilterLabels = { all: 'Все', unread: 'Непрочитанные', attention: 'Требуют ответа' } as const;

const Owner = createContext<MessagesCoordinator | null>(null);
/** Stable sibling of participation, owned above the Stack; no route owns credentials or packets. */
export function MessagesOwner({ children }: PropsWithChildren) {
  const auth = useAuth(), owner = auth.messages;
  useEffect(() => {
    const release = owner.mount();
    owner.setForeground(AppState.currentState === 'active');
    const listener = AppState.addEventListener('change', state => { owner.setForeground(state === 'active'); if (state === 'active') void owner.loadCounts(); });
    return () => { listener.remove(); release(); owner.setForeground(false); };
  }, [owner]);
  useEffect(() => { if (auth.status === 'authenticated') void owner.loadCounts(); }, [auth.status, owner]);
  return <Owner.Provider value={owner}>{children}</Owner.Provider>;
}
export function useMessages() {
  const owner = useContext(Owner); if (!owner) throw new Error('MessagesOwner missing');
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { owner, state };
}
function MessageAvatar({ peer }: { peer: MessagePeer }) {
  const [failed, setFailed] = useState<string[]>([]);
  const uri = [peer.avatar?.uploadedUrl, peer.avatar?.providerUrl].map(v => playerMediaUrl(v, 'avatar')).find(v => v && !failed.includes(v));
  return <View accessible={false} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF0B8', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    {uri ? <Image source={{ uri }} style={{ width: 44, height: 44 }} onError={() => setFailed(v => [...v, uri])} /> : <Label>{peer.displayName.trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('')}</Label>}
  </View>;
}
function MessageHeader({ name, subtitle, peer }: { name: string; subtitle?: string; peer?: MessagePeer }) {
  const router = useRouter();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Назад" onPress={() => router.navigate('/messages')}
      style={({ pressed }) => [{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, pressed && { backgroundColor: colors.paper }]}>
      <Label accessible={false} style={{ fontSize: 22, lineHeight: 28 }}>←</Label>
    </Pressable>
    {peer && <MessageAvatar key={`${peer.publicPlayerId}:${peer.avatar?.uploadedUrl}`} peer={peer} />}
    <View style={{ flex: 1, minWidth: 100 }}><Label accessibilityRole="header" style={{ fontWeight: '700' }}>{name}</Label>{subtitle && <Label style={{ color: colors.secondary }}>{subtitle}</Label>}</View>
  </View>;
}
function PrivateEntry() {
  const auth = useAuth(), path = usePathname();
  return <View style={styles.card}><Label>{auth.status === 'hydrating' ? 'Проверяем сеанс…' : 'Войдите, чтобы открыть сообщения'}</Label>
    {auth.status !== 'hydrating' && <PrimaryButton title="Войти" onPress={() => { void auth.signIn(path); }} />}</View>;
}
export function NativeMessagesInbox() {
  const { state, owner } = useMessages(), auth = useAuth(), router = useRouter();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const filterTrigger = useRef<ComponentRef<typeof Pressable>>(null);
  useFocusEffect(useCallback(() => {
    if (auth.status !== 'authenticated') return;
    return owner.leaseFocus('inbox');
  }, [owner, auth.status]));
  const items = filterLoadedInbox(state.inbox?.items ?? [], filter);
  return <ScreenFrame header={<Header />}>
    <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 8 }}>
      <Label style={{ fontSize: 12, lineHeight: 16, color: colors.secondary, letterSpacing: 0.6, textTransform: 'uppercase' }}>Личные и игровые</Label>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Label accessibilityRole="header" style={[styles.title, { flex: 1 }]}>Сообщения</Label>
        <Pressable ref={filterTrigger} accessibilityRole="button" accessibilityLabel="Фильтр сообщений"
          accessibilityState={{ expanded: filterOpen }} onPress={() => setFilterOpen(true)}
          style={({ pressed }) => [{ minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 4,
            borderWidth: 1, borderColor: colors.line, borderRadius: 12 }, pressed && { backgroundColor: colors.paper }]}>
          <Label>{inboxFilterLabels[filter]}</Label>
          <DiscoveryIcon name="chevron" />
        </Pressable>
      </View>
    </View>
    <DiscoverySheet visible={filterOpen} title="Фильтр сообщений" onClose={() => setFilterOpen(false)} returnFocusRef={filterTrigger}>
      {(['all', 'unread', 'attention'] as const).map(value =>
        <DiscoveryChip key={value} title={inboxFilterLabels[value]} selected={filter === value}
          onPress={() => { setFilter(value); setFilterOpen(false); }} />)}
    </DiscoverySheet>
    {auth.status !== 'authenticated' ? <View style={{ padding: 16 }}><PrivateEntry /></View> : <>
      <FlatList data={items} keyExtractor={i => `${i.kind}:${i.id}`} contentContainerStyle={{ padding: 16, gap: 0, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={state.inboxStatus === 'loading'} onRefresh={() => { void owner.loadInbox(); }}
          tintColor={Platform.OS === 'ios' ? colors.purple : undefined} />}
        ListEmptyComponent={<Label>{state.inboxStatus === 'loading' ? 'Загружаем сообщения…' : state.inboxStatus === 'error' ? 'Не удалось загрузить сообщения' : state.inboxStatus === 'ready' ? 'Здесь пока пусто. Здесь появятся переписки, приглашения и чаты ваших игр.' : 'Сообщения'}</Label>}
        renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => router.push(inboxDestination(item) as '/messages')}
          style={{ borderBottomColor: colors.line, borderBottomWidth: 1, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {item.peer && <MessageAvatar peer={item.peer} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Label numberOfLines={1} style={{ fontWeight: '700', textAlign: 'left' }}>{item.title}</Label>
            <Label numberOfLines={1} style={{ color: colors.secondary, textAlign: 'left' }}>{item.subtitle}</Label>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
            <Label style={{ fontSize: 12, lineHeight: 16, color: colors.secondary, textAlign: 'right' }}>{formatInboxActivityDate(item.lastActivityAt)}</Label>
            {(item.unreadCount > 0 || item.attention) && <Label accessibilityLabel={`${item.unreadCount} непрочитанных${item.attention ? ', требует ответа' : ''}`}
              style={{ backgroundColor: colors.limeSoft, padding: 4 }}>{item.unreadCount > 0 ? item.unreadCount : '•'}</Label>}
          </View>
        </Pressable>}
        ListFooterComponent={<>{state.inboxError && <Label accessibilityRole="alert">Не удалось загрузить. Повторите обновление.</Label>}
          {(state.inboxStatus === 'error' || state.notice) && <TextButton title="Повторить" onPress={() => { void owner.loadInbox(); }} />}
          {state.inbox?.nextCursor && <PrimaryButton disabled={state.loadingMore} title="Ещё сообщения" onPress={() => { void owner.loadInbox(state.filter, state.inbox!.nextCursor!); }} />}</>} />
    </>}
  </ScreenFrame>;
}
const requestCopy = { pending: 'Запрос на общение', accepted: 'Переписка', declined: 'Запрос отклонён', expired: 'Срок запроса истёк', closed: 'Переписка закрыта' };
export const invitationCopy = { pending: 'Вас приглашают в игру', accepted: 'Приглашение принято', declined: 'Приглашение отклонено', expired: 'Срок приглашения истёк', revoked: 'Приглашение отозвано', cancelled_by_game: 'Игра отменена' } as const;
/** Shared safe invitation terms + accept/decline; MyGames and Messages reuse one MessagesCoordinator owner. */
export function InvitationDecisionBody({ invitation, ownId, pending, onAccept, onDecline, onOpenGame }: {
  invitation: import('../messages.ts').GameInvitation;
  ownId: string | null;
  pending: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onOpenGame?: () => void;
}) {
  const context = invitation.acceptanceContext, recipient = ownId === invitation.inviteePublicPlayerId;
  return <View style={{ gap: 8 }}>
    <Label style={styles.subtitle}>{invitationCopy[invitation.status]}</Label>
    {context ? <><Label style={{ fontWeight: '700' }}>{context.title}</Label><Label>{new Date(context.startsAt).toLocaleString('ru', { timeZone: context.timezone })} · {context.timezone}</Label>
      <Label>{context.venueName} · {context.venueAddress}</Label><Label>{formatLabel(context.formatKey)} · {levelLabel({ scaleId: context.levelScaleId, scaleVersion: context.levelScaleVersion, allowedLevelIds: context.allowedLevelIds })}</Label>
      {context.activityKind === 'trainer_led' && <Label>С тренером{context.trainerDisplayName ? ` · ${context.trainerDisplayName}` : ''}</Label>}
      {context.trainingDescription && <Label>{context.trainingDescription}</Label>}
      <Label>{context.settlementPurpose === 'no_trainer_fee' ? 'Без тренерского сбора' : context.priceStatus === 'fixed' ? `${context.priceMinor ? (BigInt(context.priceMinor) / 100n).toString() + '.' + (BigInt(context.priceMinor) % 100n).toString().padStart(2, '0') : ''} ${context.currency} / игрока за занятие` : 'Цена по договорённости'}</Label>
      <Label>{context.settlementTerms}</Label><Label>Свободных мест: {context.availablePlaces}. Окончательное место проверяется при принятии.</Label></> : invitation.status === 'pending' && <Label>Условия сейчас недоступны. Обновите приглашение.</Label>}
    {recipient && invitation.status === 'pending' && <><PrimaryButton title="Принять приглашение" disabled={!!pending || !context} onPress={onAccept} />
      <TextButton title="Отклонить" onPress={onDecline} /></>}
    {invitation.status === 'accepted' && invitation.participationId && onOpenGame ? <TextButton title="Открыть игру" onPress={onOpenGame} /> : null}
  </View>;
}
export function NativeMessageThread({ resource }: { resource: MessageResource }) {
  const { owner, state } = useMessages(), auth = useAuth(), router = useRouter(), key = resourceKey(resource);
  const resourceRef = useRef(resource); resourceRef.current = resource;
  const detail = state.detail && resourceKey(state.detail.resource) === key ? state.detail : null;
  const pending = state.pending[key], draft = state.drafts[key] ?? '';
  const [showMembers, setShowMembers] = useState(false);
  const list = useRef<FlatList<DirectMessage>>(null), nearBottom = useRef(false), visibleIds = useRef<string[]>([]), initialScroll = useRef(true);
  const readVisible = useCallback(() => owner.visible(resourceRef.current, visibleIds.current, nearBottom.current), [owner]);
  const onViewable = useRef<NonNullable<FlatListProps<DirectMessage>['onViewableItemsChanged']>>(({ viewableItems }) => {
    visibleIds.current = viewableItems.filter(v => v.isViewable).map(v => v.item.id); readVisible();
  }).current;
  useFocusEffect(useCallback(() => {
    if (auth.status !== 'authenticated') return;
    initialScroll.current = true; nearBottom.current = false; visibleIds.current = [];
    const release = owner.leaseFocus(resourceRef.current);
    return () => { nearBottom.current = false; visibleIds.current = []; release(); };
  }, [owner, key, auth.status]));
  const h = detail?.header, direct = h && 'requestState' in h ? h : null, chat = h && 'lifecycleState' in h ? h : null, invitation = h && 'status' in h ? h : null;
  const title = direct?.peer.displayName ?? (chat ? 'Чат игры' : 'Приглашение в игру');
  const notice = <>{state.notice && <Label accessibilityRole="alert">{state.notice}</Label>}{pending?.state === 'unknown' && <PrimaryButton title="Проверить тем же запросом" onPress={() => { void owner.retry(resource, state.viewGeneration, state.actor); }} />}
    {pending?.state === 'sending' && <Label accessibilityLiveRegion="polite">Отправляем…</Label>}</>;
  if (auth.status !== 'authenticated') return <Page header={<MessageHeader name="Сообщения" />}><PrivateEntry /></Page>;
  if (!detail || detail.status !== 'ready' || !h) return <Page header={<MessageHeader name={title} />}><Label>{detail?.status === 'error' ? detail.error : 'Загружаем…'}</Label><TextButton title="Обновить" onPress={() => { void owner.loadDetail(resource); }} />{notice}</Page>;
  if (invitation) {
    return <Page keyboard header={<MessageHeader name="Приглашение в игру" subtitle="Участие и условия игры" />}>
      <View style={styles.card}><InvitationDecisionBody
        invitation={invitation} ownId={detail.ownId} pending={!!pending}
        onAccept={() => { void owner.act(resource, 'accept'); }}
        onDecline={() => { if (!pending) void owner.act(resource, 'decline'); }}
        onOpenGame={() => router.push(`/games/${invitation.gameId}` as '/games')}
      /></View>{notice}<TextButton title="Обновить" onPress={() => { void owner.loadDetail(resource); }} />
    </Page>;
  }
  const canSend = direct ? direct.requestState === 'accepted' && !owner.isPeerSafetyHeld(direct.peer.publicPlayerId) : chat?.lifecycleState === 'active';
  return <ScreenFrame keyboard header={<MessageHeader name={title} subtitle={direct ? requestCopy[direct.requestState] : chat?.lifecycleState === 'active' ? 'Участники игры' : 'Чат закрыт'} peer={direct?.peer} />}>
    {direct && <NativeSafety peerId={direct.peer.publicPlayerId} name={direct.peer.displayName} conversationId={direct.id} messages={detail.messages} />}
    {chat && <><TextButton title={showMembers ? 'Скрыть участников' : `Участники (${detail.members.length})`} onPress={() => setShowMembers(v => !v)} />
      {showMembers && <FlatList data={detail.members} keyExtractor={m => m.publicPlayerId} style={{ flexGrow: 0 }} renderItem={({ item }) => <Label style={{ padding: 8 }}>{item.displayName} · {item.role === 'manager' ? 'Организатор' : 'Участник'}</Label>} />}</>}
    <FlatList ref={list} data={detail.messages} keyExtractor={m => m.id} contentContainerStyle={{ padding: 12, gap: 8, flexGrow: 1 }}
      onViewableItemsChanged={onViewable} viewabilityConfig={{ itemVisiblePercentThreshold: 80, minimumViewTime: 250 }}
      onContentSizeChange={() => { if (initialScroll.current && detail.messages.length) { initialScroll.current = false; list.current?.scrollToEnd({ animated: false }); } }}
      onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; nearBottom.current = contentSize.height - layoutMeasurement.height - contentOffset.y <= 64; readVisible(); }} scrollEventThrottle={100}
      ListHeaderComponent={<>{detail.cursor && <TextButton title={detail.loadingMore ? 'Загружаем…' : 'Предыдущие сообщения'} onPress={() => { void owner.loadDetail(resource, true); }} />}{detail.error && <Label accessibilityRole="alert">{detail.error}</Label>}</>}
      ListEmptyComponent={<Label>Сообщений пока нет</Label>}
      renderItem={({ item }) => <View style={{ alignSelf: item.authorPublicPlayerId === detail.ownId ? 'flex-end' : 'flex-start', maxWidth: '92%', padding: 12, borderRadius: 16, backgroundColor: item.authorPublicPlayerId === detail.ownId ? colors.limeSoft : colors.paper }}>
        {chat && item.authorPublicPlayerId !== detail.ownId && <Label style={{ fontWeight: '600' }}>{detail.members.find(m => m.publicPlayerId === item.authorPublicPlayerId)?.displayName ?? 'Участник'}</Label>}
        <Label>{item.contentState === 'live' ? item.text : 'Сообщение недоступно'}</Label><Label style={{ fontSize: 12, color: colors.secondary }}>{new Date(item.createdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</Label>
      </View>} />
    <View style={{ padding: 12, borderTopWidth: 1, borderColor: colors.line, gap: 8 }}>
      {direct && direct.requestState !== 'accepted' && <><Label>{direct.requestState === 'pending' && direct.role === 'recipient' ? 'Принять запрос на общение?' : direct.requestState === 'pending' ? 'Запрос отправлен. Дождитесь ответа.' : requestCopy[direct.requestState]}</Label>
        {direct.requestState === 'pending' && direct.role === 'recipient' && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><PrimaryButton title="Принять" disabled={!!pending} onPress={() => { void owner.act(resource, 'accept'); }} /><TextButton title="Отклонить" onPress={() => { if (!pending) void owner.act(resource, 'decline'); }} /></View>}</>}
      {canSend && <><TextInput accessibilityLabel="Текст сообщения" multiline editable={!pending} value={draft} onChangeText={text => owner.draft(resource, text, state.viewGeneration, state.actor)} placeholder="Сообщение" style={[styles.input, { fontSize: 16, padding: 10 }]} />
        <PrimaryButton title="Отправить" disabled={!!pending || !draft.trim()} onPress={() => { void owner.act(resource, 'send', undefined, state.viewGeneration, state.actor); }} /></>}
      {notice}<View style={{ flexDirection: 'row', flexWrap: 'wrap' }}><TextButton title="Обновить" onPress={() => { initialScroll.current = true; void owner.loadDetail(resource); }} /><TextButton title="Новые сообщения" onPress={() => { void owner.catchUp(resource); }} /></View>
    </View>
  </ScreenFrame>;
}
