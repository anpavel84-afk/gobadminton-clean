import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { TextInput } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import { Header, Label, Loading, Page, PrimaryButton, TextButton, styles } from './ui.tsx';

function useContact(target: string) {
  const auth = useAuth(), owner = auth.contact;
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const actor = state.actor;
  useFocusEffect(useCallback(() => {
    if (auth.status === 'authenticated' && actor) void owner.open(target);
    return () => owner.blur();
  }, [owner, target, auth.status, actor]));
  return { auth, owner, state, current: state.target === target && !!state.actor };
}
export function NativeContactAction({ target }: { target: string }) {
  const { auth, owner, state, current } = useContact(target), router = useRouter();
  if (auth.status === 'guest') return <PrimaryButton title="Войти, чтобы написать" onPress={() => { void auth.signIn(`/messages/new/${target}`); }} />;
  if (auth.status !== 'authenticated') return <Label>Проверьте вход, чтобы написать.</Label>;
  if (!current || state.status === 'loading') return <PrimaryButton title="Проверяем…" disabled />;
  if (state.status === 'ready' || state.status === 'existing') {
    const label = state.contact?.state === 'accepted' ? 'К переписке' : state.status === 'existing' ? 'Открыть' : 'Написать';
    return <PrimaryButton title={label} onPress={() => {
      if (owner.getSnapshot() !== state) return;
      // Only a validated header can select an existing direct destination.
      if (state.conversation && !state.command) router.push(`/messages/direct/${state.conversation.id}`);
      else router.push(`/messages/new/${target}`);
    }} />;
  }
  return <><Label>{state.notice ?? 'Общение сейчас недоступно'}</Label><TextButton title="Проверить снова" onPress={() => { void owner.open(target); }} /></>;
}
export function ContactEditor({ target }: { target: string }) {
  const { auth, owner, state, current } = useContact(target), router = useRouter();
  const conversation = current && state.status === 'existing' && !state.command ? state.conversation : null;
  useEffect(() => {
    if (auth.status === 'authenticated' && conversation && owner.getSnapshot() === state) router.replace(`/messages/direct/${conversation.id}`);
  }, [auth.status, conversation, router, owner, state]);
  const command = state.command, ownCommand = command?.packet.body.targetPublicPlayerId === target;
  const text = current ? state.drafts[target] ?? '' : '';
  return <Page keyboard header={<Header back={() => router.canGoBack() ? router.back() : router.replace('/messages')} />}>
    <Label accessibilityRole="header">Сообщение</Label>
    {auth.status !== 'authenticated' ? <><Label>Войдите, чтобы написать.</Label><PrimaryButton title="Войти" onPress={() => { void auth.signIn(`/messages/new/${target}`); }} /></>
      : !current || state.status === 'loading' ? <Loading title="Загружаем профиль…" />
      : <>
        {state.player && <Label>{state.player.displayName}</Label>}
        {(state.status === 'ready' || ownCommand) && <>
          <TextInput accessibilityLabel="Текст сообщения" multiline maxLength={2000} value={text} editable={!command}
            placeholder="Сообщение" onChangeText={value => owner.draft(target, value, state.actor, state.viewGeneration)} style={styles.input} />
          {!command && <PrimaryButton title="Отправить" disabled={!text.trim() || text.trim().length > 2000} onPress={() => { void owner.send(target, state.actor, state.viewGeneration); }} />}
        </>}
        {state.notice && <Label accessibilityLiveRegion="polite">{state.notice}</Label>}
        {ownCommand && command?.status === 'unknown' && <PrimaryButton title="Проверить результат" onPress={() => { void owner.reconcile(target, state.actor, state.viewGeneration); }} />}
        {ownCommand && command?.status === 'sending' && <Label>Отправляем…</Label>}
        {command && !ownCommand && <><Label>Сначала проверьте результат прежнего сообщения.</Label><TextButton title="К прежнему сообщению" onPress={() => router.replace(`/messages/new/${command.packet.body.targetPublicPlayerId}`)} /></>}
        {!command && (state.status === 'error' || state.status === 'unavailable') && <TextButton title="Проверить снова" onPress={() => { void owner.open(target); }} />}
      </>}
  </Page>;
}
