import { useCallback } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { selectedCity } from '../../src/entry.ts';
import { useResource, useUpcomingItems } from '../../src/hooks.ts';
import { publicApi } from '../../src/public-api.ts';
import type { GamePage, PublicGame } from '../../src/public-api.ts';
import { appendUpcomingPage } from '../../src/upcoming.ts';
import { usePreferences } from '../../src/state.tsx';
import { gameTime, settlementLabel, statusLabel } from '../../src/presentation.ts';
import { colors } from '../../src/theme.ts';
import { ErrorState, Header, Hero, Label, Loading, Page, PrimaryButton, TextButton, styles } from '../../src/components/ui.tsx';

const noGames: PublicGame[] = [];
export default function GuestGames() {
  const { preferences, hydrated, storageError } = usePreferences();
  const router = useRouter();
  const citiesTask = useCallback((signal: AbortSignal) => publicApi.cities(signal), []);
  const cities = useResource('cities', citiesTask);
  const city = selectedCity(cities.state.data ?? [], preferences.cityId);
  const cityId = city?.id ?? null;
  const key = `games:${cityId ?? 'none'}`;
  const gamesTask = useCallback((signal: AbortSignal): Promise<GamePage> => cityId
    ? publicApi.games(cityId, undefined, signal) : Promise.resolve({ items: [], nextCursor: null }), [cityId]);
  const { state, retry, resource } = useResource(key, gamesTask);
  const items = useUpcomingItems(state.data?.items ?? noGames);
  const more = () => {
    const cursor = state.data?.nextCursor;
    if (!cityId || !cursor || state.status === 'loading') return;
    void resource.load(key, signal => publicApi.games(cityId, cursor, signal), appendUpcomingPage);
  };
  const selectCity = () => router.push('/city');
  return <Page>
    <Header />
    <View style={styles.cityHeader}>
      <Label style={{ color: colors.cityInk }}>Ваш город: {city?.nameRu ?? (preferences.cityId ? 'выбор сохранён' : 'не выбран')}</Label>
      <TextButton title="Выбрать другой город" onPress={selectCity} />
    </View>
    <Hero title="Игра начинается здесь" body="Гостевой просмотр расписания и условий игр." />
    {storageError && <Label>Настройки недоступны. Выбранный город действует в этом запуске.</Label>}
    {(!hydrated || cities.state.status === 'loading') && <Loading title="Загружаем города…" />}
    {cities.state.status === 'error' && <ErrorState error={cities.state.error} retry={cities.retry} />}
    {hydrated && cities.state.status === 'ready' && !city && <View style={styles.card}>
      <Label accessibilityRole="header" style={styles.subtitle}>{preferences.cityId ? 'Сохранённый город недоступен' : 'Сначала выберите город'}</Label>
      <Label>{preferences.cityId ? 'В текущем каталоге такого города нет. Выберите доступный город вручную.' : 'Покажем игры в выбранном городе.'}</Label>
      <PrimaryButton title="Выбрать город" onPress={selectCity} />
    </View>}
    {city && <>
      <Label accessibilityRole="header" style={styles.subtitle}>Предстоящие игры · {city.nameRu}</Label>
      {state.status === 'loading' && <Loading />}
      {state.status === 'error' && <ErrorState error={state.error} retry={state.data?.nextCursor ? more : retry} />}
      {state.status === 'ready' && !items.length && <View style={styles.card} accessibilityLiveRegion="polite">
        <Label style={styles.subtitle}>Игр пока нет</Label>
        <Label>Для этого города сейчас нет предстоящих игр в загруженной части каталога.</Label>
        <TextButton title="Обновить" onPress={retry} />
      </View>}
      {items.map(game => <View key={game.id} style={styles.card}>
        <Label style={styles.subtitle} accessibilityRole="header">{game.title}</Label>
        <Label>{gameTime(game)}</Label>
        <Label>{game.venue.name} · {game.venue.address}</Label>
        <Label>{statusLabel(game)} · Свободных мест: {game.availablePlaces}</Label>
        <Label>{settlementLabel(game)}</Label>
        <TextButton title="Условия игры" onPress={() => router.push({ pathname: '/games/[id]', params: { id: game.id } })} />
      </View>)}
      {state.data?.nextCursor && state.status !== 'error' && <PrimaryButton title="Показать ещё" disabled={state.status === 'loading'} onPress={more} />}
    </>}
  </Page>;
}
