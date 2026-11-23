import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/auth.tsx';
import { participationLabels } from '../src/participation.ts';
import { hubRows, hubView, hubBucket, sortHubRows, pendingInviteCount } from '../src/my-games.ts';
import type { HubRow } from '../src/my-games.ts';
import { attendanceLabel, needsAttention } from '../src/postgame.ts';
import { PublicApiError } from '../src/public-api.ts';
import {
  bindPublicRoleFocusRef,
  rememberPublicRoleFocusTarget,
  type PublicRoleFocusHandle,
} from '../src/public-role-reviews.ts';
import { colors } from '../src/theme.ts';
import { GameCard } from '../src/components/game-card.tsx';
import { MyGameInvitations } from '../src/components/my-game-invitation.tsx';
import { PostgameSurface, CommandReview, ReminderActions, SourceNotice } from '../src/components/postgame.tsx';
import { DiscoveryChip, ErrorState, Header, Label, Loading, OutlineButton, Page, PrimaryButton, TextButton, styles } from '../src/components/ui.tsx';
const filters = [
  { value: 'all', label: 'Все' },
  { value: 'manage', label: 'Создаю и управляю' },
  { value: 'participate', label: 'Заявки и участие' },
  { value: 'invites', label: 'Приглашения' },
] as const;
export default function MyGames() {
  const auth = useAuth(), router = useRouter(), owner = auth.postgame, participation = auth.participation;
  const s = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const p = useSyncExternalStore(participation.subscribe, participation.getSnapshot, participation.getSnapshot);
  const actor = auth.me?.id, session = auth.me?.session.id;
  const current = auth.status === 'authenticated' && s.actor?.actorId === actor && s.actor?.sessionId === session && p.actor?.actorId === actor;
  const [activeInvite, setActiveInvite] = useState<string | null>(null);
  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    if (p.own.status === 'idle') void participation.loadOwn(); if (p.managed.status === 'idle') void participation.loadManaged();
    if (s.own.status === 'idle') void owner.loadOwn(); if (s.reminders.status === 'idle') void owner.loadReminders();
    if (s.invitations.status === 'idle') void owner.loadInvitations();
  }, [auth.status, actor, session, owner, participation, p.own.status, p.managed.status, s.own.status, s.reminders.status, s.invitations.status]);
  const invites = s.invitations.data?.items ?? [];
  const all = current ? hubRows(p.managed.items, p.own.items, s.own.data?.items ?? [], s.reminders.data?.items ?? [], invites) : [];
  const { rows, attention, empty } = hubView(all, s.filter), target = attention[0];
  const complete = p.own.status === 'ready' && p.managed.status === 'ready' && s.own.status === 'ready' && s.reminders.status === 'ready' && s.invitations.status === 'ready';
  const pendingLoaded = pendingInviteCount(invites);
  const pendingPartial = Boolean(s.invitations.data?.nextCursor);
  const inviteBadge = s.invitations.status === 'ready' && pendingLoaded > 0
    ? `${pendingLoaded}${pendingPartial ? '+' : ''}` : null;
  const groups = [['upcoming', 'Предстоящие'], ['draft', 'Черновики'], ['past', 'История'], ['terminal', 'Завершённые заявки и отмены'], ['unknown', 'Дата недоступна']] as const;
  return <PostgameSurface><Page header={<Header />}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <Label accessibilityRole="header" style={[styles.title, { flex: 1 }]}>Мои игры</Label>
      {current ? <PrimaryButton title="Создать игру" onPress={() => router.push('/games/create')} /> : null}
    </View>
    {auth.status === 'hydrating' ? <Loading title="Проверяем сессию…" /> : !current ? <>
      <Label>Войдите, чтобы видеть свои игры</Label><TextButton title="Войти" onPress={() => void auth.signIn('/my-games')} />
    </> : <>
      <CommandReview />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{filters.map(f => <DiscoveryChip key={f.value}
        title={f.value === 'invites' && inviteBadge ? `${f.label} · ${inviteBadge}` : f.label}
        selected={s.filter === f.value}
        onPress={() => { owner.filter(f.value); }} />)}</View>
      {attention.length > 0 && target ? <Pressable accessibilityRole="link"
        accessibilityLabel={`После игры ждут ответа · ${attention.length}${s.own.data?.nextCursor ? '+' : ''}. К итогам`}
        onPress={() => router.push({ pathname: '/my-games/[gameId]/results', params: { gameId: target.gameId } })}
        style={{ backgroundColor: colors.lavender, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16 }}>
        <Label style={{ fontWeight: '700', textAlign: 'left' }}>После игры ждут ответа · {attention.length}{s.own.data?.nextCursor ? '+' : ''} | К итогам ↓</Label>
      </Pressable> : null}
      <SourceNotice title="Управляемые игры" status={p.managed.status} retry={() => void participation.loadManaged()} />
      <SourceNotice title="Заявки и участия" status={p.own.status} retry={() => void participation.loadOwn()} />
      <SourceNotice title="Приглашения" status={s.invitations.status} retry={() => void owner.loadInvitations()} />
      <SourceNotice title="Ваши итоги" status={s.own.status} retry={() => void owner.loadOwn()} />
      <SourceNotice title="Напоминания" status={s.reminders.status} retry={() => void owner.loadReminders()} />
      {s.reminders.status === 'ready' && s.reminders.data?.installed === false && <Label>Напоминания сейчас недоступны.</Label>}
      {complete && empty === 'filter' && <><Label>В выбранном фильтре нет загруженных игр.</Label><TextButton title="Показать все" onPress={() => owner.filter('all')} /></>}
      {complete && empty === 'loaded' && <><Label>В загруженных источниках пока нет ваших игр.</Label><PrimaryButton title="Найти игру" align="left" onPress={() => router.push('/games')} /></>}
      {groups.map(([bucket, title]) => {
        const getGame = (r: HubRow) => p.games[r.gameId]?.game ?? r.managed;
        const items = sortHubRows(rows.filter(r => hubBucket(r, getGame(r)) === bucket), bucket, getGame);
        if (!items.length && bucket !== 'upcoming' && bucket !== 'past') return null;
        return <View key={bucket} style={{ gap: 16 }}><Label accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700' }}>{title}</Label>
          {bucket === 'past' && <Label>История показывает исход заявки или статус игры. Это не подтверждает присутствие на площадке и не означает оплату.</Label>}
          {!items.length && complete && (bucket === 'upcoming'
            ? <><Label>В этом фильтре нет предстоящих игр.</Label><OutlineButton title="Найти игру" onPress={() => router.push('/games')} /></>
            : <Label>В загруженных источниках история этого фильтра пуста.</Label>)}
          {items.map(row => <OwnGame key={`${actor}:${session}:${row.gameId}`} row={row} activeInvite={activeInvite} onActiveInvite={setActiveInvite} />)}</View>;
      })}
      {s.invitations.data?.nextCursor && <TextButton title={s.invitations.status === 'loading' ? 'Загружаем…' : 'Показать ещё приглашения'} onPress={() => void owner.loadInvitations(true)} />}
      {s.own.data?.nextCursor && <TextButton title={s.own.status === 'loading' ? 'Загружаем…' : 'Показать ещё итоги'} onPress={() => void owner.loadOwn(true)} />}
      <TextButton title="Обновить мои игры" onPress={() => {
        void participation.loadOwn(); void participation.loadManaged();
        void owner.loadOwn(); void owner.loadReminders(); void owner.loadInvitations();
      }} />
      <View style={{ gap: 8 }}>
        <Label accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700' }}>Отзывы</Label>
        <PublicOwnReviewsEntry onOpen={() => owner.openOwnPublicHistory()} />
      </View>
    </>}
  </Page></PostgameSurface>;
}
/** Records initiator for public own-history sheet focus return (shared public-role focus target). */
function PublicOwnReviewsEntry({ onOpen }: { onOpen: () => void }) {
  const held = useRef<PublicRoleFocusHandle | null>(null);
  const setRef = useRef((node: ComponentRef<typeof Pressable> | null) => {
    bindPublicRoleFocusRef(held, node);
  }).current;
  return <Pressable
    ref={setRef}
    accessibilityRole="button"
    onPress={() => {
      rememberPublicRoleFocusTarget(held.current);
      onOpen();
    }}
    style={styles.textButton}
  >
    <Label>Мои публичные отзывы о ролях</Label>
  </Pressable>;
}
function OwnGame({ row, activeInvite, onActiveInvite }: {
  row: HubRow; activeInvite: string | null; onActiveInvite: (id: string | null) => void;
}) {
  const router = useRouter(), auth = useAuth(), owner = auth.participation;
  const p = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  useEffect(() => { if (!p.games[row.gameId]) void owner.loadGame(row.gameId); }, [owner, row.gameId, p.games]);
  const state = p.games[row.gameId], game = state?.game ?? row.managed;
  const unavailable = state?.status === 'error' && (
    state.error instanceof PublicApiError && (state.error.kind === 'unavailable' || state.error.status === 404)
  );
  const inviteUnavailable = unavailable && row.invites.length > 0;
  return <View style={{ gap: 8 }}>
    {game ? <GameCard game={game} onOpen={() => router.push({ pathname: '/games/[id]', params: { id: row.gameId } })} /> : <View style={styles.card}>
      <Label>{row.own[0]?.gameTitle ?? row.reminders[0]?.gameTitle ?? (row.invites.length ? 'Приглашение в игру' : 'Игра')}</Label>
      <Label>{row.own[0]?.endsAt ?? row.reminders[0]?.endsAt ?? 'Дата и время недоступны'}</Label>
      {inviteUnavailable ? <Label>Условия игры доступны в приглашении ниже.</Label> : null}
    </View>}
    {(!state || state.status === 'loading') && <Loading title="Загружаем условия игры…" />}
    {state?.status === 'error' && !inviteUnavailable && <ErrorState error={state.error} retry={() => void owner.loadGame(row.gameId)} />}
    <View style={styles.card}>
      {row.managed && <><Label>{row.managed.management.role === 'owner' ? 'Создаю и управляю' : 'Управляю'}</Label><TextButton title="Управление игрой" onPress={() => router.push({ pathname: '/games/manage/[id]', params: { id: row.gameId } })} /></>}
      {row.parts.map(part => <Label key={part.id}>{participationLabels[part.status]}</Label>)}
      {row.own.map(r => <Label key={r.contextId}>{attendanceLabel(r.attendance.value)}{needsAttention(r) ? ' · Ждёт вашего ответа' : ''}</Label>)}
      {row.invites.length > 0 ? <MyGameInvitations invitations={row.invites} activeId={activeInvite} onActive={onActiveInvite} /> : null}
      <TextButton title="Участники / Итоги" onPress={() => router.push({ pathname: '/my-games/[gameId]/results', params: { gameId: row.gameId } })} />
      {row.reminders.map(r => <ReminderActions key={r.id} item={r} />)}
    </View>
  </View>;
}
