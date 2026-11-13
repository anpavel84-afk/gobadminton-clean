import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { ComponentProps, PropsWithChildren } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SvgXml } from 'react-native-svg';
import { brandMarkXml } from '../../assets/brand-mark.ts';
import { colors, interaction, primaryLabelStyle, primarySurface, typography } from '../theme.ts';
import { PublicApiError } from '../public-api.ts';

export function Label({ style, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} allowFontScaling={typography.allowFontScaling} style={[styles.text, style]} />;
}
export function BrandLockup({ launch = false, light = false }: { launch?: boolean; light?: boolean }) {
  return <View accessible accessibilityRole="image" accessibilityLabel="GoBadminton" style={[styles.brand, launch && { flex: 1, alignSelf: 'center', justifyContent: 'center' }]}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.mark, launch && { width: 168, height: 96 }]}>
      <SvgXml xml={brandMarkXml} width={launch ? 168 : 47} height={launch ? 96 : 32} accessible={false} />
    </View>
    {!launch && <Text accessible={false} allowFontScaling={false} style={[styles.brandName, light && { color: colors.onPurple }]}>
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
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.textButton, pressed && { backgroundColor: light ? '#6131B5' : colors.lavender }]}>
    <Label style={{ color: light ? colors.onPurple : colors.purpleInk, textAlign: 'center' }}>{title}</Label>
  </Pressable>;
}
export function Page({ children, purple = false, keyboard = false }: PropsWithChildren<{ purple?: boolean; keyboard?: boolean }>) {
  const insets = useSafeAreaInsets();
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' && keyboard ? 'padding' : undefined}
    style={[styles.page, { backgroundColor: purple ? colors.purple : colors.paper }]}>
    <StatusBar style={purple ? 'light' : 'dark'} />
    <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 20, gap: 16 }}>
      {children}
    </ScrollView>
  </KeyboardAvoidingView>;
}
export function Header({ back, light = false }: { back?: () => void; light?: boolean }) {
  return <View style={styles.header}>
    {back && <TextButton title="Назад" onPress={back} light={light} />}
    <BrandLockup light={light} />
  </View>;
}
export function TrajectoryArtwork({ compact = false }: { compact?: boolean }) {
  const { width } = useWindowDimensions();
  const diameter = Math.max(80, Math.min(compact ? 130 : 270, (width - 80) * 0.8));
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ alignItems: 'center', justifyContent: 'center', height: diameter + 48, overflow: 'hidden', width: '100%' }}>
    <View style={{ width: diameter, height: diameter, borderRadius: diameter / 2, overflow: 'hidden', backgroundColor: colors.purpleInk }}>
      <Image source={require('../../assets/racket-v1.webp')} resizeMode="cover" accessible={false} style={{ width: '100%', height: '100%' }} />
    </View>
    <View style={[styles.orbit, { width: diameter * 1.3, height: diameter * 1.3, borderRadius: diameter,
      transform: [{ rotate: '-24deg' }, { scaleY: 0.42 }] }]} />
    <View style={[styles.orbit, { width: diameter * 1.4, height: diameter * 1.4, borderRadius: diameter,
      borderColor: colors.lime, transform: [{ rotate: '28deg' }, { scaleY: 0.44 }] }]} />
  </View>;
}
export function Hero({ title, body, compact = true }: { title: string; body: string; compact?: boolean }) {
  return <View style={styles.hero}>
    <TrajectoryArtwork compact={compact} />
    <Label style={[styles.title, { color: colors.onPurple }]} accessibilityRole="header">{title}</Label>
    <Label style={{ color: colors.storyBody }}>{body}</Label>
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
  title: { fontSize: 30, lineHeight: 38, fontWeight: '700' },
  subtitle: { fontSize: 21, lineHeight: 29, fontWeight: '700' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 },
  mark: { width: 47, height: 32, borderRadius: 6, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  brandName: { fontFamily: 'Onest', fontSize: 17, lineHeight: 21, letterSpacing: -0.45, color: colors.ink },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  textButton: { ...interaction, paddingHorizontal: 10, paddingVertical: 12, justifyContent: 'center', borderRadius: 12 },
  hero: { borderRadius: 18, backgroundColor: colors.purple, padding: 20, gap: 8 },
  orbit: { position: 'absolute', borderWidth: 2, borderColor: '#E1D1FF' },
  card: { borderRadius: 18, padding: 18, backgroundColor: colors.card, gap: 12 },
  placeholder: { minHeight: 48, backgroundColor: colors.lavender, borderRadius: 12 },
  cityHeader: { backgroundColor: colors.lavender, padding: 16, borderRadius: 18, gap: 8 },
  input: { fontFamily: 'Onest', fontSize: 18, color: colors.ink, minHeight: 52, borderWidth: 1, borderColor: colors.secondary, backgroundColor: colors.card, borderRadius: 12, padding: 14 },
});
