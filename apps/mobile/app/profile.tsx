import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../src/auth.tsx';
import { canonicalGamePath } from '../src/native-auth-protocol.ts';
import { Header, Label, Loading, Page, TextButton, styles } from '../src/components/ui.tsx';

const providerNames: Record<string, string> = { vk: 'VK', yandex: 'Яндекс', email: 'Email' };
const providerLabel = (method: string) => providerNames[method] ?? method;
export default function Profile() {
  const auth = useAuth(), router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const intent = canonicalGamePath(params.returnTo) ?? auth.returnPath;
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  async function act(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try { await work(); } finally { locked.current = false; setBusy(false); }
  }
  const notice = auth.notice === 'unavailable' ? 'Вход в приложение сейчас недоступен на сервере. Игра сохранена для возврата.'
    : auth.notice === 'storage' ? 'Не удалось безопасно прочитать или сохранить вход. Сессия не подтверждена; сохранённые данные не изменены автоматически.'
    : auth.notice === 'network' ? 'Не удалось подтвердить сессию. Проверьте соединение. Если ответ обмена или обновления потерян, нужен новый вход.'
    : auth.notice === 'remote-unconfirmed' ? 'Изменение сессий на сервере не подтверждено. При выходе локальная сессия очищена; серверный отзыв мог не завершиться.'
    : auth.notice === 'cancelled' ? 'Вход отменён. Можно вернуться к игре.'
    : auth.notice === 'signin' ? 'Сессия истекла или больше не подтверждена. Начните новый вход.' : null;
  return <Page header={<Header back={() => { if (router.canGoBack()) router.back(); else router.replace('/games'); }} />}>
    <Label accessibilityRole="header" style={styles.title}>Профиль</Label>
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
      <View style={styles.card}>
        <Label accessibilityRole="header" style={styles.subtitle}>{auth.me.displayName}</Label>
        <Label>Язык: {auth.me.locale}</Label>
        <Label>Связанные провайдеры: {auth.me.linkedProviders.length ? auth.me.linkedProviders.map(providerLabel).join(', ') : 'Нет связанных провайдеров'}</Label>
        <Label>Редактирование профиля и способов входа в native ещё недоступно.</Label>
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
    {busy && <Label accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">Подождите…</Label>}
    {intent && <TextButton title="Вернуться к игре" onPress={() => router.replace(intent as '/games')} />}
    <Label>Вход не подаёт заявку и не создаёт игру. Игровые действия требуют отдельного native-допуска сервера.</Label>
  </Page>;
}
