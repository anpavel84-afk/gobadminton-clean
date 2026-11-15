import { useCallback } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { publicApi } from '../public-api.ts';
import type { PublicGame } from '../public-api.ts';
import type { MapVenue } from '../venues.ts';
import { expandedVenueCreate, venueSheetSpacing } from '../maps.ts';
import { useResource } from '../hooks.ts';
import { colors } from '../theme.ts';
import { VenueContent, VenueFailure, VenuePreview } from './venue-detail.tsx';
import { GameCard } from './game-card.tsx';
import { DiscoveryIcon } from './discovery-icon.tsx';
import { Label, Loading, PrimaryButton, TextButton, styles } from './ui.tsx';

export function VenueSheet({ selection, expanded, games, onExpand, onClose, onRetrySchedule }: {
  selection: MapVenue; expanded: boolean; games: readonly PublicGame[] | null;
  onExpand:(value:boolean) => void; onClose:() => void; onRetrySchedule:() => void;
}) {
  const router = useRouter(), insets = useSafeAreaInsets(), spacing = venueSheetSpacing(insets.bottom);
  const task = useCallback(async (signal:AbortSignal) => {
    const venue = await publicApi.venue(selection.id,signal);
    if (venue.id !== selection.id || venue.cityId !== selection.cityId || venue.timezone !== selection.timezone) throw new Error('Venue scope mismatch');
    return venue;
  },[selection.id,selection.cityId,selection.timezone]);
  const {state,retry} = useResource(`sheet:${selection.id}`,task), venue = state.status === 'ready' ? state.data : undefined;
  const create = expandedVenueCreate(expanded,venue);
  return <View accessibilityLabel="Площадка" style={{position:'absolute',bottom:0,left:0,right:0,
    maxHeight:expanded ? '88%' : '52%',backgroundColor:colors.card,borderTopLeftRadius:20,borderTopRightRadius:20,borderWidth:1,borderColor:colors.line}}>
    <View style={{minHeight:48,paddingHorizontal:60,alignItems:'center'}}>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Свернуть площадку' : 'Развернуть площадку'} accessibilityState={{expanded}}
        onPress={() => onExpand(!expanded)} style={{minHeight:48,width:'100%',alignItems:'center',justifyContent:'center'}}>
        <View style={{width:40,height:4,borderRadius:4,backgroundColor:colors.lineDark}} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Закрыть площадку" onPress={onClose}
        style={{position:'absolute',right:8,top:0,width:48,height:48,alignItems:'center',justifyContent:'center'}}><DiscoveryIcon name="close" /></Pressable>
    </View>
    <ScrollView style={{flexShrink:1}} contentInsetAdjustmentBehavior="never" contentContainerStyle={{paddingHorizontal:16,paddingTop:expanded ? 16 : 0,paddingBottom:expanded ? spacing.bodyBottom : insets.bottom+16,gap:16}}>
      {(state.status === 'idle' || state.status === 'loading') && <Loading title="Загружаем площадку…" />}
      {state.status === 'error' && <VenueFailure error={state.error} retry={retry} />}
      {venue && (expanded ? <VenueContent venue={venue} schedule={<View style={{gap:16}}>
        <Label accessibilityRole="header" style={styles.subtitle}>Предстоящие игры</Label>
        <Label>{games === null ? 'Расписание недоступно' : games.length ? `${games.length} доступных игр по выбранным условиям` : 'Нет доступных игр по выбранным условиям'}</Label>
        {games?.map(game => <GameCard key={game.id} game={game} onOpen={() => router.push({pathname:'/games/[id]',params:{id:game.id}})} />)}
        <TextButton title="Обновить расписание" onPress={onRetrySchedule} />
      </View>} /> : <>
        <VenuePreview venue={venue} games={games} onOpen={() => onExpand(true)} />
      </>)}
    </ScrollView>
    {create && <View style={{padding:16,paddingBottom:spacing.footerBottom,borderTopWidth:1,borderColor:colors.line}}>
      <PrimaryButton title="Создать игру на этой площадке" onPress={() => router.push(create)} />
    </View>}
  </View>;
}
