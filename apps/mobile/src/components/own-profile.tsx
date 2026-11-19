import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';
import { useAuth } from '../auth.tsx';
import type { PublicPlayer } from '../players.ts';
import { playerLevelLabel } from '../presentation.ts';
import { colors } from '../theme.ts';
import { PlayerAvatar, PlayerBadges, PlayerCover } from './player-card.tsx';
import { Label, Loading, PrimaryButton, TextButton, styles } from './ui.tsx';

function lookingActive(intent: { state: string; expiresAt: string | null } | null): boolean {
  if (!intent || intent.state !== 'active') return false;
  if (intent.expiresAt) {
    const expires = Date.parse(intent.expiresAt);
    if (!Number.isNaN(expires) && expires <= Date.now()) return false;
  }
  return true;
}

export function OwnProfileCard({ onEdit, onSettings, settingsOpen }: {
  onEdit: () => void; onSettings: () => void; settingsOpen: boolean;
}) {
  const auth = useAuth(), owner = auth.profile;
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const actor = state.actor;
  useEffect(() => {
    if (auth.status === 'authenticated' && owner.getSnapshot().status === 'idle') void owner.load();
  }, [owner, auth.status, actor?.actorId, actor?.sessionId, actor?.generation]);
  const profile = state.profile;
  const cityName = profile?.cityId ? state.cities.find(c => c.id === profile.cityId)?.nameRu : undefined;
  const player: PublicPlayer | null = profile ? {
    publicPlayerId: profile.publicPlayerId ?? 'own',
    displayName: profile.displayName,
    cityId: profile.cityId,
    areaKey: profile.areaKey,
    level: profile.level,
    bio: profile.bio,
    trainer: profile.trainer,
    lookingForGame: lookingActive(profile.lookingForGame),
    avatar: { uploadedUrl: profile.avatar.uploadedUrl, providerUrl: null },
  } : null;
  return <View style={{ gap: 12 }}>
    {state.status === 'loading' && <Loading title="Загружаем профиль и города…" />}
    {(state.status === 'error' || state.status === 'idle') &&
      <TextButton title="Повторить загрузку профиля и городов" onPress={() => void owner.load()} />}
    {state.status === 'stale' &&
      <PrimaryButton title="Загрузить актуальный профиль для проверки" onPress={() => void owner.load()} />}
    {profile && player && <>
      <View style={{ borderRadius: 18, overflow: 'hidden', backgroundColor: colors.paper }}>
        <PlayerCover uploadedUrl={profile.cover?.uploadedUrl ?? null} />
        <View style={{ padding: 16, gap: 12 }}>
          <PlayerAvatar key={`${player.publicPlayerId}:${player.avatar?.uploadedUrl}`} player={player} large />
          <PlayerBadges player={player} />
          <Label accessibilityRole="header" style={styles.title}>{profile.displayName}</Label>
          <Label>{[playerLevelLabel(profile.level), cityName, profile.areaKey].filter(Boolean).join(' · ')}</Label>
          {profile.bio ? <Label>{profile.bio}</Label> : null}
          <View accessible accessibilityLabel="Действия профиля" style={{ gap: 8 }}>
            <PrimaryButton title="Изменить профиль" onPress={onEdit} />
            <Pressable accessibilityRole="button" accessibilityLabel="Настройки"
              accessibilityState={{ expanded: settingsOpen }} onPress={onSettings}
              style={({ pressed }) => [styles.textButton, pressed && { backgroundColor: colors.paper }]}>
              <Label style={{ color: colors.ink, textAlign: 'center' }}>Настройки</Label>
            </Pressable>
          </View>
        </View>
      </View>
      <View style={styles.card}>
        <Label style={{ color: colors.secondary, fontSize: 12, lineHeight: 17, fontWeight: '600' }}>Публичные данные</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Label accessibilityRole="header" style={styles.subtitle}>Игровой профиль</Label>
          <TextButton title="Изменить" onPress={onEdit} />
        </View>
        <Label>Уровень: {playerLevelLabel(profile.level)}</Label>
        <Label>Город: {cityName || 'Не указан'}</Label>
        <Label>Район / метро: {profile.areaKey || 'Не указан'}</Label>
        <Label>О себе: {profile.bio || 'Не заполнено'}</Label>
      </View>
    </>}
  </View>;
}
