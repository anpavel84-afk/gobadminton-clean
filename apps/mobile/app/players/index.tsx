import { useRadar } from '../../src/radar-runtime.tsx';
import { usePlayInterest } from '../../src/play-interest-runtime.tsx';
import { RadarControls } from '../../src/components/radar-controls.tsx';
import { NativeMap } from '../../src/components/native-map.tsx';
import { VenueSheet } from '../../src/components/venue-sheet.tsx';
import { loadMapSnapshot, mapControlBottom, mapDataKey, mapPackForCity, nativeRadarMapAllowed, nativeRadarPeople, playersMapContext, venueSchedules, visibleMapVenues } from '../../src/maps.ts';
import type { MapCamera, MapSnapshot, SheetMeasurement } from '../../src/maps.ts';
import { mergeRadarPlayers, parseRadarPreview, radarPlayer } from '../../src/radar.ts';
import type { UnifiedRow, UnifiedPreview, RadarRead } from '../../src/radar.ts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentRef } from 'react';
import { FlatList, Modal, Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nativeAuth } from '../../src/auth-runtime.ts';
import type { RadarContactContext } from '../../src/contact.ts';
import type { Actor } from '../../src/participation.ts';
import { playerLevelLabel } from '../../src/presentation.ts';
import { useAuth } from '../../src/auth.tsx';
import { usePreferences } from '../../src/state.tsx';
import { useResource } from '../../src/hooks.ts';
import { publicApi } from '../../src/public-api.ts';
import type { PlayersCoordinator, PlayersSnapshot } from '../../src/players.ts';
import { playerFilterKey, resetPlayerFilters } from '../../src/players.ts';
import { cityFieldLabel, filterCities } from '../../src/entry.ts';
import { DiscoveryIcon } from '../../src/components/discovery-icon.tsx';
import { PlayerAvatar, PlayerCard, PlayerProfile } from '../../src/components/player-card.tsx';
import { colors } from '../../src/theme.ts';
import { DiscoveryChip, DiscoverySheet, ErrorState, Header, iosModalOrientations, Label, Loading, PrimaryButton, ScreenFrame, TextButton, styles } from '../../src/components/ui.tsx';

/** An inspection redeems only the selected Radar proof; it never looks up a public profile. */
export async function loadPlayerInspection(context: RadarContactContext, read: (operation: RadarRead, actor: Actor) => Promise<unknown>, now = Date.now): Promise<UnifiedPreview> {
  if (!context.valid()) throw new Error('Retired Radar selection');
  const preview = parseRadarPreview(await read({kind:'preview',resultRef:context.resultRef,target:context.target},context.actor),context.target,now());
  if (!context.valid()) throw new Error('Retired Radar selection');
  return preview;
}
export function playerDistance(preview: UnifiedPreview): string {
  const d = preview.radar.distance;
  if (!d) return 'Расстояние неизвестно · примерное местоположение';
  const meters = d.kind === 'range' ? d.upperMeters : d.roundedMeters;
  const value = meters >= 1000 ? `${Math.round(meters/100)/10} км` : `${meters} м`;
  return d.kind === 'range' ? `Примерно в пределах ${value}` : `Примерно ${value}`;
}
export function radarContactAvailable(row: UnifiedRow, preview: UnifiedPreview | null, now = Date.now()): boolean {
  return row.player.canRequestContact === true && (!preview || preview.player.publicPlayerId === row.publicPlayerId && preview.player.canRequestContact === true && Date.parse(preview.radar.validUntil) > now);
}
/** Fresh authorized detail only; the Radar proof remains the inspection/contact authority. */
export async function loadExpandedPlayerInspection(coordinator: PlayersCoordinator, context: RadarContactContext, preview: UnifiedPreview,
  current: () => boolean, now = Date.now): Promise<PlayersSnapshot['detail']> {
  const {actor,target} = context, scope = `native:${actor.actorId}:${actor.sessionId}:${actor.generation}`;
  const valid = () => current() && context.valid() && coordinator.getSnapshot().scope === scope &&
    preview.player.publicPlayerId === target && Date.parse(preview.radar.validUntil) > now();
  if (!valid()) throw new Error('Retired player detail inspection');
  // safetyReread bypasses ONLY clearUnavailable on 404. The same scoped reader, auth,
  // generation, detail sequence and target checks still apply; the ordinary list survives.
  const work = coordinator.loadDetail(target,true), pending = coordinator.getSnapshot().detail;
  let retired = false;
  let completed: PlayersSnapshot['detail'] | null = null;
  const unsubscribe = coordinator.subscribe(() => {
    const detail = coordinator.getSnapshot().detail;
    if (!valid() || detail.id !== target || detail !== pending && detail.status === 'loading' || completed && detail !== completed) retired = true;
    if (!retired && detail !== pending && detail.status !== 'loading') completed = detail;
  });
  try {
    await work;
    const detail = coordinator.getSnapshot().detail;
    if (retired || !valid() || !completed || detail !== completed || detail.id !== target ||
      !['ready','error'].includes(detail.status) || detail.status === 'ready' && detail.data?.publicPlayerId !== target) {
      throw new Error('Retired player detail response');
    }
    return detail;
  } finally { unsubscribe(); }
}
export default function Players() {
  const auth = useAuth(), coordinator = auth.players, router = useRouter(), params = useLocalSearchParams(), insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const routeContext = playersMapContext(params);
  const { owner: radar, state: radarState } = useRadar();
  const { owner: browse } = usePlayInterest();
  const [focused,setFocused] = useState(false), focusedRef = useRef(false);
  useFocusEffect(useCallback(() => {focusedRef.current=true;setFocused(true);return () => {focusedRef.current=false;setFocused(false);};}, []));
  const mapOpen = routeContext?.view === 'map' && focused;
  const [camera,setCamera] = useState<MapCamera | null>(null), [selectedVenue,setSelectedVenue] = useState<string | null>(null);
  const [selectedPerson,setSelectedPerson] = useState<UnifiedRow | null>(null), [expanded,setExpanded] = useState(false);
  const [showPeople,setShowPeople] = useState(true), [venueMode,setVenueMode] = useState<'all'|'with_games'>('all');
  const [mapFilter,setMapFilter] = useState(false), filterTrigger = useRef<ComponentRef<typeof Pressable>>(null);
  const personTrigger = useRef<ComponentRef<typeof Pressable>>(null);
  const [sheetMeasurement,setSheetMeasurement] = useState<SheetMeasurement | null>(null);
  const [controlsBottom,setControlsBottom] = useState<number | null>(null), [floatingEntryHeight,setFloatingEntryHeight] = useState(48);
  const [now,setNow] = useState(Date.now());
  const [inspectionAttempt,setInspectionAttempt] = useState(0);
  const [inspection,setInspection] = useState<{row:UnifiedRow;context:RadarContactContext;preview:UnifiedPreview | null;failed:boolean} | null>(null);
  useEffect(() => {
    if (!focused) return;
    const timer = setInterval(() => setNow(Date.now()),1000);
    return () => clearInterval(timer);
  },[focused]);
  const { preferences, hydrated } = usePreferences();
  const [citySelection, setCitySelection] = useState<string | null>(routeContext?.filters.cityId ?? null);
  const [cityPicker, setCityPicker] = useState(false), [citySearch, setCitySearch] = useState('');
  const [areaKey, setAreaKey] = useState(routeContext?.filters.areaKey ?? '');
  const [name, setName] = useState(routeContext?.filters.name ?? ''), [looking, setLooking] = useState(routeContext?.filters.looking ?? false), [trainer, setTrainer] = useState(routeContext?.filters.trainer ?? false);
  const cityId = citySelection;
  const filters = useMemo(() => ({ cityId, name: name.trim(), areaKey: areaKey.trim(), looking, trainer }), [cityId, name, areaKey, looking, trainer]);
  const key = playerFilterKey(filters), validName = !filters.name || Array.from(filters.name).length >= 2;
  const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  const citiesTask = useCallback((signal: AbortSignal) => publicApi.cities(signal), []);
  const cities = useResource('cities', citiesTask);
  const city = cities.state.data?.find(c => c.id === cityId);
  useEffect(() => {
    if (focused && hydrated && snapshot.scope && validName &&
      (snapshot.list.key !== key || snapshot.list.status === 'idle')) void coordinator.loadList(filters);
  }, [coordinator, filters, focused, hydrated, snapshot.scope, validName, key, snapshot.list.key, snapshot.list.status]);
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
  const selection = mapVenues.find(v => v.id === selectedVenue);
  const peopleAllowed = nativeRadarMapAllowed(radarState.config,radarState.query,mapCityId);
  const people = peopleAllowed && pack && showPeople ? nativeRadarPeople(radarState.pins,pack) : [];
  useEffect(() => { if (mapOpen && radarState.query && !radarState.busy) void radar.map(); }, [mapOpen,radarState.query?.query.queryRef,radar]);
  const currentRows = mapOpen ? people : radarState.filterKey === key ? radarState.rows : [];
  const person = focused && selectedPerson && currentRows.includes(selectedPerson) && selectedPerson.radar && Date.parse(selectedPerson.radar.validUntil) > now ? selectedPerson : null;
  const safeInspection = person && inspection?.row === person && inspection.context.valid() ? inspection : null;
  const preview = safeInspection?.preview && Date.parse(safeInspection.preview.radar.validUntil) > now ? safeInspection.preview : null;
  useEffect(() => {
    setInspection(null);
    if (!person) return;
    const context = radar.contactContext(person);
    if (!context) return;
    let current = true;
    setInspection({row:person,context,preview:null,failed:false});
    void loadPlayerInspection(context,nativeAuth.radarRead).then(preview => {
      if (current && context.valid()) setInspection({row:person,context,preview,failed:false});
    }).catch(() => {if (current && context.valid()) setInspection({row:person,context,preview:null,failed:true});});
    return () => {current=false;};
  },[person,radar,radarState.generation,inspectionAttempt]);
  const profileRoute = JSON.stringify([params,key,mapCityId,mapOpen,focused,mapFilter,venueMode,showPeople,radarState.generation]);
  const profileOwner = useMemo(() => expanded && person && preview && safeInspection ?
    {person,preview,context:safeInspection.context,scope:snapshot.scope,route:profileRoute} : null,
    [expanded,person,preview,safeInspection?.context,snapshot.scope,profileRoute]);
  const activeProfile = useRef(profileOwner);activeProfile.current=profileOwner;
  const [profileInspection,setProfileInspection] = useState<{owner:NonNullable<typeof profileOwner>;detail:PlayersSnapshot['detail'] | null;failed:boolean} | null>(null);
  useEffect(() => {
    setProfileInspection(null);
    if (!profileOwner) return;
    const owner = profileOwner;
    let current = true;
    const valid = () => current && activeProfile.current === owner && focusedRef.current;
    setProfileInspection({owner,detail:null,failed:false});
    void loadExpandedPlayerInspection(coordinator,owner.context,owner.preview,valid).then(detail => {
      if (valid()) setProfileInspection({owner,detail,failed:false});
    }).catch(() => {if (valid()) setProfileInspection({owner,detail:null,failed:true});});
    return () => {current=false;};
  },[coordinator,profileOwner]);
  const profileResult = profileOwner && profileOwner.context.valid() && profileInspection?.owner === profileOwner ? profileInspection : null;
  const profileDetail = profileResult?.detail && snapshot.scope === profileOwner?.scope && snapshot.detail === profileResult.detail ? profileResult.detail : null;
  const sheetContext = mapOpen && (selection || person) ? JSON.stringify([
    params,key,mapCityId,venueMode,showPeople,radarState.generation,
    person ? 'person' : 'venue',person?.publicPlayerId ?? selection?.id,expanded,
    window.width,window.height,window.fontScale,insets.top,insets.bottom,insets.left,insets.right,
  ]) : null;
  const sheetGeneration = useRef({context:sheetContext,revision:0});
  if (sheetGeneration.current.context !== sheetContext) sheetGeneration.current={context:sheetContext,revision:sheetGeneration.current.revision+1};
  const sheetOwner = sheetContext ? `${sheetGeneration.current.revision}:${sheetContext}` : null;
  /** Selected-venue component identity: stable across expand/collapse; separate from measurement sheetOwner. */
  const venueSheetKey = selection ? `venue:${mapCityId}:${key}:${selection.id}` : null;
  const activeSheet = useRef(sheetOwner);activeSheet.current=sheetOwner;
  useLayoutEffect(() => {
    activeSheet.current=sheetOwner;
    setSheetMeasurement(null);
    return () => {activeSheet.current=null;};
  },[sheetOwner]);
  const measureSheet = useCallback((height:number) => {
    if (!sheetOwner || activeSheet.current !== sheetOwner) return;
    setSheetMeasurement(Number.isFinite(height) && height > 0 ? {owner:sheetOwner,height} : null);
  },[sheetOwner]);
  const controlBottom = mapControlBottom(sheetMeasurement,sheetOwner,expanded,insets.bottom);
  const statusTop = controlsBottom === null ? undefined : controlsBottom+12;
  const closeMap = () => {
    if (mapFilter) setMapFilter(false);
    else if (person) {if (expanded) setExpanded(false);else setSelectedPerson(null);}
    else if (selection) { if (expanded) setExpanded(false); else setSelectedVenue(null); }
    else {setSelectedPerson(null);setSelectedVenue(null);router.setParams({view:'list'});}
  };
  const contactView = useRef(0), contactViewKey = JSON.stringify([focused,mapOpen,key,selectedPerson?.publicPlayerId,selectedVenue,mapFilter]);
  useLayoutEffect(() => {contactView.current++;return () => {contactView.current++;};},[contactViewKey]);
  const selectPerson = (row: UnifiedRow) => {setSelectedVenue(null);setExpanded(false);setSelectedPerson(row);};
  const contact = async (row: UnifiedRow) => {
    const view = contactView.current;
    if (!focusedRef.current || !radarContactAvailable(row,inspection?.row === row ? inspection.preview : null)) return;
    const context = radar.contactContext(row);
    if (!context) return;
    try {
      // Same fresh capability check as the existing explicit proof composer. Opening never sends.
      await radar.preview(context);
      if (focusedRef.current && view === contactView.current && context.valid() && auth.contact.stageRadar(context)) router.push(`/messages/new/${row.publicPlayerId}`);
    } catch { if (focusedRef.current && view === contactView.current && context.valid()) selectPerson(row); }
  };
  const list = snapshot.list.key === key && snapshot.scope && validName ? snapshot.list : null;
  const retry = () => { void coordinator.loadList(filters); };
  const more = () => { const cursor = list?.data?.nextCursor; if (cursor) void coordinator.loadList(filters, cursor); };
  const reset = () => {
    const cleared = resetPlayerFilters();
    setCitySelection(cleared.cityId); setName(cleared.name); setAreaKey(cleared.areaKey ?? '');
    setLooking(cleared.looking); setTrainer(cleared.trainer); setCityPicker(false); setCitySearch('');
  };
  const visibleRows = radarState.filterKey === key ? radarState.rows.filter(row => row.radar && Date.parse(row.radar.validUntil) > now) : [];
  const merged = mergeRadarPlayers(list?.data?.items ?? [],visibleRows);
  const personContent = person && <View style={{gap:12}}>
    {preview ? <>
      <Pressable accessibilityRole="button" accessibilityLabel={`Открыть игрока ${preview.player.displayName}`} accessibilityState={{expanded}}
        onPress={() => setExpanded(v => !v)} style={{minHeight:64,flexDirection:'row',alignItems:'center',gap:12}}>
        <PlayerAvatar key={`${preview.player.publicPlayerId}:${preview.player.avatar?.uploadedUrl}:${preview.player.avatar?.providerUrl}`}
          player={{...preview.player,cityId:null,areaKey:null,bio:null,lookingForGame:false}} />
        <View style={{flex:1,minWidth:0,gap:4}}><Label style={{fontWeight:'700',fontSize:18,lineHeight:24}}>{preview.player.displayName}</Label>
          <Label>{playerLevelLabel(preview.player.level)}{preview.player.trainer ? ' · Тренер' : ''}</Label>
          <Label style={{fontSize:12,lineHeight:18}}>{playerDistance(preview)}</Label></View>
        <Label accessible={false}>{expanded ? '↓' : '↑'}</Label>
      </Pressable>
      {expanded && <>
        {profileDetail?.status === 'ready' && profileDetail.data ? <PlayerProfile
          key={`${profileOwner?.scope}:${person.publicPlayerId}:${profileDetail.data.cover?.uploadedUrl}`}
          player={profileDetail.data} city={cities.state.data?.find(c => c.id === profileDetail.data?.cityId)?.nameRu} />
          : <Label accessible accessibilityLiveRegion="polite">{profileResult && !profileResult.failed && !profileResult.detail
            ? 'Загружаем профиль…' : 'Полный профиль недоступен. Доступная информация показана выше.'}</Label>}
        <Label>Местоположение и расстояние приблизительные.</Label>
        {radarContactAvailable(person,preview) ? <PrimaryButton title="Написать" onPress={() => {void contact(person);}} /> : <Label>Написать сейчас нельзя.</Label>}
      </>}
    </> : <>
      <Label accessible accessibilityLiveRegion="polite">{safeInspection && !safeInspection.failed && !safeInspection.preview ? 'Проверяем доступность игрока…' : 'Карточка игрока временно недоступна.'}</Label>
      {(!safeInspection || safeInspection.failed || safeInspection.preview && !preview) && <TextButton title="Повторить" onPress={() => setInspectionAttempt(value => value+1)} />}
    </>}
    {expanded && <TextButton title="Свернуть карточку игрока" onPress={() => setExpanded(false)} />}
  </View>;
  return <ScreenFrame keyboard header={<Header />}>
    <Modal visible={mapOpen} animationType="none" presentationStyle="fullScreen" onRequestClose={closeMap} supportedOrientations={iosModalOrientations}>
      <ScreenFrame>
        {pack ? <NativeMap key={pack.version} pack={pack} venues={mapVenues} counts={counts} selected={selection?.id ?? null} camera={camera}
          controlBottom={controlBottom} statusTop={statusTop} onCamera={setCamera}
          onSelect={id => {setSelectedPerson(null);setExpanded(false);setSelectedVenue(id);}} onCatalog={() => router.setParams({view:'list'})}
          people={people} selectedPerson={person?.publicPlayerId ?? null} onPerson={selectPerson} /> : <Label>Карта этого города пока недоступна.</Label>}
        <View pointerEvents="box-none" onLayout={event => setControlsBottom(event.nativeEvent.layout.y+event.nativeEvent.layout.height)}
          style={{position:'absolute',top:12,left:16,right:16,gap:8}}>
          <View pointerEvents="box-none" style={{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
            <View pointerEvents="box-none" style={{flex:1,minWidth:0,alignItems:'flex-start',gap:8}}>
              <Pressable accessibilityRole="button" accessibilityLabel="Назад к списку игроков" onPress={closeMap}
                style={{maxWidth:'100%',minHeight:44,flexDirection:'row',alignItems:'center',gap:8,padding:6,paddingRight:14,borderRadius:999,borderWidth:1,borderColor:colors.line,backgroundColor:colors.card}}>
                <View style={{minWidth:30,minHeight:30,borderRadius:999,backgroundColor:colors.purple,alignItems:'center',justifyContent:'center'}}><Label accessible={false} style={{color:colors.onPurple}}>←</Label></View>
                <Label style={{flexShrink:1,fontSize:14,lineHeight:20,fontWeight:'600'}}>К списку</Label>
              </Pressable>
              <Pressable ref={filterTrigger} accessibilityRole="button" accessibilityLabel="Фильтры карты" accessibilityState={{expanded:mapFilter}} onPress={() => setMapFilter(true)}
                style={{maxWidth:'100%',minHeight:44,flexDirection:'row',alignItems:'center',gap:8,paddingVertical:8,paddingHorizontal:12,borderRadius:999,borderWidth:1,borderColor:colors.line,backgroundColor:colors.card}}>
                <DiscoveryIcon name="filter" /><Label style={{flexShrink:1,fontSize:14,lineHeight:20,fontWeight:'600'}}>Фильтры</Label>
              </Pressable>
            </View>
            <RadarControls compact />
          </View>
          {mapResource.state.status==='error' && <View style={styles.card}><Label>Не удалось загрузить площадки.</Label><TextButton title="Обновить площадки" onPress={mapResource.retry} /></View>}
        </View>
        {personContent && <View key={sheetOwner} onLayout={event => measureSheet(event.nativeEvent.layout.height)}
          style={[styles.card,{position:'absolute',bottom:expanded ? 0 : insets.bottom+12,left:expanded ? 0 : 12,right:expanded ? 0 : 12,maxHeight:expanded ? '88%' : '60%',paddingBottom:expanded ? insets.bottom+16 : 16}]}>
          <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{gap:12}}>{personContent}</ScrollView>
        </View>}
        {selection && venueSheetKey && <VenueSheet key={venueSheetKey} selection={selection} expanded={expanded} games={schedules?.get(selection.id) ?? (schedules ? [] : null)}
          onExpand={setExpanded} onClose={() => setSelectedVenue(null)} onRetrySchedule={mapResource.retry} onMeasure={measureSheet} returnFocusRef={filterTrigger} />}
        <DiscoverySheet visible={mapFilter} title="Фильтры карты" onClose={() => setMapFilter(false)} returnFocusRef={filterTrigger}>
          <DiscoveryChip title="Все площадки" selected={venueMode==='all'} onPress={() => setVenueMode('all')} />
          <DiscoveryChip title="С играми" selected={venueMode==='with_games'} onPress={() => setVenueMode('with_games')} />
          <DiscoveryChip title="Игроки рядом" selected={showPeople} onPress={() => setShowPeople(v => !v)} />
          {!peopleAllowed && <Label>Площадки доступны. Для игроков рядом включите Radar и обновите список.</Label>}
          {radarState.notice && <Label accessibilityLiveRegion="polite">{radarState.notice}</Label>}
          {radarState.mapPage?.nextMapCursor && <TextButton title="Следующее окно игроков" onPress={() => {setSelectedPerson(null);void radar.map(true);}} />}
        </DiscoverySheet>
      </ScreenFrame>
    </Modal>
    <DiscoverySheet visible={!mapOpen && !!person} title="Игрок Radar" onClose={() => setSelectedPerson(null)} returnFocusRef={personTrigger}>{personContent}</DiscoverySheet>
    <FlatList data={merged.ordinary} keyExtractor={p => p.publicPlayerId}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 22, paddingBottom: Platform.OS === 'ios' ? floatingEntryHeight+48 : floatingEntryHeight+insets.bottom+48, gap: 16 }}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        <Label accessibilityRole="header" style={[styles.title, { fontSize: 32, lineHeight: Platform.OS === 'ios' ? 39 : 35 }]}>Игроки</Label>
        <Label style={{ color: colors.secondary, fontSize: 13, lineHeight: 19 }}>Найдите партнёров для хорошей игры.</Label>
        <RadarControls />
        <Pressable accessibilityRole="button" accessibilityLabel={`Город: ${cityFieldLabel({ hydrated, status: cities.state.status, city, savedCityId: cityId, emptyLabel: 'Все города' })}`} accessibilityState={{ expanded: cityPicker }} onPress={() => setCityPicker(v => !v)}
          style={{ minHeight: 66, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}><Label style={{ fontSize: 11, lineHeight: 16, color: colors.secondary }}>Город</Label>
            <Label style={{ fontSize: 14, lineHeight: 20, fontWeight: '600' }}>{cityFieldLabel({ hydrated, status: cities.state.status, city, savedCityId: cityId, emptyLabel: 'Все города' })}</Label></View><DiscoveryIcon name="chevron" />
        </Pressable>
        {cityPicker && <View style={styles.card}>
          <TextInput accessibilityLabel="Поиск города" placeholder="Найти город" value={citySearch} onChangeText={setCitySearch}
            clearButtonMode={Platform.OS === 'ios' ? 'while-editing' : undefined}
            returnKeyType={Platform.OS === 'ios' ? 'search' : undefined}
            autoCorrect={Platform.OS === 'ios' ? false : undefined}
            autoCapitalize={Platform.OS === 'ios' ? 'none' : undefined}
            style={styles.input} />
          <TextButton title="Все города" onPress={() => { setCitySelection(null); setCityPicker(false); }} />
          {cities.state.status === 'loading' && <Loading title="Загружаем города…" />}
          {cities.state.status === 'error' && <ErrorState error={cities.state.error} retry={cities.retry} />}
          {filterCities(cities.state.data ?? [], citySearch).map(c => <TextButton key={c.id} title={c.nameRu} onPress={() => { setCitySelection(c.id); setCityPicker(false); }} />)}
          {cities.state.status === 'ready' && !filterCities(cities.state.data ?? [], citySearch).length && <Label>Город не найден.</Label>}
        </View>}
        <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 }}>
          <DiscoveryIcon name="search" /><TextInput accessibilityLabel="Имя игрока" placeholder="Найти игрока" value={name} maxLength={80} onChangeText={setName}
            clearButtonMode="while-editing" returnKeyType={Platform.OS === 'ios' ? 'search' : undefined}
            style={{ flex: 1, minWidth: 0, minHeight: 58, fontFamily: 'Onest', fontSize: 14, color: colors.ink, paddingVertical: 12 }} />
        </View>
        <TextInput accessibilityLabel="Район / метро" placeholder="Район / метро" value={areaKey} maxLength={64} onChangeText={setAreaKey}
          clearButtonMode={Platform.OS === 'ios' ? 'while-editing' : undefined}
          returnKeyType={Platform.OS === 'ios' ? 'search' : undefined}
          autoCorrect={Platform.OS === 'ios' ? false : undefined}
          autoCapitalize={Platform.OS === 'ios' ? 'words' : undefined}
          style={[styles.input, { fontSize: 14 }]} />
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
        {radarState.enabling && <Label accessible accessibilityLiveRegion="polite">Сейчас ищем ближайших игроков…</Label>}
        {merged.nearby.map(row => <View key={`radar:${row.publicPlayerId}`} style={{gap:8}}>
          <Label>Рядом · примерное местоположение</Label>
          <Pressable ref={selectedPerson === row ? personTrigger : undefined} accessibilityRole="button" accessibilityLabel={`Открыть игрока ${row.player.displayName}`}
            onPress={() => selectPerson(row)} style={[styles.card,{minHeight:64,flexDirection:'row',alignItems:'center',gap:12}]}>
            <PlayerAvatar key={`${row.publicPlayerId}:${row.player.avatar.uploadedUrl}:${row.player.avatar.providerUrl}`} player={radarPlayer(row)} />
            <View style={{flex:1,minWidth:0,gap:4}}><Label style={{fontWeight:'700'}}>{row.player.displayName}</Label>
              <Label>{playerLevelLabel(row.player.level)}{row.player.trainer ? ' · Тренер' : ''}</Label></View><DiscoveryIcon name="chevron" />
          </Pressable>
          {radarContactAvailable(row,inspection?.row === row ? inspection.preview : null) ? <TextButton title="Написать" onPress={() => {void contact(row);}} /> : <Label>Написать сейчас нельзя.</Label>}
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
    <View pointerEvents="box-none" onLayout={event => setFloatingEntryHeight(event.nativeEvent.layout.height)}
      style={{position:'absolute',bottom:Platform.OS === 'ios' ? 16 : insets.bottom+16,left:0,right:0,alignItems:'center',paddingHorizontal:16,gap:8}}>
    <Pressable accessibilityRole="button" accessibilityLabel="Свайп — просмотр игроков карточками"
      onPress={() => { browse.stage(filters,list?.data ?? null); router.push('/players/browse'); }}
      style={{width:Math.min(280,window.width-insets.left-insets.right-32),minHeight:48,borderRadius:999,paddingHorizontal:20,paddingVertical:12,backgroundColor:colors.ink,alignItems:'center',justifyContent:'center'}}>
      <Label style={{fontWeight:'600',color:colors.card}}>Свайп</Label>
    </Pressable>
    {radarState.activation?.state === 'active' && <Pressable accessibilityRole="button" accessibilityLabel="Показать игроков и площадки на карте"
      onPress={() => {setSelectedPerson(null);setExpanded(false);router.setParams({view:'map',cityId:cityId ?? '',name:filters.name,areaKey:filters.areaKey ?? '',looking:looking?'1':'0',trainer:trainer?'1':'0'});}}
      style={{width:Math.min(280,window.width-insets.left-insets.right-32),minHeight:48,borderRadius:999,paddingVertical:6,paddingLeft:6,paddingRight:16,
        backgroundColor:colors.card,borderWidth:1,borderColor:colors.line,shadowColor:colors.ink,shadowOffset:{width:0,height:4},shadowOpacity:0.12,shadowRadius:12,elevation:4,
        flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10}}>
      <View style={{width:36,height:36,borderRadius:10,backgroundColor:colors.lime,alignItems:'center',justifyContent:'center'}}><DiscoveryIcon name="map" color={colors.purple} /></View>
      <Label style={{flexShrink:1,fontWeight:'600'}}>На карте</Label>
    </Pressable>}
    </View>
  </ScreenFrame>;
}
