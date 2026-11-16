import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Image, Linking, PanResponder, Pressable, ScrollView, View } from 'react-native';
import type { GestureResponderEvent, PanResponderGestureState } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResource, useUpcomingItems } from '../hooks.ts';
import type { PublicGame } from '../public-api.ts';
import { API_ORIGIN, PublicApiError, publicApi } from '../public-api.ts';
import {
  decideGalleryAxis,
  decideGallerySwipe,
  gallerySelectionOf,
  resolveGallerySelection,
  stepGallerySelection,
  type GallerySelection,
} from '../venue-gestures.ts';
import { VenueSchedule, safeCatalogSource, venueCreatePath } from '../venues.ts';
import type { GalleryItem, PublicVenue } from '../venues.ts';
import { GameCard } from './game-card.tsx';
import { Header, Label, Loading, PrimaryButton, ScreenFrame, TextButton, styles } from './ui.tsx';
import { colors } from '../theme.ts';

export function VenueFailure({ error, retry }: { error: unknown; retry: () => void }) {
  const kind = error instanceof PublicApiError ? error.kind : 'network';
  const message = kind === 'unavailable' ? 'Площадка или данные не найдены либо больше недоступны.'
    : kind === 'invalid' ? 'Не удалось подтвердить данные сервера. Повторите загрузку.'
    : kind === 'network' ? 'Не удалось получить данные. Проверьте соединение.' : 'Сервис временно недоступен.';
  return <View style={styles.card} accessibilityLiveRegion="polite"><Label>{message}</Label><TextButton title="Повторить" onPress={retry} /></View>;
}
/** Safe links are projected before reaching this component; only a press opens one. */
function PublicLink({ label, url }: { label: string; url: string }) {
  const [failed, setFailed] = useState(false);
  return <View><TextButton title={label} onPress={() => { setFailed(false); void Linking.openURL(url).catch(() => setFailed(true)); }} />
    {failed && <Label accessibilityRole="alert">Не удалось открыть ссылку. Попробуйте ещё раз.</Label>}</View>;
}
function VenueImage({ item, name, mapSheet = false }: { item: GalleryItem; name: string; mapSheet?: boolean }) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0), current = useRef(0);
  const label = item.credit.kind === 'photo' ? 'Фото площадки' : item.credit.kind === 'logo' ? 'Логотип площадки' : 'Иллюстрация';
  return <View style={{ gap: 8 }}>
    {!mapSheet && <Label>{label}</Label>}
    {phase !== 'error' && <Image key={attempt} source={{ uri: `${API_ORIGIN}${item.url}` }} resizeMode={mapSheet ? "cover" : "contain"}
      accessibilityLabel={`${label}: ${name}`} style={mapSheet ? {width:'100%',aspectRatio:16/9,borderRadius:12,backgroundColor:colors.paper} : {width:'100%',height:230,backgroundColor:colors.paper}}
      onLoad={() => { if (current.current === attempt) setPhase('ready'); }}
      onError={() => { if (current.current === attempt) setPhase('error'); }} />}
    {phase === 'loading' && <Label accessibilityLiveRegion="polite">Загружаем изображение…</Label>}
    {phase === 'error' && <><Label>Изображение не загрузилось.</Label><TextButton title="Повторить загрузку изображения" onPress={() => { current.current++; setAttempt(current.current); setPhase('loading'); }} /></>}
    {item.credit.url ? <PublicLink key={item.credit.url} label={item.credit.text} url={item.credit.url} /> : <Label>{item.credit.text}</Label>}
  </View>;
}
/** Controlled gallery: parent owns selected media across compact/expanded and info/schedule. */
export function VenueGallery({ venue, mapSheet = false, selected, onSelect }: {
  venue: PublicVenue; mapSheet?: boolean; selected: GallerySelection | null; onSelect: (next: GallerySelection | null) => void;
}) {
  const item = resolveGallerySelection(venue.gallery, venue.mainImage, selected);
  const index = item ? Math.max(0, venue.gallery.findIndex(entry => entry.url === item.url || entry.id === item.id)) : 0;
  const suppress = useRef(false);
  const axis = useRef<'pending' | 'horizontal' | 'vertical'>('pending');
  const go = useCallback((delta: 1 | -1) => {
    if (venue.gallery.length <= 1) return;
    const next = stepGallerySelection(venue.gallery, item, delta);
    onSelect(gallerySelectionOf(next));
  }, [venue.gallery, item, onSelect]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      if (venue.gallery.length <= 1) return false;
      const next = decideGalleryAxis(gesture.dx, gesture.dy);
      axis.current = next;
      return next === 'horizontal';
    },
    onPanResponderGrant: () => { axis.current = 'pending'; },
    onPanResponderMove: (_event, gesture) => {
      if (axis.current === 'pending') axis.current = decideGalleryAxis(gesture.dx, gesture.dy);
    },
    onPanResponderRelease: (_event, gesture) => {
      const locked = axis.current === 'pending' ? decideGalleryAxis(gesture.dx, gesture.dy) : axis.current;
      const action = decideGallerySwipe(locked, gesture.dx);
      axis.current = 'pending';
      if (action === 'none') return;
      suppress.current = true;
      go(action === 'next' ? 1 : -1);
    },
    onPanResponderTerminate: () => { axis.current = 'pending'; },
    onPanResponderTerminationRequest: () => true,
  }), [venue.gallery.length, go]);
  const step = (delta: 1 | -1) => {
    if (suppress.current) { suppress.current = false; return; }
    go(delta);
  };
  return <View style={mapSheet ? {gap:8} : styles.card}>
    {!mapSheet && <Label accessibilityRole="header" style={styles.subtitle}>Галерея</Label>}
    {item ? <>
      <View {...responder.panHandlers}>
        <VenueImage key={item.url} item={item} name={venue.name} mapSheet={mapSheet} />
      </View>
      {(!mapSheet || venue.gallery.length > 1) && <Label accessibilityLiveRegion="polite">Изображение {index + 1} из {venue.gallery.length}</Label>}
      {venue.gallery.length > 1 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Предыдущее изображение" onPress={() => step(-1)}
          style={{ minWidth: 44, minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' }}>
          <Label>←</Label>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Следующее изображение" onPress={() => step(1)}
          style={{ minWidth: 44, minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' }}>
          <Label>→</Label>
        </Pressable>
      </View>}
    </> : <Label>Нет доступных изображений площадки.</Label>}
    {venue.catalogSource && <><Label>Источник: badminton4u.ru</Label>{venue.catalogSource.clubs.map(club => <PublicLink key={club.id} label={club.name} url={club.url} />)}</>}
  </View>;
}

/** Standalone detail owns media identity without a map sheet parent. */
function useVenueMedia(venue: PublicVenue | undefined) {
  const [selected, setSelected] = useState<GallerySelection | null>(null);
  const venueKey = venue ? `${venue.id}:${venue.cityId}` : '';
  useEffect(() => { setSelected(null); }, [venueKey]);
  useEffect(() => {
    if (!venue) { setSelected(null); return; }
    const identity = gallerySelectionOf(resolveGallerySelection(venue.gallery, venue.mainImage, selected));
    if ((identity?.url ?? null) !== (selected?.url ?? null) || (identity?.id ?? null) !== (selected?.id ?? null)) {
      setSelected(identity);
    }
  }, [venue, selected]);
  return { selected, setSelected };
}
function Schedule({ venue }: { venue: PublicVenue }) {
  const router = useRouter();
  const [resource] = useState(() => new VenueSchedule(publicApi, venue));
  const state = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  useEffect(() => { void resource.refresh(); return () => resource.cancel(); }, [resource]);
  const items = useUpcomingItems(state.data?.items ?? []);
  return <View style={{ gap: 16 }}>
    <Label accessibilityRole="header" style={styles.subtitle}>Предстоящие игры</Label>
    {(state.status === 'idle' || state.status === 'loading') && <Loading title="Загружаем расписание…" />}
    {state.status === 'error' && <VenueFailure error={state.error} retry={() => { if (state.data?.nextCursor) void resource.more(); else void resource.refresh(); }} />}
    {state.status === 'ready' && items.length === 0 && <Label>Нет предстоящих доступных игр</Label>}
    {items.map(game => <GameCard key={game.id} game={game} onOpen={() => router.push({ pathname: '/games/[id]', params: { id: game.id } })} />)}
    {state.data?.nextCursor && state.status !== 'loading' && <TextButton title="Загрузить ещё" onPress={() => void resource.more()} />}
    <TextButton title="Обновить расписание" onPress={() => void resource.refresh()} />
  </View>;
}
const amenity = (value: boolean | null) => value === null ? 'Нет данных' : value ? 'Есть' : 'Нет';
export function VenueContent({ venue, schedule, mapSheet = false, selected = null, onSelectMedia }: {
  venue: PublicVenue; schedule?: ReactNode; mapSheet?: boolean;
  selected?: GallerySelection | null; onSelectMedia?: (next: GallerySelection | null) => void;
}) {
  const owned = useVenueMedia(onSelectMedia ? undefined : venue);
  const media = onSelectMedia ? selected : owned.selected;
  const setMedia = onSelectMedia ?? owned.setSelected;
  if (mapSheet) return <>
    <VenueGallery venue={venue} mapSheet selected={media} onSelect={setMedia} />
    {venue.description && <Label>{venue.description}</Label>}
    <Label accessibilityRole="header" style={{fontSize:24,lineHeight:32,fontWeight:'800'}}>{venue.name}</Label><Label>{venue.address}</Label>
    <View style={{gap:8}}>
      <Label>Количество кортов: {venue.courtCount ?? 'Нет данных'}</Label>
      <Label>Парковка: {amenity(venue.parking)}</Label><Label>Душевые: {amenity(venue.showers)}</Label>
      {venue.updatedAt && <Label>Содержимое обновлено: {new Date(venue.updatedAt).toLocaleDateString('ru-RU', {timeZone:'UTC'})}</Label>}
    </View>
    <View style={{gap:8}}><Label accessibilityRole="header" style={styles.subtitle}>Контакты площадки</Label>
      {venue.contacts.length ? venue.contacts.map(link => <PublicLink key={link.url} {...link} />) : <Label>Контакты пока не добавлены</Label>}
    </View>
    {schedule}
  </>;
  return <>
    <Label accessibilityRole="header" style={styles.title}>{venue.name}</Label><Label>{venue.address}</Label>
    <VenueGallery venue={venue} selected={media} onSelect={setMedia} />
    <View style={styles.card}><Label accessibilityRole="header" style={styles.subtitle}>О площадке</Label>
      {venue.description && <Label>{venue.description}</Label>}
      <Label>Количество кортов: {venue.courtCount ?? 'Нет данных'}</Label>
      <Label>Парковка: {amenity(venue.parking)}</Label><Label>Душевые: {amenity(venue.showers)}</Label>
      {venue.updatedAt && <Label>Содержимое обновлено: {new Date(venue.updatedAt).toLocaleDateString('ru-RU', { timeZone: 'UTC' })}</Label>}
    </View>
    <View style={styles.card}><Label accessibilityRole="header" style={styles.subtitle}>Контакты площадки</Label>
      {venue.contacts.length ? venue.contacts.map(link => <PublicLink key={link.url} {...link} />) : <Label>Контакты пока не добавлены</Label>}
    </View>
    {schedule ?? <Schedule venue={venue} />}
  </>;
}
function CompactSourceLink({name,url}:{name:string;url:string}) {
  const [failed,setFailed] = useState(false);
  return <><Pressable accessibilityRole="link" accessibilityLabel={`Источник: badminton4u.ru · ${name}`} onPress={() => {setFailed(false);void Linking.openURL(url).catch(() => setFailed(true));}}
    style={{minHeight:44,justifyContent:'center'}}><Label style={{fontSize:12,lineHeight:18,color:colors.secondary}}>Источник: badminton4u.ru · {name}</Label></Pressable>
    {failed && <Label accessibilityRole="alert">Не удалось открыть источник. Попробуйте ещё раз.</Label>}</>;
}
/** Verified compact catalog credit is a sibling of the single row action. */
export function VenuePreview({ venue, games, onOpen, selected = null, onSelectMedia, suppressTap }: {
  venue: PublicVenue; games: readonly PublicGame[] | null; onOpen: () => void;
  selected?: GallerySelection | null; onSelectMedia?: (next: GallerySelection | null) => void;
  suppressTap?: () => boolean;
}) {
  const item = resolveGallerySelection(venue.gallery, venue.mainImage, selected);
  const [failed,setFailed] = useState(false), [badgeHeight,setBadgeHeight] = useState(0);
  const source = safeCatalogSource(venue.catalogSource), club = source?.clubs[0];
  const axis = useRef<'pending' | 'horizontal' | 'vertical'>('pending');
  const imageSwipe = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => {
      if (!onSelectMedia || venue.gallery.length <= 1) return false;
      const next = decideGalleryAxis(gesture.dx, gesture.dy);
      axis.current = next;
      return next === 'horizontal';
    },
    onPanResponderRelease: (_event, gesture) => {
      const locked = axis.current === 'pending' ? decideGalleryAxis(gesture.dx, gesture.dy) : axis.current;
      axis.current = 'pending';
      if (!onSelectMedia) return;
      const action = decideGallerySwipe(locked, gesture.dx);
      if (action === 'none') return;
      const next = stepGallerySelection(venue.gallery, item, action === 'next' ? 1 : -1);
      onSelectMedia(gallerySelectionOf(next));
    },
    onPanResponderTerminate: () => { axis.current = 'pending'; },
    onPanResponderTerminationRequest: () => true,
  }), [onSelectMedia, venue.gallery, item]);
  const open = () => { if (suppressTap?.()) return; onOpen(); };
  return <View style={{gap:8}}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Открыть площадку ${venue.name}`} onPress={open}
      style={{flexDirection:'row',alignItems:'center',gap:12,minHeight:84}}>
      <View {...imageSwipe.panHandlers} style={{width:64,minHeight:Math.max(64,badgeHeight),backgroundColor:colors.paper,borderRadius:12,overflow:'hidden'}}>
        {item && !failed ? <Image source={{uri:`${API_ORIGIN}${item.url}`}} resizeMode="cover" accessibilityLabel={item.credit.kind === 'illustration' ? 'Иллюстрация' : item.credit.kind === 'logo' ? 'Логотип площадки' : 'Фото площадки'} onError={() => setFailed(true)} style={{width:64,height:64}} />
          : <Label style={{fontSize:11}}>{failed ? 'Фото не загрузилось' : 'Нет изображения'}</Label>}
        {item?.credit.kind === 'illustration' && <Label onLayout={event => setBadgeHeight(event.nativeEvent.layout.height)}
          style={{position:'absolute',bottom:0,left:0,right:0,fontSize:10,lineHeight:14,backgroundColor:colors.card,textAlign:'center'}}>Иллюстрация</Label>}
      </View>
      <View style={{flex:1,minWidth:0,gap:0}}>
        <Label accessibilityRole="header" style={{fontSize:17,lineHeight:23,fontWeight:'700'}}>{venue.name}</Label><Label style={{fontSize:14,lineHeight:20}}>{venue.address}</Label>
        <Label style={{fontSize:13,lineHeight:18,color:colors.secondary}}>{games === null ? 'Расписание временно недоступно' : games[0] ? new Date(games[0].startsAt).toLocaleString('ru-RU',{timeZone:venue.timezone}) : 'Пока нет игр'}</Label>
        {games !== null && games.length > 0 && <Label style={{fontSize:13,lineHeight:18,color:colors.limeDeep}}>{games.length} доступных игр</Label>}
      </View><View style={{width:44,height:44,borderRadius:22,backgroundColor:colors.lime,alignItems:'center',justifyContent:'center'}}><Label accessible={false}>↑</Label></View>
    </Pressable>
    {venue.gallery.length > 1 && onSelectMedia && <View style={{flexDirection:'row',gap:8}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Предыдущее изображение" onPress={() => onSelectMedia(gallerySelectionOf(stepGallerySelection(venue.gallery, item, -1)))}
        style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Label>←</Label></Pressable>
      <Label accessibilityLiveRegion="polite" style={{alignSelf:'center'}}>
        {Math.max(1, venue.gallery.findIndex(entry => entry.url === item?.url) + 1)} / {venue.gallery.length}
      </Label>
      <Pressable accessibilityRole="button" accessibilityLabel="Следующее изображение" onPress={() => onSelectMedia(gallerySelectionOf(stepGallerySelection(venue.gallery, item, 1)))}
        style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Label>→</Label></Pressable>
    </View>}
    {club && <View><CompactSourceLink name={club.name} url={club.url} /></View>}
  </View>;
}
export function VenueDetail({ id }: { id: string }) {
  const router = useRouter(), insets = useSafeAreaInsets();
  const task = useCallback((signal: AbortSignal) => publicApi.venue(id, signal), [id]);
  const { state, retry } = useResource(`venue:${id}`, task);
  const venue = state.status === 'ready' ? state.data : undefined;
  return <ScreenFrame header={<Header back={() => router.canGoBack() ? router.back() : router.replace('/games')} />}>
    <View style={{ flex: 1 }}>
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}>
        {(state.status === 'loading' || state.status === 'idle') && <Loading title="Загружаем площадку…" />}
        {state.status === 'error' && <VenueFailure error={state.error} retry={retry} />}
        {venue && <VenueContent key={`${id}:${JSON.stringify(venue)}`} venue={venue} />}
      </ScrollView>
      {venue && <View style={{ padding: 16, paddingBottom: insets.bottom + 16, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.line }}>
        <PrimaryButton title="Создать игру на этой площадке" onPress={() => router.push(venueCreatePath(venue.id)!)} />
      </View>}
    </View>
  </ScreenFrame>;
}
