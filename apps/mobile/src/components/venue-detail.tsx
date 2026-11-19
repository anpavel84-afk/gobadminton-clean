import { NativeVenueCommunity } from './venue-community.tsx';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Image, Linking, PanResponder, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResource, useUpcomingItems } from '../hooks.ts';
import type { PublicGame } from '../public-api.ts';
import { API_ORIGIN, PublicApiError, publicApi } from '../public-api.ts';
import {
  consumeFollowOnSuppress,
  createGalleryGestureHandlers,
  galleryMediaIdentity,
  gallerySelectionOf,
  mediaFailureApplies,
  resolveGallerySelection,
  stepGallerySelection,
  suppressAfterFreshTouch,
  type GalleryAxis,
  type GallerySelection,
} from '../venue-gestures.ts';
import { VenueSchedule, safeCatalogSource, venueCreatePath } from '../venues.ts';
import type { GalleryItem, PublicVenue } from '../venues.ts';
import { GameCard } from './game-card.tsx';
import { VenueCover } from './venue-cover.tsx';
import { BackLink, Header, Label, Loading, PrimaryButton, ScreenFrame, TextButton, styles } from './ui.tsx';
import { colors } from '../theme.ts';

export function VenueFailure({ error, retry }: { error: unknown; retry: () => void }) {
  const kind = error instanceof PublicApiError ? error.kind : 'network';
  const message = kind === 'unavailable' ? 'Площадка или данные не найдены либо больше недоступны.'
    : kind === 'invalid' ? 'Не удалось подтвердить данные сервера. Повторите загрузку.'
    : kind === 'network' ? 'Не удалось получить данные. Проверьте соединение.' : 'Сервис временно недоступен.';
  return <View style={styles.card} accessibilityLiveRegion="polite"><Label>{message}</Label><TextButton title="Повторить" onPress={retry} /></View>;
}
/** Safe links are projected before reaching this component; only a press opens one. */
function PublicLink({ label, url, onControlTouch, onControlTouchEnd }: {
  label: string; url: string; onControlTouch?: () => void; onControlTouchEnd?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return <View>
    <Pressable accessibilityRole="button" onPressIn={onControlTouch} onPressOut={onControlTouchEnd}
      onPress={() => { onControlTouchEnd?.(); setFailed(false); void Linking.openURL(url).catch(() => setFailed(true)); }}
      style={({ pressed }) => [styles.textButton, pressed && { backgroundColor: colors.paper }]}>
      <Label style={{ color: colors.ink, textAlign: 'center' }}>{label}</Label>
    </Pressable>
    {failed && <Label accessibilityRole="alert">Не удалось открыть ссылку. Попробуйте ещё раз.</Label>}
  </View>;
}

/** Media surface only — credits/retry stay outside gallery/sheet gesture ownership. */
function VenueMediaSurface({ item, name, mapSheet = false, onControlTouch, onControlTouchEnd }: {
  item: GalleryItem; name: string; mapSheet?: boolean;
  onControlTouch?: () => void; onControlTouchEnd?: () => void;
}) {
  const identity = galleryMediaIdentity(item);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const active = useRef(identity);
  const attemptRef = useRef(0);
  useEffect(() => {
    active.current = identity;
    attemptRef.current = 0;
    setAttempt(0);
    setPhase('loading');
  }, [identity]);
  const label = item.credit.kind === 'photo' ? 'Фото площадки' : item.credit.kind === 'logo' ? 'Логотип площадки' : 'Иллюстрация';
  return <View style={{ gap: 8 }}>
    {!mapSheet && <Label>{label}</Label>}
    {phase !== 'error' && <Image key={`${identity}:${attempt}`} source={{ uri: `${API_ORIGIN}${item.url}` }} resizeMode={mapSheet ? "cover" : "contain"}
      accessibilityLabel={`${label}: ${name}`} style={mapSheet ? {width:'100%',aspectRatio:16/9,borderRadius:12,backgroundColor:colors.paper} : {width:'100%',height:230,backgroundColor:colors.paper}}
      onLoad={() => { if (mediaFailureApplies(active.current, identity) && attemptRef.current === attempt) setPhase('ready'); }}
      onError={() => { if (mediaFailureApplies(active.current, identity) && attemptRef.current === attempt) setPhase('error'); }} />}
    {phase === 'loading' && <Label accessibilityLiveRegion="polite">Загружаем изображение…</Label>}
    {phase === 'error' && <><Label>Изображение не загрузилось.</Label>
      <Pressable accessibilityRole="button" accessibilityLabel="Повторить загрузку изображения" onPressIn={onControlTouch} onPressOut={onControlTouchEnd}
        onPress={() => {
          onControlTouchEnd?.();
          if (!mediaFailureApplies(active.current, identity)) return;
          attemptRef.current += 1;
          setAttempt(attemptRef.current);
          setPhase('loading');
        }} style={({ pressed }) => [styles.textButton, pressed && { backgroundColor: colors.paper }]}>
        <Label style={{ color: colors.ink, textAlign: 'center' }}>Повторить загрузку изображения</Label>
      </Pressable></>}
  </View>;
}

function VenueImageCredits({ item, onControlTouch, onControlTouchEnd }: {
  item: GalleryItem; onControlTouch?: () => void; onControlTouchEnd?: () => void;
}) {
  return item.credit.url
    ? <PublicLink key={item.credit.url} label={item.credit.text} url={item.credit.url} onControlTouch={onControlTouch} onControlTouchEnd={onControlTouchEnd} />
    : <Label>{item.credit.text}</Label>;
}

/** Controlled gallery: parent owns selected media across compact/expanded and info/schedule. */
export function VenueGallery({ venue, mapSheet = false, selected, onSelect, onControlTouch, onControlTouchEnd }: {
  venue: PublicVenue; mapSheet?: boolean; selected: GallerySelection | null; onSelect: (next: GallerySelection | null) => void;
  onControlTouch?: () => void; onControlTouchEnd?: () => void;
}) {
  const item = resolveGallerySelection(venue.gallery, venue.mainImage, selected);
  const index = item ? Math.max(0, venue.gallery.findIndex(entry => entry.url === item.url || entry.id === item.id)) : 0;
  const suppress = useRef(false);
  const axis = useRef<GalleryAxis>('pending');
  const generation = useRef(0);
  const retired = useRef(false);
  const mounted = useRef(true);
  const scopeKey = `${venue.id}:${venue.cityId}`;
  const scopeRef = useRef(scopeKey);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; retired.current = true; generation.current += 1; };
  }, []);
  useEffect(() => {
    if (scopeRef.current === scopeKey) return;
    scopeRef.current = scopeKey;
    // New venue/city scope retires any in-flight gallery gesture without blocking the next grant.
    retired.current = true;
    generation.current += 1;
    axis.current = 'pending';
  }, [scopeKey]);
  const go = useCallback((delta: 1 | -1) => {
    if (venue.gallery.length <= 1) return;
    const next = stepGallerySelection(venue.gallery, item, delta);
    onSelect(gallerySelectionOf(next));
  }, [venue.gallery, item, onSelect]);
  const portsRef = useRef({ go, galleryLength: venue.gallery.length });
  portsRef.current = { go, galleryLength: venue.gallery.length };
  const responder = useMemo(() => PanResponder.create(createGalleryGestureHandlers({
    canPage: () => portsRef.current.galleryLength > 1,
    isMounted: () => mounted.current,
    getGeneration: () => generation.current,
    bumpGeneration: () => { generation.current += 1; },
    isRetired: () => retired.current,
    setRetired: (value) => { retired.current = value; },
    getAxis: () => axis.current,
    setAxis: (next) => { axis.current = next; },
    onGrantFresh: () => { suppress.current = false; },
    onCommit: (action) => {
      // Follow-on suppress only for the originating image surface, not arrow controls.
      suppress.current = true;
      portsRef.current.go(action === 'next' ? 1 : -1);
    },
  })), []);
  const step = (delta: 1 | -1) => {
    // Fresh arrow activation is never discarded for a prior image-surface swipe.
    go(delta);
  };
  const consumeImageSuppress = () => {
    const result = consumeFollowOnSuppress(suppress.current);
    suppress.current = result.suppress;
    return result.blocked;
  };
  return <View style={mapSheet ? {gap:8} : styles.card}>
    {!mapSheet && <Label accessibilityRole="header" style={styles.subtitle}>Галерея</Label>}
    {item ? <>
      <View {...responder.panHandlers} onTouchStart={() => { suppress.current = suppressAfterFreshTouch(false, suppress.current); }}>
        <Pressable accessibilityRole="image" accessibilityLabel={`Изображение ${index + 1} из ${venue.gallery.length}`}
          accessibilityActions={venue.gallery.length > 1 ? [{ name: 'increment', label: 'Следующее изображение' }, { name: 'decrement', label: 'Предыдущее изображение' }] : undefined}
          onAccessibilityAction={event => {
            if (consumeImageSuppress()) return;
            if (event.nativeEvent.actionName === 'increment') step(1);
            if (event.nativeEvent.actionName === 'decrement') step(-1);
          }}
          onPress={() => { consumeImageSuppress(); }}
          accessible>
          <VenueMediaSurface item={item} name={venue.name} mapSheet={mapSheet} onControlTouch={onControlTouch} onControlTouchEnd={onControlTouchEnd} />
        </Pressable>
      </View>
      <VenueImageCredits item={item} onControlTouch={onControlTouch} onControlTouchEnd={onControlTouchEnd} />
      {(!mapSheet || venue.gallery.length > 1) && <Label accessibilityLiveRegion="polite">Изображение {index + 1} из {venue.gallery.length}</Label>}
      {venue.gallery.length > 1 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Предыдущее изображение"
          onPressIn={onControlTouch} onPressOut={onControlTouchEnd} onPress={() => { onControlTouchEnd?.(); step(-1); }}
          style={{ minWidth: 44, minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' }}>
          <Label>←</Label>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Следующее изображение"
          onPressIn={onControlTouch} onPressOut={onControlTouchEnd} onPress={() => { onControlTouchEnd?.(); step(1); }}
          style={{ minWidth: 44, minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' }}>
          <Label>→</Label>
        </Pressable>
      </View>}
    </> : <VenueCover venueId={venue.id} name={venue.name} photoUrl={venue.mainImage} size={mapSheet ? 'sheet' : 'page'} />}
    {venue.catalogSource && <><Label>Источник: badminton4u.ru</Label>{venue.catalogSource.clubs.map(club => <PublicLink key={club.id} label={club.name} url={club.url} onControlTouch={onControlTouch} onControlTouchEnd={onControlTouchEnd} />)}</>}
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
  </View>;
}
function VenueFacts({ venue }: { venue: PublicVenue }) {
  return <>
    {venue.courtCount !== null && <Label>Количество кортов: {venue.courtCount}</Label>}
    {venue.parking !== null && <Label>Парковка: {venue.parking ? 'Есть' : 'Нет'}</Label>}
    {venue.showers !== null && <Label>Душевые: {venue.showers ? 'Есть' : 'Нет'}</Label>}
    {venue.updatedAt && <Label>Содержимое обновлено: {new Date(venue.updatedAt).toLocaleDateString('ru-RU', { timeZone: 'UTC' })}</Label>}
  </>;
}
export function VenueContent({ venue, schedule, mapSheet = false, selected = null, onSelectMedia, onControlTouch, onControlTouchEnd }: {
  venue: PublicVenue; schedule?: ReactNode; mapSheet?: boolean;
  selected?: GallerySelection | null; onSelectMedia?: (next: GallerySelection | null) => void;
  onControlTouch?: () => void; onControlTouchEnd?: () => void;
}) {
  const owned = useVenueMedia(onSelectMedia ? undefined : venue);
  const media = onSelectMedia ? selected : owned.selected;
  const setMedia = onSelectMedia ?? owned.setSelected;
  if (mapSheet) return <>
    <VenueGallery venue={venue} mapSheet selected={media} onSelect={setMedia} onControlTouch={onControlTouch} onControlTouchEnd={onControlTouchEnd} />
    {venue.description && <Label>{venue.description}</Label>}
    <Label accessibilityRole="header" style={{fontSize:24,lineHeight:32,fontWeight:'800'}}>{venue.name}</Label><Label>{venue.address}</Label>
    <View style={{gap:8}}><VenueFacts venue={venue} /></View>
    <View style={{gap:8}}><Label accessibilityRole="header" style={styles.subtitle}>Контакты площадки</Label>
      {venue.contacts.length ? venue.contacts.map(link => <PublicLink key={link.url} {...link} onControlTouch={onControlTouch} onControlTouchEnd={onControlTouchEnd} />) : <Label>Контакты пока не добавлены</Label>}
    </View>
    {schedule}
    <NativeVenueCommunity venueId={venue.id} name={venue.name} />
  </>;
  return <>
    <Label accessibilityRole="header" style={styles.title}>{venue.name}</Label><Label>{venue.address}</Label>
    <VenueGallery venue={venue} selected={media} onSelect={setMedia} />
    <View style={styles.card}><Label accessibilityRole="header" style={styles.subtitle}>О площадке</Label>
      {venue.description && <Label>{venue.description}</Label>}
      <VenueFacts venue={venue} />
    </View>
    <View style={styles.card}><Label accessibilityRole="header" style={styles.subtitle}>Контакты площадки</Label>
      {venue.contacts.length ? venue.contacts.map(link => <PublicLink key={link.url} {...link} />) : <Label>Контакты пока не добавлены</Label>}
    </View>
    {schedule ?? <Schedule venue={venue} />}
    <NativeVenueCommunity venueId={venue.id} name={venue.name} />
  </>;
}
function CompactSourceLink({name,url,onControlTouch,onControlTouchEnd}:{
  name:string;url:string;onControlTouch?:()=>void;onControlTouchEnd?:()=>void;
}) {
  const [failed,setFailed] = useState(false);
  return <><Pressable accessibilityRole="link" accessibilityLabel={`Источник: badminton4u.ru · ${name}`}
    onPressIn={onControlTouch} onPressOut={onControlTouchEnd}
    onPress={() => {onControlTouchEnd?.();setFailed(false);void Linking.openURL(url).catch(() => setFailed(true));}}
    style={{minHeight:44,justifyContent:'center'}}><Label style={{fontSize:12,lineHeight:18,color:colors.secondary}}>Источник: badminton4u.ru · {name}</Label></Pressable>
    {failed && <Label accessibilityRole="alert">Не удалось открыть источник. Попробуйте ещё раз.</Label>}</>;
}
/** Verified compact catalog credit is a sibling of the single row action. */
export function VenuePreview({ venue, games, onOpen, selected = null, onSelectMedia, suppressTap, onControlTouch, onControlTouchEnd }: {
  venue: PublicVenue; games: readonly PublicGame[] | null; onOpen: () => void;
  selected?: GallerySelection | null; onSelectMedia?: (next: GallerySelection | null) => void;
  suppressTap?: () => boolean;
  onControlTouch?: () => void; onControlTouchEnd?: () => void;
}) {
  const item = resolveGallerySelection(venue.gallery, venue.mainImage, selected);
  const identity = galleryMediaIdentity(item);
  const [failedIdentity, setFailedIdentity] = useState<string | null>(null);
  const [badgeHeight, setBadgeHeight] = useState(0);
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const failed = failedIdentity !== null && failedIdentity === identity;
  const showPhoto = !!(item && !failed);
  const source = safeCatalogSource(venue.catalogSource), club = source?.clubs[0];
  const axis = useRef<GalleryAxis>('pending');
  const generation = useRef(0);
  const retired = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; retired.current = true; generation.current += 1; };
  }, []);
  const index = item ? Math.max(0, venue.gallery.findIndex(entry => entry.url === item.url || entry.id === item.id)) : 0;
  const page = (delta: 1 | -1) => {
    if (!onSelectMedia || venue.gallery.length <= 1) return;
    const next = stepGallerySelection(venue.gallery, item, delta);
    onSelectMedia(gallerySelectionOf(next));
  };
  const pageRef = useRef({ page, canPage: !!(onSelectMedia && venue.gallery.length > 1), item });
  pageRef.current = { page, canPage: !!(onSelectMedia && venue.gallery.length > 1), item };
  const imageSwipe = useMemo(() => PanResponder.create(createGalleryGestureHandlers({
    canPage: () => pageRef.current.canPage,
    isMounted: () => mounted.current,
    getGeneration: () => generation.current,
    bumpGeneration: () => { generation.current += 1; },
    isRetired: () => retired.current,
    setRetired: (value) => { retired.current = value; },
    getAxis: () => axis.current,
    setAxis: (next) => { axis.current = next; },
    onGrantFresh: () => {},
    onCommit: (action) => {
      pageRef.current.page(action === 'next' ? 1 : -1);
    },
  })), []);
  const open = () => { if (suppressTap?.()) return; onOpen(); };
  const thumbLabel = showPhoto
    ? `${item!.credit.kind === 'illustration' ? 'Иллюстрация' : item!.credit.kind === 'logo' ? 'Логотип площадки' : 'Фото площадки'}${venue.gallery.length > 1 ? `, ${index + 1} из ${venue.gallery.length}` : ''}`
    : 'Иллюстрация';
  return <View style={{gap:8}}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Открыть площадку ${venue.name}`} onPress={open}
      style={{flexDirection:'row',alignItems:'center',gap:12,minHeight:84}}>
      <View {...imageSwipe.panHandlers} style={{width:64,minHeight:Math.max(64,badgeHeight),backgroundColor:colors.paper,borderRadius:12,overflow:'hidden'}}
        accessible accessibilityRole="image" accessibilityLabel={thumbLabel}
        accessibilityActions={onSelectMedia && venue.gallery.length > 1 ? [
          { name: 'increment', label: 'Следующее изображение' },
          { name: 'decrement', label: 'Предыдущее изображение' },
        ] : undefined}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'increment') page(1);
          if (event.nativeEvent.actionName === 'decrement') page(-1);
        }}>
        {showPhoto ? <Image key={identity} source={{uri:`${API_ORIGIN}${item!.url}`}} resizeMode="cover"
          accessibilityLabel={thumbLabel}
          onError={() => {
            if (!mediaFailureApplies(activeIdentity.current, identity)) return;
            setFailedIdentity(identity);
          }} style={{width:64,height:64}} />
          : <VenueCover venueId={venue.id} name={venue.name} photoUrl={null} size="thumb" />}
        {item?.credit.kind === 'illustration' && showPhoto && <Label onLayout={event => setBadgeHeight(event.nativeEvent.layout.height)}
          style={{position:'absolute',bottom:0,left:0,right:0,fontSize:10,lineHeight:14,backgroundColor:colors.card,textAlign:'center'}}>Иллюстрация</Label>}
      </View>
      <View style={{flex:1,minWidth:0,gap:0}}>
        <Label accessibilityRole="header" style={{fontSize:17,lineHeight:23,fontWeight:'700'}}>{venue.name}</Label><Label style={{fontSize:14,lineHeight:20}}>{venue.address}</Label>
        <Label style={{fontSize:13,lineHeight:18,color:colors.secondary}}>{games === null ? 'Расписание временно недоступно' : games[0] ? new Date(games[0].startsAt).toLocaleString('ru-RU',{timeZone:venue.timezone}) : 'Пока нет игр'}</Label>
        {games !== null && games.length > 0 && <Label style={{fontSize:13,lineHeight:18,color:colors.limeDeep}}>{games.length} доступных игр</Label>}
      </View><View style={{width:44,height:44,borderRadius:22,backgroundColor:colors.lime,alignItems:'center',justifyContent:'center'}}><Label accessible={false}>↑</Label></View>
    </Pressable>
    {club && <View><CompactSourceLink name={club.name} url={club.url} onControlTouch={onControlTouch} onControlTouchEnd={onControlTouchEnd} /></View>}
  </View>;
}
export function VenueDetail({ id }: { id: string }) {
  const router = useRouter(), insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ from?: string | string[] }>();
  const from = typeof params.from === 'string' ? params.from : '';
  const task = useCallback((signal: AbortSignal) => publicApi.venue(id, signal), [id]);
  const { state, retry } = useResource(`venue:${id}`, task);
  const venue = state.status === 'ready' ? state.data : undefined;
  return <ScreenFrame header={<Header />}>
    <View style={{ flex: 1 }}>
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}>
        <BackLink title={from === 'game' ? '← К игре' : '← Назад к карте'} onPress={() => router.canGoBack() ? router.back() : router.replace('/games')} />
        {(state.status === 'loading' || state.status === 'idle') && <Loading title="Загружаем площадку…" />}
        {state.status === 'error' && <VenueFailure error={state.error} retry={retry} />}
        {venue && <VenueContent key={`${id}:${JSON.stringify(venue)}`} venue={venue} />}
      </ScrollView>
      {venue && <View style={{ padding: 16, paddingBottom: insets.bottom + 16, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.line }}>
        <PrimaryButton title="Создать игру на этой площадке →" align="left" onPress={() => router.push(venueCreatePath(venue.id)!)} />
      </View>}
    </View>
  </ScreenFrame>;
}
