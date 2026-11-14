import { useCallback } from 'react';
import { useAuth } from '../../src/auth.tsx';
import { gamePath } from '../../src/native-auth-protocol.ts';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useResource } from '../../src/hooks.ts';
import { publicApi } from '../../src/public-api.ts';
import { PublicGameMedia } from '../../src/components/game-card.tsx';
import { deadline, formatLabel, gameTime, levelLabel, settlementLabel, statusLabel } from '../../src/presentation.ts';
import { ErrorState, Header, Label, Loading, Page, TextButton, styles } from '../../src/components/ui.tsx';

export default function PublicGameDetails() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const auth = useAuth();
  const task = useCallback((signal: AbortSignal) => publicApi.game(id, signal), [id]);
  // Session establishment rereads public conditions even if this route stays mounted.
  const { state, retry } = useResource(`game:${id}:${auth.me?.session.id ?? 'public'}`, task);
  const game = state.data;
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
      <View style={styles.card}>
        <Label>Подача заявки в native пока недоступна. Вход не отправляет заявку автоматически.</Label>
        {auth.status === 'hydrating' ? <Loading title="Проверяем сессию…" />
          : auth.status !== 'authenticated' && <TextButton title="Войти и вернуться к этой игре" onPress={() => router.push({ pathname: '/profile', params: { returnTo: gamePath(game.id) ?? '' } })} />}
      </View>
    </>}
  </Page>;
}
