import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState, FlatList, Image, TextInput, View } from 'react-native';
import type { FlatListProps } from 'react-native';
import { useFocusEffect, usePathname, useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import type { MessagesCoordinator } from '../messages-coordinator.ts';
import { resourceKey } from '../messages-coordinator.ts';
import { inboxDestination } from '../messages.ts';
import type { DirectMessage, MessagePeer, MessageResource } from '../messages.ts';
import { playerMediaUrl } from '../media.ts';
import { formatLabel, levelLabel } from '../presentation.ts';
import { colors } from '../theme.ts';
import { Label, Page, PrimaryButton, ScreenFrame, TextButton, styles } from './ui.tsx';

const Owner = createContext<MessagesCoordinator | null>(null);
/** Stable sibling of participation, owned above the Stack; no route owns credentials or packets. */
export function MessagesOwner({ children }: PropsWithChildren) {
  const auth = useAuth(), owner = auth.messages;
  useEffect(() => {
    const release = owner.mount();
    owner.setForeground(AppState.currentState === 'active');
    const listener = AppState.addEventListener('change', state => { owner.setForeground(state === 'active'); if (state === 'active') void owner.loadCounts(); });
    return () => { listener.remove(); release(); owner.setForeground(false); };
  },[owner]);
  useEffect(() => { if (auth.status === 'authenticated') void owner.loadCounts(); },[auth.status,owner]);
  return <Owner.Provider value={owner}>{children}</Owner.Provider>;
}
export function useMessages() {
  const owner = useContext(Owner); if (!owner) throw new Error('MessagesOwner missing');
  const state = useSyncExternalStore(owner.subscribe,owner.getSnapshot,owner.getSnapshot);
  return { owner, state };
}
function MessageAvatar({ peer }: { peer: MessagePeer }) {
  const [failed,setFailed] = useState<string[]>([]);
  const uri = [peer.avatar?.uploadedUrl,peer.avatar?.providerUrl].map(v => playerMediaUrl(v,'avatar')).find(v => v && !failed.includes(v));
  return <View accessible={false} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF0B8', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    {uri ? <Image source={{ uri }} style={{ width: 44,height: 44 }} onError={() => setFailed(v => [...v,uri])} /> : <Label>{peer.displayName.trim().split(/\s+/).slice(0,2).map(s => s[0]).join('')}</Label>}
  </View>;
}
function MessageHeader({ name, subtitle, peer }: { name: string; subtitle?: string; peer?: MessagePeer }) {
  const router = useRouter();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
    <TextButton title="Назад" onPress={() => router.navigate('/messages')} />
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
  const { state,owner } = useMessages(), auth = useAuth(), router = useRouter();
  useFocusEffect(useCallback(() => {
    if (auth.status !== 'authenticated') return;
    return owner.leaseFocus('inbox');
  },[owner,auth.status]));
  return <ScreenFrame header={<Label accessibilityRole="header" style={styles.subtitle}>Сообщения</Label>}>
    {auth.status !== 'authenticated' ? <PrivateEntry /> : <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 }}>{(['all','unread','attention'] as const).map((filter,i) => <TextButton key={filter}
        title={`${state.filter === filter ? '✓ ' : ''}${['Все','Непрочитанные','Требуют ответа'][i]}`} onPress={() => { void owner.loadInbox(filter); }} />)}</View>
      <FlatList data={state.inbox?.items ?? []} keyExtractor={i => `${i.kind}:${i.id}`} contentContainerStyle={{ padding: 16, gap: 8, flexGrow: 1 }}
        refreshing={state.inboxStatus === 'loading'} onRefresh={() => { void owner.loadInbox(); }}
        ListEmptyComponent={<Label>{state.inboxStatus === 'loading' ? 'Загружаем сообщения…' : state.inboxStatus === 'error' ? 'Не удалось загрузить сообщения' : state.inboxStatus === 'ready' ? 'Здесь пока пусто. Здесь появятся переписки, приглашения и чаты ваших игр.' : 'Сообщения'}</Label>}
        renderItem={({ item }) => <View style={{ borderBottomColor: colors.line,borderBottomWidth: 1,paddingVertical: 8 }}>
          <View style={{ flexDirection: 'row',alignItems: 'center',gap: 8 }}>{item.peer && <MessageAvatar peer={item.peer} />}
            <View style={{ flex: 1 }}><TextButton title={item.title} onPress={() => router.push(inboxDestination(item) as '/messages')} /><Label style={{ color: colors.secondary }}>{item.subtitle}</Label></View>
            {(item.unreadCount > 0 || item.attention) && <Label accessibilityLabel={`${item.unreadCount} непрочитанных${item.attention ? ', требует ответа' : ''}`} style={{ backgroundColor: colors.limeSoft, padding: 4 }}>{item.unreadCount > 0 ? item.unreadCount : '•'}</Label>}</View>
        </View>}
        ListFooterComponent={<>{state.inboxError && <Label accessibilityRole="alert">Не удалось загрузить. Повторите обновление.</Label>}
          {(state.inboxStatus === 'error' || state.notice) && <TextButton title="Повторить" onPress={() => { void owner.loadInbox(); }} />}
          {state.inbox?.nextCursor && <PrimaryButton disabled={state.loadingMore} title="Ещё сообщения" onPress={() => { void owner.loadInbox(state.filter,state.inbox!.nextCursor!); }} />}</>} />
    </>}
  </ScreenFrame>;
}
const requestCopy = { pending: 'Запрос на общение', accepted: 'Переписка', declined: 'Запрос отклонён', expired: 'Срок запроса истёк', closed: 'Переписка закрыта' };
const invitationCopy = { pending: 'Вас приглашают в игру', accepted: 'Приглашение принято', declined: 'Приглашение отклонено', expired: 'Срок приглашения истёк', revoked: 'Приглашение отозвано', cancelled_by_game: 'Игра отменена' };
export function NativeMessageThread({ resource }: { resource: MessageResource }) {
  const { owner,state } = useMessages(), auth = useAuth(), router = useRouter(), key = resourceKey(resource);
  const resourceRef = useRef(resource); resourceRef.current = resource;
  const detail = state.detail && resourceKey(state.detail.resource) === key ? state.detail : null;
  const pending = state.pending[key], draft = state.drafts[key] ?? '';
  const [showMembers,setShowMembers] = useState(false);
  const list = useRef<FlatList<DirectMessage>>(null), nearBottom = useRef(false), visibleIds = useRef<string[]>([]), initialScroll = useRef(true);
  const readVisible = useCallback(() => owner.visible(resourceRef.current,visibleIds.current,nearBottom.current),[owner]);
  const onViewable = useRef<NonNullable<FlatListProps<DirectMessage>['onViewableItemsChanged']>>(({ viewableItems }) => {
    visibleIds.current = viewableItems.filter(v => v.isViewable).map(v => v.item.id); readVisible();
  }).current;
  useFocusEffect(useCallback(() => {
    if (auth.status !== 'authenticated') return;
    initialScroll.current = true; nearBottom.current = false; visibleIds.current = [];
    const release = owner.leaseFocus(resourceRef.current);
    return () => { nearBottom.current = false; visibleIds.current = []; release(); };
  },[owner,key,auth.status]));
  const h = detail?.header, direct = h && 'requestState' in h ? h : null, chat = h && 'lifecycleState' in h ? h : null, invitation = h && 'status' in h ? h : null;
  const title = direct?.peer.displayName ?? (chat ? 'Чат игры' : 'Приглашение в игру');
  const notice = <>{state.notice && <Label accessibilityRole="alert">{state.notice}</Label>}{pending?.state === 'unknown' && <PrimaryButton title="Проверить тем же запросом" onPress={() => { void owner.retry(resource); }} />}
    {pending?.state === 'sending' && <Label accessibilityLiveRegion="polite">Отправляем…</Label>}</>;
  if (auth.status !== 'authenticated') return <Page header={<MessageHeader name="Сообщения" />}><PrivateEntry /></Page>;
  if (!detail || detail.status !== 'ready' || !h) return <Page header={<MessageHeader name={title} />}><Label>{detail?.status === 'error' ? detail.error : 'Загружаем…'}</Label><TextButton title="Обновить" onPress={() => { void owner.loadDetail(resource); }} />{notice}</Page>;
  if (invitation) {
    const context = invitation.acceptanceContext, recipient = detail.ownId === invitation.inviteePublicPlayerId;
    return <Page keyboard header={<MessageHeader name="Приглашение в игру" subtitle="Участие и условия игры" />}>
      <View style={styles.card}><Label style={styles.subtitle}>{invitationCopy[invitation.status]}</Label>
        {context ? <><Label style={{ fontWeight: '700' }}>{context.title}</Label><Label>{new Date(context.startsAt).toLocaleString('ru',{ timeZone: context.timezone })} · {context.timezone}</Label>
          <Label>{context.venueName} · {context.venueAddress}</Label><Label>{formatLabel(context.formatKey)} · {levelLabel({ scaleId: context.levelScaleId, scaleVersion: context.levelScaleVersion, allowedLevelIds: context.allowedLevelIds })}</Label>
          {context.activityKind === 'trainer_led' && <Label>С тренером{context.trainerDisplayName ? ` · ${context.trainerDisplayName}` : ''}</Label>}
          {context.trainingDescription && <Label>{context.trainingDescription}</Label>}
          <Label>{context.settlementPurpose === 'no_trainer_fee' ? 'Без тренерского сбора' : context.priceStatus === 'fixed' ? `${context.priceMinor ? (BigInt(context.priceMinor)/100n).toString() + '.' + (BigInt(context.priceMinor)%100n).toString().padStart(2,'0') : ''} ${context.currency} / игрока за занятие` : 'Цена по договорённости'}</Label>
          <Label>{context.settlementTerms}</Label><Label>Свободных мест: {context.availablePlaces}. Окончательное место проверяется при принятии.</Label></> : invitation.status === 'pending' && <Label>Условия сейчас недоступны. Обновите приглашение.</Label>}
        {recipient && invitation.status === 'pending' && <><PrimaryButton title="Принять приглашение" disabled={!!pending || !context} onPress={() => { void owner.act(resource,'accept'); }} />
          <TextButton title="Отклонить" onPress={() => { if (!pending) void owner.act(resource,'decline'); }} /></>}
        {invitation.status === 'accepted' && invitation.participationId && <TextButton title="Открыть игру" onPress={() => router.push(`/games/${invitation.gameId}` as '/games')} />}
      </View>{notice}<TextButton title="Обновить" onPress={() => { void owner.loadDetail(resource); }} />
    </Page>;
  }
  const canSend = direct?.requestState === 'accepted' || chat?.lifecycleState === 'active';
  return <ScreenFrame keyboard header={<MessageHeader name={title} subtitle={direct ? requestCopy[direct.requestState] : chat?.lifecycleState === 'active' ? 'Участники игры' : 'Чат закрыт'} peer={direct?.peer} />}>
    {chat && <><TextButton title={showMembers ? 'Скрыть участников' : `Участники (${detail.members.length})`} onPress={() => setShowMembers(v => !v)} />
      {showMembers && <FlatList data={detail.members} keyExtractor={m => m.publicPlayerId} style={{ flexGrow: 0 }} renderItem={({ item }) => <Label style={{ padding: 8 }}>{item.displayName} · {item.role === 'manager' ? 'Организатор' : 'Участник'}</Label>} />}</>}
    <FlatList ref={list} data={detail.messages} keyExtractor={m => m.id} contentContainerStyle={{ padding: 12, gap: 8, flexGrow: 1 }}
      onViewableItemsChanged={onViewable} viewabilityConfig={{ itemVisiblePercentThreshold: 80, minimumViewTime: 250 }}
      onContentSizeChange={() => { if (initialScroll.current && detail.messages.length) { initialScroll.current = false; list.current?.scrollToEnd({ animated: false }); } }}
      onScroll={event => { const { contentOffset,contentSize,layoutMeasurement } = event.nativeEvent; nearBottom.current = contentSize.height - layoutMeasurement.height - contentOffset.y <= 64; readVisible(); }} scrollEventThrottle={100}
      ListHeaderComponent={<>{detail.cursor && <TextButton title={detail.loadingMore ? 'Загружаем…' : 'Предыдущие сообщения'} onPress={() => { void owner.loadDetail(resource,true); }} />}{detail.error && <Label accessibilityRole="alert">{detail.error}</Label>}</>}
      ListEmptyComponent={<Label>Сообщений пока нет</Label>}
      renderItem={({ item }) => <View style={{ alignSelf: item.authorPublicPlayerId === detail.ownId ? 'flex-end' : 'flex-start', maxWidth: '92%', padding: 12, borderRadius: 16, backgroundColor: item.authorPublicPlayerId === detail.ownId ? colors.limeSoft : colors.paper }}>
        {chat && item.authorPublicPlayerId !== detail.ownId && <Label style={{ fontWeight: '600' }}>{detail.members.find(m => m.publicPlayerId === item.authorPublicPlayerId)?.displayName ?? 'Участник'}</Label>}
        <Label>{item.contentState === 'live' ? item.text : 'Сообщение недоступно'}</Label><Label style={{ fontSize: 12, color: colors.secondary }}>{new Date(item.createdAt).toLocaleTimeString('ru',{ hour: '2-digit', minute: '2-digit' })}</Label>
      </View>} />
    <View style={{ padding: 12, borderTopWidth: 1, borderColor: colors.line, gap: 8 }}>
      {direct && direct.requestState !== 'accepted' && <><Label>{direct.requestState === 'pending' && direct.role === 'recipient' ? 'Принять запрос на общение?' : direct.requestState === 'pending' ? 'Запрос отправлен. Дождитесь ответа.' : requestCopy[direct.requestState]}</Label>
        {direct.requestState === 'pending' && direct.role === 'recipient' && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><PrimaryButton title="Принять" disabled={!!pending} onPress={() => { void owner.act(resource,'accept'); }} /><TextButton title="Отклонить" onPress={() => { if (!pending) void owner.act(resource,'decline'); }} /></View>}</>}
      {canSend && <><TextInput accessibilityLabel="Текст сообщения" multiline editable={!pending} value={draft} onChangeText={text => owner.draft(resource,text)} placeholder="Сообщение" style={[styles.input,{ fontSize: 16, padding: 10 }]} />
        <PrimaryButton title="Отправить" disabled={!!pending || !draft.trim()} onPress={() => { void owner.act(resource,'send'); }} /></>}
      {notice}<View style={{ flexDirection: 'row',flexWrap: 'wrap' }}><TextButton title="Обновить" onPress={() => { initialScroll.current = true; void owner.loadDetail(resource); }} /><TextButton title="Новые сообщения" onPress={() => { void owner.catchUp(resource); }} /></View>
    </View>
  </ScreenFrame>;
}
