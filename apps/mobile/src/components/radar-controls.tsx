import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Switch, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useAuth } from '../auth.tsx';
import { useRadar } from '../radar-runtime.tsx';
import { colors } from '../theme.ts';
import { Label, Loading, PrimaryButton, ScreenFrame, TextButton, styles } from './ui.tsx';
export function RadarControls({ compact = false }: { compact?: boolean }) {
  const auth = useAuth(), { owner, state } = useRadar(), [open, setOpen] = useState(false), [accepted, setAccepted] = useState(false);
  const active = state.activation?.state === 'active' && state.activation.ownerHere;
  const enter = () => {
    if (auth.status === 'guest') { void auth.signIn('/players'); return; }
    if (auth.status !== 'authenticated') return;
    setAccepted(false); setOpen(true);
    if (!active && !state.command) void owner.consent();
  };
  const close = () => { setOpen(false); setAccepted(false); if (state.enabling || state.phase === 'consent') owner.cancel(); };
  return <>
    {compact ? <Pressable accessibilityRole="button" accessibilityLabel={`Radar ${active ? 'включён' : 'выключен'}`} onPress={enter}
      style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke={active ? colors.lime : colors.secondary} strokeWidth={1.7} accessible={false}>
        <Circle cx={12} cy={12} r={10} /><Circle cx={12} cy={12} r={6} /><Circle cx={12} cy={12} r={2} /><Path d="m12 12 7-7" />
      </Svg>
    </Pressable> : <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Label>Radar · {active ? 'включён' : 'выключен'}</Label>
        <Switch accessibilityLabel="Radar" value={active} onValueChange={value => { if (value) enter(); else void owner.stop(); }} />
      </View>
      <TextButton title={auth.status === 'guest' ? 'Войти для Radar' : 'Настройки Radar'} onPress={enter} />
      {state.enabling && <Loading title="Сейчас ищем ближайших игроков…" />}
      {state.notice && <Label accessibilityLiveRegion="polite">{state.notice}</Label>}
    </View>}
    <Modal visible={open} onRequestClose={close} animationType="none" presentationStyle="pageSheet">
      <ScreenFrame><ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <TextButton title="Закрыть" onPress={close} /><Label accessibilityRole="header" style={styles.title}>Radar</Label>
        <Label>{auth.me?.displayName && !auth.me.displayName.includes('@') ? auth.me.displayName : 'Ваш профиль'}</Label>
        {state.enabling && <Loading title="Сейчас ищем ближайших игроков…" />}
        {state.phase === 'restoring' && <Label>Проверяем статус…</Label>}
        {state.notice && <Label accessibilityLiveRegion="polite">{state.notice}</Label>}
        {active && !state.command ? <>
          <Label>Вы видны до {new Date(state.activation!.state === 'active' ? state.activation!.expiresAt : 0).toLocaleTimeString('ru-RU')}.</Label>
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
