import type { PropsWithChildren } from 'react';
import { Pressable, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { useMessages } from './messages.tsx';
import { Label } from './ui.tsx';
import { colors } from '../theme.ts';

// Ported verbatim from WEB nav-items.ts / nav-icon-paths.tsx. Accepted fourth Messages tab uses the same root owner.
export const MAIN_NAV_ITEMS = [
  { path: '/games', label: 'Игры', icon: 'games' },
  { path: '/players', label: 'Игроки', icon: 'players' },
  { path: '/my-games', label: 'Мои игры', icon: 'mine' },
  { path: '/messages', label: 'Сообщения', icon: 'messages' },
] as const;
const icons = {
  messages: <Path d="M5 3.7h14A3.3 3.3 0 0 1 22.3 7v8.55a3.3 3.3 0 0 1-3.3 3.3H9.75l-4.25 3.0v-3H5a3.3 3.3 0 0 1-3.3-3.3V7A3.3 3.3 0 0 1 5 3.7Z" />,
  games: <>
    <Path d="M5.4 15 L9 18.6 A2.545584412271571 2.545584412271571 0 0 1 5.4 15 Z" />
    <Path d="M5.32 14.92 L10.739503532 3.677165335 A1.4 1.4 0 0 1 13.277165335 4.860496468 L5.32 14.92 Z" />
    <Path d="M7.2 16.8 L16.820101013 5.2 A1.4 1.4 0 0 1 18.8 7.179898987 L7.2 16.8 Z" />
    <Path d="M9.08 18.68 L19.139503532 10.722834665 A1.4 1.4 0 0 1 20.322834665 13.260496468 L9.08 18.68 Z" />
  </>,
  players: <>
    <Circle cx="8.7" cy="6.7" r="2.65" />
    <Path d="M3.2 20.4v-1.6c0-3.4 2.25-5.45 5.5-5.45s5.5 2.05 5.5 5.45v1.6" />
    <Path d="M16.8 8.0c1.55.3 2.55 1.54 2.55 3.0s-1 2.72-2.5 3.0" />
    <Path d="M18.1 15.3c2.2.82 3.3 2.3 3.3 5.1" />
  </>,
  mine: <>
    <Path d="M8.2 4.3H5.25A2.25 2.25 0 0 0 3 6.55v13.2A2.25 2.25 0 0 0 5.25 22h13.5A2.25 2.25 0 0 0 21 19.75V6.55a2.25 2.25 0 0 0-2.25-2.25H15.8" />
    <Path d="M9.2 4V3.5a2.8 2.8 0 0 1 5.6 0V4h.9v2.55H8.3V4h.9Z" />
    <Path d="m7.85 14.05 2.7 2.7 5.9-6.1" />
  </>,
};
/** Always owns the same Stack subtree; changing sections never rekeys an auth/participation owner. */
export function MainNavigation({ children }: PropsWithChildren) {
  const { state } = useMessages();
  const count = state.counts ? state.counts.pendingRequestCount + state.counts.pendingInvitationCount + state.counts.dmUnread + state.counts.gameChatUnread : null;
  const path = usePathname(), router = useRouter(), insets = useSafeAreaInsets();
  const visible = /^\/(games|players|my-games|messages|profile)(\/|$)/.test(path);
  return <View style={{ flex: 1, backgroundColor: colors.card }}>
    <View style={{ flex: 1 }}>{children}</View>
    {visible && <View accessibilityRole="tablist" accessibilityLabel="Основная навигация" style={{
      flexDirection: 'row', paddingLeft: insets.left + 4, paddingRight: insets.right + 4,
      paddingBottom: insets.bottom + 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line,
    }}>{MAIN_NAV_ITEMS.map(item => {
      const selected = path === item.path || path.startsWith(`${item.path}/`);
      return <Pressable key={item.path} accessibilityRole="tab" accessibilityState={{ selected }}
        onPress={() => { if (path !== item.path) router.navigate(item.path); }}
        style={({ pressed }) => ({ flex: 1, minWidth: 44, minHeight: 59, paddingHorizontal: 2, paddingVertical: 8, gap: 7,
          alignItems: 'center', justifyContent: 'center', borderRadius: 12,
          backgroundColor: pressed ? colors.paper : colors.card })}>
        <View style={{ padding: 4, borderRadius: 24, backgroundColor: selected ? colors.limeSoft : colors.card }}><Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={selected ? colors.ink : colors.secondary} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" accessible={false}>{icons[item.icon]}</Svg></View>
        {item.icon === 'messages' && state.actor && <View accessibilityLabel={count === null ? 'Количество сообщений загружается или недоступно' : `${count} требуют внимания`}
          style={{ position: 'absolute', top: 0, right: 6, minWidth: 20, minHeight: 20, borderRadius: 10, backgroundColor: count === null ? colors.paper : count > 0 ? colors.limeSoft : 'transparent' }}>
          <Label style={{ textAlign: 'center', fontSize: 12 }}>{count === null ? '…' : count > 99 ? '99+' : count > 0 ? count : ''}</Label></View>}
        {selected && <View style={{ position: 'absolute',bottom: -3,width: 30,height: 3,borderRadius: 3,backgroundColor: '#74CE14' }} />}
        <Label style={{ fontSize: 12, lineHeight: 18, color: selected ? colors.ink : colors.secondary, textAlign: 'center', fontWeight: '500' }}>{item.label}</Label>
      </Pressable>;
    })}</View>}
  </View>;
}
