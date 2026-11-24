import { useEffect, useSyncExternalStore } from 'react';
import { Platform, TextInput, View } from 'react-native';
import { useAuth } from '../auth.tsx';
import { nativeAuth } from '../auth-runtime.ts';
import {
  GAME_CONTACT_MAX, canRemoveGameContact, canSaveGameContact,
} from '../game-contact-preference.ts';
import { colors } from '../theme.ts';
import { Label, Loading, OutlineButton, PrimaryButton, TextButton, styles } from './ui.tsx';

/** Bounded own «Контакт для игр» card — web GameContactPreference texts + native profile-card tokens. */
export function GameContactPreferenceCard() {
  const auth = useAuth();
  const owner = nativeAuth.gameContactPreference;
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const actor = state.actor;

  useEffect(() => {
    if (auth.status === 'authenticated' && owner.getSnapshot().status === 'idle') void owner.load();
  }, [owner, auth.status, actor?.actorId, actor?.sessionId, actor?.generation]);

  if (auth.status !== 'authenticated') return null;

  const locked = !!state.command || state.status === 'stale' || state.status === 'loading';
  const saveEnabled = !locked && state.status === 'ready' && canSaveGameContact(state.draft, state.preference);
  const removeEnabled = !locked && state.status === 'ready' && canRemoveGameContact(state.preference);

  return <View style={styles.card} accessibilityLabel="Контакт для игр">
    <Label style={{ color: colors.secondary, fontSize: 12, lineHeight: 17, fontWeight: '600' }}>Создание игр</Label>
    <Label accessibilityRole="header" style={styles.subtitle}>Контакт для игр</Label>
    <Label>
      Контакт подставится при создании игры. Он станет виден на её странице после публикации. Сведения в каталоге игроков не изменятся.
    </Label>
    {state.status === 'loading' && !state.preference && <Loading title="Загружаем сохранённый контакт…" />}
    {state.status === 'error' && !state.command && <>
      <Label accessibilityLiveRegion="polite">{state.notice ?? 'Не удалось загрузить контакт. Можно указать его при создании игры.'}</Label>
      <TextButton title="Повторить загрузку" onPress={() => { void owner.load(); }} />
    </>}
    {(state.status === 'ready' || state.status === 'stale' || !!state.command || (state.status === 'error' && state.preference)) && <>
      <Label style={{ color: colors.secondary, fontSize: 13, lineHeight: 18 }}>Сохранённый контакт для игры</Label>
      <TextInput
        accessibilityLabel="Сохранённый контакт для игры"
        value={state.draft}
        onChangeText={value => owner.updateDraft(value)}
        maxLength={GAME_CONTACT_MAX}
        editable={!locked}
        placeholder="Telegram, телефон или другой контакт"
        placeholderTextColor={colors.secondary}
        style={styles.input}
        textContentType={Platform.OS === 'ios' ? 'none' : undefined}
        autoCorrect={Platform.OS === 'ios' ? false : undefined}
      />
      <PrimaryButton title="Сохранить контакт" disabled={!saveEnabled} onPress={() => { void owner.save(); }} />
      <OutlineButton title="Удалить сохранённый контакт" disabled={!removeEnabled} onPress={() => { void owner.remove(); }} />
    </>}
    {state.notice && <Label accessibilityLiveRegion="polite">{state.notice}</Label>}
    {state.command?.status === 'sending' &&
      <Label accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">Сохраняем контакт…</Label>}
    {state.command?.status === 'unknown' &&
      <PrimaryButton title="Повторить прежнее изменение контакта" onPress={() => { void owner.reconcile(); }} />}
    {state.status === 'stale' && !state.command &&
      <PrimaryButton title="Обновить данные" onPress={() => { void owner.refreshAuthoritative(); }} />}
  </View>;
}
