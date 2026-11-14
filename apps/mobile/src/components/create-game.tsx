import { useEffect, useSyncExternalStore } from 'react';
import { TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import { usePreferences } from '../state.tsx';
import { Label, Page, Header, Loading, PrimaryButton, TextButton, styles } from './ui.tsx';
import { colors, typography } from '../theme.ts';
import { ManagementCommand, ManagedTerms } from './game-management.tsx';
import type { CreationForm } from '../game-management.ts';

export function GameField({ label, value, onChange, maxLength = 2000, multiline = false, numeric = false }: { label: string; value: string; onChange: (v: string) => void; maxLength?: number; multiline?: boolean; numeric?: boolean }) {
  return <View style={{ gap: 6 }}><Label>{label}</Label><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} maxLength={maxLength}
    multiline={multiline} keyboardType={numeric ? 'number-pad' : 'default'} allowFontScaling
    style={{ minHeight: 48, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.lineDark, color: colors.ink, fontFamily: typography.fontFamily, fontSize: 16, backgroundColor: colors.card }} /></View>;
}
export function CreateGame() {
  const auth = useAuth(), owner = auth.gameManagement, router = useRouter();
  const { preferences, hydrated } = usePreferences();
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const actor = state.actor;
  useEffect(() => { if (auth.status === 'authenticated' && hydrated) void owner.loadContext(preferences.cityId); }, [owner, auth.status, actor?.actorId, actor?.sessionId, actor?.generation, hydrated, preferences.cityId]);
  const f = state.form;
  const field = (key: 'title' | 'date' | 'time' | 'duration' | 'capacity' | 'contact' | 'terms' | 'training' | 'trainerTerms', label: string, props = {}) => <GameField key={key} label={label} value={f[key]} onChange={value => owner.update({ [key]: value })} {...props} />;
  const choice = <K extends keyof CreationForm,>(key: K, value: CreationForm[K], label: string) => <TextButton key={String(value)} title={`${f[key] === value ? '✓ ' : ''}${label}`} onPress={() => owner.update({ [key]: value })} />;
  const active = auth.status === 'authenticated' && state.actor?.actorId === auth.me?.id;
  const blocked = ['sending','unknown'].includes(state.command?.status ?? '');
  return <Page keyboard header={<Header back={() => router.canGoBack() ? router.back() : router.replace('/games')} />}>
    <Label style={styles.title} accessibilityRole="header">Создать игру</Label>
    {auth.status === 'hydrating' ? <Loading title="Проверяем сессию…" /> : !active ? <><Label>Войдите, чтобы создать игру.</Label><PrimaryButton title="Войти" onPress={() => void auth.signIn('/games/create')} /></>
      : blocked && state.command ? <>
        <Label>Сначала проверьте результат прежнего действия. Проверка повторит только его; следующее действие не выполнится автоматически.</Label>
        {state.command.packet.kind === 'create' && <>
          <Label>{state.command.packet.body.title || 'Игра'} · {new Date(state.command.packet.body.startsAt).toLocaleString('ru-RU', { timeZone: state.command.packet.body.timezone })} · {state.command.packet.body.timezone}</Label>
          <Label>Вместимость: {state.command.packet.body.capacity} · Публичный контакт: {state.command.packet.body.hostPublicContact}</Label>
          <Label>{state.command.packet.body.settlement.terms}</Label>
        </>}
        <ManagementCommand />
        {state.creationReference && <TextButton title="Открыть сводку созданной игры" onPress={() => router.push({ pathname: '/games/manage/[id]', params: { id: state.creationReference!.id } })} />}
      </> : state.created ? <>
        <Label style={styles.subtitle}>{state.created.status === 'published' ? 'Игра опубликована' : 'Черновик создан'}</Label>
        <ManagedTerms game={state.created} />
        <Label>{state.created.activityKind === 'regular' ? 'Создатель обычной игры занимает место по правилам сервиса.' : 'Тренер не занимает место участника автоматически.'}</Label>
        <ManagementCommand />
        {state.created.status === 'draft' && !blocked && <PrimaryButton title="Опубликовать черновик" onPress={() => void owner.publishDraft(state.created!.id)} />}
        {state.created.status === 'published' && !blocked && <TextButton title="Создать ещё игру" onPress={() => void owner.newCreation(preferences.cityId)} />}
        <TextButton title="Открыть сводку" onPress={() => router.push({ pathname: '/games/manage/[id]', params: { id: state.created!.id } })} />
      </> : state.creationReference ? <>
        <Label>Игра уже создана. Сначала проверьте её сводку; повторное создание недоступно.</Label>
        <TextButton title="Открыть сводку созданной игры" onPress={() => router.push({ pathname: '/games/manage/[id]', params: { id: state.creationReference!.id } })} />
      </> : state.context === 'loading' || state.context === 'idle' ? <Loading title="Проверяем профиль и площадки…" />
      : state.context === 'setup' ? <>
        <Label>Для создания игры нужен заполненный профиль с городом и выбранный вручную город поиска.</Label>
        {!state.profile?.cityId && <Label>Обязательный следующий шаг — указать город в профиле. Редактирование профиля в native ещё не перенесено; заполните профиль в веб-приложении и обновите проверку здесь.</Label>}
        <TextButton title="Выбрать город поиска" onPress={() => router.push('/city')} />
        <TextButton title="Обновить проверку профиля" onPress={() => void owner.loadContext(preferences.cityId)} />
      </> : state.context === 'error' ? <><Label>Не удалось проверить профиль, настройки или каталог площадок.</Label><TextButton title="Повторить" onPress={() => void owner.loadContext(preferences.cityId)} /></>
      : state.preview ? <>
        <Label style={styles.subtitle}>Предпросмотр игры</Label>
        <Label>{state.preview.title || (state.preview.activityKind === 'regular' ? 'Игра' : 'Игра с тренером')}</Label>
        <Label>{state.venues.find(v => v.id === state.preview!.venueId)?.name}</Label>
        <Label>{new Date(state.preview.startsAt).toLocaleString('ru-RU', { timeZone: state.preview.timezone })} · {state.preview.timezone}</Label>
        <Label>{state.preview.activityKind === 'trainer_led' ? 'С тренером' : 'Обычная игра'}</Label>
        <Label>Длительность: {f.duration} мин · Вместимость: {state.preview.capacity}</Label>
        <Label>{({ doubles: 'Парная игра', singles: 'Одиночная игра', mixed: 'Микст' })[f.format]} · Уровни игроков: от {f.lower.toFixed(1)} до {f.upper.toFixed(1)}</Label>
        <Label>{f.visibility === 'public' ? 'В поиске' : 'Только по ссылке'}</Label>
        <Label>Публичный контакт: {state.preview.hostPublicContact}</Label><Label>{state.preview.settlement.terms}</Label>
        {!!state.preview.trainingDescription && <Label>{state.preview.trainingDescription}</Label>}
        <Label>Нажатие создаст черновик и опубликует игру с этими условиями.</Label>
        <ManagementCommand />
        <PrimaryButton title="Опубликовать" disabled={blocked} onPress={() => void owner.publishPreview()} />
        {!blocked && <TextButton title="Изменить" onPress={owner.edit} />}
      </> : <>
        {state.trainer && <View style={styles.card}><Label>Тип игры</Label>{choice('activity','regular','Обычная игра')}{choice('activity','trainer_led','С тренером')}</View>}
        {field('title','Название (необязательно)',{ maxLength: 160 })}
        <Label style={styles.subtitle}>Площадка</Label><Label>Договоритесь о корте с площадкой заранее.</Label>
        <TextButton title="Изменить город поиска" onPress={() => router.push('/city')} />
        {state.venues.length === 0 && <><Label>В выбранном городе площадок нет.</Label><TextButton title="Обновить каталог" onPress={() => void owner.loadContext(preferences.cityId)} /></>}
        {state.venues.map(v => <TextButton key={v.id} title={`${v.id === f.venueId ? '✓ ' : ''}${v.name} · ${v.address} · ${v.timezone}`} onPress={() => owner.update({ venueId: v.id })} />)}
        {field('date','Дата (ГГГГ-ММ-ДД)',{ maxLength: 10 })}{field('time','Время начала (ЧЧ:ММ)',{ maxLength: 5 })}
        <Label>Время выбранной площадки. Заявки принимаются до начала игры.</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{['60','120','180'].map(v => choice('duration',v,`${Number(v) / 60} ч`))}</View>
        {field('duration','Длительность в минутах (1–1440)',{ numeric: true, maxLength: 4 })}{field('capacity','Количество мест (1–1000)',{ numeric: true, maxLength: 4 })}
        <Label>Формат</Label><View style={styles.card}>{choice('format','doubles','Парная игра')}{choice('format','singles','Одиночная игра')}{choice('format','mixed','Микст')}</View>
        <Label>Уровни игроков · от {f.lower.toFixed(1)} до {f.upper.toFixed(1)}</Label>
        {(['lower','upper'] as const).map(bound => <View key={bound} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}><Label>{bound === 'lower' ? 'От' : 'До'}: {f[bound].toFixed(1)}</Label>
          <TextButton title={`Уменьшить ${bound === 'lower' ? 'нижний' : 'верхний'} уровень`} onPress={() => owner.update({ [bound]: Math.max(bound === 'lower' ? 1 : f.lower, f[bound] - 0.5) })} />
          <TextButton title={`Увеличить ${bound === 'lower' ? 'нижний' : 'верхний'} уровень`} onPress={() => owner.update({ [bound]: Math.min(bound === 'lower' ? f.upper : 7, f[bound] + 0.5) })} /></View>)}
        <Label>Видимость</Label>{choice('visibility','public','В поиске')}{choice('visibility','unlisted','Только по ссылке')}
        {field('contact','Публичный контакт для этой игры',{ maxLength: 320 })}<Label>Будет виден на странице игры.</Label>
        <TextButton title={`${f.saveContact ? '✓ ' : ''}Сохранить контакт для следующих игр`} onPress={() => owner.update({ saveContact: !f.saveContact })} />
        <Label>Контакт подставится при создании новой игры. Контакты в профиле не изменятся.</Label>
        {f.activity === 'regular' ? field('terms','Условия площадки',{ multiline: true }) : <>{field('training','Описание тренировки',{ multiline: true })}{field('trainerTerms','Оплата тренеру (по договорённости)',{ multiline: true })}<Label>Расчёт напрямую с тренером.</Label></>}
        {state.notice && <Label accessibilityRole="alert">{state.notice}</Label>}
        <PrimaryButton title="Далее — к созданию" onPress={owner.preview} />
      </>}
  </Page>;
}
