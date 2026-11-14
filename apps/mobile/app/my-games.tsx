import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/auth.tsx';
import { useResource } from '../src/hooks.ts';
import { publicApi } from '../src/public-api.ts';
import type { PublicGame } from '../src/public-api.ts';
import { myGameRows, participationLabels } from '../src/participation.ts';
import type { MyGameRow, ReadState } from '../src/participation.ts';
import { GameCard } from '../src/components/game-card.tsx';
import { ErrorState, Header, Label, Loading, Page, TextButton, styles } from '../src/components/ui.tsx';

type Filter = 'all' | 'managed' | 'participation' | 'pending' | 'confirmed';
const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Все' }, { value: 'managed', label: 'Создаю и управляю' },
  { value: 'participation', label: 'Заявки и участие' }, { value: 'pending', label: 'Ожидают решения' },
  { value: 'confirmed', label: 'Участие подтверждено' },
];
export default function MyGames() {
  const auth = useAuth(), router = useRouter(), coordinator = auth.participation;
  const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  const [filter, setFilter] = useState<Filter>('all');
  const actor = auth.me?.id, session = auth.me?.session.id;
  useEffect(() => {
    if (auth.status === 'authenticated') { void coordinator.loadOwn(); void coordinator.loadManaged(); }
  }, [coordinator, actor, session, auth.status]);
  const current = auth.status === 'authenticated' && snapshot.actor?.actorId === actor && snapshot.actor?.sessionId === session;
  const rows = current ? myGameRows(snapshot.managed.items, snapshot.own.items).filter(row =>
    filter === 'all' || (filter === 'managed' ? !!row.managed : filter === 'participation' ? row.parts.length > 0 : row.parts.some(p => p.status === filter))) : [];
  const complete = snapshot.own.status === 'ready' && snapshot.managed.status === 'ready';
  return <Page header={<Header back={() => router.canGoBack() ? router.back() : router.replace('/games')} />}>
    <Label accessibilityRole="header" style={styles.title}>Мои игры</Label>
    {auth.status === 'hydrating' ? <Loading title="Проверяем сессию…" /> : !current
      ? <><Label>Войдите, чтобы увидеть свои игры и заявки.</Label><TextButton title="Войти" onPress={() => router.push('/profile')} /></>
      : <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{filters.map(item => <TextButton key={item.value}
          title={`${filter === item.value ? '✓ ' : ''}${item.label}`} onPress={() => setFilter(item.value)} />)}</View>
        <SourceState title="Заявки и участие" source={snapshot.own} retry={coordinator.loadOwn} />
        <SourceState title="Создаю и управляю" source={snapshot.managed} retry={coordinator.loadManaged} />
        {complete && rows.length === 0 && <Label>В выбранном списке игр нет.</Label>}
        {rows.map(row => <OwnGame key={`${actor}:${session}:${row.gameId}`} row={row} />)}
        <TextButton title="Обновить мои игры" onPress={() => { void coordinator.loadOwn(); void coordinator.loadManaged(); }} />
        <Label>Управляемые игры доступны для просмотра. Действия организатора ещё не перенесены в native.</Label>
        <Label>Приглашения, рекомендации и итоги игр ещё не перенесены. Этот список пока охватывает управление, заявки и участие.</Label>
      </>}
  </Page>;
}
function SourceState<T>({ title, source, retry }: { title: string; source: ReadState<T>; retry: () => Promise<void> }) {
  return source.status === 'loading' || source.status === 'idle' ? <Loading title={`Загружаем: ${title}…`} />
    : source.status === 'error' ? <View style={styles.card}><Label>{title}: загрузка неполная. Это не пустой список.</Label>
      <TextButton title={`Повторить: ${title}`} onPress={() => void retry()} /></View> : null;
}
function OwnGame({ row }: { row: MyGameRow }) {
  const router = useRouter();
  const task = useCallback((signal: AbortSignal): Promise<PublicGame> => row.managed ? Promise.resolve(row.managed) : publicApi.game(row.gameId, signal), [row.gameId, row.managed]);
  const { state, retry } = useResource(`my-game:${row.gameId}`, task);
  return <View style={{ gap: 8 }}>
    <View style={styles.card}>
      {row.managed && <Label>{row.managed.management.role === 'owner' ? 'Создаю и управляю' : 'Управляю'} · только просмотр</Label>}
      {row.parts.map(part => <Label key={part.id}>{participationLabels[part.status]}</Label>)}
    </View>
    {state.status === 'loading' && <Loading title="Загружаем условия игры…" />}
    {state.status === 'error' && <><ErrorState error={state.error} retry={retry} /><Label>Связь с вашей заявкой сохранена. Условия игры сейчас недоступны.</Label></>}
    {state.data && <GameCard game={state.data} onOpen={() => router.push({ pathname: '/games/[id]', params: { id: row.gameId } })} />}
  </View>;
}
