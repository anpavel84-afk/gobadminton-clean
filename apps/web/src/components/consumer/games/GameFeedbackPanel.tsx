"use client";

import { useEffect, useRef, useState } from "react";
import type {
  GameFeedbackSlice,
  GamePersonalNote,
  GameReview,
  PeerReviewRating,
  PeerReviewTag,
  ReviewKind,
} from "../../../lib/consumer-types";
import type { SocialMutationPending } from "../messages/useSocialMutation";
import { Button } from "../Button";
import { SectionHeader } from "../players/ProfileComposition";
import { SurfacePanel } from "../Surfaces";
import type { GameResultsMutationApi } from "./useGameResultsMutation";

type Mode = "peer" | "organization" | "training" | "received" | "notes";

const PEER_OPTIONS: Array<{ value: PeerReviewRating; title: string; hint: string }> = [
  { value: "play_again", title: "Было здорово сыграть", hint: "Хотелось бы повторить" },
  { value: "neutral", title: "Всё спокойно", hint: "Обычный игровой опыт" },
  { value: "difficulties", title: "Были сложности", hint: "Играть вместе было трудно" },
];

const TAG_OPTIONS: Array<{ value: PeerReviewTag; label: string }> = [
  { value: "communication", label: "Общение" },
  { value: "teamwork", label: "Командная игра" },
  { value: "agreements", label: "Договорённости" },
];

function peerLabel(rating: PeerReviewRating | null): string {
  return PEER_OPTIONS.find((o) => o.value === rating)?.title ?? "—";
}

function sameFrozenBody(left: object, right: object): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type ReviewFlight = {
  path: string;
  method: string;
  body: Record<string, unknown>;
  peerRating: PeerReviewRating | null;
  orgScore: number | "";
  comment: string;
  tags: PeerReviewTag[];
  discrepancy: string;
  subjectId: string;
  kind: ReviewKind;
};

type NoteEditFlight = {
  path: string;
  method: string;
  body: Record<string, unknown>;
  contextId: string;
  text: string;
};

export function GameFeedbackPanel({
  gameId,
  feedback,
  mutation,
  busy,
  unknownOp,
  onLocalNotice,
  noteSubjects = [],
  confirmedOperation = null,
  onConfirmedOperationSeen,
}: {
  gameId: string;
  feedback: GameFeedbackSlice | null | undefined;
  mutation: GameResultsMutationApi;
  busy: boolean;
  unknownOp: boolean;
  onLocalNotice: (text: string | null) => void;
  noteSubjects?: Array<{ contextId: string; displayName: string }>;
  /** Validated-success frozen request from host; ignored when null / unrelated. */
  confirmedOperation?: SocialMutationPending | null;
  onConfirmedOperationSeen?: () => void;
}) {
  const caps = feedback?.capabilities;
  const writes = Boolean(feedback?.installed && feedback.writesEnabled);
  const [mode, setMode] = useState<Mode>("peer");
  const [subjectId, setSubjectId] = useState<string>("");
  const [peerRating, setPeerRating] = useState<PeerReviewRating | null>(null);
  const [orgScore, setOrgScore] = useState<number | "">("");
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<PeerReviewTag[]>([]);
  const [discrepancy, setDiscrepancy] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [noteContextId, setNoteContextId] = useState("");
  const [noteText, setNoteText] = useState("");
  const [editingNoteContextId, setEditingNoteContextId] = useState("");
  const [editingNoteText, setEditingNoteText] = useState("");
  const boundGame = useRef(gameId);
  boundGame.current = gameId;
  const reviewFlight = useRef<ReviewFlight | null>(null);
  const noteEditFlight = useRef<NoteEditFlight | null>(null);
  const draftSnapshot = useRef({
    peerRating,
    orgScore,
    comment,
    tags,
    discrepancy,
    subjectId,
    editingNoteContextId,
    editingNoteText,
  });
  draftSnapshot.current = {
    peerRating,
    orgScore,
    comment,
    tags,
    discrepancy,
    subjectId,
    editingNoteContextId,
    editingNoteText,
  };

  useEffect(() => {
    const first = caps?.peerSubjects[0]?.contextId ?? "";
    setSubjectId((current) => current || first);
  }, [caps?.peerSubjects]);

  useEffect(() => {
    if (!caps?.canCreatePeer && mode === "peer") {
      if (caps?.canCreateOrganization) setMode("organization");
      else if (caps?.canCreateTraining) setMode("training");
      else setMode("received");
    }
  }, [caps, mode]);

  useEffect(() => {
    if (!confirmedOperation) return;
    const pending = confirmedOperation;
    const review = reviewFlight.current;
    const draft = draftSnapshot.current;
    if (
      review &&
      boundGame.current === gameId &&
      pending.path === review.path &&
      pending.method === review.method &&
      sameFrozenBody(pending.body, review.body)
    ) {
      const unchanged =
        draft.peerRating === review.peerRating &&
        draft.orgScore === review.orgScore &&
        draft.comment === review.comment &&
        draft.tags.length === review.tags.length &&
        draft.tags.every((tag, i) => tag === review.tags[i]) &&
        draft.discrepancy === review.discrepancy &&
        draft.subjectId === review.subjectId;
      if (unchanged) {
        setPeerRating(null);
        setOrgScore("");
        setComment("");
        setTags([]);
        setDiscrepancy("");
      }
      reviewFlight.current = null;
    }

    const noteFlight = noteEditFlight.current;
    if (
      noteFlight &&
      boundGame.current === gameId &&
      pending.path === noteFlight.path &&
      pending.method === noteFlight.method &&
      sameFrozenBody(pending.body, noteFlight.body)
    ) {
      const unchanged =
        draft.editingNoteContextId === noteFlight.contextId &&
        draft.editingNoteText === noteFlight.text;
      if (unchanged) {
        setEditingNoteContextId("");
        setEditingNoteText("");
      }
      noteEditFlight.current = null;
    }

    onConfirmedOperationSeen?.();
  }, [confirmedOperation, gameId, onConfirmedOperationSeen]);

  if (!feedback?.installed) {
    return (
      <SurfacePanel tone="bordered" className="gb-postgame__panel">
        <SectionHeader title="Как вам встреча?" />
        <p>Раздел обратной связи ещё не установлен на этой среде.</p>
      </SurfacePanel>
    );
  }

  const subjects = caps?.peerSubjects ?? [];
  const selectedSubject = subjects.find((s) => s.contextId === subjectId) ?? subjects[0];
  const sent = (feedback.gameReviews ?? []).filter((r) => r.direction === "sent");
  const received = (feedback.gameReviews ?? []).filter((r) => r.direction === "received");
  const notes = feedback.myNotes ?? [];

  function submitReview(kind: ReviewKind) {
    if (!writes || busy || unknownOp) return;
    if (boundGame.current !== gameId) return;
    const body: Record<string, unknown> = {
      kind,
      experienceAssertion: "i_experienced_this_game",
    };
    if (discrepancy.trim()) body.discrepancyExplanation = discrepancy.trim();
    if (kind === "peer") {
      if (!selectedSubject || !peerRating) return;
      body.subjectContextId = selectedSubject.contextId;
      body.peerRating = peerRating;
      if (comment.trim()) body.comment = comment.trim();
      if (tags.length) body.tags = tags;
    } else if (kind === "organization") {
      if (orgScore === "" && !comment.trim()) return;
      if (orgScore !== "") body.organizationScore = orgScore;
      if (comment.trim()) body.comment = comment.trim();
    } else {
      if (!comment.trim()) return;
      body.comment = comment.trim();
    }
    const path = `/v1/games/${gameId}/reviews`;
    onLocalNotice(null);
    // Freeze flight before async transport; do not treat run() admission as success.
    reviewFlight.current = {
      path,
      method: "POST",
      body,
      peerRating,
      orgScore,
      comment,
      tags: [...tags],
      discrepancy,
      subjectId,
      kind,
    };
    mutation.run(path, body, "POST");
  }

  function submitReply(review: GameReview) {
    if (!writes || busy || unknownOp || !review.allowedActions.canReply) return;
    const text = (replyDrafts[review.id] ?? "").trim();
    if (!text) return;
    onLocalNotice(null);
    mutation.run(
      `/v1/reviews/${review.id}/reply`,
      {
        expectedVersion: review.reply?.version ?? 0,
        text,
      },
      "PUT",
    );
  }

  function resetCreateNoteDraft() {
    setNoteContextId("");
    setNoteText("");
  }

  function resetEditNoteDraft(contextId?: string) {
    if (contextId && editingNoteContextId && editingNoteContextId !== contextId) return;
    setEditingNoteContextId("");
    setEditingNoteText("");
  }

  /** Create requires canCreateNote; edit of an existing own note uses note.canEdit only. */
  function saveNote(existing?: GamePersonalNote) {
    if (!writes || busy || unknownOp) return;
    if (boundGame.current !== gameId) return;
    if (existing) {
      if (!existing.allowedActions.canEdit) return;
      const text = noteText.trim();
      if (!text) return;
      onLocalNotice(null);
      mutation.run(
        `/v1/games/${gameId}/notes/${existing.contextId}`,
        {
          expectedVersion: existing.version,
          text,
        },
        "PUT",
      );
      resetCreateNoteDraft();
      return;
    }
    if (!caps?.canCreateNote) return;
    const contextId = noteContextId;
    const text = noteText.trim();
    if (!contextId || !text) return;
    // Never create with a stale draft that actually targets an existing row as version 0.
    const preexisting = notes.find((n) => n.contextId === contextId);
    if (preexisting) {
      if (!preexisting.allowedActions.canEdit) return;
      onLocalNotice(null);
      mutation.run(
        `/v1/games/${gameId}/notes/${preexisting.contextId}`,
        {
          expectedVersion: preexisting.version,
          text,
        },
        "PUT",
      );
      resetCreateNoteDraft();
      return;
    }
    onLocalNotice(null);
    mutation.run(
      `/v1/games/${gameId}/notes/${contextId}`,
      {
        expectedVersion: 0,
        text,
      },
      "PUT",
    );
    resetCreateNoteDraft();
  }

  function saveExistingNote(note: GamePersonalNote) {
    if (!writes || busy || unknownOp || !note.allowedActions.canEdit) return;
    if (boundGame.current !== gameId) return;
    if (editingNoteContextId !== note.contextId) return;
    const text = editingNoteText.trim();
    if (!text) return;
    const path = `/v1/games/${gameId}/notes/${note.contextId}`;
    const body = {
      expectedVersion: note.version,
      text,
    };
    onLocalNotice(null);
    // Keep editor open until confirmed success of this exact PUT.
    noteEditFlight.current = {
      path,
      method: "PUT",
      body,
      contextId: note.contextId,
      text: editingNoteText,
    };
    mutation.run(path, body, "PUT");
  }

  function deleteNote(note: GamePersonalNote) {
    if (!writes || busy || unknownOp || !note.allowedActions.canDelete) return;
    onLocalNotice(null);
    mutation.run(
      `/v1/games/${gameId}/notes/${note.contextId}`,
      {
        expectedVersion: note.version,
      },
      "DELETE",
    );
    resetEditNoteDraft(note.contextId);
  }

  function toggleTag(tag: PeerReviewTag) {
    setTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : current.length < 3 ? [...current, tag] : current,
    );
  }

  const modes: Array<{ id: Mode; label: string; show: boolean }> = [
    { id: "peer", label: "Игроку", show: Boolean(caps?.canCreatePeer || subjects.length) },
    { id: "organization", label: "Организации", show: Boolean(caps?.canCreateOrganization || caps?.organizationRecipientDisplay) },
    { id: "training", label: "Тренировка", show: Boolean(caps?.canCreateTraining) },
    { id: "received", label: "Полученные", show: true },
    { id: "notes", label: "Заметки", show: Boolean(caps?.canCreateNote || notes.length) },
  ];

  return (
    <div className="gb-postgame__layout">
      <div className="gb-postgame__main">
        <SurfacePanel tone="bordered" className="gb-postgame__panel">
          <p className="gb-postgame__eyebrow">После игры</p>
          <div className="gb-postgame__clarify-head">
            <SectionHeader title="Как вам встреча?" />
            <span className="gb-postgame__pill">Без публичного рейтинга</span>
          </div>
          <p>Один игровой контекст. Каждый текст виден только указанному адресату.</p>

          <div className="gb-postgame__segment" role="tablist" aria-label="Тип обратной связи">
            {modes
              .filter((m) => m.show)
              .map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === m.id}
                  className="gb-postgame__segment-btn"
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
          </div>

          {mode === "peer" ? (
            <div className="gb-postgame__dialog-form">
              {selectedSubject ? (
                <div className="gb-postgame__who">
                  <strong>{selectedSubject.displayName}</strong>
                  <small>Отзыв увидите только вы и {selectedSubject.displayName.split(" ")[0]}</small>
                </div>
              ) : (
                <p>Нет доступных адресатов для отзыва игроку.</p>
              )}
              {subjects.length > 1 ? (
                <label className="profile-field">
                  Кому
                  <select
                    value={selectedSubject?.contextId ?? ""}
                    onChange={(e) => setSubjectId(e.target.value)}
                    disabled={busy || unknownOp || !writes}
                  >
                    {subjects.map((s) => (
                      <option key={s.contextId} value={s.contextId}>
                        {s.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <fieldset className="gb-postgame__choice-set" disabled={busy || unknownOp || !writes || !caps?.canCreatePeer}>
                <legend>Как было играть вместе?</legend>
                {PEER_OPTIONS.map((opt) => (
                  <label key={opt.value} className="gb-postgame__choice">
                    <input
                      type="radio"
                      name="peerRating"
                      checked={peerRating === opt.value}
                      onChange={() => setPeerRating(opt.value)}
                    />
                    <span>
                      <strong>{opt.title}</strong>
                      <small>{opt.hint}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <label className="profile-field">
                Комментарий (необязательно)
                <textarea
                  maxLength={500}
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  disabled={busy || unknownOp || !writes}
                />
              </label>
              <div className="gb-postgame__tag-row">
                {TAG_OPTIONS.map((tag) => (
                  <button
                    key={tag.value}
                    type="button"
                    className="gb-postgame__pill"
                    aria-pressed={tags.includes(tag.value)}
                    disabled={busy || unknownOp || !writes}
                    onClick={() => toggleTag(tag.value)}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
              <label className="profile-field">
                Пояснение расхождения (если отметка не «пришёл»)
                <textarea
                  maxLength={500}
                  rows={2}
                  value={discrepancy}
                  onChange={(e) => setDiscrepancy(e.target.value)}
                  disabled={busy || unknownOp || !writes}
                />
              </label>
              <Button
                disabled={busy || unknownOp || !writes || !caps?.canCreatePeer || !peerRating || !selectedSubject}
                onClick={() => submitReview("peer")}
              >
                Отправить игроку
              </Button>
            </div>
          ) : null}

          {mode === "organization" ? (
            <div className="gb-postgame__dialog-form">
              <p>
                Адресат: {caps?.organizationRecipientDisplay ?? "ответственный организатор"}. Видно только вам и
                организатору.
              </p>
              <label className="profile-field">
                Оценка организации (1–5, необязательно если есть комментарий)
                <select
                  value={orgScore === "" ? "" : String(orgScore)}
                  onChange={(e) => setOrgScore(e.target.value ? Number(e.target.value) : "")}
                  disabled={busy || unknownOp || !writes || !caps?.canCreateOrganization}
                >
                  <option value="">Без оценки</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="profile-field">
                Комментарий
                <textarea
                  maxLength={500}
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  disabled={busy || unknownOp || !writes}
                />
              </label>
              <label className="profile-field">
                Пояснение расхождения при необходимости
                <textarea
                  maxLength={500}
                  rows={2}
                  value={discrepancy}
                  onChange={(e) => setDiscrepancy(e.target.value)}
                  disabled={busy || unknownOp || !writes}
                />
              </label>
              <Button
                disabled={
                  busy ||
                  unknownOp ||
                  !writes ||
                  !caps?.canCreateOrganization ||
                  (orgScore === "" && !comment.trim())
                }
                onClick={() => submitReview("organization")}
              >
                Отправить организации
              </Button>
            </div>
          ) : null}

          {mode === "training" ? (
            <div className="gb-postgame__dialog-form">
              <p>Только для подтверждённой тренировки с тренером. Без оценки навыка.</p>
              <label className="profile-field">
                Как прошла тренировка
                <textarea
                  required
                  maxLength={500}
                  rows={4}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  disabled={busy || unknownOp || !writes || !caps?.canCreateTraining}
                />
              </label>
              <label className="profile-field">
                Пояснение расхождения при необходимости
                <textarea
                  maxLength={500}
                  rows={2}
                  value={discrepancy}
                  onChange={(e) => setDiscrepancy(e.target.value)}
                  disabled={busy || unknownOp || !writes}
                />
              </label>
              <Button
                disabled={busy || unknownOp || !writes || !caps?.canCreateTraining || !comment.trim()}
                onClick={() => submitReview("training")}
              >
                Отправить
              </Button>
            </div>
          ) : null}

          {mode === "received" ? (
            <div className="gb-postgame__dialog-form">
              {received.length === 0 ? <p>Пока нет полученных отзывов по этой игре.</p> : null}
              {received.map((review) => (
                <article key={review.id} className="gb-postgame__review-card">
                  <strong>
                    {review.kind === "peer"
                      ? peerLabel(review.peerRating)
                      : review.kind === "organization"
                        ? review.organizationScore
                          ? `Оценка ${review.organizationScore}/5`
                          : "Отзыв организации"
                        : "Тренировка"}
                  </strong>
                  {review.comment ? <p>{review.comment}</p> : null}
                  {review.reply ? (
                    <p className="gb-postgame__helper">
                      Ваш ответ{review.reply.editedAt ? " (изменён)" : ""}: {review.reply.text}
                    </p>
                  ) : null}
                  {review.allowedActions.canReply ? (
                    <>
                      <label className="profile-field">
                        Ответ адресата
                        <textarea
                          maxLength={500}
                          rows={2}
                          value={replyDrafts[review.id] ?? review.reply?.text ?? ""}
                          onChange={(e) =>
                            setReplyDrafts((current) => ({ ...current, [review.id]: e.target.value }))
                          }
                          disabled={busy || unknownOp || !writes}
                        />
                      </label>
                      <Button
                        disabled={busy || unknownOp || !writes || !(replyDrafts[review.id] ?? "").trim()}
                        onClick={() => submitReply(review)}
                      >
                        {review.reply ? "Обновить ответ" : "Ответить"}
                      </Button>
                    </>
                  ) : null}
                </article>
              ))}
              {sent.length > 0 ? (
                <>
                  <SectionHeader title="Отправленные" />
                  {sent.map((review) => (
                    <article key={review.id} className="gb-postgame__review-card">
                      <strong>
                        {review.kind}: {review.recipientDisplay}
                        {review.editedAt ? " · изменено" : ""}
                      </strong>
                      <p>
                        {review.kind === "peer"
                          ? peerLabel(review.peerRating)
                          : review.comment ?? `Оценка ${review.organizationScore ?? "—"}`}
                      </p>
                      {review.reply ? <p className="gb-postgame__helper">Ответ: {review.reply.text}</p> : null}
                    </article>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}

          {mode === "notes" ? (
            <div className="gb-postgame__dialog-form">
              <p>Личная заметка видна только вам. Это не отзыв и не жалоба.</p>
              {caps?.canCreateNote ? (
                <>
                  <label className="profile-field">
                    Участник
                    <select
                      value={noteContextId}
                      onChange={(e) => {
                        setNoteContextId(e.target.value);
                        const existing = notes.find((n) => n.contextId === e.target.value);
                        setNoteText(existing?.text ?? "");
                      }}
                      disabled={busy || unknownOp || !writes}
                    >
                      <option value="">Выберите</option>
                      {(noteSubjects.length ? noteSubjects : subjects).map((s) => (
                        <option key={s.contextId} value={s.contextId}>
                          {s.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="profile-field">
                    Текст заметки
                    <textarea
                      maxLength={500}
                      rows={3}
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      disabled={busy || unknownOp || !writes}
                    />
                  </label>
                  <Button
                    disabled={busy || unknownOp || !writes || !noteContextId || !noteText.trim()}
                    onClick={() => saveNote(notes.find((n) => n.contextId === noteContextId))}
                  >
                    Сохранить заметку
                  </Button>
                </>
              ) : null}
              {notes.map((note) => {
                const editing = editingNoteContextId === note.contextId && note.allowedActions.canEdit;
                return (
                  <article key={note.contextId} className="gb-postgame__review-card">
                    <strong>{note.subjectDisplay}</strong>
                    {editing ? (
                      <label className="profile-field">
                        Текст заметки
                        <textarea
                          maxLength={500}
                          rows={3}
                          value={editingNoteText}
                          onChange={(e) => setEditingNoteText(e.target.value)}
                          disabled={busy || unknownOp || !writes}
                        />
                      </label>
                    ) : (
                      <p>{note.text}</p>
                    )}
                    <div className="gb-postgame__actions">
                      {note.allowedActions.canEdit ? (
                        editing ? (
                          <Button
                            disabled={busy || unknownOp || !writes || !editingNoteText.trim()}
                            onClick={() => saveExistingNote(note)}
                          >
                            Сохранить изменения
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            disabled={busy || unknownOp || !writes}
                            onClick={() => {
                              setEditingNoteContextId(note.contextId);
                              setEditingNoteText(note.text);
                            }}
                          >
                            Изменить
                          </Button>
                        )
                      ) : null}
                      <Button
                        variant="outline"
                        disabled={busy || unknownOp || !writes || !note.allowedActions.canDelete}
                        onClick={() => deleteNote(note)}
                      >
                        Удалить
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </SurfacePanel>
      </div>
      <aside className="gb-postgame__rail">
        <SectionHeader title="Об этой встрече" />
        <p>Отзыв приватный и отделён от посещения. Нет публичного рейтинга и смены навыка.</p>
        <p className="gb-postgame__helper">
          Контекстная жалоба — отдельное явное действие безопасности. Для этого среза используется существующая жалоба
          на игрока; типизированное расширение Safety по отзыву ещё не входит.
        </p>
      </aside>
    </div>
  );
}
