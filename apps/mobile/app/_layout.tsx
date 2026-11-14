import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadAsync } from 'expo-font';
import { AuthProvider } from '../src/auth.tsx';
import { PreferencesProvider } from '../src/state.tsx';
import { motionPolicy } from '../src/theme.ts';
import { useReduceMotion } from '../src/hooks.ts';
import { BrandLockup, Label, Page, PrimaryButton } from '../src/components/ui.tsx';

export default function RootLayout() {
  const [font, setFont] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    let active = true;
    // Metro needs a literal require to bundle the native font asset.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loadAsync({ Onest: require('../assets/onest.ttf') }).then(() => { if (active) setFont('ready'); })
      .catch(() => { if (active) setFont('error'); });
    return () => { active = false; };
  }, [attempt]);
  return <SafeAreaProvider>
    {font === 'ready' ? <PreferencesProvider>
      <AuthProvider><Stack screenOptions={{ headerShown: false, animation: reduceMotion || !motionPolicy.arrivalAnimated ? 'none' : 'fade' }} /></AuthProvider>
    </PreferencesProvider> : <Page>
      <BrandLockup launch />
      {font === 'error' && <><Label>Не удалось загрузить шрифт приложения.</Label>
        <PrimaryButton title="Повторить" onPress={() => { setFont('loading'); setAttempt(value => value + 1); }} /></>}
    </Page>}
  </SafeAreaProvider>;
}
