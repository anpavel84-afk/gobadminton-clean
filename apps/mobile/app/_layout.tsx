import { VenueCommunityProvider } from '../src/venue-community-runtime.tsx';
import { GameCommentsProvider } from '../src/game-comments-runtime.tsx';
import { FriendshipsProvider } from '../src/friendships-runtime.tsx';
import { RadarProvider } from '../src/radar-runtime.tsx';
import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadAsync } from 'expo-font';
import { MessagesOwner } from '../src/components/messages.tsx';
import { MainNavigation } from '../src/components/main-navigation.tsx';
import { AuthProvider } from '../src/auth.tsx';
import { PreferencesProvider } from '../src/state.tsx';
import { motionPolicy } from '../src/theme.ts';
import { useReduceMotion } from '../src/hooks.ts';
import { BrandLockup, Label, Page, PrimaryButton } from '../src/components/ui.tsx';
import { PublicRoleReviewHost } from '../src/components/public-role-reviews.tsx';

export default function RootLayout() {
  const [font, setFont] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    let active = true;
    // Metro needs literal requires to bundle the native font assets. iOS cannot select a wght
    // instance of the variable face, so it gets the static instances as one family and never the
    // variable file (both carry the PostScript name Onest-Regular).
    /* eslint-disable @typescript-eslint/no-require-imports */
    const loading = Platform.OS === 'ios'
      ? loadAsync([{ fontFamily: 'Onest', fontDefinitions: [
        { path: require('../assets/onest-regular.ttf'), weight: 400 },
        { path: require('../assets/onest-medium.ttf'), weight: 500 },
        { path: require('../assets/onest-semibold.ttf'), weight: 600 },
        { path: require('../assets/onest-bold.ttf'), weight: 700 },
        { path: require('../assets/onest-extrabold.ttf'), weight: 800 },
      ] }])
      : loadAsync({ Onest: require('../assets/onest.ttf') });
    /* eslint-enable @typescript-eslint/no-require-imports */
    loading.then(() => { if (active) setFont('ready'); })
      .catch(() => { if (active) setFont('error'); });
    return () => { active = false; };
  }, [attempt]);
  return <SafeAreaProvider>
    {font === 'ready' ? <PreferencesProvider>
      <AuthProvider><RadarProvider><VenueCommunityProvider><GameCommentsProvider><FriendshipsProvider><MessagesOwner><MainNavigation><Stack screenOptions={{ headerShown: false, animation: reduceMotion || !motionPolicy.arrivalAnimated ? 'none' : 'fade' }}>
          <Stack.Screen name="games/create/venue/[venueId]" options={{
            presentation: 'formSheet',
            headerShown: false,
            sheetAllowedDetents: [0.9],
            sheetCornerRadius: 20,
            sheetGrabberVisible: true,
            sheetExpandsWhenScrolledToEdge: false,
          }} />
        </Stack><PublicRoleReviewHost /></MainNavigation></MessagesOwner></FriendshipsProvider></GameCommentsProvider></VenueCommunityProvider></RadarProvider></AuthProvider>
    </PreferencesProvider> : <Page>
      <BrandLockup launch />
      {font === 'error' && <><Label>Не удалось загрузить шрифт приложения.</Label>
        <PrimaryButton title="Повторить" onPress={() => { setFont('loading'); setAttempt(value => value + 1); }} /></>}
    </Page>}
  </SafeAreaProvider>;
}
