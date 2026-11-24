import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef, type RefObject } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import {
  displayOnlyReview,
  feedbackSectionVisible,
  normalizeFormReason,
  peerCreateReasonLabel,
  peerHistoryEmptyText,
  peerRatingLabel,
  privateReviewHeadline,
  privateReviewsForGame,
  privateReviewsOnly,
  projectReviewsFromStore,
  feedbackDiscrepancyDraftPatch,
  resolveFeedbackDisplayMode,
  resolvePeerDraftSubject,
  reviewCommandsOpen,
  reviewKindModeLabel,
  roleDiscrepancyPresentation,
  PEER_OPTIONS,
  REPORT_REASONS,
  TAG_OPTIONS,
} from '../postgame.ts';
import type { PrivateReview, Results } from '../postgame.ts';
import {
  boundRoleDiscrepancyFieldError,
  feedbackResultsNavParams,
  formatPrivateReviewWhen,
  privateHubHistoryEmptyText,
  privateReviewHistoryDetail,
  privateReviewKindHistoryLabel,
  roleDiscrepancyActiveDecision,
  roleDiscrepancyRequiredBlocksCreate,
  type RoleDiscrepancyDecision,
} from '../postgame-feedback.ts';
import { Choice, ReviewButton } from './postgame.tsx';
import { DiscoveryChip, DiscoverySheet, Label, Loading, TextButton, styles } from './ui.tsx';

function useOwner() {
  const owner = useAuth().postgame;
  return { owner, s: useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot) };
}
function useBlocked() {
  const { s } = useOwner();
  return !!(s.command || s.review);
}

function ReviewCard({
  review, otherGame,
}: {
  review: PrivateReview; otherGame?: boolean;
}) {
  const { owner, s } = useOwner();
  const blocked = useBlocked();
  // Feedback drafts bind to the review's gameId so report/reply allowed() sees the same key.
  const draftGameId = review.gameId;
  const draft = s.feedbackDrafts[draftGameId] ?? {};
  const replyText = draft.replyText?.[review.id] ?? review.reply?.text ?? '';
  const replyTrimmed = normalizeFormReason(replyText);
  // canReply already reflects writesEnabled on the server — do not AND missing Results.
  const commandsOpen = reviewCommandsOpen(s.reviewHistory[review.direction]?.status);
  const canReply = commandsOpen && review.allowedActions.canReply && !otherGame;
  // Exact-revision Support report remains received peer only.
  const canReport = commandsOpen && review.kind === 'peer' && review.allowedActions.canReport;
  const reporting = draft.reportReviewId === review.id;
  const kindLabel = reviewKindModeLabel(review.kind);
  const detailLine = privateReviewHeadline(review);
  const a11y = detailLine ? `Отзыв · ${kindLabel} · ${detailLine}` : `Отзыв · ${kindLabel}`;
  return <View style={styles.card} accessibilityLabel={a11y}>
    {otherGame ? <Label>Другая игра · отзыв из личной истории</Label> : null}
    <Label style={{ fontWeight: '700' }}>{kindLabel}</Label>
    {detailLine ? <Label style={{ fontWeight: '700' }}>{detailLine}</Label> : null}
    {review.direction === 'sent' ? <Label>Для {review.recipientDisplay}</Label> : null}
    {review.comment ? <Label>{review.comment}</Label> : null}
    {review.kind === 'peer' && review.tags.length ? (
      <Label>{review.tags.map(t => TAG_OPTIONS.find(o => o.value === t)?.label ?? t).join(' · ')}</Label>
    ) : null}
    {review.reply ? <Label>Ответ{review.reply.editedAt ? ' (изменён)' : ''}: {review.reply.text}</Label> : null}
    {canReply ? <>
      <Label>Ответ адресата</Label>
      <TextInput editable={!blocked && canReply} multiline scrollEnabled textAlignVertical="top"
        accessibilityLabel="Ответ адресата"
        value={replyText}
        onChangeText={text => owner.setFeedbackDraft(draftGameId, { replyText: { [review.id]: text } })}
        maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined}
        style={[styles.input, { minHeight: 80, maxHeight: 160 }]} />
      <ReviewButton title={review.reply ? 'Обновить ответ' : 'Ответить'} disabled={!replyTrimmed} onPress={() => {
        if (!replyTrimmed) return;
        owner.review({
          kind: 'peer-reply', gameId: draftGameId, reviewId: review.id,
          body: { expectedVersion: review.reply?.version ?? 0, text: replyTrimmed },
        });
      }} />
    </> : null}
    {canReport ? (
      <ReviewButton title="Пожаловаться на отзыв" onPress={() => {
        owner.setFeedbackDraft(draftGameId, {
          reportReviewId: review.id,
          reportReason: 'harassment',
          reportDetail: '',
          reportConsent: false,
          reportConsentVersion: review.version,
        });
      }} />
    ) : null}
    {/* Draft retained across pending/error; interactive form only under current canReport. */}
    {reporting && canReport ? <ReportForm draftGameId={draftGameId} review={review} /> : null}
  </View>;
}

function ReportForm({ draftGameId, review }: { draftGameId: string; review: PrivateReview }) {
  const { owner, s } = useOwner();
  const blocked = useBlocked();
  const draft = s.feedbackDrafts[draftGameId] ?? {};
  const reason = draft.reportReason ?? 'harassment';
  const detail = draft.reportDetail ?? '';
  const consent = !!draft.reportConsent;
  // Consent bound to exact frozen revision — reset if current typed version diverged.
  const versionOk = draft.reportConsentVersion === review.version;
  const actionGameId = review.gameId;
  return <View style={{ gap: 8 }}>
    <Label>Будет передана точная редакция этого отзыва (версия {review.version}), без публикации и без блокировки игрока.</Label>
    {review.comment ? <Label>{review.comment}</Label> : <Label>{peerRatingLabel(review.peerRating)}</Label>}
    {!versionOk ? <Label>Редакция изменилась. Проверьте текст и снова подтвердите согласие.</Label> : null}
    <Label>Причина</Label>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {REPORT_REASONS.map(r => (
        <Choice key={r.code} title={r.label} selected={reason === r.code}
          onPress={() => owner.setFeedbackDraft(draftGameId, { reportReason: r.code })} />
      ))}
    </View>
    <Label>Подробности</Label>
    <TextInput editable={!blocked} multiline scrollEnabled textAlignVertical="top"
      accessibilityLabel="Подробности жалобы"
      value={detail}
      onChangeText={text => owner.setFeedbackDraft(draftGameId, { reportDetail: text })}
      maxLength={1000} autoCorrect={Platform.OS === 'ios' ? false : undefined}
      style={[styles.input, { minHeight: 80, maxHeight: 160 }]} />
    <Choice title="Разрешаю назначенному специалисту прочитать выбранную редакцию отзыва только для разбора обращения"
      selected={consent && versionOk}
      onPress={() => owner.setFeedbackDraft(draftGameId, {
        reportConsent: !(consent && versionOk),
        reportConsentVersion: review.version,
      })} />
    <ReviewButton title="Отправить жалобу" disabled={!consent || !versionOk} onPress={() => {
      if (!consent || !versionOk) return;
      const trimmed = detail.trim();
      owner.review({
        kind: 'peer-report', gameId: actionGameId, reviewId: review.id,
        body: {
          expectedVersion: review.version,
          reasonCode: reason,
          detail: trimmed.length ? trimmed : null,
          shareReviewWithSupport: true,
          gameId: actionGameId,
        },
      });
    }} />
    <TextButton title="Отмена" onPress={() => owner.setFeedbackDraft(draftGameId, {
      reportReviewId: undefined, reportConsent: false, reportConsentVersion: undefined,
    })} />
  </View>;
}

/**
 * Kind is the actually rendered role form — never infer from unstored draft.mode
 * (default organization/training leaves mode undefined and would no-op onChange).
 */
function DiscrepancyField({
  gameId, kind, value, blocked, editable, fieldError, hint, activeDecision,
}: {
  gameId: string;
  kind: 'organization' | 'training';
  value: string;
  blocked: boolean;
  editable: boolean;
  fieldError: string | null | undefined;
  hint: string | null;
  activeDecision: RoleDiscrepancyDecision | null;
}) {
  const { owner } = useOwner();
  const canEdit = !blocked && editable;
  return <>
    <Label>Пояснение расхождения при необходимости</Label>
    {fieldError ? <Label accessibilityRole="alert">{fieldError}</Label> : null}
    {hint && !editable ? <Label>{hint}</Label> : null}
    <TextInput editable={canEdit} multiline scrollEnabled textAlignVertical="top"
      accessibilityLabel="Пояснение расхождения при необходимости"
      value={value}
      onChangeText={text => {
        if (!canEdit) return;
        owner.setFeedbackDraft(gameId, feedbackDiscrepancyDraftPatch(kind, text, activeDecision));
      }}
      maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined}
      style={[styles.input, { minHeight: 60, maxHeight: 120 }]} />
  </>;
}

/**
 * My Games hub entry — private received/sent history (web GameReviewsHistory parity).
 * Read-only list + exact gameId/section=feedback navigation; mutations stay on results.
 */
export function PrivateFeedbackHistoryEntry() {
  const [open, setOpen] = useState(false);
  const returnFocus = useRef<ComponentRef<typeof Pressable> | null>(null);
  return <>
    <Pressable
      ref={returnFocus}
      accessibilityRole="button"
      accessibilityLabel="Обратная связь"
      onPress={() => setOpen(true)}
      style={styles.textButton}
    >
      <Label>Обратная связь</Label>
    </Pressable>
    <PrivateFeedbackHistorySheet
      visible={open}
      onClose={() => setOpen(false)}
      returnFocusRef={returnFocus}
    />
  </>;
}

function PrivateFeedbackHistorySheet({
  visible, onClose, returnFocusRef,
}: {
  visible: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<ComponentRef<typeof Pressable> | null>;
}) {
  const router = useRouter();
  const { owner, s } = useOwner();
  const auth = useAuth();
  const actor = auth.me?.id;
  const session = auth.me?.session.id;
  const current = auth.status === 'authenticated'
    && s.actor?.actorId === actor
    && s.actor?.sessionId === session;
  const [direction, setDirection] = useState<'received' | 'sent'>('received');
  const history = s.reviewHistory[direction];
  // Retain loaded page across refresh; count is loaded-only (web parity).
  const items = privateReviewsOnly(
    projectReviewsFromStore(history.data?.items ?? [], s.reviewsById),
  );
  const loadingInitial = (history.status === 'idle' || history.status === 'loading') && items.length === 0;
  const loadingMore = history.status === 'loading' && items.length > 0;

  useEffect(() => {
    if (!visible || !current) return;
    void owner.loadReviews(direction);
  }, [visible, current, direction, owner, actor, session]);

  const openResults = (gameId: string) => {
    onClose();
    router.push({
      pathname: '/my-games/[gameId]/results',
      params: feedbackResultsNavParams(gameId),
    });
  };

  return <DiscoverySheet
    visible={visible}
    title="Обратная связь"
    onClose={onClose}
    returnFocusRef={returnFocusRef}
  >
    <Label>Только для вас</Label>
    <Label>
      Личные отзывы не публикуются в профиле и не влияют на рейтинг. Изменение и ответ — на вкладке
      «Обратная связь» итогов игры.
    </Label>
    <Label accessibilityLabel={`Записей: ${items.length}`} style={{ fontWeight: '700' }}>
      Записей: {items.length}
    </Label>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <DiscoveryChip title="Полученные" selected={direction === 'received'}
        onPress={() => setDirection('received')} />
      <DiscoveryChip title="Отправленные" selected={direction === 'sent'}
        onPress={() => setDirection('sent')} />
    </View>
    {!current ? (
      <Label>Войдите, чтобы видеть отзывы. Личная обратная связь доступна только в вашем сеансе.</Label>
    ) : history.status === 'unavailable' ? (
      <View style={styles.card}>
        <Label style={{ fontWeight: '700' }}>Раздел отзывов недоступен</Label>
        <Label>Сервер не открыл личную историю. Это не пустой список.</Label>
      </View>
    ) : loadingInitial ? (
      <Loading title="Загружаем отзывы…" />
    ) : history.status === 'error' && items.length === 0 ? (
      <View style={styles.card}>
        <Label style={{ fontWeight: '700' }}>Не удалось загрузить отзывы</Label>
        <TextButton title="Обновить" onPress={() => void owner.loadReviews(direction)} />
      </View>
    ) : history.status === 'ready' && items.length === 0 ? (
      <View style={styles.card}>
        <Label style={{ fontWeight: '700' }}>{privateHubHistoryEmptyText(direction)}</Label>
        <Label>Когда появится запись из итогов игры, она отобразится здесь.</Label>
      </View>
    ) : (
      items.map(review => (
        <PrivateHistoryRow key={review.id} review={review} direction={direction}
          onOpen={() => openResults(review.gameId)} />
      ))
    )}
    {(history.status === 'ready' || loadingMore) && history.data?.nextCursor ? (
      <TextButton
        title={loadingMore ? 'Загружаем…' : 'Показать ещё'}
        onPress={() => { if (!loadingMore) void owner.loadReviews(direction, true); }}
      />
    ) : null}
    {history.status === 'error' && items.length > 0 ? (
      <TextButton title="Повторить" onPress={() => void owner.loadReviews(direction)} />
    ) : null}
  </DiscoverySheet>;
}

function PrivateHistoryRow({
  review, direction, onOpen,
}: {
  review: PrivateReview;
  direction: 'received' | 'sent';
  onOpen: () => void;
}) {
  const kindLabel = privateReviewKindHistoryLabel(review.kind);
  const detail = privateReviewHistoryDetail(review);
  const sentLine = direction === 'sent' && review.recipientDisplay
    ? ` · для ${review.recipientDisplay}`
    : '';
  return <View style={styles.card} accessibilityLabel={`Отзыв · ${kindLabel}`}>
    <Label style={{ fontWeight: '700' }}>{kindLabel}</Label>
    <Label>К итогам игры</Label>
    <Label>{detail}{sentLine}</Label>
    {review.comment ? <Label>{review.comment}</Label> : null}
    <Label>
      версия {review.version}
      {review.editedAt ? ' · изменено' : ''}
      {` · ${formatPrivateReviewWhen(review.createdAt)}`}
      {review.reply ? ' · есть ответ' : ''}
    </Label>
    {review.reply?.text ? (
      <Label>Ответ{review.reply.editedAt ? ' (изменён)' : ''}: {review.reply.text}</Label>
    ) : null}
    <TextButton title="К итогам · обратная связь →" onPress={onOpen} />
  </View>;
}

/**
 * Private feedback after attendance/clarification: peer + organization + training.
 * History lane works when full results/roster denied; notes stay a separate section.
 */
export function FeedbackSection({
  gameId, data, openFeedback = false, sectionRef,
}: {
  gameId: string;
  data?: Results;
  /** Deep-link from hub private history — prefer history lane without writing draft.mode. */
  openFeedback?: boolean;
  sectionRef?: RefObject<View | null>;
}) {
  const { owner, s } = useOwner();
  const blocked = useBlocked();
  const feedback = data?.feedback;
  const installed = feedback?.installed !== false;
  const writes = !!(feedback?.installed && feedback.writesEnabled);
  const caps = feedback?.capabilities;
  const canCreatePeer = !!(caps?.canCreatePeer && writes);
  const canCreateOrganization = !!(caps?.canCreateOrganization && writes);
  const canCreateTraining = !!(caps?.canCreateTraining && writes);
  const showOrganization = !!(caps?.canCreateOrganization || caps?.organizationRecipientDisplay);
  const showTraining = !!caps?.canCreateTraining;
  const showPeer = !!(caps?.canCreatePeer || (caps?.peerSubjects?.length ?? 0) > 0 || caps?.peerCreateReason);
  const subjects = caps?.peerSubjects ?? [];
  const draft = s.feedbackDrafts[gameId] ?? {};
  // Display mode from visible tabs only — do not auto-write draft.mode when falling back.
  // openFeedback prefers received for section=feedback navigation without mutating the store.
  const mode = resolveFeedbackDisplayMode(draft.mode ?? (openFeedback ? 'received' : undefined), {
    peer: showPeer, organization: showOrganization, training: showTraining,
  });
  const { selected, needsReselect } = resolvePeerDraftSubject(subjects, draft.subjectContextId);
  const peerRating = draft.peerRating;
  const comment = draft.comment ?? '';
  const tags = draft.tags ?? [];
  const orgScore = draft.organizationScore;
  const orgComment = draft.organizationComment ?? '';
  const orgDiscrepancy = draft.organizationDiscrepancy ?? '';
  const trainingComment = draft.trainingComment ?? '';
  const trainingDiscrepancy = draft.trainingDiscrepancy ?? '';
  // Bind server decision to the rendered role kind + current attendance/outcome — never cross-kind.
  const roleKind = mode === 'organization' || mode === 'training' ? mode : null;
  const activeDecision = roleKind
    ? roleDiscrepancyActiveDecision(draft.discrepancyDecision, roleKind, data)
    : null;
  const discrepancyError = roleKind
    ? boundRoleDiscrepancyFieldError(draft.discrepancyDecision, roleKind, data)
    : null;
  const discrepancyUi = roleDiscrepancyPresentation(data, discrepancyError);
  const orgDiscrepancyNormalized = normalizeFormReason(orgDiscrepancy);
  const trainingDiscrepancyNormalized = normalizeFormReason(trainingDiscrepancy);
  const orgRequiredBlocks = roleDiscrepancyRequiredBlocksCreate(
    discrepancyError, orgDiscrepancyNormalized,
  );
  const trainingRequiredBlocks = roleDiscrepancyRequiredBlocksCreate(
    discrepancyError, trainingDiscrepancyNormalized,
  );
  const received = s.reviewHistory.received;
  const sent = s.reviewHistory.sent;
  const visible = feedbackSectionVisible(gameId, feedback, { received, sent });
  const orgRecipient = caps?.organizationRecipientDisplay;

  useEffect(() => {
    void owner.loadReviews('received');
    void owner.loadReviews('sent');
  }, [gameId, owner, s.actor?.actorId, s.actor?.sessionId]);

  if (!visible || !installed) {
    if (feedback && feedback.installed === false) {
      return <View style={styles.card}>
        <Label style={{ fontWeight: '700' }}>Как вам встреча?</Label>
        <Label>Раздел обратной связи ещё не установлен на этой среде.</Label>
      </View>;
    }
    return null;
  }

  const laneRows = (direction: 'received' | 'sent', history: typeof received) => {
    const byId = s.reviewsById;
    if (history.status === 'ready') {
      return privateReviewsForGame(projectReviewsFromStore(history.data?.items ?? [], byId), gameId);
    }
    if (history.status === 'unavailable') return [];
    if (history.status === 'loading' || history.status === 'error') {
      // Retain approved display only — strip write actions; never resurrect via Results fallback.
      const retained = privateReviewsOnly(Object.values(byId)).filter(r => r.direction === direction && r.gameId === gameId);
      return retained.map(displayOnlyReview);
    }
    // Idle bootstrap from same-game results until the first history GET settles.
    return privateReviewsForGame(
      privateReviewsOnly(feedback?.gameReviews?.filter(r => r.direction === direction) ?? []),
      gameId,
    );
  };
  const receivedRows = laneRows('received', received);
  const sentRows = laneRows('sent', sent);
  const historyReceivedOther = received.status === 'ready'
    ? privateReviewsOnly(projectReviewsFromStore(received.data?.items ?? [], s.reviewsById)).filter(r => r.gameId !== gameId)
    : [];
  const historySentOther = sent.status === 'ready'
    ? privateReviewsOnly(projectReviewsFromStore(sent.data?.items ?? [], s.reviewsById)).filter(r => r.gameId !== gameId)
    : [];

  const submitOrganization = () => {
    if (!canCreateOrganization) return;
    if (roleDiscrepancyRequiredBlocksCreate(discrepancyError, normalizeFormReason(orgDiscrepancy))) return;
    const trimmed = normalizeFormReason(orgComment);
    if (orgScore == null && !trimmed) return;
    const discrepancy = normalizeFormReason(orgDiscrepancy);
    owner.review({
      kind: 'organization-create', gameId,
      body: {
        kind: 'organization',
        experienceAssertion: 'i_experienced_this_game',
        ...(orgScore != null ? { organizationScore: orgScore } : {}),
        ...(trimmed ? { comment: trimmed } : {}),
        ...(!discrepancyUi.omitFromWire && discrepancy ? { discrepancyExplanation: discrepancy } : {}),
      },
    });
  };

  const submitTraining = () => {
    if (!canCreateTraining) return;
    if (roleDiscrepancyRequiredBlocksCreate(discrepancyError, normalizeFormReason(trainingDiscrepancy))) return;
    const trimmed = normalizeFormReason(trainingComment);
    if (!trimmed) return;
    const discrepancy = normalizeFormReason(trainingDiscrepancy);
    owner.review({
      kind: 'training-create', gameId,
      body: {
        kind: 'training',
        experienceAssertion: 'i_experienced_this_game',
        comment: trimmed,
        ...(!discrepancyUi.omitFromWire && discrepancy ? { discrepancyExplanation: discrepancy } : {}),
      },
    });
  };

  return <View ref={sectionRef} style={{ gap: 12 }} accessibilityLabel="Обратная связь">
    <Label accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700' }}>Как вам встреча?</Label>
    <Label>Без публичного рейтинга</Label>
    <Label>Отзыв приватный и отделён от посещения. Нет публичного рейтинга и смены навыка.</Label>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {showPeer ? (
        <Choice title="Игроку" selected={mode === 'peer'} onPress={() => owner.setFeedbackDraft(gameId, { mode: 'peer' })} />
      ) : null}
      {showOrganization ? (
        <Choice title="Организатору лично" selected={mode === 'organization'}
          onPress={() => owner.setFeedbackDraft(gameId, { mode: 'organization' })} />
      ) : null}
      {showTraining ? (
        <Choice title="Тренировка" selected={mode === 'training'}
          onPress={() => owner.setFeedbackDraft(gameId, { mode: 'training' })} />
      ) : null}
      <Choice title="Полученные" selected={mode === 'received'} onPress={() => owner.setFeedbackDraft(gameId, { mode: 'received' })} />
      <Choice title="Отправленные" selected={mode === 'sent'} onPress={() => owner.setFeedbackDraft(gameId, { mode: 'sent' })} />
    </View>

    {mode === 'peer' ? <View style={styles.card}>
      {!caps?.canCreatePeer ? (
        <Label>{peerCreateReasonLabel(caps?.peerCreateReason) ?? 'Пока нет участников для отзыва'}</Label>
      ) : null}
      {needsReselect ? <Label>Выберите получателя снова</Label> : null}
      {selected ? <>
        <Label style={{ fontWeight: '700' }}>{selected.displayName}</Label>
        <Label>Отзыв увидите только вы и {selected.displayName.split(' ')[0]}</Label>
      </> : null}
      {subjects.length === 0 && caps?.canCreatePeer ? <Label>Пока нет участников для отзыва</Label> : null}
      {subjects.length > 0 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Label>Кому</Label>
        {subjects.map(subject => (
          <Choice key={subject.contextId} title={subject.displayName}
            selected={selected?.contextId === subject.contextId}
            onPress={() => owner.setFeedbackDraft(gameId, { subjectContextId: subject.contextId })} />
        ))}
      </View> : null}
      <Label>Как было играть вместе?</Label>
      <View style={{ gap: 8 }}>
        {PEER_OPTIONS.map(opt => (
          <Choice key={opt.value} title={`${opt.title} — ${opt.hint}`}
            selected={peerRating === opt.value}
            onPress={() => owner.setFeedbackDraft(gameId, { peerRating: opt.value })} />
        ))}
      </View>
      <Label>Комментарий (необязательно)</Label>
      <TextInput editable={!blocked && canCreatePeer} multiline scrollEnabled textAlignVertical="top"
        accessibilityLabel="Комментарий к отзыву"
        value={comment}
        onChangeText={text => owner.setFeedbackDraft(gameId, { comment: text })}
        maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined}
        style={[styles.input, { minHeight: 80, maxHeight: 160 }]} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {TAG_OPTIONS.map(tag => (
          <Choice key={tag.value} title={tag.label} selected={tags.includes(tag.value)}
            onPress={() => {
              const next = tags.includes(tag.value)
                ? tags.filter(t => t !== tag.value)
                : tags.length < 3 ? [...tags, tag.value] : tags;
              owner.setFeedbackDraft(gameId, { tags: next });
            }} />
        ))}
      </View>
      <Label>Отправляя отзыв, вы подтверждаете, что играли вместе</Label>
      <ReviewButton title="Отправить игроку" disabled={!canCreatePeer || !peerRating || !selected} onPress={() => {
        if (!canCreatePeer || !peerRating || !selected) return;
        const trimmed = normalizeFormReason(comment);
        owner.review({
          kind: 'peer-create', gameId,
          body: {
            kind: 'peer',
            subjectContextId: selected.contextId,
            peerRating,
            experienceAssertion: 'i_experienced_this_game',
            ...(trimmed ? { comment: trimmed } : {}),
            ...(tags.length ? { tags: [...tags] } : {}),
          },
        });
      }} />
    </View> : null}

    {mode === 'organization' ? <View style={styles.card}>
      <Label>
        {orgRecipient
          ? `Ваш отзыв увидит организатор этой встречи — ${orgRecipient}`
          : 'Ваш отзыв увидит организатор этой встречи'}
      </Label>
      <Label>Адресат лично. Видно только вам и адресату — это не отзыв организации-компании.</Label>
      {!canCreateOrganization ? (
        <Label>Сейчас нельзя отправить отзыв организатору</Label>
      ) : null}
      <Label>Оценка организации (1–5, необязательно если есть комментарий)</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Choice title="Без оценки" selected={orgScore == null}
          disabled={!canCreateOrganization}
          onPress={() => {
            if (!canCreateOrganization) return;
            owner.setFeedbackDraft(gameId, { organizationScore: null });
          }} />
        {([1, 2, 3, 4, 5] as const).map(n => (
          <Choice key={n} title={String(n)} selected={orgScore === n}
            disabled={!canCreateOrganization}
            onPress={() => {
              if (!canCreateOrganization) return;
              owner.setFeedbackDraft(gameId, { organizationScore: n });
            }} />
        ))}
      </View>
      <Label>Комментарий</Label>
      <TextInput editable={!blocked && canCreateOrganization} multiline scrollEnabled textAlignVertical="top"
        accessibilityLabel="Комментарий организатору"
        value={orgComment}
        onChangeText={text => {
          if (!canCreateOrganization) return;
          owner.setFeedbackDraft(gameId, { organizationComment: text });
        }}
        maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined}
        style={[styles.input, { minHeight: 80, maxHeight: 160 }]} />
      {discrepancyUi.visible ? (
        <DiscrepancyField gameId={gameId} kind="organization" value={orgDiscrepancy}
          blocked={blocked} editable={canCreateOrganization && discrepancyUi.editable}
          fieldError={discrepancyError} hint={discrepancyUi.hint}
          activeDecision={activeDecision} />
      ) : null}
      <Label>Отправляя отзыв, вы подтверждаете, что описываете собственный опыт этой встречи</Label>
      <ReviewButton title="Отправить организатору лично"
        disabled={!canCreateOrganization || orgRequiredBlocks
          || (orgScore == null && !normalizeFormReason(orgComment))}
        onPress={submitOrganization} />
    </View> : null}

    {mode === 'training' ? <View style={styles.card}>
      <Label>Ваш отзыв увидит тренер этой встречи</Label>
      <Label>Как прошла тренировка</Label>
      <TextInput editable={!blocked && canCreateTraining} multiline scrollEnabled textAlignVertical="top"
        accessibilityLabel="Как прошла тренировка"
        value={trainingComment}
        onChangeText={text => owner.setFeedbackDraft(gameId, { trainingComment: text })}
        maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined}
        style={[styles.input, { minHeight: 100, maxHeight: 180 }]} />
      {discrepancyUi.visible ? (
        <DiscrepancyField gameId={gameId} kind="training" value={trainingDiscrepancy}
          blocked={blocked} editable={canCreateTraining && discrepancyUi.editable}
          fieldError={discrepancyError} hint={discrepancyUi.hint}
          activeDecision={activeDecision} />
      ) : null}
      <Label>Отправляя отзыв, вы подтверждаете, что описываете собственный опыт этой встречи</Label>
      <ReviewButton title="Отправить"
        disabled={!canCreateTraining || trainingRequiredBlocks
          || !normalizeFormReason(trainingComment)}
        onPress={submitTraining} />
    </View> : null}

    {mode === 'received' ? <>
      <SourceLane title="Полученные" status={received.status}
        retry={() => void owner.loadReviews('received')}
        empty={received.status === 'ready' && receivedRows.length === 0}
        emptyText={peerHistoryEmptyText('received', received.data?.nextCursor)} />
      {receivedRows.map(review => <ReviewCard key={review.id} review={review} />)}
      {received.status === 'ready' && received.data?.nextCursor ? (
        <TextButton title="Ещё полученные" onPress={() => void owner.loadReviews('received', true)} />
      ) : null}
      {historyReceivedOther.length ? <>
        <Label style={{ fontWeight: '700' }}>Другие игры</Label>
        {historyReceivedOther.map(review => (
          <ReviewCard key={review.id} review={review} otherGame />
        ))}
      </> : null}
    </> : null}

    {mode === 'sent' ? <>
      <SourceLane title="Отправленные" status={sent.status}
        retry={() => void owner.loadReviews('sent')}
        empty={sent.status === 'ready' && sentRows.length === 0}
        emptyText={peerHistoryEmptyText('sent', sent.data?.nextCursor)} />
      {sentRows.map(review => <ReviewCard key={review.id} review={review} />)}
      {sent.status === 'ready' && sent.data?.nextCursor ? (
        <TextButton title="Ещё отправленные" onPress={() => void owner.loadReviews('sent', true)} />
      ) : null}
      {historySentOther.length ? <>
        <Label style={{ fontWeight: '700' }}>Другие игры</Label>
        {historySentOther.map(review => (
          <ReviewCard key={review.id} review={review} otherGame />
        ))}
      </> : null}
    </> : null}
  </View>;
}

function SourceLane({
  title, status, retry, empty, emptyText,
}: {
  title: string; status: string; retry: () => void; empty: boolean; emptyText: string;
}) {
  if (status === 'idle' || status === 'loading') return <Loading title={`Загружаем: ${title}…`} />;
  if (status === 'error') return <View style={styles.card}>
    <Label>Не удалось загрузить отзывы.</Label>
    <TextButton title="Повторить" onPress={retry} />
  </View>;
  if (status === 'unavailable') return <View style={styles.card}>
    <Label>Раздел отзывов недоступен</Label>
    <Label>Сервер не открыл личную историю. Это не пустой список.</Label>
  </View>;
  if (empty) return <Label>{emptyText}</Label>;
  return null;
}
