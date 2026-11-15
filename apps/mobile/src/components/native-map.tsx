import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Map as MapLibreMap, Camera, Marker } from '@maplibre/maplibre-react-native';
import * as Crypto from 'expo-crypto';
import type { CityMapPack, MapCamera } from '../maps.ts';
import type { MapVenue } from '../venues.ts';
import { loadNativeStyle, markerActivation, validMapCamera, venueMarkerLabel } from '../maps.ts';
import { useResource } from '../hooks.ts';
import { colors } from '../theme.ts';
import { Label, Loading, TextButton } from './ui.tsx';

const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,bytes)),byte => byte.toString(16).padStart(2,'0')).join('');
function VenueMarker({ venue, counts, selected, onSelect }: { venue: MapVenue; counts: ReadonlyMap<string,number> | null; selected: boolean; onSelect: (id:string) => void }) {
  const activation = useRef(markerActivation()).current;
  const count = counts?.get(venue.id);
  return <Marker id={venue.id} coordinate={[venue.longitude,venue.latitude]}>
    <Pressable accessibilityRole="button" accessibilityLabel={venueMarkerLabel(venue,counts)} accessibilityState={{selected}}
      onTouchStart={e => activation.start(e.nativeEvent.pageX,e.nativeEvent.pageY)}
      onTouchMove={e => activation.move(e.nativeEvent.pageX,e.nativeEvent.pageY)} onTouchCancel={() => activation.cancel()}
      onPress={() => {if (activation.allow()) onSelect(venue.id);}}
      style={{minWidth:48,minHeight:48,padding:10,borderRadius:24,borderWidth:2,borderColor:colors.ink,backgroundColor:selected ? colors.purple : count ? colors.lime : colors.card,alignItems:'center',justifyContent:'center'}}>
      <Label style={{fontWeight:'700',color:selected ? colors.onPurple : colors.ink}}>{count === undefined ? '…' : count > 0 ? count : '●'}</Label>
    </Pressable>
  </Marker>;
}
/** Shared native basemap/marker renderer. Public browsing never asks for GPS/Radar consent. */
export function NativeMap({ pack, venues, counts, selected, camera, onCamera, onSelect, onCatalog }: {
  pack: CityMapPack; venues: readonly MapVenue[]; counts: ReadonlyMap<string,number> | null; selected: string | null;
  camera: MapCamera | null; onCamera: (camera:MapCamera) => void; onSelect:(id:string) => void; onCatalog:() => void;
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
  const restart = () => {setPhase('loading');setNativeError('');setAttempt(n => n+1);};
  return <View style={{flex:1}}>
    {state.data && !failed && <MapLibreMap key={generation} style={StyleSheet.absoluteFill} mapStyle={state.data}
      attribution attributionPosition="bottom-left"
      onDidFinishLoadingMap={() => {if (active.current === generation) {loaded.current=true;setPhase('loaded');}}}
      onDidFailLoadingMap={() => {if (active.current === generation) {setPhase('error');setNativeError('Не удалось загрузить ресурсы карты.');}}}
      onRegionDidChange={event => {
        const center = event.geometry.coordinates, zoom = event.properties.zoomLevel;
        if (center.length >= 2 && typeof center[0] === 'number' && typeof center[1] === 'number' && typeof zoom === 'number') onCamera(validMapCamera({center:[center[0],center[1]],zoom},pack));
      }}>
      <Camera defaultSettings={{centerCoordinate:initial.center,zoomLevel:initial.zoom}} maxBounds={{ne:pack.bounds[1],sw:pack.bounds[0]}} maxZoomLevel={16} />
      {phase === 'loaded' && venues.map(venue => <VenueMarker key={venue.id} venue={venue} counts={counts} selected={selected === venue.id} onSelect={onSelect} />)}
    </MapLibreMap>}
    {!failed && (state.status !== 'ready' || phase !== 'loaded') && <View style={mapStyles.status}><Loading title="Загружаем карту…" /></View>}
    {failed && <View style={mapStyles.status} accessibilityRole="alert">
      <Label>Карта не загрузилась</Label><Label>{nativeError || 'Не удалось проверить или получить ресурсы карты.'}</Label>
      <TextButton title="Повторить загрузку карты" onPress={restart} /><TextButton title="Площадки списком" onPress={onCatalog} />
    </View>}
  </View>;
}
const mapStyles = StyleSheet.create({status:{margin:16,marginTop:90,padding:16,gap:8,borderRadius:16,backgroundColor:colors.card}});
