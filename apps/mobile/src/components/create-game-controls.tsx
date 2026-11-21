import { useRef, useState } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { Image, Platform, Pressable, TextInput, View } from 'react-native';
import { DiscoveryChip, DiscoverySheet, Label, styles } from './ui.tsx';
import { LevelRange } from './level-range.tsx';
import { colors, typography } from '../theme.ts';
import type { CreationForm, Venue } from '../game-management.ts';
import {
  DURATION_CHIPS,
  clampCapacity,
  createGameDateChoice,
  createGameDateOptions,
  createGameTimeSlots,
  durationChipSelected,
} from '../game-form.ts';
import { discoveryDateLabel } from '../presentation.ts';

export function GameField({ label, value, onChange, maxLength = 2000, multiline = false, numeric = false }: {
  label: string; value: string; onChange: (v: string) => void; maxLength?: number; multiline?: boolean; numeric?: boolean;
}) {
  return <View style={{ gap: 6 }}>
    <Label style={{ textAlign: 'left' }}>{label}</Label>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} maxLength={maxLength}
      multiline={multiline} keyboardType={numeric ? 'number-pad' : 'default'} allowFontScaling
      returnKeyType={Platform.OS === 'ios' ? (multiline || numeric ? 'done' : 'next') : undefined}
      style={{ minHeight: multiline ? 96 : 48, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.lineDark,
        color: colors.ink, fontFamily: typography.fontFamily, fontSize: 16, backgroundColor: colors.card, textAlign: 'left' }} />
  </View>;
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return <View style={[styles.card, { gap: 24, padding: 20, marginBottom: 4 }]}>
    <Label accessibilityRole="header" style={[styles.subtitle, { textAlign: 'left' }]}>{title}</Label>
    <View style={{ gap: 20 }}>{children}</View>
  </View>;
}

export function OutlineButton({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({
      flex: 1, minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.lineDark,
      backgroundColor: pressed ? colors.paper : colors.card, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 14,
    })}>
    <Label style={{ textAlign: 'center', fontWeight: '700' }}>{title}</Label>
  </Pressable>;
}

export function LeftLink({ title, onPress }: { title: string; onPress: () => void }) {
  return <Pressable accessibilityRole="link" onPress={onPress}
    style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }, pressed && { backgroundColor: colors.paper }]}>
    <Label style={{ color: colors.secondary, fontWeight: '600', textAlign: 'left' }}>{title}</Label>
  </Pressable>;
}

export function StepIndicator({ step }: { step: 1 | 2 }) {
  return <Label accessibilityRole="header" style={{ textAlign: 'left', fontWeight: '600' }}>
    <Label style={{ fontWeight: step === 1 ? '700' : '500', color: step === 1 ? colors.ink : colors.secondary }}>1 · Данные</Label>
    <Label style={{ color: colors.secondary }}> → </Label>
    <Label style={{ fontWeight: step === 2 ? '700' : '500', color: step === 2 ? colors.ink : colors.secondary }}>2 · Проверка</Label>
  </Label>;
}

export function CreateGameSheetHeader({ name, address, onBack, onClose }: {
  name: string; address: string; onBack: () => void; onClose: () => void;
}) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Назад" onPress={onBack}
      style={({ pressed }) => [{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, pressed && { backgroundColor: colors.paper }]}>
      <Label accessible={false} style={{ fontSize: 22, lineHeight: 28 }}>←</Label>
    </Pressable>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Label numberOfLines={1} style={{ fontWeight: '700', textAlign: 'left' }}>{name}</Label>
      <Label numberOfLines={1} style={{ fontSize: 14, lineHeight: 20, color: colors.secondary, textAlign: 'left' }}>{address}</Label>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose}
      style={({ pressed }) => [{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, pressed && { backgroundColor: colors.paper }]}>
      <Label accessible={false} style={{ fontSize: 22, lineHeight: 28 }}>✕</Label>
    </Pressable>
  </View>;
}

const FORMAT_OPTIONS: { value: CreationForm['format']; label: string }[] = [
  { value: 'doubles', label: 'Парная игра' },
  { value: 'singles', label: 'Одиночная игра' },
  { value: 'mixed', label: 'Микст' },
];
const VISIBILITY_OPTIONS: { value: CreationForm['visibility']; label: string }[] = [
  { value: 'public', label: 'В поиске' },
  { value: 'unlisted', label: 'Только по ссылке' },
];

export function CreateGameFormSections({ form, venues, trainer, timezone, coverUrl, onUpdate, onOpenCity, contactAlert = null }: {
  form: CreationForm;
  venues: Venue[];
  trainer: boolean;
  timezone: string | null;
  coverUrl?: string | null;
  onUpdate: (patch: Partial<CreationForm>) => void;
  onOpenCity: () => void;
  contactAlert?: string | null;
}) {
  const selected = venues.find(v => v.id === form.venueId);
  const catalogueTrigger = useRef<ComponentRef<typeof Pressable>>(null);
  const dateTrigger = useRef<ComponentRef<typeof Pressable>>(null);
  const timeTrigger = useRef<ComponentRef<typeof Pressable>>(null);
  const formatTrigger = useRef<ComponentRef<typeof Pressable>>(null);
  const visibilityTrigger = useRef<ComponentRef<typeof Pressable>>(null);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [customDuration, setCustomDuration] = useState(() => durationChipSelected(form.duration, false) === 'custom');
  const dates = timezone ? createGameDateOptions(timezone) : null;
  const dateChoice = timezone && form.date ? createGameDateChoice(form.date, timezone) : 'custom';
  const durationSelected = durationChipSelected(form.duration, customDuration);
  const capacity = clampCapacity(/^\d+$/.test(form.capacity) ? Number(form.capacity) : 1);
  const formatLabel = FORMAT_OPTIONS.find(o => o.value === form.format)?.label ?? 'Парная игра';
  const visibilityLabel = VISIBILITY_OPTIONS.find(o => o.value === form.visibility)?.label ?? 'В поиске';

  return <>
    <FormSection title="Основное">
      {trainer && <View style={{ gap: 8 }}>
        <Label style={{ textAlign: 'left' }}>Тип игры</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <DiscoveryChip title="Обычная игра" selected={form.activity === 'regular'} onPress={() => onUpdate({ activity: 'regular' })} />
          <DiscoveryChip title="С тренером" selected={form.activity === 'trainer_led'} onPress={() => onUpdate({ activity: 'trainer_led' })} />
        </View>
      </View>}
      <GameField label="Название (необязательно)" value={form.title} onChange={title => onUpdate({ title })} maxLength={160} />
      <View style={{ gap: 8 }}>
        <Label style={{ textAlign: 'left' }}>Формат</Label>
        <Pressable ref={formatTrigger} accessibilityRole="button" accessibilityLabel="Формат" onPress={() => setFormatOpen(true)}
          style={({ pressed }) => ({ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineDark, padding: 12, backgroundColor: pressed ? colors.paper : colors.card })}>
          <Label style={{ textAlign: 'left' }}>{formatLabel}</Label>
        </Pressable>
      </View>
    </FormSection>

    <FormSection title="Место и время">
      <Label style={{ textAlign: 'left', color: colors.secondary }}>Договоритесь о корте с площадкой заранее.</Label>
      <Pressable accessibilityRole="button" onPress={onOpenCity} style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}>
        <Label style={{ color: colors.secondary, fontWeight: '600', textAlign: 'left' }}>Изменить город поиска</Label>
      </Pressable>
      {venues.length === 0 && <Label style={{ textAlign: 'left' }}>В выбранном городе площадок нет.</Label>}
      <View style={{ gap: 8 }}>
        <Label style={{ textAlign: 'left', fontWeight: '600' }}>Известная площадка</Label>
        <View style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }]}>
          {coverUrl ? <Image source={{ uri: coverUrl }} accessibilityIgnoresInvertColors style={{ width: 56, height: 56, borderRadius: 10 }} /> : null}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Label numberOfLines={1} style={{ fontWeight: '700', textAlign: 'left' }}>{selected?.name ?? 'Выберите площадку'}</Label>
            {selected && <Label numberOfLines={2} style={{ fontSize: 14, lineHeight: 20, color: colors.secondary, textAlign: 'left' }}>{selected.address}</Label>}
          </View>
        </View>
        <Pressable ref={catalogueTrigger} accessibilityRole="button" onPress={() => setCatalogueOpen(true)}
          style={({ pressed }) => ({ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineDark, padding: 12, backgroundColor: pressed ? colors.paper : colors.card })}>
          <Label style={{ textAlign: 'left', fontWeight: '600' }}>Из каталога площадок</Label>
        </Pressable>
      </View>
      <View style={{ gap: 8 }}>
        <Label style={{ textAlign: 'left' }}>Дата</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <DiscoveryChip title="Сегодня" selected={dateChoice === 'today'} onPress={() => { if (dates) onUpdate({ date: dates.today }); }} />
          <DiscoveryChip title="Завтра" selected={dateChoice === 'tomorrow'} onPress={() => { if (dates) onUpdate({ date: dates.tomorrow }); }} />
          <Pressable ref={dateTrigger} accessibilityRole="button" accessibilityState={{ selected: dateChoice === 'custom' }} onPress={() => setDateOpen(true)}
            style={({ pressed }) => [styles.chip, { backgroundColor: dateChoice === 'custom' ? colors.ink : pressed ? colors.paper : colors.card }]}>
            <Label style={{ fontSize: 14, lineHeight: 20, color: dateChoice === 'custom' ? colors.onPurple : colors.secondary }}>Выбрать дату</Label>
          </Pressable>
        </View>
        {!!form.date && <Label style={{ textAlign: 'left', color: colors.secondary }}>{discoveryDateLabel(form.date)}</Label>}
      </View>
      <View style={{ gap: 8 }}>
        <Label style={{ textAlign: 'left' }}>Время начала</Label>
        <Pressable ref={timeTrigger} accessibilityRole="button" accessibilityLabel="Время начала" onPress={() => setTimeOpen(true)}
          style={({ pressed }) => ({ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineDark, padding: 12, backgroundColor: pressed ? colors.paper : colors.card })}>
          <Label style={{ textAlign: 'left' }}>{form.time || 'Выберите время'}</Label>
        </Pressable>
        <Label style={{ textAlign: 'left', color: colors.secondary }}>Время выбранного города</Label>
      </View>
      <View style={{ gap: 8 }}>
        <Label style={{ textAlign: 'left' }}>Длительность</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {DURATION_CHIPS.map(minutes => <DiscoveryChip key={minutes} title={`${minutes / 60} ч`} selected={durationSelected === minutes}
            onPress={() => { setCustomDuration(false); onUpdate({ duration: String(minutes) }); }} />)}
          <DiscoveryChip title="Своя" selected={durationSelected === 'custom'} onPress={() => setCustomDuration(true)} />
        </View>
        {customDuration && <GameField label="Длительность в минутах" value={form.duration} onChange={duration => onUpdate({ duration })} numeric maxLength={4} />}
      </View>
    </FormSection>

    <FormSection title="Для кого">
      <View style={{ gap: 8 }}>
        <Label style={{ textAlign: 'left' }}>Количество мест</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Уменьшить количество мест" disabled={capacity <= 1}
            onPress={() => onUpdate({ capacity: String(clampCapacity(capacity - 1)) })}
            style={({ pressed }) => ({ minWidth: 48, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineDark, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.paper : colors.card, opacity: capacity <= 1 ? 0.4 : 1 })}>
            <Label accessible={false}>−</Label>
          </Pressable>
          <Label style={{ minWidth: 40, textAlign: 'center', fontWeight: '700' }}>{capacity}</Label>
          <Pressable accessibilityRole="button" accessibilityLabel="Увеличить количество мест" disabled={capacity >= 1000}
            onPress={() => onUpdate({ capacity: String(clampCapacity(capacity + 1)) })}
            style={({ pressed }) => ({ minWidth: 48, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineDark, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.paper : colors.card, opacity: capacity >= 1000 ? 0.4 : 1 })}>
            <Label accessible={false}>+</Label>
          </Pressable>
        </View>
      </View>
      <LevelRange lower={form.lower} upper={form.upper} onUpdate={({ lower, upper }) => onUpdate({ lower, upper })} />
      <View style={{ gap: 8 }}>
        <Label style={{ textAlign: 'left' }}>Видимость</Label>
        <Pressable ref={visibilityTrigger} accessibilityRole="button" accessibilityLabel="Видимость" onPress={() => setVisibilityOpen(true)}
          style={({ pressed }) => ({ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineDark, padding: 12, backgroundColor: pressed ? colors.paper : colors.card })}>
          <Label style={{ textAlign: 'left' }}>{visibilityLabel}</Label>
        </Pressable>
        <Label style={{ textAlign: 'left', color: colors.secondary }}>«В поиске» — публичная игра. «Только по ссылке» не добавляет игру в поиск.</Label>
      </View>
    </FormSection>

    <FormSection title="Условия участия">
      <GameField label="Публичный контакт для этой игры" value={form.contact} onChange={contact => onUpdate({ contact })} maxLength={320} />
      {!!contactAlert && <Label accessibilityRole="alert" style={{ textAlign: 'left', color: colors.secondary }}>{contactAlert}</Label>}
      <Label style={{ textAlign: 'left', color: colors.secondary }}>Будет виден на странице игры.</Label>
      <Pressable accessibilityRole="button" onPress={() => onUpdate({ saveContact: !form.saveContact })}
        style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }, pressed && { backgroundColor: colors.paper }]}>
        <Label style={{ textAlign: 'left', fontWeight: '600' }}>{`${form.saveContact ? '✓ ' : ''}Сохранить контакт для следующих игр`}</Label>
      </Pressable>
      <Label style={{ textAlign: 'left', color: colors.secondary }}>Контакт подставится при создании новой игры. Контакты в профиле не изменятся.</Label>
      {form.activity === 'regular'
        ? <GameField label="Условия площадки" value={form.terms} onChange={terms => onUpdate({ terms })} multiline />
        : <>
          <GameField label="Описание тренировки" value={form.training} onChange={training => onUpdate({ training })} multiline />
          <GameField label="Оплата тренеру (по договорённости)" value={form.trainerTerms} onChange={trainerTerms => onUpdate({ trainerTerms })} multiline />
          <Label style={{ textAlign: 'left', color: colors.secondary }}>Расчёт напрямую с тренером.</Label>
        </>}
    </FormSection>

    <FormSection title="Фото этой игры">
      <Label style={{ textAlign: 'left' }}>Будет использована текущая одобренная обложка площадки или стандартная.</Label>
    </FormSection>

    <DiscoverySheet visible={catalogueOpen} title="Из каталога площадок" onClose={() => setCatalogueOpen(false)} returnFocusRef={catalogueTrigger}>
      {venues.map(v => <Pressable key={v.id} accessibilityRole="button" onPress={() => { onUpdate({ venueId: v.id }); setCatalogueOpen(false); }}
        style={({ pressed }) => [{ gap: 4, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line }, pressed && { backgroundColor: colors.paper }]}>
        <Label style={{ textAlign: 'left', fontWeight: v.id === form.venueId ? '700' : '500' }}>{`${v.id === form.venueId ? '✓ ' : ''}${v.name}`}</Label>
        <Label style={{ textAlign: 'left', color: colors.secondary, fontSize: 14, lineHeight: 20 }}>{v.address}</Label>
      </Pressable>)}
    </DiscoverySheet>
    <DiscoverySheet visible={dateOpen} title="Выбрать дату" onClose={() => setDateOpen(false)} returnFocusRef={dateTrigger}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(dates?.days ?? []).map(day => <DiscoveryChip key={day} title={discoveryDateLabel(day)} selected={form.date === day}
          onPress={() => { onUpdate({ date: day }); setDateOpen(false); }} />)}
      </View>
    </DiscoverySheet>
    <DiscoverySheet visible={timeOpen} title="Время начала" onClose={() => setTimeOpen(false)} returnFocusRef={timeTrigger}>
      {createGameTimeSlots().map(slot => <Pressable key={slot} accessibilityRole="button" onPress={() => { onUpdate({ time: slot }); setTimeOpen(false); }}
        style={({ pressed }) => [{ minHeight: 44, justifyContent: 'center' }, pressed && { backgroundColor: colors.paper }]}>
        <Label style={{ textAlign: 'left', fontWeight: form.time === slot ? '700' : '500' }}>{`${form.time === slot ? '✓ ' : ''}${slot}`}</Label>
      </Pressable>)}
    </DiscoverySheet>
    <DiscoverySheet visible={formatOpen} title="Формат" onClose={() => setFormatOpen(false)} returnFocusRef={formatTrigger}>
      {FORMAT_OPTIONS.map(option => <Pressable key={option.value} accessibilityRole="button" onPress={() => { onUpdate({ format: option.value }); setFormatOpen(false); }}
        style={({ pressed }) => [{ minHeight: 44, justifyContent: 'center' }, pressed && { backgroundColor: colors.paper }]}>
        <Label style={{ textAlign: 'left', fontWeight: form.format === option.value ? '700' : '500' }}>{`${form.format === option.value ? '✓ ' : ''}${option.label}`}</Label>
      </Pressable>)}
    </DiscoverySheet>
    <DiscoverySheet visible={visibilityOpen} title="Видимость" onClose={() => setVisibilityOpen(false)} returnFocusRef={visibilityTrigger}>
      {VISIBILITY_OPTIONS.map(option => <Pressable key={option.value} accessibilityRole="button" onPress={() => { onUpdate({ visibility: option.value }); setVisibilityOpen(false); }}
        style={({ pressed }) => [{ minHeight: 44, justifyContent: 'center' }, pressed && { backgroundColor: colors.paper }]}>
        <Label style={{ textAlign: 'left', fontWeight: form.visibility === option.value ? '700' : '500' }}>{`${form.visibility === option.value ? '✓ ' : ''}${option.label}`}</Label>
      </Pressable>)}
    </DiscoverySheet>
  </>;
}
