import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../../src/auth.tsx';
import { gamePath } from '../../src/native-auth-protocol.ts';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useResource } from '../../src/hooks.ts';
import { publicApi } from '../../src/public-api.ts';
import { PublicGameMedia } from '../../src/components/game-card.tsx';
import { deadline, formatLabel, gameTime, levelLabel, settlementLabel, statusLabel } from '../../src/presentation.ts';
import { canApply, dominantParticipation, participationLabels } from '../../src/participation.ts';
import { ErrorState, Header, Label, Loading, Page, PrimaryButton, TextButton, styles } from '../../src/components/ui.tsx';

export default function PublicGameDetails() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const auth = useAuth();
  const task = useCallback((signal: AbortSignal) => publicApi.game(id, signal), [id]);
  // Session establishment rereads public conditions even if this route stays mounted.
  const { state, retry } = useResource(`game:${id}:${auth.me?.session.id ?? 'public'}`, task);
  const privateSnapshot = useSyncExternalStore(auth.participation.subscribe, auth.participation.getSnapshot, auth.participation.getSnapshot);
  const currentDetail = auth.status === 'authenticated' && privateSnapshot.actor?.actorId === auth.me?.id && privateSnapshot.actor?.sessionId === auth.me?.session.id
    ? privateSnapshot.details[id] : undefined;
  const game = currentDetail?.status === 'ready' ? currentDetail.game : state.data;
  const format = game ? formatLabel(game.formatKey) : null;
  // This route never depends on story completion or city lookup.
  return <Page header={<Header back={() => { if (router.canGoBack()) router.back(); else router.replace('/games'); }} />}>
    {state.status === 'loading' && <Loading title="Загружаем условия игры…" />}
    {state.status === 'error' && <ErrorState error={state.error} retry={retry} />}
    {game && <>
      <Label accessibilityRole="header" style={styles.title}>{game.title}</Label>
      <Label>{statusLabel(game)}</Label>
      <PublicGameMedia key={game.id} game={game} />
      <View style={styles.card}>
        <Label accessibilityRole="header" style={styles.subtitle}>Когда и где</Label>
        <Label>{gameTime(game)}</Label>
        <Label>{game.venue.name}</Label>
        <Label>{game.venue.address}</Label>
        <Label>Заявки до: {deadline(game)} ({game.timezone})</Label>
      </View>
      <View style={styles.card}>
        <Label accessibilityRole="header" style={styles.subtitle}>Условия</Label>
        {format && <Label>Формат: {format}</Label>}
        <Label>Уровни: {levelLabel(game.levelRule)}</Label>
        <Label>Вместимость: {game.capacity}</Label>
        <Label>Подтверждено в приложении: {game.confirmedCount}</Label>
        <Label>Зарезервировано вне приложения: {game.externalReservedCount}</Label>
        <Label>Свободных мест по данным сервера: {game.availablePlaces}</Label>
        <Label>{settlementLabel(game)}</Label>
        <Label>{game.settlement.terms || 'Дополнительные условия расчётов не указаны.'}</Label>
        <Label>Расчёты проходят вне приложения.</Label>
        {game.activityKind === 'trainer_led' && <Label>{game.trainer ? `Тренер: ${game.trainer.displayName}` : 'Занятие с тренером'}</Label>}
        {game.trainingDescription && <Label>{game.trainingDescription}</Label>}
      </View>
      <View style={styles.card}>
        <Label accessibilityRole="header" style={styles.subtitle}>Организатор</Label>
        <Label>{game.organizer.displayName}</Label>
        <Label selectable>{game.organizer.publicContact || 'Публичный контакт не указан.'}</Label>
      </View>
      <ParticipationArea gameId={game.id} />
    </>}
  </Page>;
}

function ParticipationArea({ gameId }: { gameId: string }) {
  const auth = useAuth(), router = useRouter(), coordinator = auth.participation;
  const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  const session = auth.me?.session.id;
  useEffect(() => {
    if (auth.status === 'authenticated') void coordinator.loadDetail(gameId);
  }, [coordinator, gameId, session, auth.status]);
  const detail = snapshot.actor?.actorId === auth.me?.id && snapshot.actor?.sessionId === session ? snapshot.details[gameId] : undefined;
  const own = dominantParticipation(detail?.parts ?? []), command = detail?.command;
  const locked = command?.state === 'sending' || command?.state === 'unknown';
  return <View style={styles.card}>
    <Label accessibilityRole="header" style={styles.subtitle}>Заявка и участие</Label>
    <Label>Заявка ожидает решения организатора и не гарантирует место. Только подтверждённое участие занимает место.</Label>
    {auth.status === 'hydrating' ? <Loading title="Проверяем сессию…" /> : auth.status !== 'authenticated'
      ? <><Label>Войдите, чтобы увидеть свои заявки. После входа проверьте актуальные условия и отправьте заявку отдельным действием.</Label>
        <TextButton title="Войти и вернуться к этой игре" onPress={() => router.push({ pathname: '/profile', params: { returnTo: gamePath(gameId) ?? '' } })} /></>
      : <>
        {command?.state === 'sending' && <Label accessibilityLiveRegion="polite">Отправляем выбранное действие…</Label>}
        {command?.state === 'unknown' && <Label accessibilityLiveRegion="polite">Ответ не подтверждён. Повторная отправка заблокирована. Проверяем игру и ваши заявки; если результат ещё не виден, состояние остаётся неизвестным.</Label>}
        {command?.state === 'rejected' && <Label accessibilityLiveRegion="polite">Изменение не принято. Проверьте обновлённые условия и текущий статус перед новым подтверждением.</Label>}
        {command?.state === 'settled' && command.result && <Label accessibilityLiveRegion="polite">По данным сервера: {participationLabels[command.result.status]}.</Label>}
        {(!detail || detail.status === 'loading') && <Loading title="Проверяем игру и все ваши заявки…" />}
        {detail?.status === 'error' && <><Label>Не удалось проверить все данные. Отсутствие заявки не подтверждено.</Label>
          <TextButton title="Повторить проверку" onPress={() => void coordinator.loadDetail(gameId)} /></>}
        {detail?.status === 'ready' && detail.game && <>
          <Label>Свободных мест сейчас: {detail.game.availablePlaces}. Заявки до: {deadline(detail.game)}.</Label>
          {detail.parts.length ? detail.parts.map(part => <Label key={part.id}>{participationLabels[part.status]}</Label>) : <Label>Ваших заявок на эту игру нет.</Label>}
          {!locked && !detail.review && <>
            {(!own || !['pending', 'confirmed'].includes(own.status)) && <PrimaryButton title="Подать заявку" disabled={!canApply(detail.game)} onPress={() => coordinator.review(gameId, 'request')} />}
            {own && ['pending', 'confirmed'].includes(own.status) && <TextButton title={own.status === 'pending' ? 'Отозвать заявку' : 'Отказаться от участия'} onPress={() => coordinator.review(gameId, 'withdraw')} />}
            {!canApply(detail.game) && !own && <Label>Сейчас подать заявку нельзя: проверьте статус, срок и наличие мест.</Label>}
          </>}
          {!locked && detail.review && <>
            <Label>{detail.review === 'request' ? 'Отправить заявку на текущих условиях? Подтверждение организатора потребуется отдельно.'
              : own?.status === 'confirmed' ? 'Отказаться от подтверждённого участия? Ваше место освободится.' : 'Отозвать ожидающую заявку?'}</Label>
            <PrimaryButton title={detail.review === 'request' ? 'Подтвердить отправку заявки' : 'Подтвердить отказ / отзыв'}
              disabled={detail.review === 'request' ? !canApply(detail.game) || !!own && ['pending', 'confirmed'].includes(own.status) : !own || !['pending', 'confirmed'].includes(own.status)} onPress={() => void coordinator.confirm(gameId)} />
            <TextButton title="Отмена" onPress={() => coordinator.review(gameId)} />
          </>}
        </>}
        <TextButton title="Обновить условия и статус" onPress={() => void coordinator.loadDetail(gameId)} />
        <TextButton title="Мои игры" onPress={() => router.push('/my-games')} />
      </>}
  </View>;
}
