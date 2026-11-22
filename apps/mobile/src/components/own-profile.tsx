import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useAuth } from '../auth.tsx';
import { lookingIntentActive } from '../looking-for-game.ts';
import type { PublicPlayer } from '../players.ts';
import { playerLevelLabel } from '../presentation.ts';
import { colors } from '../theme.ts';
import { CoverEditor } from './cover-editor.tsx';
import { LookingForGameCard } from './looking-for-game.tsx';
import { PlayerProfileHero } from './player-hero.tsx';
import { Label, Loading, PrimaryButton, TextButton, styles } from './ui.tsx';

export function OwnProfileCard({ onEdit, onSettings, settingsOpen }: {
  onEdit: () => void; onSettings: () => void; settingsOpen: boolean;
}) {
  const auth = useAuth(), owner = auth.profile;
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const [coverOpen, setCoverOpen] = useState(false);
  const coverTrigger = useRef<ComponentRef<typeof Pressable>>(null);
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
    lookingForGame: lookingIntentActive(profile.lookingForGame),
    avatar: { uploadedUrl: profile.avatar.uploadedUrl, providerUrl: null },
    cover: profile.cover ?? { uploadedUrl: null },
  } : null;
  const peerBusy = auth.avatar.blocksEdits() || auth.cover.blocksEdits();
  const coverLocked = !!state.command || state.status !== 'ready' || peerBusy;
  const policyLocked = !!state.command || state.status !== 'ready' || peerBusy || !profile || profile.version < 1;
  const lookingLocked = !!state.command || state.status !== 'ready' || peerBusy || !profile;
  const policyPending = state.command?.packet.kind === 'contactPolicy';
  const lookingPending = state.command?.packet.kind === 'lookingPut' || state.command?.packet.kind === 'lookingDelete';
  // Reachable when same-actor reauth restores command with profile still null (load refuses).
  // With profile present, same fragment stays inside the owning card only — no duplicate.
  const pendingPolicyStatus = <>
    {state.noticeOwner === 'contactPolicy' && state.notice &&
      <Label accessibilityLiveRegion="polite">{state.notice}</Label>}
    {policyPending && state.command?.status === 'sending' &&
      <Label accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">Сохраняем настройку…</Label>}
    {policyPending && state.command?.status === 'unknown' &&
      <PrimaryButton title="Повторить прежнюю настройку личных сообщений" onPress={() => void owner.reconcile()} />}
  </>;
  const pendingLookingStatus = <>
    {state.noticeOwner === 'looking' && state.notice &&
      <Label accessibilityLiveRegion="polite">{state.notice}</Label>}
    {lookingPending && state.command?.status === 'sending' &&
      <Label accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">Сохраняем статус «Ищу игру»…</Label>}
    {lookingPending && state.command?.status === 'unknown' &&
      <PrimaryButton title="Повторить прежний статус «Ищу игру»" onPress={() => void owner.reconcile()} />}
  </>;
  return <View style={{ gap: 12 }}>
    {state.status === 'loading' && <Loading title="Загружаем профиль и города…" />}
    {(state.status === 'error' || state.status === 'idle') &&
      <TextButton title="Повторить загрузку профиля и городов" onPress={() => void owner.retryRead()} />}
    {state.status === 'stale' &&
      <PrimaryButton title="Загрузить актуальный профиль для проверки" onPress={() => void owner.refreshAuthoritative()} />}
    {!profile && policyPending && pendingPolicyStatus}
    {!profile && lookingPending && pendingLookingStatus}
    {profile && player && <>
      <PlayerProfileHero
        player={player}
        city={cityName}
        coverSource={auth.cover.coverImageSource(profile.cover?.uploadedUrl)}
      />
      <View accessible accessibilityLabel="Действия профиля" style={{ gap: 8 }}>
        <PrimaryButton title="Изменить профиль" onPress={onEdit} />
        <Pressable
          ref={coverTrigger}
          accessibilityRole="button"
          accessibilityLabel="Изменить обложку"
          disabled={coverLocked && !coverOpen}
          onPress={() => setCoverOpen(true)}
          style={({ pressed }) => [
            styles.textButton,
            {
              borderWidth: 1,
              borderColor: colors.lineDark,
              backgroundColor: pressed ? colors.paper : colors.card,
              opacity: coverLocked && !coverOpen ? 0.5 : 1,
            },
          ]}>
          <Label style={{ color: colors.ink, textAlign: 'center', fontWeight: '600' }}>Изменить обложку</Label>
        </Pressable>
        <CoverEditor open={coverOpen} onOpenChange={setCoverOpen} returnFocusRef={coverTrigger} />
        <Pressable accessibilityRole="button" accessibilityLabel="Настройки"
          accessibilityState={{ expanded: settingsOpen }} onPress={onSettings}
          style={({ pressed }) => [styles.textButton, pressed && { backgroundColor: colors.paper }]}>
          <Label style={{ color: colors.ink, textAlign: 'center' }}>Настройки</Label>
        </Pressable>
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
      <LookingForGameCard
        owner={owner}
        profile={profile}
        locked={lookingLocked}
        cityName={cityName}
        notice={state.noticeOwner === 'looking' ? state.notice : null}
        pendingLooking={lookingPending}
        pendingStatus={lookingPending ? state.command?.status : undefined}
      />
      <View style={styles.card}>
        <Label style={{ color: colors.secondary, fontSize: 12, lineHeight: 17, fontWeight: '600' }}>Настройки сообщений</Label>
        <Label accessibilityRole="header" style={styles.subtitle}>Личные сообщения</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Label style={{ flex: 1, flexShrink: 1 }}>Разрешать личные сообщения</Label>
          <Switch
            accessibilityRole="switch"
            accessibilityLabel="Разрешать личные сообщения"
            accessibilityHint="Другие игроки смогут написать вам, когда ваш профиль виден в каталоге. Выключение блокирует новые входящие; история переписок сохраняется."
            accessibilityState={{ checked: profile.contactPolicy === 'requests', disabled: policyLocked }}
            value={profile.contactPolicy === 'requests'}
            disabled={policyLocked}
            onValueChange={allow => {
              if (policyLocked) return;
              void owner.setContactPolicy(allow ? 'requests' : 'closed');
            }}
          />
        </View>
        <Label style={{ color: colors.secondary, fontSize: 13, lineHeight: 18 }}>
          Другие игроки смогут написать вам, когда ваш профиль виден в каталоге. Выключение блокирует новые входящие; история переписок сохраняется.
        </Label>
        {profile.version < 1 && <Label>Сначала сохраните игровой профиль.</Label>}
        {pendingPolicyStatus}
      </View>
    </>}
  </View>;
}
