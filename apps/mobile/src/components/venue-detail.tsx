import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Image, Linking, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResource, useUpcomingItems } from '../hooks.ts';
import type { PublicGame } from '../public-api.ts';
import { API_ORIGIN, PublicApiError, publicApi } from '../public-api.ts';
import { VenueSchedule, venueCreatePath } from '../venues.ts';
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
function VenueImage({ item, name }: { item: GalleryItem; name: string }) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0), current = useRef(0);
  const label = item.credit.kind === 'photo' ? 'Фото площадки' : item.credit.kind === 'logo' ? 'Логотип площадки' : 'Иллюстрация';
  return <View style={{ gap: 8 }}>
    <Label>{label}</Label>
    {phase !== 'error' && <Image key={attempt} source={{ uri: `${API_ORIGIN}${item.url}` }} resizeMode="contain"
      accessibilityLabel={`${label}: ${name}`} style={{ width: '100%', height: 230, backgroundColor: colors.paper }}
      onLoad={() => { if (current.current === attempt) setPhase('ready'); }}
      onError={() => { if (current.current === attempt) setPhase('error'); }} />}
    {phase === 'loading' && <Label accessibilityLiveRegion="polite">Загружаем изображение…</Label>}
    {phase === 'error' && <><Label>Изображение не загрузилось.</Label><TextButton title="Повторить загрузку изображения" onPress={() => { current.current++; setAttempt(current.current); setPhase('loading'); }} /></>}
    {item.credit.url ? <PublicLink key={item.credit.url} label={item.credit.text} url={item.credit.url} /> : <Label>{item.credit.text}</Label>}
  </View>;
}
function VenueGallery({ venue }: { venue: PublicVenue }) {
  const [index, setIndex] = useState(() => Math.max(0, venue.gallery.findIndex(item => item.url === venue.mainImage)));
  const item = venue.gallery[index];
  return <View style={styles.card}>
    <Label accessibilityRole="header" style={styles.subtitle}>Галерея</Label>
    {item ? <>
      <VenueImage key={item.url} item={item} name={venue.name} />
      <Label accessibilityLiveRegion="polite">Изображение {index + 1} из {venue.gallery.length}</Label>
      {venue.gallery.length > 1 && <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <TextButton title="Предыдущее изображение" onPress={() => setIndex((index + venue.gallery.length - 1) % venue.gallery.length)} />
        <TextButton title="Следующее изображение" onPress={() => setIndex((index + 1) % venue.gallery.length)} />
      </View>}
    </> : <Label>Нет доступных изображений площадки.</Label>}
    {venue.catalogSource && <><Label>Источник: badminton4u.ru</Label>{venue.catalogSource.clubs.map(club => <PublicLink key={club.id} label={club.name} url={club.url} />)}</>}
  </View>;
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
export function VenueContent({ venue, schedule }: { venue: PublicVenue; schedule?: ReactNode }) {
  return <>
    <Label accessibilityRole="header" style={styles.title}>{venue.name}</Label><Label>{venue.address}</Label>
    <VenueGallery venue={venue} />
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
/** Original compact preview: attributed cover, venue identity and schedule hints only. */
export function VenuePreview({ venue, games, onOpen }: { venue: PublicVenue; games: readonly PublicGame[] | null; onOpen: () => void }) {
  const item = venue.gallery.find(item => item.url === venue.mainImage) ?? venue.gallery[0];
  const [failed,setFailed] = useState(false);
  return <View style={{gap:8}}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Открыть площадку ${venue.name}`} onPress={onOpen}
      style={{flexDirection:'row',alignItems:'center',gap:12,minHeight:104}}>
      <View style={{width:64,height:64,backgroundColor:colors.paper,borderRadius:12,overflow:'hidden'}}>
        {item && !failed ? <Image source={{uri:`${API_ORIGIN}${item.url}`}} resizeMode="cover" accessibilityLabel={item.credit.kind === 'illustration' ? 'Иллюстрация' : item.credit.kind === 'logo' ? 'Логотип площадки' : 'Фото площадки'} onError={() => setFailed(true)} style={{width:64,height:64}} />
          : <Label style={{fontSize:11}}>{failed ? 'Фото не загрузилось' : 'Нет изображения'}</Label>}
      </View>
      <View style={{flex:1,minWidth:0,gap:4}}>
        <Label accessibilityRole="header" style={styles.subtitle}>{venue.name}</Label><Label>{venue.address}</Label>
        <Label>{games === null ? 'Расписание временно недоступно' : games[0] ? new Date(games[0].startsAt).toLocaleString('ru-RU',{timeZone:venue.timezone}) : 'Пока нет игр'}</Label>
        {games !== null && games.length > 0 && <Label>{games.length} доступных игр</Label>}
      </View><Label accessible={false} style={{width:32,textAlign:'center'}}>↑</Label>
    </Pressable>
    {item && (item.credit.url ? <PublicLink label={item.credit.text} url={item.credit.url} /> : <Label>{item.credit.text}</Label>)}
    {venue.catalogSource && <><Label>Источник: badminton4u.ru</Label>{venue.catalogSource.clubs.map(club => <PublicLink key={club.id} label={club.name} url={club.url} />)}</>}
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
