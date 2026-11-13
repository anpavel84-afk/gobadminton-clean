import { useCallback } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useResource } from '../../src/hooks.ts';
import { publicApi } from '../../src/public-api.ts';
import { deadline, gameTime, settlementLabel, statusLabel } from '../../src/presentation.ts';
import { ErrorState, Header, Label, Loading, Page, PrimaryButton, styles } from '../../src/components/ui.tsx';

export default function PublicGameDetails() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const task = useCallback((signal: AbortSignal) => publicApi.game(id, signal), [id]);
  const { state, retry } = useResource(`game:${id}`, task);
  const game = state.data;
  // This route never depends on story completion or city lookup.
  return <Page>
    <Header back={() => { if (router.canGoBack()) router.back(); else router.replace('/games'); }} />
    {state.status === 'loading' && <Loading title="Загружаем условия игры…" />}
    {state.status === 'error' && <ErrorState error={state.error} retry={retry} />}
    {game && <>
      <Label accessibilityRole="header" style={styles.title}>{game.title}</Label>
      <Label>{statusLabel(game)}</Label>
      <View style={styles.card}>
        <Label accessibilityRole="header" style={styles.subtitle}>Когда и где</Label>
        <Label>{gameTime(game)}</Label>
        <Label>{game.venue.name}</Label>
        <Label>{game.venue.address}</Label>
        <Label>Заявки до: {deadline(game)} ({game.timezone})</Label>
      </View>
      <View style={styles.card}>
        <Label accessibilityRole="header" style={styles.subtitle}>Условия</Label>
        <Label>Формат: {game.formatKey}</Label>
        <Label>Уровни: {game.levelRule.allowedLevelIds.length ? game.levelRule.allowedLevelIds.join(', ') : 'не указаны'} (шкала {game.levelRule.scaleId}, версия {game.levelRule.scaleVersion})</Label>
        <Label>Вместимость: {game.capacity}</Label>
        <Label>Подтверждено в приложении: {game.confirmedCount}</Label>
        <Label>Зарезервировано вне приложения: {game.externalReservedCount}</Label>
        <Label>Свободных мест по данным сервера: {game.availablePlaces}</Label>
        <Label>{settlementLabel(game)}</Label>
        <Label>{game.settlement.terms || 'Дополнительные условия расчётов не указаны.'}</Label>
        <Label>Расчёты проходят вне приложения.</Label>
        {game.activityKind === 'trainer_led' && <Label>Занятие с тренером{game.trainer ? `: ${game.trainer.displayName} (по заявлению тренера)` : ''}</Label>}
        {game.trainingDescription && <Label>{game.trainingDescription}</Label>}
      </View>
      <View style={styles.card}>
        <Label accessibilityRole="header" style={styles.subtitle}>Организатор</Label>
        <Label>{game.organizer.displayName}</Label>
        <Label selectable>{game.organizer.publicContact || 'Публичный контакт не указан.'}</Label>
      </View>
      <View style={styles.card}>
        <Label>Сейчас доступен гостевой просмотр. Вход и подача заявки в этой версии приложения пока недоступны.</Label>
        <PrimaryButton title="Подача заявки пока недоступна" disabled />
      </View>
    </>}
  </Page>;
}
