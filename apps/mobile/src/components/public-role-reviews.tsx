import { useEffect, useRef, useSyncExternalStore, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Keyboard, Modal, Pressable, Switch, Text, TextInput, View, type ScrollView } from 'react-native';
import { useAuth } from '../auth.tsx';
import { isPublicRolePacketKind } from '../public-role-reviews.ts';
import {
  bindPublicRoleFocusRef,
  clearPublicRoleFocusTarget,
  currentPublicRoleFocusTarget,
  eligibleBases,
  mayWithdrawOwnPublic,
  PUBLIC_ROLE_REPORT_REASONS,
  publicRoleLabel,
  publicRoleStatusLabel,
  rememberPublicRoleFocusTarget,
  subjectOwnReplyLabel,
  topicOptionsForRole,
  usableOwnRoleHandle,
  type PublicRoleAuthorTarget,
  type PublicRoleFocusHandle,
  type PublicRoleReaderTarget,
  type PublicRoleReportReason,
} from '../public-role-reviews.ts';
import { ROLE_TOPIC_LABEL, reviewReplyLabel } from '../role-reputation.ts';
import { colors } from '../theme.ts';
import { iosModalOrientations, Label, Loading, OutlineButton, Page, PrimaryButton, TextButton, styles } from './ui.tsx';

type FocusTarget = ComponentRef<typeof Pressable>;

export {
  bindPublicRoleFocusRef,
  clearPublicRoleFocusTarget,
  rememberPublicRoleFocusTarget,
};

function restorePublicTriggerFocus() {
  const current = currentPublicRoleFocusTarget();
  const frame = requestAnimationFrame(() => {
    current?.focus();
    const node = findNodeHandle((current as FocusTarget | null) ?? null);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  });
  return () => cancelAnimationFrame(frame);
}

/** Explicit author entry — same chrome as ui OutlineButton tokens. */
export function PublicRoleAuthorEntryButton({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  const held = useRef<PublicRoleFocusHandle | null>(null);
  // Stable callback identity — recreating per render would detach/attach and clear a live opener.
  const setRef = useRef((node: FocusTarget | null) => {
    bindPublicRoleFocusRef(held, node);
  }).current;
  return <Pressable
    ref={setRef}
    accessibilityRole="button"
    onPress={() => {
      rememberPublicRoleFocusTarget(held.current);
      onPress();
    }}
    style={({ pressed }) => [{
      alignSelf: 'flex-start' as const,
      minHeight: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.lineDark,
      backgroundColor: pressed ? colors.paper : colors.card,
      justifyContent: 'center' as const,
      paddingHorizontal: 16,
      paddingVertical: 12,
    }]}
  >
    <Label style={{ fontWeight: '700', textAlign: 'left' }}>{title}</Label>
  </Pressable>;
}

/** Own history / withdraw sheet — same surface for MyGames entry and create receipt link. */
export function PublicRoleOwnHistorySheet({ onClose }: { onClose: () => void }) {
  const auth = useAuth(), owner = auth.postgame;
  const s = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const heading = useRef<ComponentRef<typeof Text>>(null);
  const command = s.command;
  const publicBusy = command && isPublicRolePacketKind(command.packet.kind) ? command : null;
  useEffect(() => {
    const node = findNodeHandle(heading.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);
  const close = () => {
    onClose();
    restorePublicTriggerFocus();
  };
  const items = s.publicOwn.status === 'ready' ? s.publicOwn.data?.items ?? [] : [];
  return <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={close} supportedOrientations={iosModalOrientations}>
    <Page keyboard header={<View style={{ gap: 8 }}>
      <TextButton title="Закрыть" onPress={close} />
      {publicBusy?.status === 'unknown' ? <TextButton title="Проверить исходное действие" onPress={() => void owner.reconcilePublic()} /> : null}
    </View>}>
      <View accessibilityViewIsModal onAccessibilityEscape={close} style={{ gap: 16 }}>
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
                onPress={() => {
                  const surface = s.publicSurface;
                  if (!surface || surface.mode !== 'history') return;
                  void owner.withdrawOwnPublic(item, s.actor, surface.gen);
                }}
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
  const publicBusy = command && isPublicRolePacketKind(command.packet.kind) ? command : null;
  useEffect(() => {
    const node = findNodeHandle(heading.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, [target?.roleHandle]);
  const close = () => {
    onClose();
    restorePublicTriggerFocus();
  };
  if (!target || !draft) return null;
  const eligibility = s.publicEligibility.status === 'ready' ? s.publicEligibility.data : null;
  const eligible = eligibleBases(eligibility);
  const topics = topicOptionsForRole(target.role);
  const receipt = s.publicReceipt;
  const disabled = !!publicBusy || !!receipt;
  return <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={close} supportedOrientations={iosModalOrientations}>
    <Page keyboard header={<View style={{ gap: 8 }}>
      <TextButton title="Закрыть" onPress={close} />
      {publicBusy?.status === 'unknown' ? <TextButton title="Проверить исходное действие" onPress={() => void owner.reconcilePublic()} /> : null}
    </View>}>
      <View accessibilityViewIsModal onAccessibilityEscape={close} style={{ gap: 16 }}>
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
          <Label>
            Квитанция: {receipt.receiptToken}. Отзыв принят на разбор; срок и исполнитель не обещаются.
          </Label>
          <TextButton title="Мои публичные отзывы о ролях" onPress={onOpenHistory} />
        </> : null}
        {s.publicNotice ? <Label accessibilityRole="alert">{s.publicNotice}</Label> : null}
        {publicBusy?.status === 'sending' ? <Loading title="Отправляем…" /> : null}
      </View>
    </Page>
  </Modal>;
}

/** Actor-aware public reviews sheet — reply/report with consent; no anonymous fallback. */
export function PublicRoleReaderSheet({ onClose }: { onClose: () => void }) {
  const auth = useAuth(), owner = auth.postgame;
  const s = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const heading = useRef<ComponentRef<typeof Text>>(null);
  const pageScrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const reportHeadingRef = useRef<ComponentRef<typeof Text>>(null);
  const reportFormRef = useRef<ComponentRef<typeof View>>(null);
  const reportTriggerRefs = useRef(new Map<string, FocusTarget | null>());
  const reportRowRefs = useRef(new Map<string, ComponentRef<typeof View> | null>());
  const reportRevealedKey = useRef<string | null>(null);
  const prevReportRowKey = useRef<string | null>(null);
  const reader = s.publicSurface?.mode === 'reader' ? s.publicSurface.reader : null;
  const surfaceGen = s.publicSurface?.mode === 'reader' ? s.publicSurface.gen : 0;
  const command = s.command;
  const publicBusy = command && isPublicRolePacketKind(command.packet.kind) ? command : null;
  const report = s.publicReportDraft;
  const reportRowKey = report ? `${report.reviewHandle}:${report.publishedRevision}` : null;
  const reportInFlight = publicBusy?.packet.kind === 'public-role-report';
  useEffect(() => {
    const node = findNodeHandle(heading.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, [reader?.roleHandle]);
  useEffect(() => {
    if (!reportRowKey) reportRevealedKey.current = null;
  }, [reportRowKey]);
  // Auto-retire (permission/revision loss): focus visible row or reader heading.
  // Explicit Cancel keeps its own trigger focus when that button is still mounted.
  useEffect(() => {
    const prev = prevReportRowKey.current;
    prevReportRowKey.current = reportRowKey;
    if (!prev || reportRowKey) return;
    const expectedGen = surfaceGen;
    const retiredHandle = prev.slice(0, prev.lastIndexOf(':'));
    const frame = requestAnimationFrame(() => {
      const surface = owner.getSnapshot().publicSurface;
      if (!surface || surface.mode !== 'reader' || surface.gen !== expectedGen) return;
      if (owner.getSnapshot().publicReportDraft) return;
      const trigger = reportTriggerRefs.current.get(prev);
      if (trigger) return;
      const row = reportRowRefs.current.get(retiredHandle);
      const target = row ?? heading.current;
      if (!target) return;
      const node = findNodeHandle(target);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    });
    return () => cancelAnimationFrame(frame);
  }, [reportRowKey, surfaceGen, owner]);
  const revealSelectedReport = () => {
    if (!reportRowKey || reportRevealedKey.current === reportRowKey) return;
    const expectedSurfaceGen = surfaceGen;
    const expectedKey = reportRowKey;
    // After layout only — no TextInput focus / keyboard.
    Keyboard.dismiss();
    const surface = owner.getSnapshot().publicSurface;
    if (!surface || surface.mode !== 'reader' || surface.gen !== expectedSurfaceGen) return;
    const draft = owner.getSnapshot().publicReportDraft;
    if (!draft || `${draft.reviewHandle}:${draft.publishedRevision}` !== expectedKey) return;
    reportRevealedKey.current = expectedKey;
    const node = findNodeHandle(reportHeadingRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
    const content = pageScrollRef.current?.getInnerViewRef?.();
    const form = reportFormRef.current;
    if (content && form) {
      form.measureLayout(
        content,
        (_x, y) => {
          const live = owner.getSnapshot();
          if (live.publicSurface?.mode !== 'reader' || live.publicSurface.gen !== expectedSurfaceGen) return;
          if (!live.publicReportDraft
            || `${live.publicReportDraft.reviewHandle}:${live.publicReportDraft.publishedRevision}` !== expectedKey) {
            return;
          }
          pageScrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: false });
        },
        () => undefined,
      );
    }
  };
  const close = () => {
    onClose();
    restorePublicTriggerFocus();
  };
  if (!reader) return null;
  const summary = s.publicReader.status === 'ready' ? s.publicReader.data : null;
  const count = summary?.publishedReviewCount ?? 0;
  const title = reader.role === 'training'
    ? (count > 0 ? `Отзывы о тренировках · ${count}` : 'Отзывы о тренировках')
    : (count > 0 ? `Отзывы об организации · ${count}` : 'Отзывы об организации');
  const replyAckHandle = s.publicReplyReceipt?.reviewHandle ?? null;
  const reportAckHandle = s.publicReportReceipt?.reviewHandle ?? null;
  const threadBusy = !!publicBusy;
  const cancelReport = () => {
    if (reportInFlight) return;
    const key = reportRowKey;
    const expectedGen = surfaceGen;
    owner.cancelPublicReport();
    if (!key) return;
    requestAnimationFrame(() => {
      const surface = owner.getSnapshot().publicSurface;
      if (!surface || surface.mode !== 'reader' || surface.gen !== expectedGen) return;
      if (owner.getSnapshot().publicReportDraft) return;
      const trigger = reportTriggerRefs.current.get(key);
      if (!trigger) return;
      trigger.focus();
      const node = findNodeHandle(trigger);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    });
  };
  return <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={close} supportedOrientations={iosModalOrientations}>
    <Page keyboard scrollRef={pageScrollRef} header={<View style={{ gap: 8 }}>
      <TextButton title="Закрыть" onPress={close} />
      {publicBusy?.status === 'unknown' ? <TextButton title="Проверить исходное действие" onPress={() => void owner.reconcilePublic()} /> : null}
    </View>}>
      <View accessibilityViewIsModal onAccessibilityEscape={close} style={{ gap: 16 }}>
        <Text ref={heading} accessibilityRole="header" accessibilityLiveRegion="polite" allowFontScaling style={[styles.text, styles.subtitle]}>
          {title}
        </Text>
        <Label>Опыт участников. Отрицательные впечатления тоже важны. Читать можно без прошлого участия.</Label>
        {s.publicReader.status === 'idle' || s.publicReader.status === 'loading' ? <Loading title="Загружаем отзывы…" /> : null}
        {s.publicReader.status === 'error' ? <>
          <Label accessibilityRole="alert">Не удалось загрузить.</Label>
          <OutlineButton title="Обновить" onPress={() => void owner.loadPublicReader()} />
        </> : null}
        {s.publicReader.status === 'unavailable' ? (
          <Label>Публичные отзывы по этой роли сейчас недоступны.</Label>
        ) : null}
        {s.publicReader.status === 'ready' && summary ? <>
          {!summary.items.length ? <Label>Пока нет опубликованных отзывов.</Label> : null}
          {summary.items.map(item => {
            const draft = s.publicReplyDrafts[item.reviewHandle] ?? { text: '', consent: false };
            const rowDisabled = threadBusy
              || replyAckHandle === item.reviewHandle
              || reportAckHandle === item.reviewHandle;
            const itemReportKey = `${item.reviewHandle}:${item.publishedRevision}`;
            const showReport = !!report
              && report.reviewHandle === item.reviewHandle
              && report.publishedRevision === item.publishedRevision
              && item.allowedActions.canReport;
            const reportDisabled = threadBusy || reportAckHandle === item.reviewHandle;
            return <View
              key={item.reviewHandle}
              ref={node => {
                if (node) reportRowRefs.current.set(item.reviewHandle, node);
                else reportRowRefs.current.delete(item.reviewHandle);
              }}
              style={styles.card}
              accessibilityLabel={item.authorLabel}
            >
              <Label style={{ fontWeight: '700' }}>{item.authorLabel}</Label>
              <Label>✓ Участие подтверждено</Label>
              {item.experienceState === 'basis_under_review' ? <Label>Основание на проверке</Label> : null}
              <Label>{item.text}</Label>
              {item.topics.length ? (
                <Label>{item.topics.map(t => ROLE_TOPIC_LABEL[t] ?? t).join(', ')}</Label>
              ) : null}
              {item.reply ? <Label>{reviewReplyLabel(item.role, item.reply.text)}</Label> : null}
              {item.subjectOwnReply ? (
                <Label accessibilityLiveRegion="polite">{subjectOwnReplyLabel(item.subjectOwnReply)}</Label>
              ) : null}
              {s.publicReplyReceipt?.reviewHandle === item.reviewHandle ? (
                <Label accessibilityLiveRegion="polite">Ответ принят.</Label>
              ) : null}
              {item.allowedActions.canReport ? (
                <Pressable
                  ref={node => {
                    if (node) reportTriggerRefs.current.set(itemReportKey, node);
                    else reportTriggerRefs.current.delete(itemReportKey);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: rowDisabled }}
                  disabled={rowDisabled}
                  onPress={() => owner.beginPublicReport(item, s.actor, s.publicSurface!.gen)}
                  style={({ pressed }) => [{
                    alignSelf: 'flex-start' as const,
                    minHeight: 48,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.lineDark,
                    backgroundColor: pressed ? colors.paper : colors.card,
                    justifyContent: 'center' as const,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    opacity: rowDisabled ? 0.5 : 1,
                  }]}
                >
                  <Label style={{ fontWeight: '700', textAlign: 'left' }}>Сообщить о нарушении</Label>
                </Pressable>
              ) : null}
              {showReport ? <View
                ref={reportFormRef}
                onLayout={revealSelectedReport}
                style={{ gap: 12 }}
                accessibilityLabel="Жалоба на отзыв"
              >
                <Text
                  ref={reportHeadingRef}
                  accessibilityRole="header"
                  accessibilityLiveRegion="polite"
                  allowFontScaling
                  style={[styles.text, { fontWeight: '700' }]}
                >
                  Жалоба на отзыв
                </Text>
                <Label>Причина</Label>
                {PUBLIC_ROLE_REPORT_REASONS.map(r => (
                  <Pressable
                    key={r.code}
                    accessibilityRole="button"
                    accessibilityState={{ selected: report!.reasonCode === r.code, disabled: reportDisabled }}
                    disabled={reportDisabled}
                    onPress={() => owner.patchPublicReportDraft({ reasonCode: r.code as PublicRoleReportReason })}
                    style={[styles.chip, { opacity: reportDisabled ? 0.45 : 1 }]}
                  >
                    <Label>{report!.reasonCode === r.code ? '✓ ' : ''}{r.label}</Label>
                  </Pressable>
                ))}
                <Label>Пояснение</Label>
                <TextInput
                  editable={!reportDisabled}
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  accessibilityLabel="Пояснение к жалобе"
                  value={report!.explanation}
                  onChangeText={explanation => owner.patchPublicReportDraft({ explanation })}
                  maxLength={500}
                  style={[styles.input, { minHeight: 96, maxHeight: 180 }]}
                />
                <PrimaryButton
                  title="Отправить жалобу"
                  disabled={reportDisabled}
                  onPress={() => {
                    Keyboard.dismiss();
                    void owner.submitPublicReport(s.actor, s.publicSurface!.gen);
                  }}
                />
                <OutlineButton
                  title="Отмена"
                  disabled={!!reportInFlight || reportAckHandle === report!.reviewHandle}
                  onPress={cancelReport}
                />
              </View> : null}
              {item.allowedActions.canReply ? <>
                <Label>Ваш ответ</Label>
                <TextInput
                  editable={!rowDisabled}
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  accessibilityLabel="Ваш ответ"
                  value={draft.text}
                  onChangeText={text => owner.patchPublicReplyDraft(item.reviewHandle, { text })}
                  maxLength={500}
                  style={[styles.input, { minHeight: 96, maxHeight: 180 }]}
                />
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                  <Switch
                    disabled={rowDisabled}
                    accessibilityLabel="Публикую ответ от своего имени по этой роли"
                    value={draft.consent}
                    onValueChange={consent => owner.patchPublicReplyDraft(item.reviewHandle, { consent })}
                  />
                  <Label style={{ flex: 1 }}>Публикую ответ от своего имени по этой роли</Label>
                </View>
                <PrimaryButton
                  title="Отправить ответ"
                  disabled={rowDisabled || !draft.text.trim()}
                  onPress={() => {
                    Keyboard.dismiss();
                    void owner.submitPublicReply(item.reviewHandle, s.actor, s.publicSurface!.gen);
                  }}
                />
              </> : null}
            </View>;
          })}
          {s.publicReaderMoreError && summary.nextCursor ? <>
            <Label accessibilityRole="alert">Не удалось загрузить следующие отзывы. Уже загруженные сохранены.</Label>
            <OutlineButton
              title="Повторить"
              disabled={threadBusy || s.publicReaderLoadingMore}
              onPress={() => void owner.loadPublicReader({ cursor: summary.nextCursor, append: true })}
            />
          </> : summary.nextCursor ? (
            s.publicReaderLoadingMore
              ? <Label>Загружаем ещё отзывы…</Label>
              : <OutlineButton
                title="Ещё отзывы"
                disabled={threadBusy}
                onPress={() => void owner.loadPublicReader({ cursor: summary.nextCursor, append: true })}
              />
          ) : null}
        </> : null}
        {s.publicNotice ? <Label accessibilityRole="alert">{s.publicNotice}</Label> : null}
        {publicBusy?.status === 'sending' ? <Loading title="Отправляем…" /> : null}
      </View>
    </Page>
  </Modal>;
}

/**
 * Single persistent host under AuthProvider (RootLayout) — opens composer/history/reader from
 * PostgameCoordinator surface ownership; resumes bounded guest pending once when actor is current.
 */
export function PublicRoleReviewHost() {
  const auth = useAuth(), owner = auth.postgame;
  const s = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    if (!auth.me || !s.actor) return;
    if (s.actor.actorId !== auth.me.id || s.actor.sessionId !== auth.me.session.id) return;
    if (s.pendingPublicAuthor) {
      owner.resumePendingPublicAuthor();
      return;
    }
    if (s.pendingPublicReader) owner.resumePendingPublicReader();
  }, [
    auth.status,
    auth.me?.id,
    auth.me?.session.id,
    owner,
    s.actor?.actorId,
    s.actor?.sessionId,
    s.pendingPublicAuthor,
    s.pendingPublicReader,
  ]);
  const surface = s.publicSurface;
  if (!surface) return null;
  if (surface.mode === 'history') {
    return <PublicRoleOwnHistorySheet onClose={() => owner.closePublicSurface()} />;
  }
  if (surface.mode === 'reader') {
    return <PublicRoleReaderSheet onClose={() => owner.closePublicSurface()} />;
  }
  return <PublicRoleComposerSheet
    onClose={() => owner.closePublicSurface()}
    onOpenHistory={() => {
      owner.closePublicSurface();
      owner.openOwnPublicHistory();
    }}
  />;
}

export function beginPublicReaderEntry(args: {
  authenticated: boolean;
  target: PublicRoleReaderTarget;
  signIn: (returnPath: string | null) => void;
  open: (target: PublicRoleReaderTarget) => void;
  rememberPending: (target: PublicRoleReaderTarget) => void;
  returnPath: string | null;
}) {
  if (!args.authenticated) {
    args.rememberPending(args.target);
    args.signIn(args.returnPath);
    return;
  }
  args.open(args.target);
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
