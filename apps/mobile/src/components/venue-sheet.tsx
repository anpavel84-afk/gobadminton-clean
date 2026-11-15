import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { publicApi } from '../public-api.ts';
import type { PublicGame } from '../public-api.ts';
import type { MapVenue } from '../venues.ts';
import { closeVenueSheet, expandedVenueCreate, venueScheduleDays, venueSheetSpacing } from '../maps.ts';
import { discoveryDateLabel, levelLabel } from '../presentation.ts';
import { useResource } from '../hooks.ts';
import { colors } from '../theme.ts';
import { VenueContent, VenueFailure, VenuePreview } from './venue-detail.tsx';
import { DiscoveryIcon } from './discovery-icon.tsx';
import { DiscoveryChip, Label, Loading, PrimaryButton, TextButton, styles } from './ui.tsx';

export function VenueSheet({ selection, expanded, games, onExpand, onClose, onRetrySchedule, onMeasure }: {
  selection: MapVenue; expanded: boolean; games: readonly PublicGame[] | null;
  onExpand:(value:boolean) => void; onClose:() => void; onRetrySchedule:() => void; onMeasure:(height:number) => void;
}) {
  const router = useRouter(), insets = useSafeAreaInsets(), spacing = venueSheetSpacing(insets.bottom);
  const [view,setView] = useState<'info'|'schedule'>('info'), [selectedDate,setSelectedDate] = useState('');
  const scroll = useRef<ScrollView>(null), mounted = useRef(true);
  useLayoutEffect(() => {mounted.current=true;return () => {mounted.current=false;onMeasure(0);};},[onMeasure]);
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
  const changeView = (next:'info'|'schedule') => {setView(next);scroll.current?.scrollTo({y:0,animated:false});};
  const close = () => {
    const next = closeVenueSheet({filter:false,expanded,selected:selection.id});
    if (next.selected) onExpand(next.expanded); else onClose();
  };
  return <View accessibilityLabel="Площадка" onLayout={event => {if (mounted.current) onMeasure(event.nativeEvent.layout.height);}}
    style={{position:'absolute',bottom:expanded ? 0 : insets.bottom+12,left:expanded ? 0 : 12,right:expanded ? 0 : 12,
      maxHeight:expanded ? '88%' : '60%',backgroundColor:colors.card,borderRadius:20,borderWidth:1,borderColor:colors.line}}>
    <View style={{minHeight:44,paddingHorizontal:52,alignItems:'center'}}>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Свернуть площадку' : 'Развернуть площадку'} accessibilityState={{expanded}}
        onPress={() => onExpand(!expanded)} style={{minHeight:44,width:'100%',alignItems:'center',justifyContent:'center'}}>
        <View style={{width:40,height:4,borderRadius:4,backgroundColor:colors.lineDark}} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Свернуть площадку' : 'Закрыть площадку'} onPress={close}
        style={{position:'absolute',right:4,top:0,width:44,height:44,alignItems:'center',justifyContent:'center'}}><DiscoveryIcon name="close" /></Pressable>
    </View>
    <ScrollView ref={scroll} style={{flexShrink:1}} contentInsetAdjustmentBehavior="never" contentContainerStyle={{paddingHorizontal:16,paddingBottom:expanded ? spacing.bodyBottom : 16,gap:16}}>
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
      </> : <VenueContent venue={venue} mapSheet schedule={<View style={{gap:8}}>
        <Label>{games === null ? 'Расписание временно недоступно' : games.length ? `${games.length} доступных игр по выбранным условиям` : 'Нет доступных игр по выбранным условиям'}</Label>
        {games !== null && games.length > 0 && <PrimaryButton title="Показать игры на этой площадке" onPress={() => changeView('schedule')} />}
        <TextButton title={games === null ? 'Повторить загрузку расписания' : 'Обновить расписание'} onPress={onRetrySchedule} />
      </View>} /> : <VenuePreview key={`${venue.id}:${JSON.stringify(venue)}`} venue={venue} games={games} onOpen={() => onExpand(true)} />)}
    </ScrollView>
    {create && <View style={{padding:16,paddingBottom:spacing.footerBottom,borderTopWidth:1,borderColor:colors.line}}>
      <PrimaryButton title="Создать игру на этой площадке" onPress={() => router.push(create)} />
    </View>}
  </View>;
}
