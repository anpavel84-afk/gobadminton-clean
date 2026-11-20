import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentRef, RefObject } from 'react';
import {
  AccessibilityInfo, findNodeHandle, Modal, PanResponder, Platform, Pressable, ScrollView, useWindowDimensions, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { publicApi } from '../public-api.ts';
import type { PublicGame } from '../public-api.ts';
import type { MapVenue } from '../venues.ts';
import { closeVenueSheet, expandedVenueCreate, venueScheduleDays, venueSheetSpacing } from '../maps.ts';
import { discoveryDateLabel, levelLabel } from '../presentation.ts';
import { useReduceMotion, useResource } from '../hooks.ts';
import {
  compactLiveGrowthHeight,
  consumeFollowOnSuppress,
  createCompactSheetHandlers,
  createHandleSheetHandlers,
  decideCompactRelease,
  decideHandleSettle,
  gallerySelectionOf,
  gestureGenerationActive,
  measuredSheetTravel,
  resolveGallerySelection,
  createReturnFocusLifecycle,
  suppressAfterFreshTouch,
  type GallerySelection,
  type SheetAxis,
  type SheetDrag,
  type SheetResponderPorts,
} from '../venue-gestures.ts';
import { colors } from '../theme.ts';
import { VenueContent, VenueFailure, VenuePreview } from './venue-detail.tsx';
import { DiscoveryIcon } from './discovery-icon.tsx';
import { DiscoveryChip, iosModalOrientations, Label, Loading, PrimaryButton, TextButton, styles } from './ui.tsx';

export function VenueSheet({ selection, expanded, games, onExpand, onClose, onRetrySchedule, onMeasure, returnFocusRef }: {
  selection: MapVenue; expanded: boolean; games: readonly PublicGame[] | null;
  onExpand:(value:boolean) => void; onClose:() => void; onRetrySchedule:() => void; onMeasure:(height:number) => void;
  /** Host opener/fallback (e.g. map filterTrigger) restored after final compact dismiss. */
  returnFocusRef?: RefObject<ComponentRef<typeof Pressable> | null>;
}) {
  const router = useRouter(), insets = useSafeAreaInsets(), spacing = venueSheetSpacing(insets.bottom);
  const reduceMotion = useReduceMotion();
  const { height: windowHeight } = useWindowDimensions();
  const [view,setView] = useState<'info'|'schedule'>('info'), [selectedDate,setSelectedDate] = useState('');
  const [media, setMedia] = useState<GallerySelection | null>(null);
  const [lift, setLift] = useState(0);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null), mounted = useRef(true);
  const handleFocus = useRef<ComponentRef<typeof Pressable>>(null);
  const compactFocus = useRef<ComponentRef<typeof Pressable>>(null);
  const heights = useRef({ compact: 0, expanded: 0 });
  const suppressTap = useRef(false);
  const controlOrigin = useRef(false);
  const drag = useRef<SheetDrag | null>(null);
  const generation = useRef(0);
  const createNavLock = useRef(false);
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const wasExpanded = useRef(expanded);
  const returnFocus = useRef(returnFocusRef); returnFocus.current = returnFocusRef;
  const focusLife = useRef(createReturnFocusLifecycle()).current;

  const retireGesture = useCallback((clearSuppress = true) => {
    drag.current = null;
    controlOrigin.current = false;
    if (clearSuppress) suppressTap.current = false;
    setLift(0);
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      drag.current = null;
      // Intentional dismiss restore stays armed; obsolete/transient only is cancelled.
      focusLife.disposeSheetUnmount();
      onMeasure(0);
    };
  }, [onMeasure, focusLife]);

  useEffect(() => {
    generation.current += 1;
    retireGesture(true);
    createNavLock.current = false;
    focusLife.cancelObsolete();
  }, [selection.id, selection.cityId, retireGesture, focusLife]);

  useFocusEffect(useCallback(() => {
    createNavLock.current = false;
  }, []));

  // External expanded/Back/state replacement retires drag; measurement generation stays separate.
  // Do not clear follow-on suppress here — the completing gesture's synthetic press must still be consumable once.
  useEffect(() => {
    if (wasExpanded.current === expanded) return;
    wasExpanded.current = expanded;
    generation.current += 1;
    drag.current = null;
    controlOrigin.current = false;
    setLift(0);
  }, [expanded]);

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

  const restoreFocusOnCollapse = useRef(false);
  useEffect(() => {
    if (expanded) {
      restoreFocusOnCollapse.current = true;
      return;
    }
    if (!restoreFocusOnCollapse.current) return;
    restoreFocusOnCollapse.current = false;
    const frame = requestAnimationFrame(() => {
      const target = compactFocus.current ?? handleFocus.current;
      const node = findNodeHandle(target);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded]);

  const focusExpandedHandle = () => {
    const node = findNodeHandle(handleFocus.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
    AccessibilityInfo.announceForAccessibility(venue?.name ? `Площадка: ${venue.name}` : 'Площадка');
  };

  const restoreOpenerFocus = useCallback(() => {
    focusLife.armDismissRestore(() => {
      const target = returnFocus.current?.current;
      if (!target) return;
      target.focus?.();
      const node = findNodeHandle(target);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, (cb) => {
      const id = requestAnimationFrame(cb);
      return { cancel: () => cancelAnimationFrame(id) };
    });
  }, [focusLife]);

  const dismissSheet = useCallback(() => {
    restoreOpenerFocus();
    onClose();
  }, [onClose, restoreOpenerFocus]);

  const changeView = (next:'info'|'schedule') => {setView(next);scroll.current?.scrollTo({y:0,animated:false});};
  const openExpandedCreate = useCallback(() => {
    if (!create || createNavLock.current) return;
    createNavLock.current = true;
    const path = create;
    // Retire Modal first so the create formSheet is never pushed under it; selection stays for Back.
    onExpand(false);
    requestAnimationFrame(() => { router.push(path); });
  }, [create, onExpand, router]);
  const close = () => {
    const next = closeVenueSheet({filter:false,expanded,selected:selection.id});
    if (next.selected) onExpand(next.expanded); else dismissSheet();
  };
  const consumeSuppress = () => {
    const result = consumeFollowOnSuppress(suppressTap.current);
    suppressTap.current = result.suppress;
    return result.blocked;
  };
  const noteControlOrigin = () => { controlOrigin.current = true; };
  const clearControlOrigin = () => { controlOrigin.current = false; };
  const travelFor = () => measuredSheetTravel(
    heights.current.compact,
    heights.current.expanded,
    Math.floor(windowHeight * 0.88),
  );
  const availableExpanded = () => Math.floor(windowHeight * 0.88);
  const beginFreshTouch = () => {
    suppressTap.current = suppressAfterFreshTouch(drag.current !== null, suppressTap.current);
  };

  const liftRef = useRef(0); liftRef.current = lift;
  const reduceMotionRef = useRef(reduceMotion); reduceMotionRef.current = reduceMotion;
  const actions = useRef({ onExpand, dismissSheet }); actions.current = { onExpand, dismissSheet };
  const gestureApi = useRef({
    applyLift: (value: number) => { setLift(reduceMotionRef.current ? 0 : value); },
    settleLift: () => { setLift(0); },
    endCompact: (axis: SheetAxis, dy: number, gen: number) => {
      if (!gestureGenerationActive(generation.current, gen, mounted.current)) {
        drag.current = null; setLift(0); return;
      }
      const current = drag.current;
      if (current?.controlOrigin) { drag.current = null; setLift(0); return; }
      const action = decideCompactRelease(axis, dy);
      drag.current = null;
      if (action === 'none' || action === 'origin') { setLift(0); return; }
      suppressTap.current = true;
      setLift(0);
      if (action === 'dismiss') actions.current.dismissSheet();
      else actions.current.onExpand(true);
    },
    endHandle: (gen: number, dy: number, velocity: number, velocityAgeMs: number) => {
      const current = drag.current;
      if (!current || current.kind !== 'handle' || !gestureGenerationActive(generation.current, gen, mounted.current)) {
        drag.current = null; setLift(0); return;
      }
      if (current.controlOrigin || current.axis !== 'vertical' || current.travel <= 0) {
        drag.current = null; setLift(0); return;
      }
      const action = decideHandleSettle({
        originExpanded: current.originExpanded,
        dy,
        start: current.start,
        travel: current.travel,
        velocity,
        velocityAgeMs,
      });
      drag.current = null;
      suppressTap.current = true;
      setLift(0);
      if (action === 'dismiss') actions.current.dismissSheet();
      else if (action === 'expand') actions.current.onExpand(true);
      else actions.current.onExpand(false);
    },
    activateHandle: () => {
      const blocked = consumeFollowOnSuppress(suppressTap.current);
      suppressTap.current = blocked.suppress;
      if (blocked.blocked) return;
      actions.current.onExpand(!expandedRef.current);
    },
  });

  const portsRef = useRef<SheetResponderPorts | null>(null);
  portsRef.current = {
    isExpanded: () => expandedRef.current,
    isHandleActive: () => drag.current?.kind === 'handle',
    getControlOrigin: () => controlOrigin.current,
    getGeneration: () => generation.current,
    getTravel: () => travelFor(),
    getLift: () => liftRef.current,
    getDrag: () => drag.current,
    setDrag: (next) => { drag.current = next; },
    beginFreshTouch,
    retireGesture,
    applyLift: (value) => gestureApi.current.applyLift(value),
    settleLift: () => gestureApi.current.settleLift(),
    markSuppress: () => { suppressTap.current = true; },
    endCompact: (axis, dy, gen) => gestureApi.current.endCompact(axis, dy, gen),
    endHandle: (gen, dy, velocity, velocityAgeMs) => gestureApi.current.endHandle(gen, dy, velocity, velocityAgeMs),
    activateHandle: () => gestureApi.current.activateHandle(),
  };

  const [compactResponder] = useState(() => PanResponder.create(
    createCompactSheetHandlers({
      isExpanded: () => portsRef.current!.isExpanded(),
      isHandleActive: () => portsRef.current!.isHandleActive(),
      getControlOrigin: () => portsRef.current!.getControlOrigin(),
      getGeneration: () => portsRef.current!.getGeneration(),
      getTravel: () => portsRef.current!.getTravel(),
      getLift: () => portsRef.current!.getLift(),
      getDrag: () => portsRef.current!.getDrag(),
      setDrag: (next) => portsRef.current!.setDrag(next),
      beginFreshTouch: () => portsRef.current!.beginFreshTouch(),
      retireGesture: (clear) => portsRef.current!.retireGesture(clear),
      applyLift: (value) => portsRef.current!.applyLift(value),
      settleLift: () => portsRef.current!.settleLift(),
      markSuppress: () => portsRef.current!.markSuppress(),
      endCompact: (axis, dy, gen) => portsRef.current!.endCompact(axis, dy, gen),
      endHandle: (gen, dy, velocity, age) => portsRef.current!.endHandle(gen, dy, velocity, age),
      activateHandle: () => portsRef.current!.activateHandle?.(),
    }),
  ));

  const [handleResponder] = useState(() => PanResponder.create(
    createHandleSheetHandlers({
      isExpanded: () => portsRef.current!.isExpanded(),
      isHandleActive: () => portsRef.current!.isHandleActive(),
      getControlOrigin: () => portsRef.current!.getControlOrigin(),
      getGeneration: () => portsRef.current!.getGeneration(),
      getTravel: () => portsRef.current!.getTravel(),
      getLift: () => portsRef.current!.getLift(),
      getDrag: () => portsRef.current!.getDrag(),
      setDrag: (next) => portsRef.current!.setDrag(next),
      beginFreshTouch: () => portsRef.current!.beginFreshTouch(),
      retireGesture: (clear) => portsRef.current!.retireGesture(clear),
      applyLift: (value) => portsRef.current!.applyLift(value),
      settleLift: () => portsRef.current!.settleLift(),
      markSuppress: () => portsRef.current!.markSuppress(),
      endCompact: (axis, dy, gen) => portsRef.current!.endCompact(axis, dy, gen),
      endHandle: (gen, dy, velocity, age) => portsRef.current!.endHandle(gen, dy, velocity, age),
      activateHandle: () => portsRef.current!.activateHandle?.(),
    }),
  ));

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
    </> : <VenueContent venue={venue} mapSheet selected={media} onSelectMedia={setMedia} onControlTouch={noteControlOrigin} onControlTouchEnd={clearControlOrigin} schedule={<View style={{gap:8}}>
      {games === null ? <>
        <Label>Расписание временно недоступно</Label>
        <TextButton title="Повторить загрузку расписания" onPress={onRetrySchedule} />
      </> : games.length > 0 ? <>
        <Label>{`${games.length} доступных игр по выбранным условиям`}</Label>
        <PrimaryButton title="Показать игры на этой площадке" onPress={() => changeView('schedule')} />
      </> : <View style={{gap:8}} accessibilityLabel="Ближайшие игры">
        <Label style={{fontWeight:'700'}}>На этой площадке пока нет игр</Label>
        <Label>Будьте первым, кто создаст игру и соберет компанию!</Label>
      </View>}
    </View>} /> : <VenuePreview venue={venue} games={games} selected={media} onSelectMedia={setMedia} suppressTap={consumeSuppress}
      onControlTouch={noteControlOrigin} onControlTouchEnd={clearControlOrigin}
      onOpen={() => { if (consumeSuppress()) return; onExpand(true); }} />)}
  </>;

  // Compact UP live-grows height toward measured/available expanded (web VenuePopup); expanded handle still translates.
  const dragStyle = lift > 0
    ? (expanded
      ? { transform: [{ translateY: lift }] as const }
      : {
          height: compactLiveGrowthHeight(heights.current.compact, lift, availableExpanded()) || undefined,
          maxHeight: availableExpanded(),
        })
    : null;

  const sheet = (
    <View
      accessibilityLabel="Площадка"
      accessibilityViewIsModal={expanded}
      onAccessibilityEscape={close}
      onTouchStart={beginFreshTouch}
      onLayout={event => onSheetLayout(event.nativeEvent.layout.height)}
      style={[{
        position: expanded ? 'relative' as const : 'absolute' as const,
        bottom: expanded ? 0 : insets.bottom + 12,
        left: expanded ? 0 : 12,
        right: expanded ? 0 : 12,
        maxHeight: expanded ? '88%' : (lift > 0 ? availableExpanded() : '60%'),
        backgroundColor: colors.card,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.line,
        alignSelf: expanded ? 'stretch' as const : undefined,
      }, dragStyle]}
    >
      <View style={{minHeight:44,paddingHorizontal:52,alignItems:'center'}}>
        {/* View owns panHandlers — Pressable must not host them (RN Pressable overrides responder callbacks). */}
        <View {...handleResponder.panHandlers} style={{minHeight:44,width:'100%',alignItems:'center',justifyContent:'center'}}>
          <Pressable ref={handleFocus} pointerEvents="none" accessibilityRole="button"
            accessibilityLabel={expanded ? 'Свернуть площадку' : 'Развернуть площадку'} accessibilityState={{expanded}}
            onPress={() => { if (consumeSuppress()) return; onExpand(!expanded); }}
            style={{minHeight:44,width:'100%',alignItems:'center',justifyContent:'center'}}>
            <View style={{width:40,height:4,borderRadius:4,backgroundColor:colors.lineDark}} />
          </Pressable>
        </View>
        <Pressable ref={compactFocus} accessibilityRole="button" accessibilityLabel={expanded ? 'Свернуть площадку' : 'Закрыть площадку'} onPress={() => { if (consumeSuppress()) return; close(); }}
          style={{position:'absolute',right:4,top:0,width:44,height:44,alignItems:'center',justifyContent:'center'}}><DiscoveryIcon name="close" /></Pressable>
      </View>
      {expanded ? (
        <ScrollView ref={scroll} style={{flexShrink:1}} contentInsetAdjustmentBehavior="never"
          contentContainerStyle={{paddingHorizontal:16,paddingBottom:spacing.bodyBottom,gap:16}} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      ) : (
        <ScrollView {...compactResponder.panHandlers} style={{flexShrink:1}} contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled" nestedScrollEnabled
          contentContainerStyle={{paddingHorizontal:16,paddingBottom:16,gap:16}}>{body}</ScrollView>
      )}
      {create && <View style={{padding:16,paddingBottom:spacing.footerBottom,borderTopWidth:1,borderColor:colors.line}}>
        <PrimaryButton title="Создать игру на этой площадке →" align="left" onPress={openExpandedCreate} />
      </View>}
    </View>
  );

  if (!expanded) return sheet;

  // Local Modal: Android TalkBack isolation + Back/escape; map host ownership unchanged.
  return <Modal transparent visible animationType="none" onRequestClose={close} onShow={focusExpandedHandle}
    presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : undefined} supportedOrientations={iosModalOrientations}>
    <View style={[{ flex: 1, justifyContent: 'flex-end' }, Platform.OS === 'ios' && { paddingLeft: insets.left, paddingRight: insets.right }]} pointerEvents="box-none">
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      {sheet}
    </View>
  </Modal>;
}
