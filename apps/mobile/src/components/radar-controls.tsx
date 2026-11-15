import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Switch, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useAuth } from '../auth.tsx';
import { useRadar } from '../radar-runtime.tsx';
import { activationDeadline } from '../radar.ts';
import type { RadarSnapshot } from '../radar-coordinator.ts';
import { colors } from '../theme.ts';
import { Label, PrimaryButton, ScreenFrame, TextButton, styles } from './ui.tsx';
/** UI clock only: no permission, publication, heartbeat or renewal is dispatched here. */
export function radarControlPresentation(state: RadarSnapshot, now: number) {
  const a = state.activation;
  const end = a && (a.state === 'active' || a.state === 'owned_elsewhere') ? Math.min(Date.parse(a.expiresAt),Date.parse(a.hardExpiresAt)) : NaN;
  const start = a && (a.state === 'active' || a.state === 'owned_elsewhere') ? Date.parse(a.startedAt) : NaN;
  const authority = a && (a.state === 'active' || a.state === 'owned_elsewhere') ? activationDeadline(a) : NaN;
  const active = !!state.actor && a?.state === 'active' && a.ownerHere && [now,start,end,authority].every(Number.isFinite) && start <= now && end > start && authority > now && end > now;
  const running = active && state.phase !== 'restoring' && state.phase !== 'unknown' && !state.command;
  const next = a && (a.state === 'active' || a.state === 'owned_elsewhere') ? Date.parse(a.nextLocationUpdateAt) : NaN;
  const attention = !!state.command || state.phase === 'unknown' || state.phase === 'owned_elsewhere' ||
    ['denied','restricted','services_off','location_error','error'].includes(state.phase) || running && Number.isFinite(next) && now >= next;
  const seconds = running ? Math.max(0,Math.ceil((end-now)/1000)) : 0;
  const remaining = `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  const tone = attention ? 'attention' : running ? 'active' : state.phase === 'restoring' ? 'checking' : 'off';
  const caption = state.phase === 'owned_elsewhere' ? 'На другом устройстве' : attention ? 'Проверьте Radar' :
    running ? `Включён · ${remaining}` : state.phase === 'restoring' ? 'Проверяем статус' : 'Выключен';
  const progress = running && Number.isFinite(start) && end > start ? Math.max(0,Math.min(1,(end-now)/(end-start))) : 0;
  return {active, running, tone, caption, progress, remaining, until:active ? end : null};
}
export function RadarControls({ compact = false }: { compact?: boolean }) {
  const auth = useAuth(), { owner, state } = useRadar(), [open, setOpen] = useState(false), [accepted, setAccepted] = useState(false);
  const [now,setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (state.activation?.state !== 'active') return;
    const timer = setInterval(() => setNow(Date.now()),1000);
    return () => clearInterval(timer);
  },[state.activation]);
  const presentation = radarControlPresentation(state,now), {active} = presentation;
  const glyphColor = presentation.tone === 'active' ? colors.ink : colors.secondary;
  const glyph = <Svg width={48} height={48} viewBox="0 0 48 48" accessible={false}>
    <Circle cx={24} cy={24} r={21} fill="none" stroke={colors.secondary} strokeWidth={3.5} opacity={0.13} />
    {presentation.running && <Circle cx={24} cy={24} r={21} fill="none" stroke="#8DE126" strokeWidth={3.5} strokeLinecap="round"
      strokeDasharray={2*Math.PI*21} strokeDashoffset={2*Math.PI*21*(1-presentation.progress)} transform="rotate(-90 24 24)" />}
    <Circle cx={24} cy={24} r={16} fill={presentation.tone === 'active' ? colors.limeSoft : colors.paper} />
    <Circle cx={24} cy={24} r={11} fill="none" stroke={glyphColor} strokeWidth={2} />
    <Circle cx={24} cy={24} r={6} fill="none" stroke={glyphColor} strokeWidth={2} />
    <Path d="M24 24L31 17" stroke={glyphColor} strokeWidth={2} strokeLinecap="round" /><Circle cx={24} cy={24} r={1.3} fill={glyphColor} />
    {presentation.tone === 'attention' && <><Circle cx={39} cy={8} r={7} fill={colors.yellow} /><Path d="M39 4v4m0 3v1" stroke={colors.ink} strokeWidth={2} /></>}
  </Svg>;
  const enter = () => {
    if (auth.status === 'guest') { void auth.signIn('/players'); return; }
    if (auth.status !== 'authenticated') return;
    setAccepted(false); setOpen(true);
    if (!active && !state.command) void owner.consent();
  };
  const close = () => { setOpen(false); setAccepted(false); if (state.enabling || state.phase === 'consent') owner.cancel(); };
  return <>
    {compact ? <Pressable accessibilityRole="button" accessibilityLabel={`Radar. ${presentation.caption}. Открыть управление Radar`}
      accessibilityState={{expanded:open}} onPress={enter} style={{width:48,height:48,alignItems:'center',justifyContent:'center',flexShrink:0}}>
      {glyph}
    </Pressable> : <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Открыть управление Radar" onPress={enter} style={{minHeight:48,minWidth:48}}>{glyph}</Pressable>
      <Pressable accessibilityRole="button" onPress={enter} accessibilityLabel={`Radar. ${presentation.caption}`} style={{flex:1,minHeight:48,justifyContent:'center'}}>
        <Label style={{fontWeight:'600'}}>Radar</Label><Label style={{fontSize:12,lineHeight:18}}>{presentation.caption}</Label>
      </Pressable>
      <Switch accessibilityLabel="Radar" value={active} disabled={state.busy || !!state.command} onValueChange={value => { if (value) enter(); else void owner.stop(); }} />
    </View>}
    <Modal visible={open} onRequestClose={close} animationType="none" presentationStyle="pageSheet">
      <ScreenFrame><ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <TextButton title="Закрыть" onPress={close} /><Label accessibilityRole="header" style={styles.title}>Radar</Label>
        <Label>{auth.me?.displayName && !auth.me.displayName.includes('@') ? auth.me.displayName : 'Ваш профиль'}</Label>
        {state.enabling && <Label accessible accessibilityLiveRegion="polite">Сейчас ищем ближайших игроков…</Label>}
        {state.phase === 'restoring' && <Label>Проверяем статус…</Label>}
        {state.notice && <Label accessibilityLiveRegion="polite">{state.notice}</Label>}
        <Label>{presentation.caption}</Label>
        {active && !state.command ? <>
          <Label>Вы видны до {new Date(presentation.until!).toLocaleTimeString('ru-RU')}.</Label>
          {state.approximate && <Label>Используется примерное местоположение.</Label>}
          <PrimaryButton title="Выключить Radar" disabled={state.busy} onPress={() => { void owner.stop(); }} />
          <TextButton title="Обновить местоположение" onPress={() => { void owner.change('update', undefined, true); }} />
          <TextButton title="Продлить сеанс" onPress={() => { void owner.change('renew'); }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{([3,5,10] as const).map(radius => <TextButton key={radius} title={`${radius} км`} onPress={() => { void owner.change('update', radius); }} />)}</View>
        </> : !state.command && state.phase === 'consent' && state.config ? <>
          <Label>{state.config.disclosure.text}</Label>
          <Label>Разрешение устройства на геолокацию запрашивается отдельно. Примерной геопозиции достаточно.</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Switch accessibilityLabel="Согласие на временную публикацию примерного местоположения" value={accepted} onValueChange={setAccepted} /><Label style={{ flex: 1 }}>Согласен временно показывать примерное местоположение</Label></View>
          <PrimaryButton title={state.activation?.state === 'owned_elsewhere' ? 'Подтверждаю перенос Radar на это устройство' : 'Включить Radar'} disabled={!accepted || state.busy}
            onPress={() => { if (accepted && state.config) void owner.enable(state.config.disclosure.sha256, state.activation?.state === 'owned_elsewhere'); }} />
        </> : !state.command && !state.enabling && <TextButton title="Включить Radar" onPress={() => { void owner.consent(); }} />}
        {state.command && <><TextButton title="Проверить текущий статус" onPress={() => { void owner.restore(); }} />{active && <PrimaryButton title="Выключить текущий Radar" disabled={state.busy} onPress={() => { void owner.stop(); }} />}</>}
        {['denied','restricted','services_off','location_error'].includes(state.phase) && <TextButton title="Открыть настройки устройства" onPress={() => { void Linking.openSettings(); }} />}
        <Label>Поиск игроков по городу доступен и без геолокации.</Label>
        <TextButton title="К списку игроков" onPress={close} />
      </ScrollView></ScreenFrame>
    </Modal>
  </>;
}
