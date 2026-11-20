import { useCallback, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth.tsx';
import { usePreferences } from '../src/state.tsx';
import { OwnProfileCard } from '../src/components/own-profile.tsx';
import { ProfileEditor } from '../src/components/profile-editor.tsx';
import { canonicalReturnPath } from '../src/native-auth-protocol.ts';
import { bindIosBack } from '../src/ios-back.ts';
import { colors } from '../src/theme.ts';
import { Header, Label, Loading, ScreenFrame as Page, TextButton, styles } from '../src/components/ui.tsx';

const providerNames: Record<string, string> = { vk: 'VK', yandex: 'Яндекс', email: 'Email' };
const providerLabel = (method: string) => providerNames[method] ?? method;
const useIosBack = bindIosBack(Platform.OS, usePreventRemove);

function ProfileHardwareBack({ editing, onClose }: { editing: boolean; onClose: () => void }) {
  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editing) {
        onClose();
        return true;
      }
      return false;
    });
    return () => back.remove();
  }, [editing, onClose]));
  return null;
}

function ProfileIosBack({ editing, onClose }: { editing: boolean; onClose: () => void }) {
  useIosBack(editing, onClose);
  return null;
}

function ProfileScroll({ scrollRef, children }: {
  scrollRef: RefObject<ComponentRef<typeof ScrollView> | null>; children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return <ScrollView
    ref={scrollRef}
    keyboardShouldPersistTaps="handled"
    keyboardDismissMode="on-drag"
    contentInsetAdjustmentBehavior="never"
    contentContainerStyle={{ flexGrow: 1, paddingTop: 16, paddingBottom: insets.bottom + 24, paddingHorizontal: 16, gap: 16 }}
  >
    {children}
  </ScrollView>;
}

export default function Profile() {
  const auth = useAuth(), router = useRouter();
  const { preferences } = usePreferences();
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const requested = canonicalReturnPath(params.returnTo);
  const intent = requested?.startsWith('/games/') ? requested : auth.returnPath;
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const locked = useRef(false);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const settingsY = useRef(0);
  const scrollSettingsOnLayout = useRef(false);
  async function act(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try { await work(); } finally { locked.current = false; setBusy(false); }
  }
  function toggleSettings() {
    setSettingsOpen(open => {
      const next = !open;
      if (next) scrollSettingsOnLayout.current = true;
      return next;
    });
  }
  const notice = auth.notice === 'unavailable' ? 'Вход в приложение сейчас недоступен на сервере. Игра сохранена для возврата.'
    : auth.notice === 'storage' ? 'Не удалось безопасно прочитать или сохранить вход. Сессия не подтверждена; сохранённые данные не изменены автоматически.'
    : auth.notice === 'network' ? 'Не удалось подтвердить сессию. Проверьте соединение. Если ответ обмена или обновления потерян, нужен новый вход.'
    : auth.notice === 'remote-unconfirmed' ? 'Изменение сессий на сервере не подтверждено. При выходе локальная сессия очищена; серверный отзыв мог не завершиться.'
    : auth.notice === 'cancelled' ? 'Вход отменён. Можно вернуться к игре.'
    : auth.notice === 'signin' ? 'Сессия истекла или больше не подтверждена. Начните новый вход.' : null;
  async function returnToGame() {
    if (!intent) return;
    if (auth.status === 'authenticated') {
      if (intent === '/games/create') await auth.gameManagement.loadContext(preferences.cityId);
      else if (intent.startsWith('/games/manage/')) await auth.gameManagement.loadDetail(intent.slice('/games/manage/'.length));
    }
    router.replace(intent as '/games');
  }
  return <Page keyboard header={<Header />}>
    <ProfileHardwareBack editing={editing} onClose={() => setEditing(false)} />
    <ProfileIosBack editing={editing} onClose={() => setEditing(false)} />
    <ProfileScroll scrollRef={scrollRef}>
      <Label accessibilityRole="header" style={styles.title}>{auth.status === 'authenticated' && auth.me ? 'Мой профиль' : 'Профиль'}</Label>
      {auth.status === 'authenticated' && auth.me && <Label style={{ color: colors.secondary, fontSize: 15, lineHeight: 22 }}>Управляйте игровыми данными и тем, что видят другие.</Label>}
      {notice && <Label accessibilityLiveRegion="polite">{notice}</Label>}
      {auth.status === 'hydrating' && <Loading title="Проверяем сохранённую сессию…" />}
      {auth.status === 'signing-in' && <View style={styles.card}>
        <Label>Завершите вход в системном браузере. После перезапуска можно продолжить по исходной HTTPS-ссылке до истечения входа.</Label>
        <TextButton title="Отменить вход" onPress={() => void act(auth.cancel)} />
      </View>}
      {(auth.status === 'guest' || auth.status === 'unverifiable') && <View style={styles.card}>
        <Label>{auth.status === 'unverifiable' ? 'Сессия сейчас не подтверждена.' : 'Вы просматриваете игры как гость.'}</Label>
        <Label>Доступные способы входа определяет сервер. Вход откроется в системном браузере.</Label>
        {!busy && auth.notice !== 'storage' && <TextButton title="Войти" onPress={() => void act(() => auth.signIn(intent))} />}
        {auth.status === 'unverifiable' && !busy && <TextButton title="Проверить соединение и сессию" onPress={() => void act(auth.validate)} />}
      </View>}
      {auth.status === 'authenticated' && auth.me && <>
        {!editing && <OwnProfileCard onEdit={() => setEditing(true)} onSettings={toggleSettings} settingsOpen={settingsOpen} />}
        {editing && <>
          <Pressable accessibilityRole="button" accessibilityLabel="Мой профиль" onPress={() => setEditing(false)}
            style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 44, minWidth: 44, justifyContent: 'center' }, pressed && { backgroundColor: colors.paper }]}>
            <Label style={{ color: colors.secondary, fontWeight: '600', textAlign: 'left' }}>← Мой профиль</Label>
          </Pressable>
          <ProfileEditor />
        </>}
        {settingsOpen && <>
          <View style={styles.card} onLayout={e => {
            settingsY.current = e.nativeEvent.layout.y;
            if (scrollSettingsOnLayout.current) {
              scrollSettingsOnLayout.current = false;
              scrollRef.current?.scrollTo({ y: Math.max(0, settingsY.current), animated: true });
            }
          }}>
            <Label accessibilityRole="header" style={styles.subtitle}>Вход в аккаунт</Label>
            <Label>Язык: {auth.me.locale}</Label>
            <Label>Связанные провайдеры: {auth.me.linkedProviders.length ? auth.me.linkedProviders.map(providerLabel).join(', ') : 'Нет связанных провайдеров'}</Label>
          </View>
          <View style={styles.card}>
            <Label accessibilityRole="header" style={styles.subtitle}>Сессии</Label>
            {!busy && <TextButton title="Загрузить / обновить сессии" onPress={() => void act(auth.loadSessions)} />}
            {auth.sessions.map(session => <View key={session.id} style={{ gap: 8 }}>
              <Label>{session.current ? 'Текущая сессия' : 'Другая сессия'}</Label>
              <Label>Создана: {new Date(session.createdAt).toLocaleString('ru')}</Label>
              <Label>Последняя активность: {new Date(session.lastSeenAt).toLocaleString('ru')}</Label>
              <Label>Истекает: {new Date(session.expiresAt).toLocaleString('ru')}</Label>
              {!busy && <TextButton title={session.current ? 'Завершить текущую сессию' : 'Завершить сессию'} onPress={() => void act(() => auth.revokeSession(session.id))} />}
            </View>)}
            {!busy && <TextButton title="Завершить другие сессии" onPress={() => void act(() => auth.revokeSession(null))} />}
          </View>
          <TextButton title="Выйти" onPress={() => void auth.logout()} />
        </>}
      </>}
      {busy && <Label accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">Подождите…</Label>}
      {intent && <TextButton title="Вернуться к игре" onPress={() => void act(returnToGame)} />}
      <Label>Вход не подаёт заявку и не создаёт игру. Игровые действия требуют отдельного native-допуска сервера.</Label>
    </ProfileScroll>
  </Page>;
}
