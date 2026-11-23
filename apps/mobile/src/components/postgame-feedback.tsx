import { useEffect, useSyncExternalStore } from 'react';
import { Platform, TextInput, View } from 'react-native';
import { useAuth } from '../auth.tsx';
import {
  feedbackSectionVisible,
  normalizeFormReason,
  peerCreateReasonLabel,
  peerRatingLabel,
  peerReviewsForGame,
  peerReviewsOnly,
  PEER_OPTIONS,
  REPORT_REASONS,
  TAG_OPTIONS,
} from '../postgame.ts';
import type { PrivateReview, Results } from '../postgame.ts';
import { Choice, ReviewButton } from './postgame.tsx';
import { Label, Loading, TextButton, styles } from './ui.tsx';

function useOwner() {
  const owner = useAuth().postgame;
  return { owner, s: useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot) };
}
function useBlocked() {
  const { s } = useOwner();
  return !!(s.command || s.review);
}

function ReviewCard({
  gameId, review, writes, otherGame,
}: {
  gameId: string; review: PrivateReview; writes: boolean; otherGame?: boolean;
}) {
  const { owner, s } = useOwner();
  const blocked = useBlocked();
  // Feedback drafts bind to the review's gameId so report/reply allowed() sees the same key.
  const draftGameId = review.gameId;
  const draft = s.feedbackDrafts[draftGameId] ?? {};
  const replyText = draft.replyText?.[review.id] ?? review.reply?.text ?? '';
  const replyTrimmed = normalizeFormReason(replyText);
  const canReply = writes && review.allowedActions.canReply && !otherGame;
  const canReport = review.allowedActions.canReport;
  const reporting = draft.reportReviewId === review.id;
  return <View style={styles.card} accessibilityLabel={`Отзыв · ${peerRatingLabel(review.peerRating)}`}>
    {otherGame ? <Label>Другая игра · отзыв из личной истории</Label> : null}
    <Label style={{ fontWeight: '700' }}>{peerRatingLabel(review.peerRating)}</Label>
    {review.direction === 'sent' ? <Label>Для {review.recipientDisplay}</Label> : null}
    {review.comment ? <Label>{review.comment}</Label> : null}
    {review.tags.length ? <Label>{review.tags.map(t => TAG_OPTIONS.find(o => o.value === t)?.label ?? t).join(' · ')}</Label> : null}
    {review.reply ? <Label>Ответ{review.reply.editedAt ? ' (изменён)' : ''}: {review.reply.text}</Label> : null}
    {canReply ? <>
      <Label>Ответ адресата</Label>
      <TextInput editable={!blocked && writes} multiline scrollEnabled textAlignVertical="top"
        accessibilityLabel="Ответ адресата"
        value={replyText}
        onChangeText={text => owner.setFeedbackDraft(draftGameId, { replyText: { [review.id]: text } })}
        maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined}
        style={[styles.input, { minHeight: 80, maxHeight: 160 }]} />
      <ReviewButton title={review.reply ? 'Обновить ответ' : 'Ответить'} onPress={() => {
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
    {reporting ? <ReportForm draftGameId={draftGameId} review={review} /> : null}
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
    <ReviewButton title="Отправить жалобу" onPress={() => {
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
 * Private peer feedback after attendance/clarification.
 * History lane works when full results/roster denied; notes stay a separate section.
 */
export function FeedbackSection({ gameId, data }: { gameId: string; data?: Results }) {
  const { owner, s } = useOwner();
  const blocked = useBlocked();
  const feedback = data?.feedback;
  const installed = feedback?.installed !== false;
  const writes = !!(feedback?.installed && feedback.writesEnabled);
  const caps = feedback?.capabilities;
  const canCreate = !!(caps?.canCreatePeer && writes);
  const subjects = caps?.peerSubjects ?? [];
  const draft = s.feedbackDrafts[gameId] ?? {};
  const mode = draft.mode ?? (canCreate || subjects.length || caps?.peerCreateReason ? 'peer' : 'received');
  const selectedId = draft.subjectContextId ?? (subjects.length === 1 ? subjects[0]!.contextId : '');
  const selected = subjects.find(s => s.contextId === selectedId) ?? subjects[0];
  const peerRating = draft.peerRating;
  const comment = draft.comment ?? '';
  const tags = draft.tags ?? [];
  const received = s.reviewHistory.received;
  const sent = s.reviewHistory.sent;
  const visible = feedbackSectionVisible(gameId, feedback, { received, sent });

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

  const receivedPeer = peerReviewsForGame(
    received.status === 'ready' ? received.data?.items ?? [] : peerReviewsOnly(feedback?.gameReviews?.filter(r => r.direction === 'received') ?? []),
    gameId,
  );
  const sentPeer = peerReviewsForGame(
    sent.status === 'ready' ? sent.data?.items ?? [] : peerReviewsOnly(feedback?.gameReviews?.filter(r => r.direction === 'sent') ?? []),
    gameId,
  );
  const historyReceivedOther = peerReviewsOnly(received.data?.items ?? []).filter(r => r.gameId !== gameId);
  const historySentOther = peerReviewsOnly(sent.data?.items ?? []).filter(r => r.gameId !== gameId);

  return <View style={{ gap: 12 }}>
    <Label style={{ fontSize: 20, fontWeight: '700' }}>Как вам встреча?</Label>
    <Label>Без публичного рейтинга</Label>
    <Label>Отзыв приватный и отделён от посещения. Нет публичного рейтинга и смены навыка.</Label>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {(canCreate || subjects.length > 0 || caps?.peerCreateReason) ? (
        <Choice title="Игроку" selected={mode === 'peer'} onPress={() => owner.setFeedbackDraft(gameId, { mode: 'peer' })} />
      ) : null}
      <Choice title="Полученные" selected={mode === 'received'} onPress={() => owner.setFeedbackDraft(gameId, { mode: 'received' })} />
      <Choice title="Отправленные" selected={mode === 'sent'} onPress={() => owner.setFeedbackDraft(gameId, { mode: 'sent' })} />
    </View>

    {mode === 'peer' ? <View style={styles.card}>
      {!caps?.canCreatePeer ? (
        <Label>{peerCreateReasonLabel(caps?.peerCreateReason) ?? 'Пока нет участников для отзыва'}</Label>
      ) : null}
      {selected ? <>
        <Label style={{ fontWeight: '700' }}>{selected.displayName}</Label>
        <Label>Отзыв увидите только вы и {selected.displayName.split(' ')[0]}</Label>
      </> : caps?.canCreatePeer ? <Label>Пока нет участников для отзыва</Label> : null}
      {subjects.length > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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
      <TextInput editable={!blocked && canCreate} multiline scrollEnabled textAlignVertical="top"
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
      <ReviewButton title="Отправить игроку" onPress={() => {
        if (!canCreate || !peerRating || !selected) return;
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

    {mode === 'received' ? <>
      <SourceLane title="Полученные" status={received.status}
        retry={() => void owner.loadReviews('received')}
        empty={received.status === 'ready' && receivedPeer.length === 0}
        emptyText="Пока нет полученных отзывов по этой игре." />
      {receivedPeer.map(review => <ReviewCard key={review.id} gameId={gameId} review={review} writes={writes} />)}
      {received.status === 'ready' && received.data?.nextCursor ? (
        <TextButton title="Ещё полученные" onPress={() => void owner.loadReviews('received', true)} />
      ) : null}
      {historyReceivedOther.length ? <>
        <Label style={{ fontWeight: '700' }}>Другие игры</Label>
        {historyReceivedOther.map(review => (
          <ReviewCard key={review.id} gameId={gameId} review={review} writes={false} otherGame />
        ))}
      </> : null}
    </> : null}

    {mode === 'sent' ? <>
      <SourceLane title="Отправленные" status={sent.status}
        retry={() => void owner.loadReviews('sent')}
        empty={sent.status === 'ready' && sentPeer.length === 0}
        emptyText="Пока нет отправленных отзывов по этой игре." />
      {sentPeer.map(review => <ReviewCard key={review.id} gameId={gameId} review={review} writes={writes} />)}
      {sent.status === 'ready' && sent.data?.nextCursor ? (
        <TextButton title="Ещё отправленные" onPress={() => void owner.loadReviews('sent', true)} />
      ) : null}
      {historySentOther.length ? <>
        <Label style={{ fontWeight: '700' }}>Другие игры</Label>
        {historySentOther.map(review => (
          <ReviewCard key={review.id} gameId={gameId} review={review} writes={false} otherGame />
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
