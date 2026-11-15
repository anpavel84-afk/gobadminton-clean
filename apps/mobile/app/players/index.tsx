import { useRadar } from '../../src/radar-runtime.tsx';
import { RadarControls } from '../../src/components/radar-controls.tsx';
import { NativeMap } from '../../src/components/native-map.tsx';
import { VenueSheet } from '../../src/components/venue-sheet.tsx';
import { loadMapSnapshot, mapDataKey, mapPackForCity, nativeRadarMapAllowed, nativeRadarPeople, playersMapContext, venueSchedules, visibleMapVenues } from '../../src/maps.ts';
import type { MapCamera, MapSnapshot } from '../../src/maps.ts';
import { mergeRadarPlayers, radarPlayer } from '../../src/radar.ts';
import type { UnifiedRow } from '../../src/radar.ts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { FlatList, Modal, Pressable, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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
  const auth = useAuth(), coordinator = auth.players, router = useRouter(), params = useLocalSearchParams();
  const routeContext = playersMapContext(params);
  const { owner: radar, state: radarState } = useRadar();
  const [focused,setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const mapOpen = routeContext?.view === 'map' && focused;
  const [camera,setCamera] = useState<MapCamera | null>(null), [selectedVenue,setSelectedVenue] = useState<string | null>(null);
  const [selectedPerson,setSelectedPerson] = useState<UnifiedRow | null>(null), [expanded,setExpanded] = useState(false);
  const [showPeople,setShowPeople] = useState(true), [venueMode,setVenueMode] = useState<'all'|'with_games'>('all');
  const [sheetHeight,setSheetHeight] = useState(0);
  const measureSheet = useCallback((height: number) => setSheetHeight(height), []);
  const { preferences, hydrated } = usePreferences();
  const [citySelection, setCitySelection] = useState<string | null | undefined>(routeContext?.filters.cityId);
  const [cityPicker, setCityPicker] = useState(false), [citySearch, setCitySearch] = useState('');
  const [areaKey, setAreaKey] = useState(routeContext?.filters.areaKey ?? '');
  const [name, setName] = useState(routeContext?.filters.name ?? ''), [looking, setLooking] = useState(routeContext?.filters.looking ?? false), [trainer, setTrainer] = useState(routeContext?.filters.trainer ?? false);
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
  useLayoutEffect(() => { radar.setFilters(filters); }, [radar, filters]);
  useEffect(() => { setSelectedPerson(null); }, [radarState.generation]);
  const mapCityId = cityId ?? radarState.query?.cityId ?? preferences.cityId ?? '';
  useEffect(() => {setCamera(null);setSelectedVenue(null);setSelectedPerson(null);}, [mapCityId]);
  const mapFilters = useMemo(() => ({}), []);
  const mapTask = useCallback(async (signal: AbortSignal): Promise<MapSnapshot | null> => mapOpen ? loadMapSnapshot(publicApi,mapCityId,mapFilters,signal) : null, [mapOpen,mapCityId,mapFilters]);
  const mapResource = useResource(`${mapOpen}:${mapDataKey(mapCityId,mapFilters)}`, mapTask);
  const mapData = mapResource.state.status === 'ready' ? mapResource.state.data : null;
  const pack = mapPackForCity(mapCityId);
  const schedules = mapData ? venueSchedules(mapData,mapFilters,Date.now()) : null;
  const counts = schedules ? new Map([...schedules].map(([id,games]) => [id,games.length])) : null;
  const mapVenues = pack && mapData ? visibleMapVenues(mapData.venues,counts,venueMode,pack) : [];
  const selection = mapData?.venues.find(v => v.id === selectedVenue);
  const peopleAllowed = nativeRadarMapAllowed(radarState.config,radarState.query,mapCityId);
  const people = peopleAllowed && pack && showPeople ? nativeRadarPeople(radarState.pins,pack) : [];
  useEffect(() => { if (mapOpen && radarState.query && !radarState.busy) void radar.map(); }, [mapOpen,radarState.query?.query.queryRef,radar]);
  const closeMap = () => {
    if (selectedPerson) setSelectedPerson(null);
    else if (selection) { if (expanded) setExpanded(false); else setSelectedVenue(null); }
    else router.setParams({view:'list'});
  };
  const contact = (row: UnifiedRow) => {
    const context = radar.contactContext(row);
    if (context && auth.contact.stageRadar(context)) router.push(`/messages/new/${row.publicPlayerId}`);
  };
  const list = snapshot.list.key === key && snapshot.scope && validName ? snapshot.list : null;
  const retry = () => { void coordinator.loadList(filters); };
  const more = () => { const cursor = list?.data?.nextCursor; if (cursor) void coordinator.loadList(filters, cursor); };
  const reset = () => {
    const cleared = resetPlayerFilters();
    setCitySelection(cleared.cityId); setName(cleared.name); setAreaKey(cleared.areaKey ?? '');
    setLooking(cleared.looking); setTrainer(cleared.trainer); setCityPicker(false); setCitySearch('');
  };
  const visibleRows = radarState.filterKey === key ? radarState.rows.filter(row => row.radar && Date.parse(row.radar.validUntil) > Date.now()) : [];
  const merged = mergeRadarPlayers(list?.data?.items ?? [],visibleRows);
  return <ScreenFrame keyboard header={<Header />}>
    <Modal visible={mapOpen} animationType="none" presentationStyle="fullScreen" onRequestClose={closeMap}>
      <ScreenFrame>
        {pack ? <NativeMap key={pack.version} pack={pack} venues={mapVenues} counts={counts} selected={selectedVenue} camera={camera}
          controlBottom={selection ? sheetHeight+24 : 24} statusTop={140} onCamera={setCamera} onSelect={id => {setSelectedPerson(null);setSelectedVenue(id);}} onCatalog={() => router.setParams({view:'list'})}
          people={people} onPerson={row => {setSelectedVenue(null);setSelectedPerson(row);}} /> : <Label>Карта этого города пока недоступна.</Label>}
        <View style={{position:'absolute',top:16,left:16,right:16,gap:8,backgroundColor:colors.card,borderRadius:12,padding:8}}>
          <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><TextButton title="К списку" onPress={closeMap} /><RadarControls compact /></View>
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
            <DiscoveryChip title="Все площадки" selected={venueMode==='all'} onPress={() => setVenueMode('all')} />
            <DiscoveryChip title="С играми" selected={venueMode==='with_games'} onPress={() => setVenueMode('with_games')} />
            <DiscoveryChip title="Игроки рядом" selected={showPeople} onPress={() => setShowPeople(v => !v)} />
          </View>
          {!peopleAllowed && <Label>Площадки доступны. Для игроков рядом включите Radar и обновите список.</Label>}
          {mapResource.state.status==='error' && <TextButton title="Обновить площадки" onPress={mapResource.retry} />}
          {radarState.mapPage?.nextMapCursor && <TextButton title="Следующее окно игроков" onPress={() => {setSelectedPerson(null);void radar.map(true);}} />}
        </View>
        {selectedPerson && people.includes(selectedPerson) && <View style={[styles.card,{position:'absolute',bottom:24,left:16,right:16}]}>
          <Label>{selectedPerson.player.displayName}</Label><Label>Примерное местоположение</Label>
          <PrimaryButton title="Написать" onPress={() => contact(selectedPerson)} /><TextButton title="Закрыть игрока" onPress={() => setSelectedPerson(null)} />
        </View>}
        {selection && <VenueSheet key={selection.id} selection={selection} expanded={expanded} games={schedules?.get(selection.id) ?? (schedules ? [] : null)}
          onExpand={setExpanded} onClose={() => setSelectedVenue(null)} onRetrySchedule={mapResource.retry} onMeasure={measureSheet} />}
      </ScreenFrame>
    </Modal>
    <FlatList data={merged.ordinary} keyExtractor={p => p.publicPlayerId}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 22, paddingBottom: 24, gap: 16 }}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        <Label accessibilityRole="header" style={[styles.title, { fontSize: 32, lineHeight: 35 }]}>Игроки</Label>
        <Label style={{ color: colors.secondary, fontSize: 13, lineHeight: 19 }}>Найдите партнёров для хорошей игры.</Label>
        <RadarControls />
        <TextButton title="На карте" onPress={() => router.setParams({view:'map',cityId:cityId ?? '',name:filters.name,areaKey:filters.areaKey ?? '',looking:looking?'1':'0',trainer:trainer?'1':'0'})} />
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
        {merged.nearby.map(row => <View key={`radar:${row.publicPlayerId}`} style={{gap:8}}>
          <Label>Рядом · примерное местоположение</Label>
          <PlayerCard player={radarPlayer(row)} city={cities.state.data?.find(c => c.id===row.player.cityId)?.nameRu} onOpen={() => contact(row)} />
          <TextButton title="Написать" onPress={() => contact(row)} />
        </View>)}
        {radarState.query?.page.nextCursor && <TextButton title="Ещё участников Radar" onPress={() => {void radar.query(false,true);}} />}
        {radarState.activation?.state==='active' && <TextButton title="Обновить Radar" onPress={() => {void radar.query();}} />}
        {!validName && <Label>Введите не менее двух символов имени.</Label>}
        {(!hydrated || auth.status === 'hydrating') && <Loading title="Восстанавливаем настройки и сессию…" />}
        {auth.status !== 'hydrating' && !snapshot.scope && <View style={styles.card}>
          <Label>Каталог для текущей сессии недоступен. Проверьте вход в профиле.</Label>
          <TextButton title="Профиль" onPress={() => router.push('/profile')} />
        </View>}
        {list?.status === 'loading' && <Loading title="Загружаем игроков…" />}
        {list?.status === 'error' && <ErrorState error={list.error} retry={retry} />}
        {list?.status === 'ready' && !list.data?.items.length && !merged.nearby.length && <View style={styles.card}>
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
