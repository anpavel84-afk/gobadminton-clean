import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, PanResponder, Pressable, ScrollView, View } from 'react-native';
import type { GestureResponderEvent, PanResponderGestureState } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { publicApi } from '../public-api.ts';
import type { PublicGame } from '../public-api.ts';
import type { MapVenue } from '../venues.ts';
import { closeVenueSheet, expandedVenueCreate, venueScheduleDays, venueSheetSpacing } from '../maps.ts';
import { discoveryDateLabel, levelLabel } from '../presentation.ts';
import { useReduceMotion, useResource } from '../hooks.ts';
import {
  clampSheetLift,
  decideCompactRelease,
  decideHandleSettle,
  decideSheetAxis,
  gallerySelectionOf,
  resolveGallerySelection,
  type GallerySelection,
  type SheetAxis,
} from '../venue-gestures.ts';
import { colors } from '../theme.ts';
import { VenueContent, VenueFailure, VenuePreview } from './venue-detail.tsx';
import { DiscoveryIcon } from './discovery-icon.tsx';
import { DiscoveryChip, Label, Loading, PrimaryButton, TextButton, styles } from './ui.tsx';

export function VenueSheet({ selection, expanded, games, onExpand, onClose, onRetrySchedule, onMeasure }: {
  selection: MapVenue; expanded: boolean; games: readonly PublicGame[] | null;
  onExpand:(value:boolean) => void; onClose:() => void; onRetrySchedule:() => void; onMeasure:(height:number) => void;
}) {
  const router = useRouter(), insets = useSafeAreaInsets(), spacing = venueSheetSpacing(insets.bottom);
  const reduceMotion = useReduceMotion();
  const [view,setView] = useState<'info'|'schedule'>('info'), [selectedDate,setSelectedDate] = useState('');
  const [media, setMedia] = useState<GallerySelection | null>(null);
  const [lift, setLift] = useState(0);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null), mounted = useRef(true);
  const handleFocus = useRef<ComponentRef<typeof Pressable>>(null);
  const heights = useRef({ compact: 0, expanded: 0 });
  const suppressTap = useRef(false);
  const drag = useRef<{
    kind: 'compact' | 'handle'; axis: SheetAxis; startY: number; lastY: number; time: number; velocity: number;
    originExpanded: boolean; start: number; travel: number; generation: number;
  } | null>(null);
  const generation = useRef(0);
  const expandedRef = useRef(expanded); expandedRef.current = expanded;

  useLayoutEffect(() => {mounted.current=true;return () => {mounted.current=false;onMeasure(0);};},[onMeasure]);
  useEffect(() => {
    generation.current += 1;
    drag.current = null;
    suppressTap.current = false;
    setLift(0);
  }, [selection.id, selection.cityId]);

  const task = useCallback(async (signal:AbortSignal) => {
    const venue = await publicApi.venue(selection.id,signal);
    if (venue.id !== selection.id || venue.cityId !== selection.cityId || venue.timezone !== selection.timezone) throw new Error('Venue scope mismatch');
    return venue;
  },[selection.id,selection.cityId,selection.timezone]);
  const {state,retry} = useResource(`sheet:${selection.id}:${selection.cityId}:${selection.timezone}`,task), venue = state.status === 'ready' ? state.data : undefined;
  const create = expandedVenueCreate(expanded,venue);
  const days = venueScheduleDays(games ?? [],selection.timezone), day = days.find(d => d.date === selectedDate) ?? days[0];
  const schedule = view === 'schedule' && games !== null && days.length > 0;

  useEffect(() => {if (games === null || !days.length) {setView('info');setSelectedDate('');}},[games,days.length]);
  useEffect(() => {
    if (!venue) return;
    const next = gallerySelectionOf(resolveGallerySelection(venue.gallery, venue.mainImage, media));
    if ((next?.url ?? null) !== (media?.url ?? null) || (next?.id ?? null) !== (media?.id ?? null)) setMedia(next);
  }, [venue, media]);

  useEffect(() => {
    if (!expanded) return;
    const node = findNodeHandle(handleFocus.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
    AccessibilityInfo.announceForAccessibility(venue?.name ? `Площадка: ${venue.name}` : 'Площадка');
  }, [expanded, venue?.name]);

  const changeView = (next:'info'|'schedule') => {setView(next);scroll.current?.scrollTo({y:0,animated:false});};
  const close = () => {
    const next = closeVenueSheet({filter:false,expanded,selected:selection.id});
    if (next.selected) onExpand(next.expanded); else onClose();
  };
  const consumeSuppress = () => {
    if (!suppressTap.current) return false;
    suppressTap.current = false;
    return true;
  };
  const travelFor = () => {
    const compact = heights.current.compact || 172;
    const full = heights.current.expanded || Math.max(compact + 200, compact * 2.5);
    return Math.max(1, full - compact);
  };

  const liftRef = useRef(0); liftRef.current = lift;
  const reduceMotionRef = useRef(reduceMotion); reduceMotionRef.current = reduceMotion;
  const actions = useRef({ onExpand, onClose }); actions.current = { onExpand, onClose };
  const gestureApi = useRef({
    applyLift: (value: number) => { setLift(reduceMotionRef.current ? 0 : value); },
    settleLift: () => { setLift(0); },
    endCompact: (axis: SheetAxis, dy: number, gen: number) => {
      if (gen !== generation.current) { drag.current = null; setLift(0); return; }
      const action = decideCompactRelease(axis, dy);
      drag.current = null;
      if (action === 'none' || action === 'origin') { setLift(0); return; }
      suppressTap.current = true;
      setLift(0);
      if (action === 'dismiss') actions.current.onClose();
      else actions.current.onExpand(true);
    },
    endHandle: (gen: number) => {
      const current = drag.current;
      if (!current || current.kind !== 'handle' || gen !== generation.current) {
        drag.current = null; setLift(0); return;
      }
      if (current.axis !== 'vertical') { drag.current = null; setLift(0); return; }
      const action = decideHandleSettle({
        originExpanded: current.originExpanded,
        dy: current.lastY - current.startY,
        start: current.start,
        travel: current.travel,
        velocity: current.velocity,
        velocityAgeMs: Date.now() - current.time,
      });
      drag.current = null;
      suppressTap.current = true;
      setLift(0);
      if (action === 'dismiss') actions.current.onClose();
      else if (action === 'expand') actions.current.onExpand(true);
      else actions.current.onExpand(false);
    },
  });

  const [compactResponder] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      if (expandedRef.current || drag.current?.kind === 'handle') return false;
      return decideSheetAxis(gesture.dx, gesture.dy) === 'vertical';
    },
    onPanResponderGrant: (event) => {
      const travel = travelFor();
      drag.current = {
        kind: 'compact', axis: 'pending', startY: event.nativeEvent.pageY, lastY: event.nativeEvent.pageY,
        time: event.nativeEvent.timestamp, velocity: 0, originExpanded: false, start: 0, travel, generation: generation.current,
      };
    },
    onPanResponderMove: (event, gesture) => {
      const current = drag.current;
      if (!current || current.kind !== 'compact' || current.generation !== generation.current) return;
      if (current.axis === 'pending') {
        const axis = decideSheetAxis(gesture.dx, gesture.dy);
        if (axis === 'pending') return;
        if (axis === 'horizontal') { drag.current = null; gestureApi.current.settleLift(); return; }
        current.axis = 'vertical';
        suppressTap.current = true;
      }
      current.lastY = event.nativeEvent.pageY;
      gestureApi.current.applyLift(clampSheetLift(gesture.dy, current.travel));
    },
    onPanResponderRelease: (_event, gesture) => {
      const current = drag.current;
      if (!current || current.kind !== 'compact') { gestureApi.current.settleLift(); return; }
      const axis = current.axis === 'pending' ? decideSheetAxis(gesture.dx, gesture.dy) : current.axis;
      gestureApi.current.endCompact(axis, gesture.dy, current.generation);
    },
    onPanResponderTerminate: () => { drag.current = null; gestureApi.current.settleLift(); suppressTap.current = false; },
    onPanResponderTerminationRequest: () => true,
  }));

  const [handleResponder] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const originExpanded = expandedRef.current;
      const travel = travelFor();
      const start = originExpanded ? travel : (liftRef.current > 0 ? Math.min(travel, liftRef.current) : 0);
      drag.current = {
        kind: 'handle', axis: 'pending', startY: event.nativeEvent.pageY, lastY: event.nativeEvent.pageY,
        time: event.nativeEvent.timestamp, velocity: 0, originExpanded, start, travel, generation: generation.current,
      };
    },
    onPanResponderMove: (event, gesture) => {
      const current = drag.current;
      if (!current || current.kind !== 'handle' || current.generation !== generation.current) return;
      if (current.axis === 'pending') {
        const axis = decideSheetAxis(gesture.dx, gesture.dy);
        if (axis === 'pending') return;
        if (axis === 'horizontal') { drag.current = null; gestureApi.current.settleLift(); suppressTap.current = true; return; }
        current.axis = 'vertical';
        suppressTap.current = true;
      }
      const elapsed = event.nativeEvent.timestamp - current.time;
      if (elapsed > 0) current.velocity = (current.lastY - event.nativeEvent.pageY) / elapsed;
      current.lastY = event.nativeEvent.pageY;
      current.time = event.nativeEvent.timestamp;
      const position = Math.max(0, Math.min(current.travel, current.start - gesture.dy));
      gestureApi.current.applyLift(current.originExpanded ? Math.max(0, current.travel - position) : position);
    },
    onPanResponderRelease: () => {
      const current = drag.current;
      if (!current || current.kind !== 'handle') { gestureApi.current.settleLift(); return; }
      gestureApi.current.endHandle(current.generation);
    },
    onPanResponderTerminate: () => { drag.current = null; gestureApi.current.settleLift(); suppressTap.current = false; },
    onPanResponderTerminationRequest: () => false,
  }));

  const onSheetLayout = (height: number) => {
    if (!mounted.current) return;
    onMeasure(height);
    if (drag.current) return;
    if (expanded) heights.current.expanded = height;
    else heights.current.compact = height;
  };

  const body = <>
    {(state.status === 'idle' || state.status === 'loading') && <Loading title="Загружаем площадку…" />}
    {state.status === 'error' && <VenueFailure error={state.error} retry={retry} />}
    {venue && (expanded ? schedule ? <>
      <TextButton title="К информации о площадке" onPress={() => changeView('info')} />
      <Label accessibilityRole="header" style={styles.subtitle}>Игры на этой площадке</Label>
      <ScrollView horizontal contentContainerStyle={{gap:8}} accessibilityLabel="Даты игр">
        {days.map(item => <DiscoveryChip key={item.date} title={discoveryDateLabel(item.date)} selected={item.date === day?.date} onPress={() => {setSelectedDate(item.date);}} />)}
      </ScrollView>
      {day?.games.map(game => <Pressable key={game.id} accessibilityRole="button" accessibilityLabel={`Открыть игру ${game.title}`} onPress={() => router.push({pathname:'/games/[id]',params:{id:game.id}})} style={styles.card}>
        <Label>{new Date(game.startsAt).toLocaleTimeString('ru-RU',{timeZone:venue.timezone,hour:'2-digit',minute:'2-digit'})}–{new Date(game.endsAt).toLocaleTimeString('ru-RU',{timeZone:venue.timezone,hour:'2-digit',minute:'2-digit'})}</Label>
        <Label style={{fontSize:17,lineHeight:23,fontWeight:'700'}}>{game.title}</Label><Label>{levelLabel(game.levelRule)}</Label>
        <Label>Организатор: {game.organizer.displayName}</Label><Label style={{color:colors.limeDeep}}>Свободно мест: {game.availablePlaces}</Label>
      </Pressable>)}
      <TextButton title="Обновить расписание" onPress={onRetrySchedule} />
    </> : <VenueContent venue={venue} mapSheet selected={media} onSelectMedia={setMedia} schedule={<View style={{gap:8}}>
      <Label>{games === null ? 'Расписание временно недоступно' : games.length ? `${games.length} доступных игр по выбранным условиям` : 'Нет доступных игр по выбранным условиям'}</Label>
      {games !== null && games.length > 0 && <PrimaryButton title="Показать игры на этой площадке" onPress={() => changeView('schedule')} />}
      <TextButton title={games === null ? 'Повторить загрузку расписания' : 'Обновить расписание'} onPress={onRetrySchedule} />
    </View>} /> : <VenuePreview venue={venue} games={games} selected={media} onSelectMedia={setMedia} suppressTap={consumeSuppress}
      onOpen={() => { if (consumeSuppress()) return; onExpand(true); }} />)}
  </>;

  return <View accessibilityLabel="Площадка" accessibilityViewIsModal={expanded}
    onAccessibilityEscape={close}
    onLayout={event => onSheetLayout(event.nativeEvent.layout.height)}
    style={{position:'absolute',bottom:expanded ? 0 : insets.bottom+12,left:expanded ? 0 : 12,right:expanded ? 0 : 12,
      maxHeight:expanded ? '88%' : '60%',backgroundColor:colors.card,borderRadius:20,borderWidth:1,borderColor:colors.line,
      paddingBottom: !expanded && lift > 0 ? lift : 0}}>
    <View style={{minHeight:44,paddingHorizontal:52,alignItems:'center'}}>
      <Pressable ref={handleFocus} {...handleResponder.panHandlers} accessibilityRole="button" accessibilityLabel={expanded ? 'Свернуть площадку' : 'Развернуть площадку'} accessibilityState={{expanded}}
        onPress={() => { if (consumeSuppress()) return; onExpand(!expanded); }} style={{minHeight:44,width:'100%',alignItems:'center',justifyContent:'center'}}>
        <View style={{width:40,height:4,borderRadius:4,backgroundColor:colors.lineDark}} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Свернуть площадку' : 'Закрыть площадку'} onPress={() => { if (consumeSuppress()) return; close(); }}
        style={{position:'absolute',right:4,top:0,width:44,height:44,alignItems:'center',justifyContent:'center'}}><DiscoveryIcon name="close" /></Pressable>
    </View>
    {expanded ? (
      <ScrollView ref={scroll} style={{flexShrink:1}} contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{paddingHorizontal:16,paddingBottom:spacing.bodyBottom,gap:16}} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    ) : (
      <View {...compactResponder.panHandlers} style={{paddingHorizontal:16,paddingBottom:16,gap:16}}>{body}</View>
    )}
    {create && <View style={{padding:16,paddingBottom:spacing.footerBottom,borderTopWidth:1,borderColor:colors.line}}>
      <PrimaryButton title="Создать игру на этой площадке" onPress={() => router.push(create)} />
    </View>}
  </View>;
}
