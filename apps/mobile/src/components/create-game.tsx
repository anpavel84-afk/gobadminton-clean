import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth.tsx';
import { usePreferences } from '../state.tsx';
import { BackLink, Header, Label, Loading, PrimaryButton, ScreenFrame, TextButton, styles } from './ui.tsx';
import { colors } from '../theme.ts';
import { ManagementCommand, ManagedTerms } from './game-management.tsx';
import { API_ORIGIN, publicApi } from '../public-api.ts';
import { useResource } from '../hooks.ts';
import { venueCreatePath } from '../venues.ts';
import {
  CreateGameFormSections,
  CreateGameSheetHeader,
  LeftLink,
  OutlineButton,
  StepIndicator,
} from './create-game-controls.tsx';

export { GameField } from './create-game-controls.tsx';

export function CreateGame({ venueId }: { venueId?: string }) {
  const auth = useAuth(), owner = auth.gameManagement, router = useRouter();
  const { preferences, hydrated } = usePreferences();
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const actor = state.actor;
  const view = useRef(0);
  const [selecting, setSelecting] = useState(false);
  // Blur/refocus fences local reads; returning to a mounted form must not reload or replace its draft.
  useFocusEffect(useCallback(() => { view.current++; setSelecting(false); return () => { view.current++; }; }, []));
  const [selectedIntent, setSelected] = useState<string | null>(null), [attemptedIntent, setAttempted] = useState<string | null>(null);
  const selectionKey = `${venueId}:${actor?.actorId}:${actor?.sessionId}:${actor?.generation}`;
  const selected = selectedIntent === selectionKey, attempted = attemptedIntent === selectionKey;
  const venueTask = useCallback((signal: AbortSignal) => venueId ? publicApi.venue(venueId, signal) : Promise.resolve(null), [venueId]);
  const { state: venueState, retry: retryVenue } = useResource(`create-venue:${venueId ?? ''}`, venueTask);
  const returnTo = venueId ? venueCreatePath(venueId) ?? '/games/create' : '/games/create';
  const contextCity = venueId ? venueState.data?.cityId ?? state.cityId : preferences.cityId;
  const sheet = Boolean(venueId);
  const closeSheet = () => { if (router.canGoBack()) router.back(); else router.replace('/games/map'); };
  const selectVenue = async () => {
    const venue = venueState.data;
    if (!venue || selecting) return;
    setSelecting(true);
    setAttempted(selectionKey);
    const actorAtPress = owner.getSnapshot().actor, viewAtPress = view.current;
    const current = () => view.current === viewAtPress && owner.getSnapshot().actor === actorAtPress;
    if (await owner.selectVenue(venue, current) && current()) setSelected(selectionKey);
    if (view.current === viewAtPress) setSelecting(false);
  };
  const continueOrdinaryForm = () => {
    view.current++; setSelecting(false);
    owner.continueOrdinaryForm(preferences.cityId);
    router.push('/games/create');
  };
  const reloadContext = () => venueId ? void selectVenue() : void owner.loadContext(preferences.cityId);
  useEffect(() => { if (!venueId && auth.status === 'authenticated' && hydrated) void owner.mountOrdinaryForm(preferences.cityId); }, [owner, auth.status, actor?.actorId, actor?.sessionId, actor?.generation, hydrated, preferences.cityId, venueId]);
  const f = state.form;
  // Auto-select after the mountedCreateGame harness slice so lifecycle tests keep calling selectVenue explicitly.
  useEffect(() => {
    if (!venueId || selected || attempted || selecting || state.created || state.creationReference) return;
    if (venueState.status !== 'ready' || !venueState.data) return;
    void selectVenue();
  // selectVenue closes over the latest fence; venue readiness + selection key drive the one-shot.
  }, [venueId, venueState.status, venueState.data, selected, attempted, selecting, state.created, state.creationReference, selectionKey]);
  const insets = useSafeAreaInsets();
  const active = auth.status === 'authenticated' && state.actor?.actorId === auth.me?.id;
  const blocked = ['sending','unknown'].includes(state.command?.status ?? '');
  const sheetVenue = venueState.data ?? state.venues.find(v => v.id === (venueId || f.venueId));
  const coverUrl = venueState.data && venueState.data.mainImage && (!f.venueId || f.venueId === venueState.data.id)
    ? `${API_ORIGIN}${venueState.data.mainImage}` : null;
  const timezone = state.venues.find(v => v.id === f.venueId)?.timezone ?? sheetVenue?.timezone ?? null;
  const awaitingVenue = Boolean(venueId && !selected && !attempted && !state.created && !state.creationReference);
  // continueOrdinaryForm remains for the mounted lifecycle harness (explicit Continue CTA removed from UI).
  void continueOrdinaryForm;

  const shell = (body: ReactNode, opts?: { footer?: ReactNode }) => <ScreenFrame keyboard header={sheet ? undefined : <Header />}>
    {sheet && <CreateGameSheetHeader
      name={sheetVenue?.name ?? 'Площадка'}
      address={sheetVenue?.address ?? ''}
      onBack={closeSheet}
      onClose={closeSheet}
    />}
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ flexGrow: 1, paddingTop: 16, paddingBottom: (opts?.footer ? 16 : insets.bottom + 24), paddingHorizontal: 16, gap: 16 }}>
      {!sheet && <BackLink title="← Все игры" onPress={() => router.canGoBack() ? router.back() : router.replace('/games')} />}
      {body}
    </ScrollView>
    {opts?.footer}
  </ScreenFrame>;

  const formFooter = <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.card }}>
    <OutlineButton title="Отмена" onPress={() => sheet ? closeSheet() : (router.canGoBack() ? router.back() : router.replace('/games'))} />
    <View style={{ flex: 1 }}><PrimaryButton title="Далее — к созданию" onPress={owner.preview} /></View>
  </View>;
  const showFormFooter = active && auth.status !== 'hydrating' && !(blocked && state.command) && !awaitingVenue
    && state.context === 'ready' && !state.created && !state.creationReference && !state.preview;

  return shell(auth.status === 'hydrating' ? <Loading title="Проверяем сессию…" /> : !active ? <><Label>Войдите, чтобы создать игру.</Label><PrimaryButton title="Войти" onPress={() => void auth.signIn(returnTo)} /></>
    : blocked && state.command ? <>
      <Label>Сначала проверьте результат прежнего действия. Проверка повторит только его; следующее действие не выполнится автоматически.</Label>
      {state.command.packet.kind === 'create' && <>
        <Label>{state.command.packet.body.title || 'Игра'} · {new Date(state.command.packet.body.startsAt).toLocaleString('ru-RU', { timeZone: state.command.packet.body.timezone })} · {state.command.packet.body.timezone}</Label>
        <Label>Вместимость: {state.command.packet.body.capacity} · Публичный контакт: {state.command.packet.body.hostPublicContact}</Label>
        <Label>{state.command.packet.body.settlement.terms}</Label>
      </>}
      <ManagementCommand />
      {state.creationReference && <TextButton title="Открыть сводку созданной игры" onPress={() => router.push({ pathname: '/games/manage/[id]', params: { id: state.creationReference!.id } })} />}
    </> : awaitingVenue ? <>
      {(venueState.status === 'loading' || venueState.status === 'idle' || selecting) && <Loading title="Проверяем площадку…" />}
      {venueState.status === 'error' && <><Label>Не удалось проверить площадку. Прежняя форма сохранена.</Label><TextButton title="Повторить проверку площадки" onPress={retryVenue} /></>}
    </> : state.context === 'setup' ? <>
      <Label>Для создания и публикации игры нужен заполненный профиль с именем и городом. Город формы выбирается вручную или по явно выбранной площадке.</Label>
      {(!state.profile?.cityId || !state.profile?.displayName.trim()) && <>
        <Label>Обязательный следующий шаг — заполнить имя и город в профиле.</Label>
        <TextButton title="Заполнить имя и город" onPress={() => router.push({ pathname: '/profile', params: { returnTo } })} />
      </>}
      <TextButton title="Выбрать город поиска" onPress={() => router.push('/city')} />
      <TextButton title="Обновить проверку профиля" onPress={reloadContext} />
      {state.creationReference && <TextButton title="Открыть сводку созданной игры" onPress={() => router.push({ pathname: '/games/manage/[id]', params: { id: state.creationReference!.id } })} />}
    </> : state.created ? <>
      <Label style={styles.subtitle}>{state.created.status === 'published' ? 'Игра опубликована' : 'Черновик создан'}</Label>
      <ManagedTerms game={state.created} />
      <Label>{state.created.activityKind === 'regular' ? 'Создатель обычной игры занимает место по правилам сервиса.' : 'Тренер не занимает место участника автоматически.'}</Label>
      <ManagementCommand />
      {state.created.status === 'draft' && !blocked && <PrimaryButton title="Опубликовать черновик" onPress={() => void owner.publishDraft(state.created!.id)} />}
      {state.created.status === 'published' && !blocked && <TextButton title="Создать ещё игру" onPress={() => void owner.newCreation(contextCity)} />}
      <TextButton title="Открыть сводку" onPress={() => router.push({ pathname: '/games/manage/[id]', params: { id: state.created!.id } })} />
    </> : state.creationReference ? <>
      <Label>Игра уже создана. Сначала проверьте её сводку; повторное создание недоступно.</Label>
      <TextButton title="Открыть сводку созданной игры" onPress={() => router.push({ pathname: '/games/manage/[id]', params: { id: state.creationReference!.id } })} />
    </> : state.context === 'loading' || state.context === 'idle' ? <Loading title="Проверяем профиль и площадки…" />
    : state.context === 'error' ? <><Label>Не удалось проверить профиль, настройки или каталог площадок.</Label><TextButton title="Повторить" onPress={reloadContext} /></>
    : state.preview ? <>
      <StepIndicator step={2} />
      <Label accessibilityRole="header" style={[styles.subtitle, { textAlign: 'left' }]}>Проверка перед созданием</Label>
      <Label style={{ textAlign: 'left' }}>Проверьте данные. Игра появится после нажатия «Создать игру».</Label>
      <View style={[styles.card, { gap: 12 }]}>
        <Label style={{ textAlign: 'left', fontWeight: '700' }}>{state.preview.title || (state.preview.activityKind === 'regular' ? 'Игра' : 'Игра с тренером')}</Label>
        <Label style={{ textAlign: 'left' }}>{state.venues.find(v => v.id === state.preview!.venueId)?.name}</Label>
        <Label style={{ textAlign: 'left' }}>{new Date(state.preview.startsAt).toLocaleString('ru-RU', { timeZone: state.preview.timezone })} · {state.preview.timezone}</Label>
        <Label style={{ textAlign: 'left' }}>Длительность: {f.duration} мин · Количество мест: {state.preview.capacity}</Label>
        <Label style={{ textAlign: 'left' }}>{({ doubles: 'Парная игра', singles: 'Одиночная игра', mixed: 'Микст' })[f.format]} · Уровни игроков: от {f.lower.toFixed(1)} до {f.upper.toFixed(1)}</Label>
        <Label style={{ textAlign: 'left' }}>{f.visibility === 'public' ? 'В поиске' : 'Только по ссылке'}</Label>
        <Label style={{ textAlign: 'left' }}>Публичный контакт: {state.preview.hostPublicContact}</Label>
        <Label style={{ textAlign: 'left' }}>{state.preview.settlement.terms}</Label>
        {!!state.preview.trainingDescription && <Label style={{ textAlign: 'left' }}>{state.preview.trainingDescription}</Label>}
      </View>
      <ManagementCommand />
      <LeftLink title="Назад к редактированию" onPress={owner.edit} />
      <PrimaryButton title="Опубликовать" disabled={blocked} onPress={() => void owner.publishPreview()} />
    </> : <>
      <StepIndicator step={1} />
      <Label accessibilityRole="header" style={[styles.title, { textAlign: 'left' }]}>Создать игру</Label>
      <CreateGameFormSections
        form={f}
        venues={state.venues}
        trainer={Boolean(state.trainer)}
        timezone={timezone}
        coverUrl={coverUrl}
        onUpdate={patch => owner.update(patch)}
        onOpenCity={() => router.push('/city')}
      />
      {state.notice && <Label accessibilityRole="alert">{state.notice}</Label>}
    </>, showFormFooter ? { footer: formFooter } : undefined);
}
