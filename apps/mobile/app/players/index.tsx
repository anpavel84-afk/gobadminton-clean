import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth.tsx';
import { usePreferences } from '../../src/state.tsx';
import { useResource } from '../../src/hooks.ts';
import { publicApi } from '../../src/public-api.ts';
import { playerFilterKey, resetPlayerFilters } from '../../src/players.ts';
import { filterCities } from '../../src/entry.ts';
import { DiscoveryIcon } from '../../src/components/discovery-icon.tsx';
import { PlayerCard } from '../../src/components/player-card.tsx';
import { colors } from '../../src/theme.ts';
import { DiscoveryChip, ErrorState, Header, Label, Loading, PrimaryButton, ScreenFrame, TextButton, styles } from '../../src/components/ui.tsx';

export default function Players() {
  const auth = useAuth(), coordinator = auth.players, router = useRouter();
  const { preferences, hydrated } = usePreferences();
  const [citySelection, setCitySelection] = useState<string | null | undefined>(undefined);
  const [cityPicker, setCityPicker] = useState(false), [citySearch, setCitySearch] = useState('');
  const [areaKey, setAreaKey] = useState('');
  const [name, setName] = useState(''), [looking, setLooking] = useState(false), [trainer, setTrainer] = useState(false);
  const cityId = citySelection === undefined ? preferences.cityId : citySelection;
  const filters = useMemo(() => ({ cityId, name: name.trim(), areaKey: areaKey.trim(), looking, trainer }), [cityId, name, areaKey, looking, trainer]);
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
  const reset = () => {
    const cleared = resetPlayerFilters();
    setCitySelection(cleared.cityId); setName(cleared.name); setAreaKey(cleared.areaKey ?? '');
    setLooking(cleared.looking); setTrainer(cleared.trainer); setCityPicker(false); setCitySearch('');
  };
  return <ScreenFrame keyboard header={<Header />}>
    <FlatList data={list?.data?.items ?? []} keyExtractor={p => p.publicPlayerId}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 22, paddingBottom: 24, gap: 16 }}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        <Label accessibilityRole="header" style={[styles.title, { fontSize: 32, lineHeight: 35 }]}>Игроки</Label>
        <Label style={{ color: colors.secondary, fontSize: 13, lineHeight: 19 }}>Найдите партнёров для хорошей игры.</Label>
        <Pressable accessibilityRole="button" accessibilityLabel={`Город: ${city?.nameRu ?? (cityId ? 'Выбор недоступен' : 'Все города')}`} accessibilityState={{ expanded: cityPicker }} onPress={() => setCityPicker(v => !v)}
          style={{ minHeight: 66, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}><Label style={{ fontSize: 11, lineHeight: 16, color: colors.secondary }}>Город</Label>
            <Label style={{ fontSize: 14, lineHeight: 20, fontWeight: '600' }}>{city?.nameRu ?? (cityId ? 'Выбор недоступен' : 'Все города')}</Label></View><DiscoveryIcon name="chevron" />
        </Pressable>
        {cityPicker && <View style={styles.card}>
          <TextInput accessibilityLabel="Поиск города" placeholder="Найти город" value={citySearch} onChangeText={setCitySearch} style={styles.input} />
          <TextButton title="Все города" onPress={() => { setCitySelection(null); setCityPicker(false); }} />
          {cities.state.status === 'loading' && <Loading title="Загружаем города…" />}
          {cities.state.status === 'error' && <ErrorState error={cities.state.error} retry={cities.retry} />}
          {filterCities(cities.state.data ?? [], citySearch).map(c => <TextButton key={c.id} title={c.nameRu} onPress={() => { setCitySelection(c.id); setCityPicker(false); }} />)}
          {cities.state.status === 'ready' && !filterCities(cities.state.data ?? [], citySearch).length && <Label>Город не найден.</Label>}
        </View>}
        <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 }}>
          <DiscoveryIcon name="search" /><TextInput accessibilityLabel="Имя игрока" placeholder="Найти игрока" value={name} maxLength={80} onChangeText={setName}
            style={{ flex: 1, minWidth: 0, minHeight: 58, fontFamily: 'Onest', fontSize: 14, color: colors.ink, paddingVertical: 12 }} />
        </View>
        <TextInput accessibilityLabel="Район / метро" placeholder="Район / метро" value={areaKey} maxLength={64} onChangeText={setAreaKey} style={[styles.input, { fontSize: 14 }]} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <DiscoveryChip title="Все" selected={!looking && !trainer} onPress={() => { setLooking(false); setTrainer(false); }} />
          <DiscoveryChip title="Ищу игру" selected={looking} onPress={() => setLooking(v => !v)} />
          <DiscoveryChip title="Тренер" selected={trainer} onPress={() => setTrainer(v => !v)} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 12 }}>
          <View style={{ flexShrink: 1 }}><Label style={{ color: colors.purple, fontSize: 11, lineHeight: 16, letterSpacing: 0.8, textTransform: 'uppercase' }}>Игровое сообщество</Label>
            <Label accessibilityRole="header" style={[styles.subtitle, { fontSize: 24, lineHeight: 30 }]}>Все игроки</Label></View>
          <TextButton title="Сбросить фильтры" onPress={reset} />
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
