import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { AppState, BackHandler, FlatList, Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { selectedCity } from '../../src/entry.ts';
import { useResource } from '../../src/hooks.ts';
import { usePreferences } from '../../src/state.tsx';
import { publicApi } from '../../src/public-api.ts';
import { cityDate, discoveryDateLabel, nextCalendarDay } from '../../src/presentation.ts';
import { gamesContext, gamesRoute, loadMapSnapshot, mapBack, mapControlBottom, mapDataKey, mapPackForCity, resolveMapSelection, venueMarkerLabel, venueSchedules, visibleMapVenues } from '../../src/maps.ts';
import type { MapCamera, MapOverlay, SheetMeasurement } from '../../src/maps.ts';
import { NativeMap } from '../../src/components/native-map.tsx';
import { VenueSheet } from '../../src/components/venue-sheet.tsx';
import { DiscoveryIcon } from '../../src/components/discovery-icon.tsx';
import { DiscoveryChip, DiscoverySheet, ErrorState, Label, Loading, ScreenFrame, TextButton, styles } from '../../src/components/ui.tsx';
import { colors } from '../../src/theme.ts';

export default function GamesMap() {
  const params = useLocalSearchParams(), context = gamesContext(params), router = useRouter(), insets = useSafeAreaInsets();
  const {preferences,hydrated} = usePreferences();
  const citiesTask = useCallback((signal:AbortSignal) => publicApi.cities(signal),[]), cities = useResource('cities',citiesTask);
  const city = selectedCity(cities.state.data ?? [],context?.cityId ?? preferences.cityId);
  const cityId = city?.id ?? '', timezone = city?.defaultTimezone;
  const today = timezone ? cityDate(new Date(),timezone) : '';
  const [day,setDay] = useState(context?.day ?? ''), [activity,setActivity] = useState(context?.activity ?? 'all');
  const [mode,setMode] = useState<'all'|'with_games'>('all'), [catalog,setCatalog] = useState(false);
  const [overlay,setOverlay] = useState<MapOverlay>({filter:false,expanded:false,selected:null});
  const filterTrigger = useRef<ComponentRef<typeof Pressable>>(null);
  const [selectionError,setSelectionError] = useState(false), [camera,setCamera] = useState<MapCamera | null>(null);
  const [now,setNow] = useState(Date.now());
  const [controlsBottom,setControlsBottom] = useState<number | null>(null);
  const [sheetMeasurement,setSheetMeasurement] = useState<SheetMeasurement | null>(null);
  const filters = useMemo(() => ({day,activityKind:activity,timezone}),[day,activity,timezone]);
  const task = useCallback((signal:AbortSignal) => loadMapSnapshot(publicApi,cityId,filters,signal),[cityId,filters]);
  const {state,retry} = useResource(mapDataKey(cityId,filters),task);
  const pack = mapPackForCity(cityId);
  useEffect(() => {
    if (today && day && day < today) setDay(today);
  },[today,day]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()),30000);
    const subscription = AppState.addEventListener('change',state => {if (state === 'active') setNow(Date.now());});
    return () => {clearInterval(timer);subscription.remove();};
  },[]);
  // An external context is honored in-memory, never written into global city preferences.
  useEffect(() => {if (hydrated && cities.state.status === 'ready' && !city) router.replace('/games');},[hydrated,cities.state.status,city,router]);
  const routeKey = JSON.stringify(params);
  useEffect(() => {
    const next = gamesContext(params);
    if (!next) {router.replace('/games');return;}
    setDay(next.day);setActivity(next.activity);setCamera(null);setOverlay({filter:false,expanded:false,selected:null});setSelectionError(false);
  },[routeKey]);
  const returnToList = useCallback(() => {
    if (!context) {router.replace('/games');return;}
    // A push keeps the mounted origin list and its resource/cursor/scroll owner intact.
    if (context.origin === 'list' && router.canGoBack()) router.dismissTo(gamesRoute({...context,cityId:cityId || context.cityId,day,activity},'list'));
    else router.replace('/games');
  },[router,context,cityId,day,activity]);
  const back = useCallback(() => {
    const next = mapBack(overlay);
    if (next) setOverlay(next); else returnToList();
    return true;
  },[overlay,returnToList]);
  useFocusEffect(useCallback(() => {const listener = BackHandler.addEventListener('hardwareBackPress',back);return () => listener.remove();},[back]));
  // Resolve route aliases only from an actual public binding in this same generation.
  const requestedSelection = useRef<string | null>(null);
  useEffect(() => {
    if (!context?.selectedVenue || !state.data || state.status !== 'ready') return;
    const key = `${state.key}:${context.selectedVenue}`;
    if (requestedSelection.current === key) return;
    requestedSelection.current = key;
    const controller = new AbortController();
    void resolveMapSelection(context.selectedVenue,state.data.venues,publicApi,controller.signal).then(venue => {
      if (!controller.signal.aborted) setOverlay(v => ({...v,selected:venue.id,expanded:false}));
    }).catch(() => {if (!controller.signal.aborted) setSelectionError(true);});
    return () => {controller.abort();requestedSelection.current=null;};
  },[context?.selectedVenue,state.data,state.key,state.status]);
  const snapshot = state.status === 'ready' ? state.data : undefined;
  const schedules = snapshot ? venueSchedules(snapshot,filters,now) : null;
  const counts = schedules ? new Map([...schedules].map(([id,games]) => [id,games.length])) : null;
  const venues = snapshot?.venues ?? [];
  const visible = pack ? visibleMapVenues(venues,counts,mode,pack) : venues;
  const selection = venues.find(v => v.id === overlay.selected);
  const sheetContext = selection ? JSON.stringify([routeKey,state.key,selection.id,overlay.expanded,insets.bottom]) : null;
  const sheetGeneration = useRef({context:sheetContext,revision:0});
  if (sheetGeneration.current.context !== sheetContext) sheetGeneration.current={context:sheetContext,revision:sheetGeneration.current.revision+1};
  const sheetOwner = sheetContext ? `${sheetGeneration.current.revision}:${sheetContext}` : null;
  const activeSheet = useRef(sheetOwner);activeSheet.current=sheetOwner;
  useLayoutEffect(() => {
    activeSheet.current=sheetOwner;
    if (!sheetOwner) setSheetMeasurement(null);
    return () => {activeSheet.current=null;};
  },[sheetOwner]);
  const measureSheet = useCallback((height:number) => {
    if (!sheetOwner || activeSheet.current !== sheetOwner) return;
    setSheetMeasurement(Number.isFinite(height) && height > 0 ? {owner:sheetOwner,height} : null);
  },[sheetOwner]);
  const controlBottom = mapControlBottom(sheetMeasurement,sheetOwner,overlay.expanded,insets.bottom);
  const statusTop = controlsBottom === null ? undefined : controlsBottom+12;
  const select = (id:string) => {setSelectionError(false);setOverlay(v => ({...v,selected:id,expanded:false}));};
  return <ScreenFrame>
    <View style={{flex:1}}>
      {context && city && pack && !catalog && <NativeMap key={cityId} pack={pack} venues={visible} counts={counts} selected={overlay.selected} camera={camera} controlBottom={controlBottom} statusTop={statusTop} onCamera={setCamera} onSelect={select} onCatalog={() => setCatalog(true)} />}
      {(!pack || catalog) && <FlatList data={visible} keyExtractor={venue => venue.id}
        contentContainerStyle={{padding:16,paddingTop:statusTop ?? 12,paddingBottom:insets.bottom+100,gap:12}}
        ListHeaderComponent={<View style={{gap:12}}><Label accessibilityRole="header" style={styles.subtitle}>Площадки списком</Label>
          {!pack && <Label>Для выбранного города карта пока недоступна.</Label>}
          {pack && <TextButton title="Повторить загрузку карты" onPress={() => setCatalog(false)} />}
          {snapshot && venues.length === 0 && <Label>Площадки не найдены</Label>}
        </View>}
        renderItem={({item}) => <Pressable accessibilityRole="button" accessibilityLabel={venueMarkerLabel(item,counts)} onPress={() => select(item.id)} style={styles.card}>
          <Label style={styles.subtitle}>{item.name}</Label><Label>{item.address}</Label><Label>{venueMarkerLabel(item,counts)}</Label>
        </Pressable>} />}
      <View pointerEvents="box-none" onLayout={event => setControlsBottom(event.nativeEvent.layout.y+event.nativeEvent.layout.height)}
        style={{position:'absolute',top:12,left:16,right:16,alignItems:'flex-start',gap:8}}>
        <Pressable accessibilityRole="button" accessibilityLabel="К списку игр" onPress={returnToList}
          style={{maxWidth:'100%',minHeight:44,flexDirection:'row',alignItems:'center',gap:8,padding:6,paddingRight:14,borderRadius:999,borderWidth:1,borderColor:colors.line,backgroundColor:colors.card}}>
          <View style={{minWidth:30,minHeight:30,borderRadius:999,backgroundColor:colors.purple,alignItems:'center',justifyContent:'center'}}><Label accessible={false} style={{color:colors.onPurple}}>←</Label></View>
          <Label style={{flexShrink:1,fontSize:14,lineHeight:20,fontWeight:'600'}}>К списку</Label>
        </Pressable>
        <Pressable ref={filterTrigger} accessibilityRole="button" accessibilityLabel="Фильтры карты" accessibilityState={{expanded:overlay.filter}}
          onPress={() => setOverlay(v => ({...v,filter:true}))}
          style={{maxWidth:'100%',minHeight:44,flexDirection:'row',alignItems:'center',gap:8,paddingVertical:8,paddingHorizontal:12,borderRadius:999,borderWidth:1,borderColor:colors.line,backgroundColor:colors.card}}>
          <DiscoveryIcon name="filter" /><Label style={{flexShrink:1,fontSize:14,lineHeight:20,fontWeight:'600'}}>Фильтры</Label>
        </Pressable>
      </View>
      {statusTop !== undefined && (!hydrated || cities.state.status === 'loading') && <View style={{position:'absolute',top:statusTop,left:16,right:16}}><Loading title="Загружаем города…" /></View>}
      {statusTop !== undefined && cities.state.status === 'error' && <View style={{position:'absolute',top:statusTop,left:16,right:16}}><ErrorState error={cities.state.error} retry={cities.retry} /></View>}
      {statusTop !== undefined && hydrated && cities.state.status === 'ready' && !city && <View style={{position:'absolute',top:statusTop,left:16,right:16,...styles.card}}><Label>Выбранный город недоступен.</Label><TextButton title="К играм" onPress={() => router.replace('/games')} /></View>}
      {statusTop !== undefined && city && state.status === 'loading' && <View pointerEvents="none" accessibilityLiveRegion="polite" style={{position:'absolute',width:1,height:1,overflow:'hidden',top:statusTop,left:0}}><Label>Загружаем площадки и расписания…</Label></View>}
      {statusTop !== undefined && city && state.status === 'error' && <View style={{position:'absolute',top:statusTop,left:16,right:16}}><ErrorState error={state.error} retry={retry} /></View>}
      {statusTop !== undefined && snapshot?.scheduleError && <View style={{position:'absolute',top:statusTop,left:16,right:16,...styles.card}}><Label>Расписание недоступно. Количество игр не подтверждено.</Label><TextButton title="Повторить загрузку расписаний" onPress={retry} /></View>}
      {statusTop !== undefined && selectionError && <View style={{position:'absolute',top:statusTop,left:16,right:16,...styles.card}}><Label>Выбранная площадка недоступна в этом городе.</Label><TextButton title="Площадки списком" onPress={() => setCatalog(true)} /></View>}
      {!selection && <View style={{position:'absolute',bottom:insets.bottom+16,alignSelf:'center',backgroundColor:colors.card,borderRadius:999}}><TextButton title="Обновить площадки" onPress={retry} /></View>}
      {selection && <VenueSheet key={`${routeKey}:${state.key}:${selection.id}`} onMeasure={measureSheet} selection={selection} expanded={overlay.expanded} games={schedules?.get(selection.id) ?? null}
        onExpand={expanded => setOverlay(v => ({...v,expanded}))} onClose={() => setOverlay(v => ({...v,selected:null,expanded:false}))} onRetrySchedule={retry} returnFocusRef={filterTrigger} />}
      <DiscoverySheet visible={overlay.filter} title="Фильтры карты" onClose={() => setOverlay(v => ({...v,filter:false}))} returnFocusRef={filterTrigger}>
        <Label>Когда играем</Label><DiscoveryChip title="Все ближайшие" selected={!day} onPress={() => setDay('')} />
        {today && Array.from({length:7},(_,i) => nextCalendarDay(today,i)).map(value => <DiscoveryChip key={value} title={discoveryDateLabel(value)} selected={day === value} onPress={() => setDay(value)} />)}
        <Label>Игры</Label>{(['all','regular','trainer_led'] as const).map(value => <DiscoveryChip key={value} title={value === 'all' ? 'Все' : value === 'regular' ? 'Обычные' : 'С тренером'} selected={activity === value} onPress={() => setActivity(value)} />)}
        <Label>Площадки</Label><DiscoveryChip title="Все площадки" selected={mode === 'all'} onPress={() => setMode('all')} /><DiscoveryChip title="Только с играми" selected={mode === 'with_games'} onPress={() => setMode('with_games')} />
        <Label>Если расписание недоступно, площадка остаётся видимой.</Label>
      </DiscoverySheet>
    </View>
  </ScreenFrame>;
}
