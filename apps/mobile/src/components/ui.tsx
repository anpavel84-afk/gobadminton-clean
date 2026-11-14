import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { usePathname, useRouter } from 'expo-router';
import { canonicalGamePath } from '../native-auth-protocol.ts';
import { SvgXml } from 'react-native-svg';
import { brandMarkXml } from '../../assets/brand-mark.ts';
import { colors, interaction, primaryLabelStyle, primarySurface, typography } from '../theme.ts';
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
export function PrimaryButton({ title, onPress, disabled = false }: { title: string; onPress?: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => primarySurface(disabled, pressed)}>
    <Text allowFontScaling style={primaryLabelStyle}>{title}</Text>
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
export function Header({ back, light = false, action }: { back?: () => void; light?: boolean; action?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const returnTo = canonicalGamePath(pathname);
  return <View style={styles.header}>
    {back && <TextButton title="Назад" onPress={back} light={light} />}
    <BrandLockup light={light} />
    {!light && <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
      {pathname !== '/city' && <TextButton title="Город" onPress={() => router.push('/city')} />}
      {pathname !== '/profile' && <TextButton title="Профиль" onPress={() => router.push({ pathname: '/profile', params: returnTo ? { returnTo } : {} })} />}
    </View>}
    {action}
  </View>;
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
  return <View accessibilityState={{ busy: true }} accessibilityLiveRegion="polite" style={styles.card}>
    <Label>{title}</Label>
    <View accessible={false} style={styles.placeholder} />
    <View accessible={false} style={styles.placeholder} />
  </View>;
}
export function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  const unavailable = error instanceof PublicApiError && error.kind === 'unavailable';
  return <View style={styles.card} accessibilityLiveRegion="polite">
    <Label accessibilityRole="header" style={styles.subtitle}>{unavailable ? 'Недоступно' : 'Не удалось загрузить'}</Label>
    <Label>{unavailable ? 'Данные не найдены или больше недоступны.' : 'Проверьте соединение и попробуйте ещё раз.'}</Label>
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
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  textButton: { ...interaction, paddingHorizontal: 10, paddingVertical: 12, justifyContent: 'center', borderRadius: 12 },
  chrome: { paddingHorizontal: 16, paddingVertical: 8, minHeight: 72, justifyContent: 'center', backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  orbit: { position: 'absolute', borderWidth: 2, borderColor: '#E1D1FF' },
  card: { borderRadius: 18, padding: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, gap: 12 },
  placeholder: { minHeight: 48, backgroundColor: colors.lavender, borderRadius: 12 },
  input: { fontFamily: 'Onest', fontSize: 18, color: colors.ink, minHeight: 52, borderWidth: 1, borderColor: colors.lineDark, backgroundColor: colors.card, borderRadius: 12, padding: 14 },
});
