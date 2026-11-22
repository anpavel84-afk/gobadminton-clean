import { useCallback } from 'react';
import { BackHandler, Platform, Pressable, ScrollView } from 'react-native';
import { useFocusEffect, usePreventRemove, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrainerProfileEditor } from '../../src/components/trainer-profile-editor.tsx';
import { bindIosBack } from '../../src/ios-back.ts';
import { colors } from '../../src/theme.ts';
import { Header, Label, ScreenFrame as Page } from '../../src/components/ui.tsx';

const useIosBack = bindIosBack(Platform.OS, usePreventRemove);

function TrainerHardwareBack({ onClose }: { onClose: () => void }) {
  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => back.remove();
  }, [onClose]));
  return null;
}

function TrainerIosBack({ onClose }: { onClose: () => void }) {
  useIosBack(true, onClose);
  return null;
}

export default function TrainerProfileRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const close = useCallback(() => { router.replace('/profile'); }, [router]);
  return <Page keyboard header={<Header />}>
    <TrainerHardwareBack onClose={close} />
    <TrainerIosBack onClose={close} />
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ flexGrow: 1, paddingTop: 16, paddingBottom: insets.bottom + 24, paddingHorizontal: 16, gap: 16 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Мой профиль"
        onPress={close}
        style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 44, minWidth: 44, justifyContent: 'center' }, pressed && { backgroundColor: colors.paper }]}
      >
        <Label style={{ color: colors.secondary, fontWeight: '600', textAlign: 'left' }}>← Мой профиль</Label>
      </Pressable>
      <TrainerProfileEditor />
    </ScrollView>
  </Page>;
}
