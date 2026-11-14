import { useCallback, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreferences } from '../src/state.tsx';
import { colors } from '../src/theme.ts';
import { contentWidth, introArtworkSize } from '../src/layout.ts';
import { Header, Label, PrimaryButton, ScreenFrame, TextButton, TrajectoryArtwork } from '../src/components/ui.tsx';
const stories = [
  ['Поймайте', 'свою игру', 'Открывайте игры и знакомьтесь с условиями до выхода на корт.'],
  ['Ваш город.', 'Ваш ритм', 'Выберите город вручную. Вход и геопозиция для просмотра не нужны.'],
  ['На корт —', 'вместе', 'Смотрите расписание и условия игр. Вы сами решаете, что подходит вам.'],
] as const;
export default function Story() {
  const [step, setStep] = useState(0);
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [viewport, setViewport] = useState<number | null>(null);
  const [copyHeight, setCopyHeight] = useState<number | null>(null);
  const [actionsHeight, setActionsHeight] = useState<number | null>(null);
  const { preferences, hydrated, finishStory } = usePreferences();
  const router = useRouter();
  const finish = useCallback(() => { finishStory(); router.replace('/city'); }, [finishStory, router]);
  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { finish(); return true; });
    return () => back.remove();
  }, [finish]));
  if (hydrated && preferences.storyCompleted) return <Redirect href={preferences.cityId ? '/games' : '/city'} />;
  const story = stories[step]!;
  const usableHeight = Math.max(0, (viewport ?? height - insets.top - 88) - insets.bottom);
  const diameter = introArtworkSize({ width: contentWidth(width, insets, 20), viewportHeight: usableHeight,
    copyHeight: copyHeight ?? 160 * fontScale, actionsHeight: actionsHeight ?? 112 * fontScale, fontScale });
  return <ScreenFrame purple header={<Header light action={<TextButton title="Пропустить" onPress={finish} light />} />}>
    <ScrollView contentInsetAdjustmentBehavior="never" onLayout={event => setViewport(event.nativeEvent.layout.height)}
      contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom }}>
      <View style={[intro.content, { minHeight: usableHeight }]}>
        <TrajectoryArtwork diameter={diameter} />
        <View accessible accessibilityLabel={`Знакомство, шаг ${step + 1} из 3`} style={intro.progress}>
          {stories.map((_, index) => <View key={index} style={[intro.mark, { backgroundColor: index === step ? colors.lime : '#B99AEF' }]} />)}
        </View>
        <View onLayout={event => setCopyHeight(event.nativeEvent.layout.height)} style={intro.copy}>
          <Label accessibilityRole="header" style={intro.title}>{story[0]}{'\n'}<Label style={[intro.title, { color: colors.lime }]}>{story[1]}</Label></Label>
          <Label style={intro.body}>{story[2]}</Label>
        </View>
        <View onLayout={event => setActionsHeight(event.nativeEvent.layout.height)} style={intro.actions}>
          <PrimaryButton title={step === 2 ? 'Выбрать город' : 'Далее'} onPress={() => step === 2 ? finish() : setStep(step + 1)} />
          <TextButton title="Продолжить гостем" onPress={finish} light />
        </View>
      </View>
    </ScrollView>
  </ScreenFrame>;
}
const intro = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingVertical: 16, gap: 12 },
  progress: { flexDirection: 'row', alignSelf: 'center', gap: 6, height: 6 },
  mark: { width: 24, height: 6, borderRadius: 3 },
  copy: { gap: 10 },
  title: { color: colors.onPurple, fontSize: 28, lineHeight: 34, fontWeight: '700', textAlign: 'center' },
  body: { color: colors.storyBody, textAlign: 'center' },
  actions: { gap: 8, width: '100%', marginTop: 'auto' },
});
