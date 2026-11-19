import { RadarControls } from './radar-controls.tsx';
import { AccessibilityInfo, findNodeHandle, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentProps, ComponentRef, PropsWithChildren, ReactNode, RefObject } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { usePathname, useRouter } from 'expo-router';
import { canonicalGamePath, canonicalVenueCreatePath } from '../native-auth-protocol.ts';
import { SvgXml } from 'react-native-svg';
import { brandMarkXml } from '../../assets/brand-mark.ts';
import { colors, interaction, primaryLabelStyle, primarySurface, typography } from '../theme.ts';
import { PlayersError } from '../players.ts';
import { useAuth } from '../auth.tsx';
import { headerAvatarPresentation } from '../header-avatar.ts';
import { CreateShape, DiscoveryArrow, DiscoveryIcon } from './discovery-icon.tsx';
import { PublicApiError } from '../public-api.ts';

// Metro needs a literal require to bundle the native image asset.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const racketImage: ImageSourcePropType = require('../../assets/racket-v1.webp');

export function Label({ style, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} allowFontScaling={typography.allowFontScaling} style={[styles.text, style]} />;
}
export function BrandLockup({ launch = false, light = false }: { launch?: boolean; light?: boolean }) {
  return <View accessible accessibilityRole="image" accessibilityLabel="GoBadminton" style={[styles.brand, launch && { flex: 1, alignSelf: 'center', justifyContent: 'center' }]}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.mark, !light && !launch && { width: 112, height: 64 }, launch && { width: 168, height: 96 }]}>
      <SvgXml xml={brandMarkXml} width={launch ? 168 : light ? 47 : 112} height={launch ? 96 : light ? 32 : 63.7} style={!light && !launch ? { transform: [{ translateX: -7.71 }] } : undefined} accessible={false} />
    </View>
    {!launch && light && <Text accessible={false} allowFontScaling={false} style={[styles.brandName, light && { color: colors.onPurple }]}>
      <Text style={{ fontWeight: '700' }}>Go</Text><Text style={{ fontWeight: '500' }}>Badminton</Text>
    </Text>}
  </View>;
}
export function PrimaryButton({ title, onPress, disabled = false, align = 'center' }: {
  title: string; onPress?: () => void; disabled?: boolean; align?: 'center' | 'left';
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [primarySurface(disabled, pressed), align === 'left' && { alignItems: 'flex-start' as const }]}>
    <Text allowFontScaling style={[primaryLabelStyle, align === 'left' && { textAlign: 'left' as const }]}>{title}</Text>
  </Pressable>;
}
export function TextButton({ title, onPress, light = false }: { title: string; onPress: () => void; light?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.textButton, pressed && { backgroundColor: light ? '#6131B5' : colors.paper }]}>
    <Label style={{ color: light ? colors.onPurple : colors.ink, textAlign: 'center' }}>{title}</Label>
  </Pressable>;
}
/** One owner for all safe edges. Chrome is outside and clips the scroll viewport. */
export function ScreenFrame({ children, header, purple = false, keyboard = false }: PropsWithChildren<{
  header?: ReactNode; purple?: boolean; keyboard?: boolean;
}>) {
  const insets = useSafeAreaInsets();
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' && keyboard ? 'padding' : undefined}
    style={[styles.page, { backgroundColor: purple ? colors.purple : colors.card,
      paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
    <StatusBar style={purple ? 'light' : 'dark'} />
    {header && <View style={[styles.chrome, purple && { backgroundColor: colors.purple, borderBottomWidth: 0, paddingHorizontal: 20 }]}>{header}</View>}
    <View style={{ flex: 1, overflow: 'hidden' }}>{children}</View>
  </KeyboardAvoidingView>;
}
export function Page({ children, purple = false, keyboard = false, header }: PropsWithChildren<{
  purple?: boolean; keyboard?: boolean; header?: ReactNode;
}>) {
  const insets = useSafeAreaInsets();
  return <ScreenFrame purple={purple} keyboard={keyboard} header={header}>
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ flexGrow: 1, paddingTop: 16, paddingBottom: insets.bottom + 24, paddingHorizontal: purple ? 20 : 16, gap: 16 }}>
      {children}
    </ScrollView>
  </ScreenFrame>;
}
export function Header({ light = false, action }: { light?: boolean; action?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const returnTo = canonicalVenueCreatePath(pathname) ?? canonicalGamePath(pathname);
  const auth = useAuth();
  const profileSnapshot = useSyncExternalStore(auth.profile.subscribe, auth.profile.getSnapshot, auth.profile.getSnapshot);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  useEffect(() => {
    if (auth.status === 'authenticated' && profileSnapshot.status === 'idle') void auth.profile.load();
  }, [auth.status, auth.profile, profileSnapshot.status]);
  const { uri, initials } = headerAvatarPresentation({
    authenticated: auth.status === 'authenticated',
    meDisplayName: auth.me?.displayName,
    profile: profileSnapshot.profile,
    failedUri,
  });
  return <View style={styles.header}>
    <View style={styles.headerRow}>
      {light ? <BrandLockup light /> : <Pressable accessibilityRole="button" accessibilityLabel="GoBadminton — Игры" onPress={() => router.navigate('/games')} style={{ minWidth: 112, minHeight: 64 }}><BrandLockup /></Pressable>}
      <View style={styles.headerActions}>
        {!light && <RadarControls compact />}
        {!light && pathname !== '/profile' && <Pressable accessibilityRole="button" accessibilityLabel="Профиль" onPress={() => router.push({ pathname: '/profile', params: returnTo ? { returnTo } : {} })}
          style={styles.profileAction}>
          <View style={styles.headerAvatar}>{uri
            ? <Image key={uri} source={{ uri }} style={{ width: 40, height: 40, borderRadius: 20, overflow: 'hidden' }} accessibilityIgnoresInvertColors onError={() => setFailedUri(uri)} />
            : <Label style={{ fontSize: 12, lineHeight: 18, fontWeight: '700' }}>{initials}</Label>}</View>
        </Pressable>}
        {action}
      </View>
    </View>
  </View>;
}
/** Web-parity contextual back link: left-aligned «← …» in page content, not a full-width header bar. */
export function BackLink({ title, onPress, accessibilityLabel }: { title: string; onPress: () => void; accessibilityLabel?: string }) {
  return <Pressable accessibilityRole="link" accessibilityLabel={accessibilityLabel} onPress={onPress}
    style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 44, minWidth: 44, justifyContent: 'center' }, pressed && { backgroundColor: colors.paper }]}>
    <Label style={{ color: colors.secondary, fontWeight: '600', textAlign: 'left' }}>{title}</Label>
  </Pressable>;
}
/** Real create route; auth/typed return stays owned by the existing create screen. */
export function DiscoveryCreateBanner({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Создать игру. Соберите своих на площадке" onPress={onPress}
    style={({ pressed }) => [styles.createBanner, pressed && { backgroundColor: colors.pressed }]}>
    <View pointerEvents="none" style={{ position: 'absolute', right: -55, top: -65, opacity: 0.22 }}><CreateShape /></View>
    <View accessible={false} style={styles.createPlus}><Label style={{ color: colors.onPurple, fontSize: 24, lineHeight: 32 }}>+</Label></View>
    <View style={{ flex: 1, minWidth: 0 }}><Label style={{ fontSize: 18, lineHeight: 24, fontWeight: '700', color: colors.primaryLabel }}>Создать игру</Label>
      <Label style={{ fontSize: 12, lineHeight: 17, color: '#426B2D' }}>Соберите своих на площадке</Label></View>
    <DiscoveryArrow />
  </Pressable>;
}
export function DiscoveryChip({ title, selected, onPress }: { title: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
    style={({ pressed }) => [styles.chip, { backgroundColor: selected ? colors.ink : pressed ? colors.paper : colors.card }]}>
    <Label style={{ fontSize: 14, lineHeight: 20, color: selected ? colors.onPurple : colors.secondary }}>{title}</Label>
  </Pressable>;
}
/** Native Modal consumes hardware Back before the route and isolates accessibility focus. */
export function DiscoverySheet({ visible, title, onClose, returnFocusRef, children }: PropsWithChildren<{
  visible: boolean; title: string; onClose: () => void; returnFocusRef: RefObject<ComponentRef<typeof Pressable> | null>;
}>) {
  const insets = useSafeAreaInsets();
  const heading = useRef<ComponentRef<typeof Text>>(null), wasOpen = useRef(false);
  useEffect(() => {
    if (!visible && wasOpen.current) {
      const frame = requestAnimationFrame(() => {
        returnFocusRef.current?.focus();
        const node = findNodeHandle(returnFocusRef.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      });
      wasOpen.current = false;
      return () => cancelAnimationFrame(frame);
    }
    wasOpen.current = visible;
  }, [visible, returnFocusRef]);
  if (!visible) return null;
  return <Modal transparent visible animationType="none" onRequestClose={onClose}
    onShow={() => { const node = findNodeHandle(heading.current); if (node) AccessibilityInfo.setAccessibilityFocus(node); }}>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#13221A8C', paddingTop: insets.top + 24, paddingLeft: insets.left, paddingRight: insets.right }}>
      <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={{ maxHeight: '100%', backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: insets.bottom }}>
        <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Закрыть: ${title}`} onPress={onClose} style={[styles.profileAction, { alignSelf: 'flex-end' }]}><DiscoveryIcon name="close" /></Pressable>
          <Text ref={heading} accessibilityRole="header" allowFontScaling style={[styles.text, styles.subtitle]}>{title}</Text>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }} style={{ flexShrink: 1 }}>
          {children}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
export function TrajectoryArtwork({ diameter }: { diameter: number }) {
  if (diameter <= 0) return null;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ alignItems: 'center', justifyContent: 'center', height: diameter + 24, overflow: 'hidden', width: '100%' }}>
    <View style={{ width: diameter, height: diameter, borderRadius: diameter / 2, overflow: 'hidden', backgroundColor: colors.purpleInk }}>
      <Image source={racketImage} resizeMode="cover" accessible={false} style={{ width: '100%', height: '100%' }} />
    </View>
    <View style={[styles.orbit, { width: diameter * 1.3, height: diameter * 1.3, borderRadius: diameter,
      transform: [{ rotate: '-24deg' }, { scaleY: 0.42 }] }]} />
    <View style={[styles.orbit, { width: diameter * 1.4, height: diameter * 1.4, borderRadius: diameter,
      borderColor: colors.lime, transform: [{ rotate: '28deg' }, { scaleY: 0.44 }] }]} />
  </View>;
}
export function Loading({ title = 'Загружаем игры…' }: { title?: string }) {
  return <Label accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>{title}</Label>;
}
export function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  const apiError = error instanceof PublicApiError || error instanceof PlayersError;
  const unavailable = apiError && error.kind === 'unavailable';
  const serviceUnavailable = apiError && error.status === 503;
  return <View style={styles.card} accessibilityLiveRegion="polite">
    <Label accessibilityRole="header" style={styles.subtitle}>{unavailable ? 'Недоступно' : serviceUnavailable ? 'Сервис временно недоступен' : 'Не удалось загрузить'}</Label>
    <Label>{unavailable ? 'Данные не найдены или больше недоступны.' : serviceUnavailable ? 'Попробуйте немного позже.' : 'Проверьте соединение и попробуйте ещё раз.'}</Label>
    <PrimaryButton title="Повторить" onPress={retry} />
  </View>;
}
export const styles = StyleSheet.create({
  page: { flex: 1 },
  text: { fontFamily: typography.fontFamily, fontSize: 16, lineHeight: 24, color: colors.ink, flexShrink: 1 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  subtitle: { fontSize: 21, lineHeight: 29, fontWeight: '700' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 },
  mark: { width: 47, height: 32, borderRadius: 6, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  brandName: { fontFamily: 'Onest', fontSize: 17, lineHeight: 21, letterSpacing: -0.45, color: colors.ink },
  header: { gap: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 64 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  profileAction: { ...interaction, alignItems: 'center', justifyContent: 'center' },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: colors.card, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  createBanner: { minHeight: 70, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 9, backgroundColor: colors.lime, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden' },
  createPlus: { width: 52, height: 52, borderRadius: 11, backgroundColor: colors.ink, justifyContent: 'center', alignItems: 'center' },
  chip: { ...interaction, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', alignItems: 'center' },
  textButton: { ...interaction, paddingHorizontal: 10, paddingVertical: 12, justifyContent: 'center', borderRadius: 12 },
  chrome: { paddingHorizontal: 16, paddingVertical: 4, minHeight: 72, justifyContent: 'center', backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  orbit: { position: 'absolute', borderWidth: 2, borderColor: '#E1D1FF' },
  card: { borderRadius: 18, padding: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, gap: 12 },
  input: { fontFamily: 'Onest', fontSize: 18, color: colors.ink, minHeight: 52, borderWidth: 1, borderColor: colors.lineDark, backgroundColor: colors.card, borderRadius: 12, padding: 14 },
});
