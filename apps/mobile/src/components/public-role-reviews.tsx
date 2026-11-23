import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Keyboard, Modal, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useAuth } from '../auth.tsx';
import { isPublicRolePacketKind } from '../public-role-reviews.ts';
import {
  eligibleBases,
  mayWithdrawOwnPublic,
  publicRoleLabel,
  publicRoleStatusLabel,
  topicOptionsForRole,
  usableOwnRoleHandle,
  type PublicRoleAuthorTarget,
} from '../public-role-reviews.ts';
import { iosModalOrientations, Label, Loading, OutlineButton, Page, PrimaryButton, TextButton, styles } from './ui.tsx';

/** At most one host renders the modal when multiple trees mount the host. */
let publicRoleHostSerial = 0;
let publicRoleHostOwner = 0;

/** Own history / withdraw sheet — same surface for MyGames entry and create receipt link. */
export function PublicRoleOwnHistorySheet({ onClose }: { onClose: () => void }) {
  const auth = useAuth(), owner = auth.postgame;
  const s = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const heading = useRef<ComponentRef<typeof Text>>(null);
  const command = s.command;
  const publicBusy = command && isPublicRolePacketKind(command.packet.kind);
  useEffect(() => {
    const node = findNodeHandle(heading.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);
  const items = s.publicOwn.status === 'ready' ? s.publicOwn.data?.items ?? [] : [];
  return <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={onClose} supportedOrientations={iosModalOrientations}>
    <Page keyboard header={<View style={{ gap: 8 }}>
      <TextButton title="Закрыть" onPress={onClose} />
      {publicBusy?.status === 'unknown' ? <TextButton title="Проверить исходное действие" onPress={() => void owner.reconcilePublic()} /> : null}
    </View>}>
      <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={{ gap: 16 }}>
        <Text ref={heading} accessibilityRole="header" accessibilityLiveRegion="polite" allowFontScaling style={[styles.text, styles.subtitle]}>
          Мои публичные отзывы о ролях
        </Text>
        <Label>Адресат, роль и фактический статус. Приватная обратная связь из итогов игры сюда не входит.</Label>
        {s.publicOwn.status === 'idle' || s.publicOwn.status === 'loading' ? <Loading title="Загружаем…" /> : null}
        {s.publicOwn.status === 'unavailable' ? <Label>Войдите, чтобы увидеть свои отзывы о ролях.</Label> : null}
        {s.publicOwn.status === 'error' ? <>
          <Label accessibilityRole="alert">Не удалось загрузить.</Label>
          <OutlineButton title="Повторить" onPress={() => void owner.loadOwnPublicReviews()} />
        </> : null}
        {s.publicOwn.status === 'ready' && items.length === 0 ? <Label>Пока нет публичных отзывов о ролях.</Label> : null}
        {s.publicOwn.status === 'ready' && items.length >= 50 ? (
          <Label>Показаны до 50 последних записей. Это не исчерпывающая история.</Label>
        ) : null}
        {items.map(item => (
          <View key={item.id} style={styles.card} accessibilityLabel={`${item.subjectDisplayName ?? 'Адресат роли'}, ${publicRoleLabel(item.role)}`}>
            <Label style={{ fontWeight: '700' }}>{item.subjectDisplayName ?? 'Адресат роли'}</Label>
            <Label>{publicRoleLabel(item.role)}</Label>
            <Label>{publicRoleStatusLabel(item.status, item.pendingIntakeStatus)}</Label>
            {item.text ? <Label>{item.text}</Label> : null}
            {item.receiptToken ? <Label>Квитанция: {item.receiptToken}</Label> : null}
            {!usableOwnRoleHandle(item.roleHandle) ? (
              <Label>Адресат роли сейчас недоступен для новой записи.</Label>
            ) : null}
            {mayWithdrawOwnPublic(item) ? (
              <OutlineButton
                title="Отозвать свой отзыв"
                disabled={!!publicBusy}
                onPress={() => void owner.withdrawOwnPublic(item)}
              />
            ) : null}
          </View>
        ))}
        {s.publicNotice ? <Label accessibilityRole="alert">{s.publicNotice}</Label> : null}
        {publicBusy?.status === 'sending' ? <Loading title="Отправляем…" /> : null}
        {s.publicReceipt?.status === 'withdrawn' ? (
          <Label accessibilityLiveRegion="polite">Отзыв отозван.</Label>
        ) : null}
      </View>
    </Page>
  </Modal>;
}

/** Composer sheet: eligibility → audience → text/topics → consent → pending receipt. */
export function PublicRoleComposerSheet({ onClose, onOpenHistory }: {
  onClose: () => void;
  onOpenHistory: () => void;
}) {
  const auth = useAuth(), owner = auth.postgame;
  const s = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const heading = useRef<ComponentRef<typeof Text>>(null);
  const target = s.publicSurface?.mode === 'composer' ? s.publicSurface.target : null;
  const draft = s.publicDraft;
  const command = s.command;
  const publicBusy = command && isPublicRolePacketKind(command.packet.kind);
  useEffect(() => {
    const node = findNodeHandle(heading.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, [target?.roleHandle]);
  if (!target || !draft) return null;
  const eligibility = s.publicEligibility.status === 'ready' ? s.publicEligibility.data : null;
  const eligible = eligibleBases(eligibility);
  const topics = topicOptionsForRole(target.role);
  const receipt = s.publicReceipt;
  const disabled = !!publicBusy || !!receipt;
  return <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={onClose} supportedOrientations={iosModalOrientations}>
    <Page keyboard header={<View style={{ gap: 8 }}>
      <TextButton title="Закрыть" onPress={onClose} />
      {publicBusy?.status === 'unknown' ? <TextButton title="Проверить исходное действие" onPress={() => void owner.reconcilePublic()} /> : null}
    </View>}>
      <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={{ gap: 16 }}>
        <Text ref={heading} accessibilityRole="header" accessibilityLiveRegion="polite" allowFontScaling style={[styles.text, styles.subtitle]}>
          Поделиться опытом · {target.role === 'training' ? 'о тренере' : 'об организаторе'}
        </Text>
        <Label>
          {target.subjectDisplayName ? `Адресат · ${target.subjectDisplayName}` : 'Адресат роли'}
        </Label>
        <Label>Ваша прошедшая встреча. Писать можно только о своём подтверждённом опыте. Навык игрока не оценивается.</Label>
        {s.publicEligibility.status === 'idle' || s.publicEligibility.status === 'loading' ? <Loading title="Проверяем допуск…" /> : null}
        {s.publicEligibility.status === 'error' ? <>
          <Label accessibilityRole="alert">Не удалось загрузить список встреч.</Label>
          <OutlineButton title="Повторить" onPress={() => void owner.loadPublicEligibility()} />
        </> : null}
        {s.publicEligibility.status === 'unavailable' ? <Label>Войдите снова, чтобы продолжить.</Label> : null}
        {s.publicEligibility.status === 'ready' && !eligible.length ? (
          <Label>Нет подтверждённой встречи для публичного отзыва по этой роли. Читать отзывы можно без записи своего текста.</Label>
        ) : null}
        {s.publicEligibility.status === 'ready' && eligible.length ? <>
          <Label style={{ fontWeight: '700' }}>Ваша встреча</Label>
          {eligible.map(b => (
            <Pressable
              key={b.gameId}
              accessibilityRole="button"
              accessibilityState={{ selected: draft.gameId === b.gameId, disabled }}
              disabled={disabled}
              onPress={() => owner.patchPublicDraft({ gameId: b.gameId })}
              style={[styles.chip, { opacity: disabled ? 0.45 : 1 }]}
            >
              <Label>{draft.gameId === b.gameId ? '✓ ' : ''}{new Date(b.endsAt).toLocaleString('ru-RU')}</Label>
            </Pressable>
          ))}
          <Label style={{ fontWeight: '700' }}>Кто увидит текст</Label>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: draft.audience === 'personal', disabled }}
            disabled={disabled}
            onPress={() => owner.patchPublicDraft({ audience: 'personal' })}
            style={[styles.card, { opacity: disabled ? 0.45 : 1 }]}
          >
            <Label style={{ fontWeight: '700' }}>
              {target.role === 'training' ? 'Тренеру лично' : 'Организатору лично'}
            </Label>
            <Label>Вы и адресат · по умолчанию. Публичный раздел этот текст не покажет.</Label>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: draft.audience === 'public', disabled }}
            disabled={disabled}
            onPress={() => owner.patchPublicDraft({ audience: 'public' })}
            style={[styles.card, { opacity: disabled ? 0.45 : 1 }]}
          >
            <Label style={{ fontWeight: '700' }}>Публично</Label>
            <Label>Всем, кому доступен этот раздел роли</Label>
          </Pressable>
          {draft.audience === 'public' ? <>
            <Label>Текст отзыва</Label>
            <TextInput
              editable={!disabled}
              multiline
              scrollEnabled
              textAlignVertical="top"
              accessibilityLabel="Текст публичного отзыва"
              value={draft.text}
              onChangeText={text => owner.patchPublicDraft({ text })}
              maxLength={500}
              style={[styles.input, { minHeight: 120, maxHeight: 220 }]}
            />
            <Label>Темы (до 2)</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {topics.map(t => {
                const selected = draft.topics.includes(t.value);
                return <Pressable
                  key={t.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled }}
                  disabled={disabled || (!selected && draft.topics.length >= 2)}
                  onPress={() => {
                    const next = selected
                      ? draft.topics.filter(x => x !== t.value)
                      : draft.topics.length < 2 ? [...draft.topics, t.value] : draft.topics;
                    owner.patchPublicDraft({ topics: next });
                  }}
                  style={[styles.chip, { opacity: disabled ? 0.45 : 1 }]}
                >
                  <Label>{selected ? '✓ ' : ''}{t.label}</Label>
                </Pressable>;
              })}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <Switch
                disabled={disabled}
                accessibilityLabel="Согласен на публикацию этого текста в отзывах о роли"
                value={draft.consent}
                onValueChange={consent => owner.patchPublicDraft({ consent })}
              />
              <Label style={{ flex: 1 }}>
                Согласен на публикацию этого текста в отзывах о роли. Согласие сбрасывается при правке текста или смене встречи.
              </Label>
            </View>
            <PrimaryButton
              title="Отправить публичный отзыв"
              disabled={disabled || !draft.consent || !draft.text.trim() || !!publicBusy}
              onPress={() => { Keyboard.dismiss(); void owner.submitPublicCreate(); }}
            />
          </> : (
            <Label>
              Чтобы написать лично организатору или тренеру, откройте итоги своей игры — приватная обратная связь отделена от публичных отзывов.
            </Label>
          )}
        </> : null}
        {receipt ? <>
          <Label accessibilityLiveRegion="polite" accessibilityRole="header">
            {publicRoleStatusLabel(receipt.status, receipt.pendingIntakeStatus)}
          </Label>
          <Label>Квитанция: {receipt.receiptToken}. Ожидание разбора — без выдуманного исполнителя.</Label>
          <TextButton title="Мои публичные отзывы о ролях" onPress={onOpenHistory} />
        </> : null}
        {s.publicNotice ? <Label accessibilityRole="alert">{s.publicNotice}</Label> : null}
        {publicBusy?.status === 'sending' ? <Loading title="Отправляем…" /> : null}
      </View>
    </Page>
  </Modal>;
}

/** Hosts public composer/history sheets from PostgameCoordinator surface ownership. */
export function PublicRoleReviewHost() {
  const auth = useAuth(), owner = auth.postgame;
  const s = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const [token] = useState(() => ++publicRoleHostSerial);
  const [owns, setOwns] = useState(() => publicRoleHostOwner === 0);
  useLayoutEffect(() => {
    if (publicRoleHostOwner === 0) {
      publicRoleHostOwner = token;
      setOwns(true);
    } else {
      setOwns(publicRoleHostOwner === token);
    }
    return () => {
      if (publicRoleHostOwner === token) publicRoleHostOwner = 0;
    };
  }, [token]);
  const surface = s.publicSurface;
  if (!owns || !surface) return null;
  if (surface.mode === 'history') {
    return <PublicRoleOwnHistorySheet onClose={() => owner.closePublicSurface()} />;
  }
  return <PublicRoleComposerSheet
    onClose={() => owner.closePublicSurface()}
    onOpenHistory={() => {
      owner.closePublicSurface();
      owner.openOwnPublicHistory();
    }}
  />;
}

export function beginPublicAuthorEntry(args: {
  authenticated: boolean;
  target: PublicRoleAuthorTarget;
  signIn: (returnPath: string | null) => void;
  open: (target: PublicRoleAuthorTarget) => void;
  rememberPending: (target: PublicRoleAuthorTarget) => void;
  returnPath: string | null;
}) {
  if (!args.authenticated) {
    args.rememberPending(args.target);
    args.signIn(args.returnPath);
    return;
  }
  args.open(args.target);
}
