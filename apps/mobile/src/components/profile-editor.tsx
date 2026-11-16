import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { Keyboard, Pressable, TextInput, View } from 'react-native';
import { useAuth } from '../auth.tsx';
import {
  LEVEL_GUIDE_DISCLAIMER, PILOT_LEVEL_OPTIONS, formatPreservedLevelChoiceLabel, levelChoiceLabel,
  levelGuideChoiceFromControlValue, levelGuideControlValue, levelGuideSkillFor, levelGuideSkills,
  shouldOfferPreservedLevel,
} from '../profile.ts';
import { DiscoveryChip, DiscoverySheet, Label, Loading, PrimaryButton, TextButton, styles } from './ui.tsx';

export function ProfileEditor() {
  const auth = useAuth(), owner = auth.profile;
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const [query, setQuery] = useState('');
  const [levelOpen, setLevelOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const levelTrigger = useRef<ComponentRef<typeof Pressable>>(null);
  const actor = state.actor;
  useEffect(() => {
    if (auth.status === 'authenticated' && owner.getSnapshot().status === 'idle') void owner.load();
  }, [owner, auth.status, actor?.actorId, actor?.sessionId, actor?.generation]);
  const locked = !!state.command || state.status !== 'ready';
  const selected = state.cities.find(c => c.id === state.draft.cityId);
  const preserved = state.profile?.level ?? null;
  const showPreserved = shouldOfferPreservedLevel(preserved);
  const choice = state.draft.levelChoice;
  const selectedSkill = choice.kind === 'ntrp' ? levelGuideSkillFor(choice.levelId) : null;
  function pick(next: string) {
    if (locked) return;
    owner.update({ levelChoice: levelGuideChoiceFromControlValue(next, showPreserved ? preserved : null) });
    setLevelOpen(false);
  }
  return <View style={styles.card}>
    <Label accessibilityRole="header" style={styles.subtitle}>Игровой профиль</Label>
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
        <Label>Игровой уровень</Label>
        <Label>Ориентировочный уровень</Label>
        <Pressable ref={levelTrigger} accessibilityRole="button" accessibilityLabel="Ориентировочный уровень"
          accessibilityState={{ disabled: locked }} disabled={locked}
          onPress={() => { Keyboard.dismiss(); setLevelOpen(true); }} style={styles.input}>
          <Label>{levelChoiceLabel(choice, preserved)}</Label>
        </Pressable>
        {!locked && <TextButton title="Не знаю" onPress={() => pick('')} />}
        {selectedSkill ? <Label accessibilityLiveRegion="polite">Выбрано: {selectedSkill.label} — {selectedSkill.summary}</Label>
          : choice.kind === 'keep' && showPreserved && preserved ? <Label accessibilityLiveRegion="polite">Сохранённый уровень: {formatPreservedLevelChoiceLabel(preserved)} (другая шкала — без автозамены)</Label>
          : choice.kind === 'pilot' ? <Label accessibilityLiveRegion="polite">Краткий уровень: {PILOT_LEVEL_OPTIONS.find(o => o.levelId === choice.levelId)?.label ?? choice.levelId}</Label>
          : <Label accessibilityLiveRegion="polite">Можно пропустить — уровень сохранится только после «Сохранить».</Label>}
        <TextButton title={helpOpen ? 'Скрыть справку об уровнях' : 'Что означают уровни'} onPress={() => setHelpOpen(v => !v)} />
        {helpOpen && <>
          <Label>{LEVEL_GUIDE_DISCLAIMER}</Label>
          {levelGuideSkills().map(skill => <TextButton key={skill.levelId} title={`${skill.label} — ${skill.summary}`}
            onPress={() => { if (!locked) { owner.update({ levelChoice: { kind: 'ntrp', levelId: skill.levelId } }); setHelpOpen(false); } }} />)}
        </>}
        <DiscoverySheet visible={levelOpen} title="Ориентировочный уровень" onClose={() => setLevelOpen(false)} returnFocusRef={levelTrigger}>
          <DiscoveryChip title="Не знаю / не указывать" selected={choice.kind === 'none'} onPress={() => pick('')} />
          {showPreserved && preserved && <DiscoveryChip title={formatPreservedLevelChoiceLabel(preserved)}
            selected={choice.kind === 'keep'} onPress={() => pick(levelGuideControlValue({ kind: 'keep', level: preserved }))} />}
          <Label>Кратко (как раньше)</Label>
          {PILOT_LEVEL_OPTIONS.map(option => <DiscoveryChip key={option.levelId} title={option.label}
            selected={choice.kind === 'pilot' && choice.levelId === option.levelId} onPress={() => pick(option.levelId)} />)}
          <Label>Числовая шкала ntrp v1</Label>
          {levelGuideSkills().map(skill => <DiscoveryChip key={skill.levelId} title={skill.label}
            selected={choice.kind === 'ntrp' && choice.levelId === skill.levelId} onPress={() => pick(skill.levelId)} />)}
        </DiscoverySheet>
        <Label>Район / метро</Label>
        <TextInput accessibilityLabel="Район / метро" value={state.draft.areaKey} onChangeText={areaKey => owner.update({ areaKey })}
          editable={!locked} maxLength={64} allowFontScaling autoComplete="off" style={styles.input} />
        <Label>О себе</Label>
        <TextInput accessibilityLabel="О себе" value={state.draft.bio} onChangeText={bio => owner.update({ bio })}
          editable={!locked} maxLength={500} multiline scrollEnabled textAlignVertical="top" allowFontScaling autoComplete="off"
          style={[styles.input, { minHeight: 96, maxHeight: 200 }]} />
        <PrimaryButton title="Сохранить" disabled={locked || !state.draft.displayName.trim() || !selected} onPress={() => { Keyboard.dismiss(); void owner.save(); }} />
        {!locked && <TextButton title="Отменить изменения" onPress={() => { Keyboard.dismiss(); setQuery(''); setHelpOpen(false); owner.cancel(); }} />}
      </>}
    </>
  </View>;
}
