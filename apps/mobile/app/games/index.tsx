import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { selectedCity } from '../../src/entry.ts';
import { useResource, useUpcomingItems } from '../../src/hooks.ts';
import { publicApi } from '../../src/public-api.ts';
import type { GamePage, PublicGame } from '../../src/public-api.ts';
import { appendUpcomingPage } from '../../src/upcoming.ts';
import { usePreferences } from '../../src/state.tsx';
import { discoveryCityHeading } from '../../src/presentation.ts';
import { colors } from '../../src/theme.ts';
import { GameCard } from '../../src/components/game-card.tsx';
import { ErrorState, Header, Label, Loading, PrimaryButton, ScreenFrame, TextButton, styles } from '../../src/components/ui.tsx';

const noGames: PublicGame[] = [];
export default function GuestGames() {
  const { preferences, hydrated, storageError } = usePreferences();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
  return <ScreenFrame header={<Header />}>
    <FlatList data={city ? items : noGames} keyExtractor={game => game.id}
      keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: insets.bottom + 24, gap: 14 }}
      ListHeaderComponent={<View style={feed.header}>
        <View style={feed.copy}>
          <Label style={feed.eyebrow}>Игры рядом{city ? ` · ${city.nameRu}` : ''}</Label>
          <Label accessibilityRole="header" style={feed.title}>Игры{city ? ' ' : ''}<Label style={[feed.title, { color: colors.purple }]}>{city ? `${discoveryCityHeading(city.nameRu)}.` : ''}</Label></Label>
          <Label style={{ color: colors.secondary }}>Настоящие люди. Большой бадминтон. Выбирайте игру или тренировку и выходите на корт.</Label>
        </View>
        <View style={feed.selectors}>
          <Pressable accessibilityRole="button" accessibilityLabel="Выбрать другой город" onPress={selectCity}
            style={({ pressed }) => [feed.selector, pressed && { backgroundColor: colors.paper }]}>
            <Label style={feed.hint}>Город</Label>
            <Label style={{ fontWeight: '600' }}>{city?.nameRu ?? (preferences.cityId ? 'Выбор недоступен' : 'Не выбран')}</Label>
          </Pressable>
          <View style={feed.selector} accessible accessibilityLabel="Когда: все ближайшие игры">
            <Label style={feed.hint}>Когда</Label>
            <Label style={{ fontWeight: '600' }}>Все ближайшие</Label>
          </View>
        </View>
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
        </>}
      </View>}
      renderItem={({ item }) => <GameCard game={item} cityName={cities.state.data?.find(candidate => candidate.id === item.venue.cityId)?.nameRu}
        onOpen={() => router.push({ pathname: '/games/[id]', params: { id: item.id } })} />}
      ListFooterComponent={city && state.data?.nextCursor && state.status !== 'error'
        ? <PrimaryButton title="Показать ещё" disabled={state.status === 'loading'} onPress={more} /> : null} />
  </ScreenFrame>;
}
const feed = StyleSheet.create({
  header: { gap: 20 },
  copy: { gap: 12 },
  eyebrow: { alignSelf: 'flex-start', backgroundColor: colors.lime, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, fontWeight: '600', fontSize: 14, lineHeight: 20 },
  title: { fontSize: 36, lineHeight: 40, fontWeight: '700' },
  selectors: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selector: { minHeight: 66, justifyContent: 'center', flexGrow: 1, flexBasis: 140, minWidth: 0, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 9, gap: 3 },
  hint: { color: colors.secondary, fontSize: 14, lineHeight: 20 },
});
