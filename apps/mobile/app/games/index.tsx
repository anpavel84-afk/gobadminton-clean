import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { selectedCity } from '../../src/entry.ts';
import { useResource, useUpcomingItems } from '../../src/hooks.ts';
import { gamesResourceKey, publicApi } from '../../src/public-api.ts';
import type { GameFilters, GamePage, PublicGame } from '../../src/public-api.ts';
import { appendUpcomingPage } from '../../src/upcoming.ts';
import { usePreferences } from '../../src/state.tsx';
import { cityDate, discoveryCityHeading, discoveryDateLabel, discoveryDayBounds, discoveryListPresentation, levelGuideSkillFor, levelGuideSkills, nextCalendarDay, LEVEL_GUIDE_DISCLAIMER, LEVEL_GUIDE_DISCOVERY_SCOPE_NOTE } from '../../src/presentation.ts';
import { colors } from '../../src/theme.ts';
import { GameCard } from '../../src/components/game-card.tsx';
import { DiscoveryIcon } from '../../src/components/discovery-icon.tsx';
import { DiscoveryChip, DiscoveryCreateBanner, DiscoverySheet, ErrorState, Header, Label, Loading, PrimaryButton, ScreenFrame, TextButton, styles } from '../../src/components/ui.tsx';

const noGames: PublicGame[] = [];
const activities = [{ kind: 'all', label: 'Все' }, { kind: 'regular', label: 'Обычные' }, { kind: 'trainer_led', label: 'С тренером' }] as const;
export default function GuestGames() {
  const { preferences, hydrated, storageError } = usePreferences();
  const router = useRouter();
  const [selectedDay, setSelectedDay] = useState('');
  const [activityKind, setActivityKind] = useState<NonNullable<GameFilters['activityKind']>>('all');
  const [level, setLevel] = useState('');
  const [sheet, setSheet] = useState<'day' | 'level' | null>(null);
  const [levelChoices, setLevelChoices] = useState(false), [help, setHelp] = useState(false);
  const filterTrigger = useRef<ComponentRef<typeof Pressable>>(null), dayTrigger = useRef<ComponentRef<typeof Pressable>>(null);
  const [, tick] = useState(0);
  const citiesTask = useCallback((signal: AbortSignal) => publicApi.cities(signal), []);
  const cities = useResource('cities', citiesTask);
  const city = selectedCity(cities.state.data ?? [], preferences.cityId);
  const cityId = city?.id ?? null, timezone = city?.defaultTimezone;
  const today = timezone ? cityDate(new Date(), timezone) : '';
  const day = selectedDay && today && selectedDay < today ? today : selectedDay;
  useEffect(() => {
    if (!today || !timezone) return;
    const midnight = Date.parse(discoveryDayBounds(today, timezone).startsBefore);
    const timer = setTimeout(() => tick(n => n + 1), Math.max(1, midnight - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [today, timezone]);
  useEffect(() => { if (day !== selectedDay) setSelectedDay(day); }, [day, selectedDay]);
  const key = gamesResourceKey(cityId, { day, activityKind, timezone });
  const gamesTask = useCallback((signal: AbortSignal): Promise<GamePage> => cityId
    ? publicApi.games(cityId, undefined, signal, { day, activityKind, timezone }) : Promise.resolve({ items: [], nextCursor: null }), [cityId, day, activityKind, timezone]);
  const { state, retry, resource } = useResource(key, gamesTask);
  // The raw upcoming list/cursor stays owned by the resource. Level never changes its key/task.
  const items = useUpcomingItems(state.data?.items ?? noGames);
  const list = discoveryListPresentation(items, level, state.data?.nextCursor ?? null);
  const more = () => {
    const cursor = state.data?.nextCursor;
    if (!cityId || !cursor || state.status === 'loading') return;
    void resource.load(key, signal => publicApi.games(cityId, cursor, signal, { day, activityKind, timezone }), appendUpcomingPage);
  };
  const selectCity = () => router.push('/city');
  const dayLabel = day ? discoveryDateLabel(day) : 'Все ближайшие';
  const skill = levelGuideSkillFor(level);
  const closeSheet = () => setSheet(null);
  return <ScreenFrame header={<Header />}>
    <FlatList data={city ? list.visible : noGames} keyExtractor={game => game.id}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 22, paddingBottom: 24, gap: 16 }}
      ListHeaderComponent={<View style={feed.header}>
        <View style={feed.copy}>
          <Label style={feed.eyebrow}>Игры рядом{city ? ` · ${city.nameRu}` : ''}</Label>
          <Label accessibilityRole="header" style={feed.title}>Игры{city ? ' ' : ''}<Label style={[feed.title, { color: colors.purple }]}>{city ? `${discoveryCityHeading(city.nameRu)}.` : ''}</Label></Label>
          <Label style={feed.body}>Настоящие люди. Большой бадминтон. Выбирайте игру или тренировку и выходите на корт.</Label>
        </View>
        <View style={feed.selectors}>
          <Pressable accessibilityRole="button" accessibilityLabel="Выбрать другой город" onPress={selectCity} style={[feed.selector, { flex: 0.45 }]}>
            <View style={{ flex: 1, minWidth: 0 }}><Label style={feed.hint}>Где играем</Label><Label style={feed.value}>{city?.nameRu ?? (preferences.cityId ? 'Выбор недоступен' : 'Не выбран')}</Label></View><DiscoveryIcon name="chevron" />
          </Pressable>
          <Pressable ref={dayTrigger} accessibilityRole="button" accessibilityLabel={`Когда: ${dayLabel}`} accessibilityState={{ expanded: sheet === 'day', disabled: !city }} disabled={!city} onPress={() => setSheet('day')} style={[feed.selector, { flex: 0.55 }]}>
            <View style={{ flex: 1, minWidth: 0 }}><Label style={feed.hint}>Когда</Label><Label style={feed.value}>{dayLabel}</Label></View><DiscoveryIcon name="chevron" />
          </Pressable>
        </View>
        <DiscoveryCreateBanner onPress={() => router.push('/games/create')} />
        <View style={feed.filters}>
          <View style={feed.chips}>{activities.map(a => <DiscoveryChip key={a.kind} title={a.label} selected={a.kind === activityKind} onPress={() => setActivityKind(a.kind)} />)}</View>
          <Pressable ref={filterTrigger} accessibilityRole="button" accessibilityLabel="Фильтры" accessibilityHint={skill ? `Уровень ${skill.label}` : undefined} accessibilityState={{ expanded: sheet === 'level' }} onPress={() => { setLevelChoices(false); setSheet('level'); }} style={[feed.iconButton, level ? { backgroundColor: colors.limeSoft } : undefined]}><DiscoveryIcon name="filter" /></Pressable>
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
          <View style={feed.section}>
            <Label accessibilityRole="header" style={[styles.title, { flex: 1 }]}>Игры {discoveryCityHeading(city.nameRu)}</Label>
            <View style={{ alignItems: 'flex-end', flexShrink: 1, gap: 8 }}>
              {state.data && <Label accessibilityLiveRegion="polite" style={feed.count}>{list.count}</Label>}
              <Pressable accessibilityRole="button" accessibilityLabel="Обновить игры" accessibilityState={{ disabled: state.status === 'loading' }} disabled={state.status === 'loading'} onPress={retry} style={feed.iconButton}><DiscoveryIcon name="refresh" /></Pressable>
            </View>
          </View>
          {level && <Label accessibilityLiveRegion="polite" style={feed.body}>Уровень {skill?.label} · только загруженные игры (ntrp v1)</Label>}
          {state.status === 'loading' && <Loading />}
          {state.status === 'error' && <ErrorState error={state.error} retry={state.data?.nextCursor ? more : retry} />}
          {state.status === 'ready' && !items.length && <View style={styles.card} accessibilityLiveRegion="polite">
            <Label style={styles.subtitle}>Игр пока нет</Label>
            <Label>По выбранным условиям нет предстоящих игр в загруженной части каталога.</Label>
            <TextButton title="Обновить" onPress={retry} />
          </View>}
          {list.levelEmpty && <View style={styles.card} accessibilityLiveRegion="polite">
            <Label style={styles.subtitle}>Среди загруженных игр нет подходящих</Label>
            <Label>{LEVEL_GUIDE_DISCOVERY_SCOPE_NOTE} Загрузите ещё или сбросьте фильтр.</Label>
            <TextButton title="Сбросить фильтр уровня" onPress={() => setLevel('')} />
          </View>}
        </>}
      </View>}
      renderItem={({ item }) => <GameCard game={item} cityName={cities.state.data?.find(candidate => candidate.id === item.venue.cityId)?.nameRu}
        onOpen={() => router.push({ pathname: '/games/[id]', params: { id: item.id } })} />}
      ListFooterComponent={city && list.canLoadMore && state.status !== 'error'
        ? <PrimaryButton title="Показать ещё" disabled={state.status === 'loading'} onPress={more} /> : undefined} />
    <DiscoverySheet visible={sheet === 'day'} title="Когда играем" onClose={closeSheet} returnFocusRef={dayTrigger}>
      <DiscoveryChip title="Все ближайшие" selected={!day} onPress={() => { setSelectedDay(''); closeSheet(); }} />
      {today && Array.from({ length: 7 }, (_, i) => nextCalendarDay(today, i)).map(value => <DiscoveryChip key={value} title={discoveryDateLabel(value)} selected={day === value} onPress={() => { setSelectedDay(value); closeSheet(); }} />)}
    </DiscoverySheet>
    <DiscoverySheet visible={sheet === 'level'} title="Фильтры" onClose={closeSheet} returnFocusRef={filterTrigger}>
      <Label style={feed.body}>{city?.nameRu ?? 'Город не выбран'} · {dayLabel} · {activities.find(a => a.kind === activityKind)?.label}</Label>
      <Label>Уровень для фильтра списка</Label>
      <Pressable accessibilityRole="button" accessibilityLabel={skill?.label ?? 'Без фильтра по уровню'} accessibilityState={{ expanded: levelChoices }} onPress={() => setLevelChoices(v => !v)} style={[feed.selector, { flex: undefined }]}>
        <Label>{skill?.label ?? 'Без фильтра по уровню'}</Label><DiscoveryIcon name="chevron" />
      </Pressable>
      {levelChoices && <View style={{ gap: 8 }}>
        <DiscoveryChip title="Без фильтра по уровню" selected={!level} onPress={() => { setLevel(''); setLevelChoices(false); }} />
        {levelGuideSkills().map(s => <DiscoveryChip key={s.levelId} title={s.label} selected={level === s.levelId} onPress={() => { setLevel(s.levelId); setLevelChoices(false); }} />)}
      </View>}
      <Label style={feed.body}>{skill ? `${skill.label} · ${skill.summary}` : 'Фильтр не активен. Выбор не подставляется из профиля автоматически.'}</Label>
      <Label style={feed.body}>{LEVEL_GUIDE_DISCOVERY_SCOPE_NOTE}</Label>
      <Label style={feed.body}>{LEVEL_GUIDE_DISCLAIMER}</Label>
      <TextButton title="Что означают уровни" onPress={() => setHelp(v => !v)} />
      {help && levelGuideSkills().map(s => <Label key={s.levelId} style={feed.body}>{s.label} · {s.summary}</Label>)}
      <PrimaryButton title="Сбросить уровень" disabled={!level} onPress={() => setLevel('')} />
      <TextButton title="К списку" onPress={closeSheet} />
    </DiscoverySheet>
  </ScreenFrame>;
}
const feed = StyleSheet.create({
  header: { gap: 16 }, copy: { gap: 8, marginBottom: 10 },
  eyebrow: { alignSelf: 'flex-start', backgroundColor: colors.lime, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, fontWeight: '600', fontSize: 12, lineHeight: 17, letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { fontSize: 36, lineHeight: 39, fontWeight: '700', letterSpacing: -1.44, marginTop: 5 },
  body: { color: colors.secondary, fontSize: 13, lineHeight: 19 },
  selectors: { flexDirection: 'row', gap: 8 },
  selector: { minHeight: 82, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 9, gap: 3 },
  value: { fontSize: 16, lineHeight: 22, fontWeight: '600' }, hint: { color: colors.secondary, fontSize: 11, lineHeight: 16 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  iconButton: { minHeight: 48, minWidth: 48, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  section: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, count: { fontSize: 11, lineHeight: 16, color: colors.secondary },
});
