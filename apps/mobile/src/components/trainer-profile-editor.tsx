import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Keyboard, Platform, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { nativeAuth } from '../auth-runtime.ts';
import { sameActor, type Actor } from '../participation.ts';
import {
  TRAINER_BIO_MAX, TRAINER_NAME_MAX, trainerActive,
} from '../trainer-profile.ts';
import { colors } from '../theme.ts';
import { Label, Loading, PrimaryButton, TextButton, styles } from './ui.tsx';

export function TrainerProfileEditor() {
  const router = useRouter();
  const owner = nativeAuth.trainer;
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const actor = state.actor;
  const mounted = useRef(true);
  const focused = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; };
  }, []));
  useEffect(() => {
    if (nativeAuth.getSnapshot().status === 'authenticated' && owner.getSnapshot().status === 'idle') {
      void owner.load();
    }
  }, [owner, actor?.actorId, actor?.sessionId, actor?.generation]);
  const canCompleteNav = (origin: Actor | null) =>
    mounted.current && focused.current && sameActor(origin, owner.getSnapshot().actor);
  const locked = owner.blocksMutations() || state.status !== 'ready';
  const active = trainerActive(state.trainer);
  const primaryTitle = !state.trainer || state.trainer.status !== 'active'
    ? 'Сохранить и включить'
    : 'Сохранить';
  return <View style={{ gap: 12 }}>
    <Label accessibilityRole="header" style={styles.title}>Тренерский профиль</Label>
    <Label>Информация заполнена пользователем</Label>
    {state.status === 'loading' && <Loading title="Загружаем профиль тренера…" />}
    {(state.status === 'error' || state.status === 'idle') &&
      <TextButton title="Повторить" onPress={() => void owner.load()} />}
    {state.status === 'stale' &&
      <PrimaryButton title="Обновить данные" onPress={() => void owner.refreshAuthoritative()} />}
    {state.command ? <>
      <Label accessibilityLiveRegion="polite">
        {state.command.packet.kind === 'deactivate'
          ? 'Отключаем профиль тренера…'
          : 'Сохраняем профиль тренера…'}
      </Label>
      {state.command.status === 'sending'
        ? <Label accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">Подождите…</Label>
        : <PrimaryButton
            title={state.command.packet.kind === 'deactivate'
              ? 'Повторить прежнее отключение'
              : 'Повторить прежнее сохранение'}
            onPress={() => void owner.reconcile()}
          />}
      {state.notice && <Label accessibilityLiveRegion="polite" accessibilityRole="alert">{state.notice}</Label>}
    </> : state.status === 'ready' || state.status === 'stale' ? <View style={styles.card}>
      <Label style={{ color: colors.secondary, fontSize: 12, lineHeight: 17, fontWeight: '600' }}>О ваших тренировках</Label>
      <Label>Имя тренера</Label>
      <TextInput
        accessibilityLabel="Имя тренера"
        value={state.draft.displayName}
        onChangeText={displayName => owner.updateDraft({ displayName })}
        editable={!locked}
        maxLength={TRAINER_NAME_MAX}
        allowFontScaling
        autoComplete="off"
        style={styles.input}
        textContentType={Platform.OS === 'ios' ? 'name' : undefined}
        autoCorrect={Platform.OS === 'ios' ? false : undefined}
      />
      <Label>Коротко о себе</Label>
      <TextInput
        accessibilityLabel="Коротко о себе"
        value={state.draft.bio}
        onChangeText={bio => owner.updateDraft({ bio })}
        editable={!locked}
        maxLength={TRAINER_BIO_MAX}
        multiline
        scrollEnabled
        textAlignVertical="top"
        allowFontScaling
        autoComplete="off"
        style={[styles.input, { minHeight: 96, maxHeight: 200 }]}
      />
      <Label>Сохранение включает профиль тренера</Label>
      {state.notice && <Label accessibilityLiveRegion="polite" accessibilityRole="alert">{state.notice}</Label>}
      {state.status === 'stale' &&
        <PrimaryButton title="Обновить данные" onPress={() => void owner.refreshAuthoritative()} />}
      <PrimaryButton
        title={primaryTitle}
        disabled={locked || !state.draft.displayName.trim()}
        onPress={() => {
          Keyboard.dismiss();
          const origin = owner.getSnapshot().actor;
          void (async () => {
            await owner.save();
            if (!canCompleteNav(origin)) return;
            const snap = owner.getSnapshot();
            if (!snap.command && snap.status === 'ready' && snap.notice === 'Профиль тренера сохранён.') {
              router.replace('/profile');
            }
          })();
        }}
      />
      <TextButton title="К профилю" onPress={() => { if (!state.command) router.replace('/profile'); }} />
      {active &&
        <TextButton
          title="Отключить профиль тренера"
          onPress={() => {
            if (locked) return;
            const origin = owner.getSnapshot().actor;
            void (async () => {
              await owner.deactivate();
              if (!canCompleteNav(origin)) return;
              const snap = owner.getSnapshot();
              if (!snap.command && snap.status === 'ready' && snap.notice === 'Профиль тренера отключён.') {
                router.replace('/profile');
              }
            })();
          }}
        />}
    </View> : null}
  </View>;
}
