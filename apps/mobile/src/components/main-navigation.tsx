import type { PropsWithChildren } from 'react';
import { Pressable, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { Label } from './ui.tsx';
import { colors } from '../theme.ts';

// Ported verbatim from WEB nav-items.ts / nav-icon-paths.tsx. Messages awaits its real native implementation.
export const MAIN_NAV_ITEMS = [
  { path: '/games', label: 'Игры', icon: 'games' },
  { path: '/players', label: 'Игроки', icon: 'players' },
  { path: '/my-games', label: 'Мои игры', icon: 'mine' },
] as const;
const icons = {
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
  const path = usePathname(), router = useRouter(), insets = useSafeAreaInsets();
  const visible = /^\/(games|players|my-games|profile)(\/|$)/.test(path);
  return <View style={{ flex: 1, backgroundColor: colors.card }}>
    <View style={{ flex: 1 }}>{children}</View>
    {visible && <View accessibilityRole="tablist" accessibilityLabel="Основная навигация" style={{
      flexDirection: 'row', paddingLeft: insets.left + 4, paddingRight: insets.right + 4,
      paddingBottom: insets.bottom + 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.line,
    }}>{MAIN_NAV_ITEMS.map(item => {
      const selected = path === item.path || path.startsWith(`${item.path}/`);
      return <Pressable key={item.path} accessibilityRole="tab" accessibilityState={{ selected }}
        onPress={() => { if (path !== item.path) router.navigate(item.path); }}
        style={({ pressed }) => ({ flex: 1, minWidth: 44, minHeight: 56, padding: 8, gap: 4,
          alignItems: 'center', justifyContent: 'center', borderRadius: 12,
          backgroundColor: selected ? colors.lime : pressed ? colors.paper : colors.card })}>
        <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" accessible={false}>{icons[item.icon]}</Svg>
        <Label style={{ fontSize: 13, lineHeight: 19, textAlign: 'center', fontWeight: selected ? '700' : '500' }}>{item.label}</Label>
      </Pressable>;
    })}</View>}
  </View>;
}
