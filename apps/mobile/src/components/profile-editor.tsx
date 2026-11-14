import { useEffect, useState, useSyncExternalStore } from 'react';
import { Keyboard, TextInput, View } from 'react-native';
import { useAuth } from '../auth.tsx';
import { Label, Loading, PrimaryButton, TextButton, styles } from './ui.tsx';

export function ProfileEditor() {
  const auth = useAuth(), owner = auth.profile;
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const [query, setQuery] = useState('');
  const actor = state.actor;
  useEffect(() => {
    if (auth.status === 'authenticated' && owner.getSnapshot().status === 'idle') void owner.load();
  }, [owner, auth.status, actor?.actorId, actor?.sessionId, actor?.generation]);
  const locked = !!state.command || state.status !== 'ready';
  const selected = state.cities.find(c => c.id === state.draft.cityId);
  return <View style={styles.card}>
    <Label accessibilityRole="header" style={styles.subtitle}>Имя и город</Label>
    <Label>Укажите имя для игрового профиля и выберите город вручную. Город поиска выбирается отдельно.</Label>
    {state.status === 'loading' && <Loading title="Загружаем профиль и города…" />}
    {state.notice && <Label accessibilityLiveRegion="polite">{state.notice}</Label>}
    {state.command ? <>
      <Label>Сохранение: {state.command.packet.body.displayName} · {state.command.packet.cityName}</Label>
      {state.command.status === 'sending' ? <Label accessibilityState={{ busy: true }}>Сохраняем…</Label>
        : <PrimaryButton title="Повторить прежнее сохранение с теми же данными" onPress={() => void owner.reconcile()} />}
      <Label>Можно уйти со страницы. Результат останется неизвестным до явной проверки; новое сохранение пока недоступно.</Label>
    </> : <>
      {(state.status === 'error' || state.status === 'idle') && <TextButton title="Повторить загрузку профиля и городов" onPress={() => void owner.load()} />}
      {state.status === 'stale' && <PrimaryButton title="Загрузить актуальный профиль для проверки" onPress={() => void owner.load()} />}
      {state.profile && <>
        <Label>Публичное имя</Label>
        <TextInput accessibilityLabel="Публичное имя" value={state.draft.displayName} onChangeText={displayName => owner.update({ displayName })}
          editable={!locked} maxLength={80} allowFontScaling autoComplete="off" style={styles.input} />
        <Label>Город профиля: {selected?.nameRu ?? 'выберите из каталога'}</Label>
        {!locked && <>
          <TextInput accessibilityLabel="Найти город профиля" value={query} onChangeText={setQuery} allowFontScaling style={styles.input} />
          {state.cities.filter(c => c.nameRu.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))).map(c =>
            <TextButton key={c.id} title={`${c.id === state.draft.cityId ? '✓ ' : ''}${c.nameRu}`} onPress={() => { owner.update({ cityId: c.id }); Keyboard.dismiss(); }} />)}
          {!state.cities.some(c => c.nameRu.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))) && <Label>Город не найден в каталоге.</Label>}
        </>}
        <PrimaryButton title="Сохранить имя и город" disabled={locked || !state.draft.displayName.trim() || !selected} onPress={() => { Keyboard.dismiss(); void owner.save(); }} />
        {!locked && <TextButton title="Отменить изменения" onPress={() => { Keyboard.dismiss(); setQuery(''); owner.cancel(); }} />}
      </>}
    </>}
  </View>;
}
