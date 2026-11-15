import { radarPlayer } from '../radar.ts';
import type { UnifiedRow } from '../radar.ts';
import { PlayerAvatar } from './player-card.tsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Map as MapLibreMap, Camera, Marker } from '@maplibre/maplibre-react-native';
import * as Crypto from 'expo-crypto';
import Svg, { Path } from 'react-native-svg';
import type { CityMapPack, MapCamera } from '../maps.ts';
import type { MapVenue } from '../venues.ts';
import { loadNativeStyle, nativeMapCamera, validMapCamera, venueMarkerLabel } from '../maps.ts';
import { useResource } from '../hooks.ts';
import { colors } from '../theme.ts';
import { Label, Loading, TextButton } from './ui.tsx';

const digest = async (bytes: Uint8Array) => {
  const owned = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(owned).set(bytes);
  return Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,owned)),byte => byte.toString(16).padStart(2,'0')).join('');
};
function VenueMarker({ venue, counts, selected, onSelect }: { venue: MapVenue; counts: ReadonlyMap<string,number> | null; selected: boolean; onSelect: (id:string) => void }) {
  const activate = () => onSelect(venue.id);
  const count = counts?.get(venue.id);
  const counted = count !== undefined && count > 0;
  return <Marker id={venue.id} lngLat={[venue.longitude,venue.latitude]} onPress={activate}>
    <View style={[mapStyles.markerOutline,selected && mapStyles.markerSelected]}>
    {/* MapLibre owns physical taps/pan discrimination; the child only handles explicit accessibility activation. */}
    <View accessible accessibilityRole="button" accessibilityLabel={venueMarkerLabel(venue,counts)} accessibilityState={{selected}} hitSlop={counted ? 0 : 2}
      accessibilityActions={[{name:'activate'}]} onAccessibilityAction={event => {if (event.nativeEvent.actionName === 'activate') activate();}}
      style={[mapStyles.marker,counted ? mapStyles.countedMarker : mapStyles.venueMarker]}>
      {counted ? <Label style={{fontWeight:'700',color:colors.ink}}>{count}</Label> :
        <Svg viewBox="0 0 24 24" width={28} height={28} fill="none" stroke={colors.purple} strokeWidth={1.7} accessible={false}>
          {/* Exact accepted WEB NavIcon.shuttlecockElement path. */}
          <Path d="M9 16 3 5l4-2 3 1 2-2 2 2 3-1 4 2-6 11M7 3l4 13M12 2v14M17 3l-4 13M9 16h6v3a3 3 0 0 1-6 0z" />
        </Svg>}
    </View>
    </View>
  </Marker>;
}
/** Shared native basemap/marker renderer. Public browsing never asks for GPS/Radar consent. */
export function NativeMap({ pack, venues, counts, selected, camera, controlBottom, statusTop, onCamera, onSelect, onCatalog, people = [], selectedPerson = null, onPerson }: {
  people?: readonly UnifiedRow[]; selectedPerson?: string | null; onPerson?: (row: UnifiedRow) => void;
  pack: CityMapPack; venues: readonly MapVenue[]; counts: ReadonlyMap<string,number> | null; selected: string | null;
  controlBottom:number; statusTop:number | undefined; camera: MapCamera | null; onCamera: (camera:MapCamera) => void; onSelect:(id:string) => void; onCatalog:() => void;
}) {
  const [attempt,setAttempt] = useState(0);
  const task = useCallback((signal:AbortSignal) => loadNativeStyle(pack,digest,signal),[pack]);
  const {state} = useResource(`style:${pack.version}:${attempt}`,task);
  const [phase,setPhase] = useState<'loading'|'loaded'|'error'>('loading');
  // Each keyed instance owns its callbacks; late native callbacks cannot recover another attempt.
  const generation = `${pack.version}:${attempt}`, active = useRef(generation); active.current = generation;
  const loaded = useRef(false);
  const [nativeError,setNativeError] = useState('');
  useEffect(() => {
    loaded.current=false;setPhase('loading');setNativeError('');
    const timer = setTimeout(() => {if (active.current === generation && !loaded.current) {setPhase('error');setNativeError('Карта не ответила вовремя.');}},25000);
    return () => clearTimeout(timer);
  },[generation]);
  // Capture the return camera once per renderer instance, without snapping after every pan.
  const initial = useMemo(() => validMapCamera(camera,pack),[pack,attempt]); // camera is an initial value; live updates stay native.
  const failed = state.status === 'error' || phase === 'error';
  // Only committed city/renderer/rows own marker callbacks; pending or abandoned renders do not.
  const markerOwner = {};
  const activeMarkers = useRef<object | null>(null);
  useLayoutEffect(() => {
    activeMarkers.current = markerOwner;
    return () => {if (activeMarkers.current === markerOwner) activeMarkers.current = null;};
  },[markerOwner]);
  const markersCurrent = () => activeMarkers.current === markerOwner && !!state.data && !failed && phase === 'loaded';
  const selectVenue = (id:string) => {
    if (markersCurrent() && venues.some(venue => venue.id === id)) onSelect(id);
  };
  const selectPerson = (row:UnifiedRow) => {
    if (markersCurrent() && people.includes(row) && row.radar && Date.parse(row.radar.validUntil) > Date.now()) onPerson?.(row);
  };
  const restart = () => {setPhase('loading');setNativeError('');setAttempt(n => n+1);};
  return <View style={{flex:1}}>
    {state.data && !failed && <MapLibreMap key={generation} style={StyleSheet.absoluteFill} mapStyle={state.data}
      attribution attributionPosition={{bottom:controlBottom,left:8}} compassPosition={{bottom:controlBottom,right:8}}
      onDidFinishLoadingMap={() => {if (active.current === generation) {loaded.current=true;setPhase('loaded');}}}
      onDidFailLoadingMap={() => {if (active.current === generation) {setPhase('error');setNativeError('Не удалось загрузить ресурсы карты.');}}}
      onRegionDidChange={event => {
        if (active.current !== generation) return;
        const next = nativeMapCamera(event,pack);
        if (next) onCamera(next);
      }}>
      <Camera initialViewState={{center:initial.center,zoom:initial.zoom}}
        maxBounds={[pack.bounds[0][0],pack.bounds[0][1],pack.bounds[1][0],pack.bounds[1][1]]} maxZoom={16} />
      {phase === 'loaded' && people.filter(row => row.radar && Date.parse(row.radar.validUntil) > Date.now()).map(row => <Marker key={`person:${row.publicPlayerId}`} id={`person:${row.publicPlayerId}`} lngLat={[row.radar!.geo.longitude,row.radar!.geo.latitude]} onPress={() => selectPerson(row)}>
        <View style={[mapStyles.markerOutline,selectedPerson === row.publicPlayerId && mapStyles.markerSelected]}>
          <View accessible accessibilityRole="button" accessibilityLabel={`${row.player.displayName}. Примерное местоположение`}
            accessibilityState={{selected:selectedPerson === row.publicPlayerId}} accessibilityActions={[{name:'activate'}]}
            onAccessibilityAction={event => {if (event.nativeEvent.actionName === 'activate') selectPerson(row);}}
            style={{minWidth:52,minHeight:52,borderRadius:26,borderWidth:3,borderColor:colors.card,alignItems:'center',justifyContent:'center'}}>
            <PlayerAvatar key={`${row.publicPlayerId}:${row.player.avatar.uploadedUrl}:${row.player.avatar.providerUrl}`} player={radarPlayer(row)} />
          </View>
        </View>
      </Marker>)}
      {phase === 'loaded' && venues.map(venue => <VenueMarker key={venue.id} venue={venue} counts={counts} selected={selected === venue.id} onSelect={selectVenue} />)}
    </MapLibreMap>}
    {statusTop !== undefined && !failed && (state.status !== 'ready' || phase !== 'loaded') && <View style={[mapStyles.status,{top:statusTop}]}><Loading title="Загружаем карту…" /></View>}
    {statusTop !== undefined && failed && <View style={[mapStyles.status,{top:statusTop}]} accessibilityRole="alert">
      <Label>Карта не загрузилась</Label><Label>{nativeError || 'Не удалось проверить или получить ресурсы карты.'}</Label>
      <TextButton title="Повторить загрузку карты" onPress={restart} /><TextButton title="Площадки списком" onPress={onCatalog} />
    </View>}
  </View>;
}
const mapStyles = StyleSheet.create({
  status:{position:'absolute',left:16,right:16,padding:16,gap:8,borderRadius:16,backgroundColor:colors.card},
  // WEB Games selection adds a purple 3px outline, offset 2px, to either marker.
  markerOutline:{padding:2,borderWidth:3,borderColor:'transparent',borderRadius:34},
  markerSelected:{borderColor:colors.purple},
  marker:{alignItems:'center',justifyContent:'center',borderRadius:24},
  // radar-geographic.css:32 + Games override :152 retain lime/ink and white border.
  countedMarker:{width:48,height:48,borderWidth:3,borderColor:colors.card,backgroundColor:colors.lime,boxShadow:'0px 3px 12px rgba(19,34,26,0.22)'},
  venueMarker:{width:44,height:44,borderWidth:1,borderColor:colors.line,backgroundColor:colors.card,boxShadow:'0px 8px 18px rgba(19,34,26,0.12)'},
});
