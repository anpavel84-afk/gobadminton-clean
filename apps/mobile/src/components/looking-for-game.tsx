import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { AppState, Pressable, TextInput, View } from 'react-native';
import type { OwnProfile, ProfileCoordinator } from '../profile.ts';
import {
  LOOKING_TTL_DEFAULT, LOOKING_TTL_OPTIONS, lookingAreaDraft, lookingIntentActive,
  lookingIntentExpired, lookingStatusLabel, type LookingTtlMinutes,
} from '../looking-for-game.ts';
import { colors } from '../theme.ts';
import { DiscoveryChip, DiscoverySheet, Label, PrimaryButton, TextButton, styles } from './ui.tsx';

export function LookingForGameCard({
  owner, profile, locked, cityName, notice, pendingLooking, pendingStatus,
}: {
  owner: ProfileCoordinator;
  profile: OwnProfile;
  locked: boolean;
  cityName: string | undefined;
  notice: string | null;
  pendingLooking: boolean;
  pendingStatus: 'sending' | 'unknown' | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [editOpen, setEditOpen] = useState(false);
  const [area, setArea] = useState(() => lookingAreaDraft(profile.lookingForGame, profile.areaKey));
  const [ttl, setTtl] = useState<LookingTtlMinutes>(LOOKING_TTL_DEFAULT);
  const editTrigger = useRef<ComponentRef<typeof Pressable>>(null);
  const active = lookingIntentActive(profile.lookingForGame, now);
  const expired = lookingIntentExpired(profile.lookingForGame, now);
  const statusHint = active ? 'включено' : expired ? 'истекло' : 'выключено';

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 30_000);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') tick(); });
    return () => { clearInterval(id); sub.remove(); };
  }, []);

  function openEdit() {
    if (locked) return;
    setArea(lookingAreaDraft(profile.lookingForGame, profile.areaKey));
    setTtl(LOOKING_TTL_DEFAULT);
    setEditOpen(true);
  }

  return <View style={[styles.card, active && { borderColor: colors.lime, borderWidth: 1 }]} accessibilityLabel="Ищу игру">
    <Label style={{ color: colors.secondary, fontSize: 12, lineHeight: 17, fontWeight: '600' }}>Игровое намерение</Label>
    <Label accessibilityRole="header" style={styles.subtitle}>Ищу игру</Label>
    <Label accessibilityLiveRegion="polite" accessibilityHint={statusHint}>
      {lookingStatusLabel(profile.lookingForGame, now)}
    </Label>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Pressable
        ref={editTrigger}
        accessibilityRole="button"
        accessibilityLabel="Изменить статус «Ищу игру»"
        disabled={locked}
        onPress={openEdit}
        style={({ pressed }) => [
          styles.textButton,
          {
            flexGrow: 1, borderWidth: 1, borderColor: colors.lineDark,
            backgroundColor: pressed ? colors.paper : colors.card,
            opacity: locked ? 0.5 : 1,
          },
        ]}>
        <Label style={{ color: colors.ink, textAlign: 'center', fontWeight: '600' }}>Изменить</Label>
      </Pressable>
      {active
        ? <View style={{ flexGrow: 1 }}><PrimaryButton title="Выключить" disabled={locked} onPress={() => { if (!locked) void owner.stopLooking(); }} /></View>
        : <View style={{ flexGrow: 1 }}><PrimaryButton title="Включить" disabled={locked} onPress={openEdit} /></View>}
    </View>
    {!profile.cityId && <Label>Сначала укажите город в игровом профиле.</Label>}
    {notice && <Label accessibilityLiveRegion="polite">{notice}</Label>}
    {pendingLooking && pendingStatus === 'sending' &&
      <Label accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">Сохраняем статус «Ищу игру»…</Label>}
    {pendingLooking && pendingStatus === 'unknown' &&
      <PrimaryButton title="Повторить прежний статус «Ищу игру»" onPress={() => void owner.reconcile()} />}
    <DiscoverySheet visible={editOpen} title="Ищу игру" onClose={() => { if (!locked) setEditOpen(false); }} returnFocusRef={editTrigger}>
      <Label>{cityName || 'Сначала выберите город в игровом профиле.'}</Label>
      <Label style={{ color: colors.secondary, fontSize: 13, lineHeight: 18 }}>Район</Label>
      <TextInput
        accessibilityLabel="Район для статуса «Ищу игру»"
        value={area}
        onChangeText={setArea}
        maxLength={64}
        editable={!locked}
        placeholder="Необязательно"
        placeholderTextColor={colors.secondary}
        style={styles.input}
      />
      <Label style={{ color: colors.secondary, fontSize: 13, lineHeight: 18 }}>Как долго искать</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {LOOKING_TTL_OPTIONS.map(option => (
          <DiscoveryChip
            key={option.minutes}
            title={option.label}
            selected={ttl === option.minutes}
            onPress={() => { if (!locked) setTtl(option.minutes); }}
          />
        ))}
      </View>
      <PrimaryButton
        title="Сохранить и включить"
        disabled={locked || !profile.cityId}
        onPress={() => {
          if (locked || !profile.cityId) return;
          setEditOpen(false);
          void owner.enableLooking(area, ttl);
        }}
      />
      <TextButton title="Отмена" onPress={() => { if (!locked) setEditOpen(false); }} />
    </DiscoverySheet>
  </View>;
}
