import { useEffect, useState, useSyncExternalStore } from 'react';
import { View, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import type { Game } from '@gobadminton/contracts/game-types';
import { useAuth } from '../auth.tsx';
import { formatLabel, levelLabel, gameTime, deadline, settlementLabel } from '../presentation.ts';
import { participationLabels } from '../participation.ts';
import { Label, Page, Header, Loading, PrimaryButton, TextButton, styles } from './ui.tsx';
import { colors, typography } from '../theme.ts';
export function ManagedTerms({ game }: { game: Game }) {
  const format = formatLabel(game.formatKey);
  return <View style={styles.card}>
    <Label style={styles.subtitle}>{game.title}</Label><Label>{game.venue.name} · {game.venue.address}</Label>
    <Label>{gameTime(game)}</Label>
    <Label>{format ?? 'Формат уточняется'} · Уровни игроков: {levelLabel(game.levelRule)}</Label>
    <Label>{game.activityKind === 'trainer_led' ? `С тренером · ${game.trainer?.displayName ?? 'Информация о тренере недоступна'}` : 'Обычная игра'}</Label>
    <Label>{game.visibility === 'public' ? 'В поиске' : 'Только по ссылке'}</Label>
    <Label>Подтверждено: {game.confirmedCount} · Свободно: {game.availablePlaces} · Вместимость: {game.capacity} · Вне сервиса: {game.externalReservedCount}</Label>
    <Label>Заявки до: {deadline(game)}</Label><Label>{settlementLabel(game)}</Label><Label>{game.settlement.terms}</Label><Label>Публичный контакт: {game.organizer.publicContact}</Label>
    {!!game.trainingDescription && <Label>{game.trainingDescription}</Label>}
  </View>;
}
export function ManagementCommand() {
  const owner = useAuth().gameManagement, state = useSyncExternalStore(owner.subscribe,owner.getSnapshot,owner.getSnapshot);
  return <>{state.command?.status === 'sending' && <Loading title="Выполняем команду…" />}
    {state.notice && <Label accessibilityLiveRegion="polite">{state.notice}</Label>}
    {state.command?.status === 'unknown' && <>
      <Label>{({create:'Создание игры',publish:'Публикация игры',confirm:'Подтверждение заявки',reject:'Отклонение заявки',remove:'Снятие участия'})[state.command.packet.kind]} · {state.command.packet.kind === 'create' ? state.command.packet.body.title || 'Игра' : state.command.packet.gameId}</Label>
      <PrimaryButton title="Проверить ту же команду" onPress={() => void owner.reconcile()} />
    </>}</>;
}
export function GameManagement({ id }: { id: string }) {
  const auth = useAuth(), owner = auth.gameManagement, router = useRouter();
  const state = useSyncExternalStore(owner.subscribe,owner.getSnapshot,owner.getSnapshot), d = state.details[id];
  const [reason,setReason] = useState('');
  useEffect(() => { setReason(''); if (auth.status === 'authenticated') void owner.loadDetail(id); }, [owner,id,auth.status,state.actor?.actorId,state.actor?.sessionId,state.actor?.generation]);
  const current = auth.status === 'authenticated' && state.actor?.actorId === auth.me?.id;
  const locked = ['sending','unknown'].includes(state.command?.status ?? '');
  const mutable = d?.status === 'ready' && d.roster === 'ready' && d.game?.status === 'published' && Date.parse(d.game.startsAt) > Date.now() && !locked;
  return <Page keyboard header={<Header back={() => router.replace('/my-games')} />}><Label style={styles.title}>Управление игрой</Label>
    {auth.status === 'hydrating' ? <Loading title="Проверяем сессию…" /> : !current ? <><Label>Сводка доступна создателю или менеджеру.</Label><PrimaryButton title="Войти" onPress={() => void auth.signIn(`/games/manage/${id}`)} /></>
      : !d || d.status === 'loading' ? <Loading title="Загружаем сводку…" />
      : d.status !== 'ready' || !d.game ? <><Label>{d.status === 'denied' ? 'Игра не в вашем списке управления. Возможно, доступ изменился.' : 'Не удалось загрузить сводку.'}</Label><TextButton title="Обновить" onPress={() => void owner.loadDetail(id)} /></>
      : <>
        <ManagedTerms game={d.game} />
        <Label>{({ draft: 'Черновик', published: 'Опубликовано', cancelled: 'Игра отменена', completed: 'Завершена' })[d.game.status]}</Label>
        <Label>{d.management?.role === 'owner' ? 'Создаю и управляю' : 'Управляю'}</Label>
        <ManagementCommand />
        {d.game.status === 'draft' && <PrimaryButton title="Опубликовать черновик" disabled={locked} onPress={() => void owner.publishDraft(id)} />}
        <Label>Изменение вместимости и отмена игры пока недоступны.</Label>
        <Label style={styles.subtitle}>Заявки и состав</Label><Label>Заявки ждут вашего ответа. Место занято после подтверждения.</Label>
        {d.roster === 'loading' && <Loading title="Загружаем заявки…" />}
        {d.roster === 'error' && <Label>Не удалось загрузить заявки. Без актуального списка действия недоступны.</Label>}
        <TextButton title="Обновить" onPress={() => void owner.loadDetail(id)} />
        {mutable && <><Label>Причина отклонения или снятия</Label><TextInput accessibilityLabel="Причина отклонения или снятия" value={reason} onChangeText={setReason} maxLength={1000} multiline allowFontScaling
          style={{ minHeight: 48, padding: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12, fontFamily: typography.fontFamily, fontSize: 16, color: colors.ink }} /></>}
        {d.roster === 'ready' && (['pending','confirmed','history'] as const).map(group => {
          const items = d.participants.filter(p => group === 'history' ? !['pending','confirmed'].includes(p.status) : p.status === group);
          return <View key={group} style={{ gap: 12 }}><Label style={styles.subtitle}>{group === 'pending' ? 'Ждут ответа' : group === 'confirmed' ? 'В составе' : 'История заявок'} · {items.length}</Label>
            {!items.length && <Label>{group === 'pending' ? 'Новых заявок нет.' : group === 'confirmed' ? 'Подтверждённых участников пока нет.' : 'Истории заявок пока нет.'}</Label>}
            {items.map(p => <View style={styles.card} key={p.id}><Label>Участник {p.userId.slice(0,8)}</Label>{p.isCreatorOrganizer && <Label>Создатель игры · участник</Label>}<Label>{participationLabels[p.status]}</Label><Label>{new Date(p.requestedAt).toLocaleString('ru-RU')}</Label>
              {mutable && group === 'pending' && <><PrimaryButton title="Подтвердить" disabled={d.game!.availablePlaces < 1} onPress={() => void owner.decide(id,p.id,'confirm',reason)} /><TextButton title="Отклонить" onPress={() => void owner.decide(id,p.id,'reject',reason)} /></>}
              {mutable && group === 'confirmed' && <TextButton title="Снять" onPress={() => void owner.decide(id,p.id,'remove',reason)} />}</View>)}
          </View>;
        })}
        {d.cursor && d.roster === 'ready' && <TextButton title="Ещё участники" onPress={() => void owner.moreParticipants(id)} />}
      </>}
  </Page>;
}
