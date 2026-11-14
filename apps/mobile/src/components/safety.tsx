import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Modal, Pressable, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import { safetyPeerId } from '../safety-coordinator.ts';
import type { DirectMessage } from '../messages.ts';
import { reportable, REPORT_REASONS } from '../safety.ts';
import { Label, Page, PrimaryButton, TextButton, styles } from './ui.tsx';

const noMessages: DirectMessage[] = [];
/** Native controls only. The root owner, never the modal, owns uncertain commands. */
export function NativeSafety({ peerId, name, conversationId, messages = noMessages }: {
  peerId: string; name: string; conversationId?: string; messages?: DirectMessage[];
}) {
  const auth = useAuth(), owner = auth.safety, router = useRouter();
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const nameRef = useRef(name); nameRef.current = name;
  useFocusEffect(useCallback(() => {
    if (auth.status !== 'authenticated' || !safetyPeerId(peerId) || conversationId !== undefined && !safetyPeerId(conversationId)) return;
    owner.open({ peerId, name: nameRef.current, ...(conversationId ? { conversationId } : {}) });
    const view = owner.getSnapshot().viewGeneration;
    return () => owner.blur(view);
  }, [owner, auth.status, peerId, conversationId]));
  const active = state.context?.peerId === peerId && state.context.conversationId === conversationId && auth.status === 'authenticated';
  const view = state.viewGeneration, actor = state.actor, context = state.context;
  const selected = messages.find(m => m.id === state.selected);
  // A changed/deleted source requires fresh sharing consent, even for the same ID.
  useEffect(() => { if (active) owner.consent(false, view, actor); }, [owner, active, view, actor, selected?.id, selected?.text, selected?.contentState, selected?.authorPublicPlayerId]);
  if (!active || !context) return null;
  const command = state.command, locked = !!command, sending = command?.status === 'sending';
  const selectable = messages.filter(m => reportable(m, context));
  const cancel = () => owner.cancel(view, actor);
  const matching = command?.packet.context.peerId === peerId && command.packet.context.conversationId === conversationId;
  const content = <>
    {state.notice && <Label accessibilityRole="alert">{state.notice}</Label>}
    {command && <Label>{command.packet.context.name}: {command.packet.action === 'report' ? 'жалоба' : command.packet.action === 'block' ? 'блокировка' : 'снятие блокировки'}.</Label>}
    {sending && <Label accessibilityLiveRegion="polite">Отправляем…</Label>}
    {command?.status === 'unknown' && (matching ? <>
      <Label>Сверка может завершить исходное действие, если сервер ещё не выполнил его. Ключ, цель и данные останутся прежними.</Label>
      <PrimaryButton title="Проверить исходное действие тем же запросом" onPress={() => { void owner.reconcile(view, actor); }} />
    </> : <TextButton title="Открыть исходную цель для проверки" onPress={() => router.push((command.packet.context.conversationId
      ? `/messages/direct/${command.packet.context.conversationId}` : `/players/${command.packet.context.peerId}`) as '/players')} />)}
  </>;
  return <View style={{ gap: 4 }}>
    <Label accessibilityRole="header">Безопасность общения</Label>
    {state.lastBlocks[peerId] !== undefined && <Label>Последнее подтверждённое действие: {state.lastBlocks[peerId] ? 'блокировка' : 'снятие блокировки'}. Текущее состояние после других действий проверяется сервером.</Label>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      <TextButton title="Заблокировать" onPress={() => owner.choose('block', view, actor)} />
      <TextButton title="Снять мою блокировку" onPress={() => owner.choose('unblock', view, actor)} />
      <TextButton title="Пожаловаться на игрока" onPress={() => owner.choose('player', view, actor)} />
      {conversationId && <TextButton title="Пожаловаться на сообщение" onPress={() => owner.choose('message', view, actor)} />}
    </View>
    {!state.dialog && content}
    <Modal visible={!!state.dialog} animationType="slide" onRequestClose={cancel}>
      <Page keyboard header={<TextButton title="Назад" onPress={cancel} />}>
        <Label accessibilityRole="header" style={styles.subtitle}>{state.dialog === 'block' ? 'Заблокировать игрока' : state.dialog === 'unblock' ? 'Снять мою блокировку' : 'Пожаловаться'}</Label>
        <Label>{context.name}</Label>
        {state.dialog === 'block' || state.dialog === 'unblock' ? <>
          <Label>Блокировка общения не отменяет участие в играх и доступ к общим игровым чатам.</Label>
          <Label>Снятие блокировки не восстанавливает завершённую дружбу или закрытый запрос на общение.</Label>
          <PrimaryButton title={state.dialog === 'block' ? 'Заблокировать игрока' : 'Снять мою блокировку'} disabled={locked}
            onPress={() => { void owner.submit(messages, view, actor); }} />
        </> : <>
          {state.dialog === 'message' && <>
            <Label>Выберите одно уже загруженное входящее сообщение этого игрока.</Label>
            {!selectable.length && <Label>В загруженной истории нет подходящих сообщений.</Label>}
            {selectable.map(m => <Pressable key={m.id} accessibilityRole="radio" accessibilityState={{ checked: state.selected === m.id, disabled: locked }} disabled={locked}
              style={styles.card} onPress={() => owner.select(m.id, messages, view, actor)}>
              <Label>{state.selected === m.id ? '✓ ' : ''}{new Date(m.createdAt).toLocaleString('ru')}</Label><Label>{m.text}</Label>
            </Pressable>)}
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: state.consent, disabled: locked || !selected }} disabled={locked || !selected}
              style={styles.textButton} onPress={() => owner.consent(!state.consent, view, actor)}>
              <Label>{state.consent ? '☑' : '☐'} Разрешаю назначенному специалисту прочитать выбранное сообщение только для разбора обращения</Label>
            </Pressable>
          </>}
          <Label>Причина</Label>
          {REPORT_REASONS.map(r => <Pressable key={r.code} accessibilityRole="radio" accessibilityState={{ checked: state.reason === r.code, disabled: locked }} disabled={locked}
            style={styles.textButton} onPress={() => owner.edit(r.code, state.detail, view, actor)}><Label>{state.reason === r.code ? '✓ ' : ''}{r.label}</Label></Pressable>)}
          <Label>Подробности (необязательно)</Label>
          <TextInput accessibilityLabel="Подробности жалобы" multiline maxLength={1000} editable={!locked} value={state.detail}
            style={styles.input} onChangeText={text => owner.edit(state.reason, text, view, actor)} />
          <PrimaryButton title="Отправить жалобу" disabled={locked || state.dialog === 'message' && (!selected || !reportable(selected, context) || !state.consent)}
            onPress={() => { void owner.submit(messages, view, actor); }} />
        </>}
        {content}<TextButton title="Отмена" onPress={cancel} />
      </Page>
    </Modal>
  </View>;
}
