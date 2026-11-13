import { useState } from 'react';
import { BackHandler, View } from 'react-native';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { usePreferences } from '../src/state.tsx';
import { colors } from '../src/theme.ts';
import { Header, Label, Page, PrimaryButton, TextButton, TrajectoryArtwork, styles } from '../src/components/ui.tsx';
const stories = [
  ['Поймайте свою игру', 'Открывайте игры и знакомьтесь с условиями до выхода на корт.'],
  ['Ваш город. Ваш ритм', 'Выберите город вручную. Вход и геопозиция для просмотра не нужны.'],
  ['На корт — вместе', 'Смотрите расписание и условия игр. Вы сами решаете, что подходит вам.'],
] as const;
export default function Story() {
  const [step, setStep] = useState(0);
  const { preferences, hydrated, finishStory } = usePreferences();
  const router = useRouter();
  const finish = useCallback(() => { finishStory(); router.replace('/city'); }, [finishStory, router]);
  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { finish(); return true; });
    return () => back.remove();
  }, [finish]));
  if (hydrated && preferences.storyCompleted) return <Redirect href={preferences.cityId ? '/games' : '/city'} />;
  const story = stories[step]!;
  return <Page purple>
    <Header light />
    <TextButton title="Пропустить" onPress={finish} light />
    <TrajectoryArtwork />
    <Label style={{ color: colors.storyBody }} accessibilityLabel={`Знакомство, шаг ${step + 1} из 3`}>{step + 1} / 3</Label>
    <Label accessibilityRole="header" style={[styles.title, { color: colors.onPurple }]}>{story[0]}</Label>
    <Label style={{ color: colors.storyBody }}>{story[1]}</Label>
    <View style={{ flexGrow: 1 }} />
    <PrimaryButton title={step === 2 ? 'Выбрать город' : 'Далее'} onPress={() => step === 2 ? finish() : setStep(step + 1)} />
    <TextButton title="Продолжить гостем" onPress={finish} light />
  </Page>;
}
