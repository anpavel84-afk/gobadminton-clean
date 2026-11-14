import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { FlatList, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth.tsx';
import { usePreferences } from '../../src/state.tsx';
import { useResource } from '../../src/hooks.ts';
import { publicApi } from '../../src/public-api.ts';
import { playerFilterKey } from '../../src/players.ts';
import { filterCities } from '../../src/entry.ts';
import { PlayerCard } from '../../src/components/player-card.tsx';
import { ErrorState, Header, Label, Loading, PrimaryButton, ScreenFrame, TextButton, styles } from '../../src/components/ui.tsx';

export default function Players() {
  const auth = useAuth(), coordinator = auth.players, router = useRouter(), insets = useSafeAreaInsets();
  const { preferences, hydrated } = usePreferences();
  const [citySelection, setCitySelection] = useState<string | null | undefined>(undefined);
  const [cityPicker, setCityPicker] = useState(false), [citySearch, setCitySearch] = useState('');
  const [name, setName] = useState(''), [looking, setLooking] = useState(false), [trainer, setTrainer] = useState(false);
  const cityId = citySelection === undefined ? preferences.cityId : citySelection;
  const filters = useMemo(() => ({ cityId, name: name.trim(), looking, trainer }), [cityId, name, looking, trainer]);
  const key = playerFilterKey(filters), validName = !filters.name || Array.from(filters.name).length >= 2;
  const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  const citiesTask = useCallback((signal: AbortSignal) => publicApi.cities(signal), []);
  const cities = useResource('cities', citiesTask);
  const city = cities.state.data?.find(c => c.id === cityId);
  useEffect(() => {
    if (hydrated && snapshot.scope && validName) void coordinator.loadList(filters);
  }, [coordinator, filters, hydrated, snapshot.scope, validName]);
  const list = snapshot.list.key === key && snapshot.scope && validName ? snapshot.list : null;
  const retry = () => { void coordinator.loadList(filters); };
  const more = () => { const cursor = list?.data?.nextCursor; if (cursor) void coordinator.loadList(filters, cursor); };
  return <ScreenFrame keyboard header={<Header />}>
    <FlatList data={list?.data?.items ?? []} keyExtractor={p => p.publicPlayerId}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: insets.bottom + 24, gap: 14 }}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        <Label accessibilityRole="header" style={styles.title}>Игроки</Label>
        <Label>Найдите партнёров по игре и тренеров в своём городе.</Label>
        <TextButton title={`Город: ${city?.nameRu ?? (cityId ? 'Выбор недоступен' : 'Все города')}`} onPress={() => setCityPicker(v => !v)} />
        {cityPicker && <View style={styles.card}>
          <TextInput accessibilityLabel="Поиск города" placeholder="Найти город" value={citySearch} onChangeText={setCitySearch} style={styles.input} />
          <TextButton title="Все города" onPress={() => { setCitySelection(null); setCityPicker(false); }} />
          {cities.state.status === 'loading' && <Loading title="Загружаем города…" />}
          {cities.state.status === 'error' && <ErrorState error={cities.state.error} retry={cities.retry} />}
          {filterCities(cities.state.data ?? [], citySearch).map(c => <TextButton key={c.id} title={c.nameRu} onPress={() => { setCitySelection(c.id); setCityPicker(false); }} />)}
          {cities.state.status === 'ready' && !filterCities(cities.state.data ?? [], citySearch).length && <Label>Город не найден.</Label>}
        </View>}
        <TextInput accessibilityLabel="Имя игрока" placeholder="Имя игрока" value={name} maxLength={80} onChangeText={setName} style={styles.input} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <TextButton title={`${looking ? '✓ ' : ''}Ищу игру`} onPress={() => setLooking(v => !v)} />
          <TextButton title={`${trainer ? '✓ ' : ''}Тренер`} onPress={() => setTrainer(v => !v)} />
        </View>
        {!validName && <Label>Введите не менее двух символов имени.</Label>}
        {(!hydrated || auth.status === 'hydrating') && <Loading title="Восстанавливаем настройки и сессию…" />}
        {auth.status !== 'hydrating' && !snapshot.scope && <View style={styles.card}>
          <Label>Каталог для текущей сессии недоступен. Проверьте вход в профиле.</Label>
          <TextButton title="Профиль" onPress={() => router.push('/profile')} />
        </View>}
        {list?.status === 'loading' && <Loading title="Загружаем игроков…" />}
        {list?.status === 'error' && <ErrorState error={list.error} retry={retry} />}
        {list?.status === 'ready' && !list.data?.items.length && <View style={styles.card}>
          <Label accessibilityRole="header" style={styles.subtitle}>Игроки не найдены</Label>
          <Label>По выбранным фильтрам пока нет доступных игроков.</Label>
          <TextButton title="Обновить" onPress={retry} />
        </View>}
      </View>}
      renderItem={({ item }) => <PlayerCard player={item} city={cities.state.data?.find(c => c.id === item.cityId)?.nameRu}
        onOpen={() => router.push({ pathname: '/players/[publicPlayerId]', params: { publicPlayerId: item.publicPlayerId } })} />}
      ListFooterComponent={<View style={{ gap: 12 }}>
        {list?.moreError != null && <><Label>Не удалось загрузить следующую страницу. Загруженные игроки сохранены.</Label><ErrorState error={list.moreError} retry={more} /></>}
        {list?.data?.nextCursor && !list.moreError && <PrimaryButton title={list.loadingMore ? 'Загружаем…' : 'Показать ещё'} disabled={list.loadingMore} onPress={more} />}
      </View>} />
  </ScreenFrame>;
}
