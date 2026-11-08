"use client";

import { useRef, useState } from "react";
import {
  buildVenueCommunityReportBody,
  isVenueCommunityReportReceipt,
  venueCommunityReportSubjectMatchesBody,
  VENUE_COMMUNITY_REPORT_REASON_OPTIONS,
  type VenueCommunityReportReasonCode,
  type VenueCommunityReportReceipt,
  type VenueCommunityReportSubject,
} from "../../../lib/venue-community-api";
import { Button } from "../Button";
import { MutationNotice } from "../messages/MessageComposition";
import { useSocialMutation } from "../messages/useSocialMutation";
import { AuthChooser, ProfileDialog } from "../players/ProfileComposition";

export type VenueCommunityReportDialogProps = {
  subject: VenueCommunityReportSubject;
  actorId: string | null;
  csrfToken: string | null;
  authReturnPath: string;
  onClose: () => void;
};

type AuthBind = { actorId: string; csrfToken: string };

function subjectScope(subject: VenueCommunityReportSubject): string {
  if (subject.subjectKind === "aggregate") {
    return `aggregate:${subject.venueId}`;
  }
  if (subject.subjectKind === "own_vote") {
    return `own_vote:${subject.venueId}:${subject.expectedVersion}`;
  }
  return `venue_comment:${subject.venueId}:${subject.commentId}:${subject.expectedVersion}`;
}

function subjectTitle(subject: VenueCommunityReportSubject): string {
  if (subject.subjectKind === "aggregate") {
    return "Пожаловаться на сводку оценок";
  }
  if (subject.subjectKind === "own_vote") {
    return "Пожаловаться на свою оценку";
  }
  return "Пожаловаться на публикацию";
}

function subjectHelp(subject: VenueCommunityReportSubject): string {
  if (subject.subjectKind === "aggregate") {
    return "Жалоба на сводку оценок сообщества этой площадки. Чужие голоса и личные отзывы после игры здесь не открываются.";
  }
  if (subject.subjectKind === "own_vote") {
    return "Запрос проверки касается только вашей текущей оценки. Снятие модерацией не восстанавливается этой формой.";
  }
  return "Материал и причина будут переданы на проверку. Публикация не скрывается автоматически.";
}

/**
 * Focused venue_community report dialog.
 * Auth + subject bind stay exact in memory (me.id + csrfToken); CSRF is never hashed,
 * logged, or placed in DOM/storage/keys/URLs.
 */
export function VenueCommunityReportDialog({
  subject,
  actorId,
  csrfToken,
  authReturnPath,
  onClose,
}: VenueCommunityReportDialogProps) {
  const signedIn = Boolean(actorId && csrfToken);
  const [reasonCode, setReasonCode] = useState<VenueCommunityReportReasonCode>("inappropriate");
  const [detail, setDetail] = useState("");
  const [done, setDone] = useState(false);
  const [authOpen, setAuthOpen] = useState(!signedIn);
  /**
   * Bumps when CSRF rotates for the same actor/subject so UNKNOWN stays on the prior
   * storage scope (no clear/replay) while the new context can start cleanly.
   * Epoch is memory-only — never derived from hashing the token.
   */
  const csrfEpochRef = useRef(0);
  /** Exact CSRF held only in memory for the admitted operation — compared with ===. */
  const admittedAuthRef = useRef<AuthBind | null>(null);
  const subjectRef = useRef(subject);
  subjectRef.current = subject;

  const liveActor = actorId ?? "guest";
  const liveCsrf = csrfToken ?? "";
  const subjectKey = subjectScope(subject);

  // Render-time fence: clear private detail/selection BEFORE effects when bind drifts.
  const fence = useRef({
    actorId: liveActor,
    csrf: liveCsrf,
    subjectKey,
  });
  if (
    fence.current.actorId !== liveActor
    || fence.current.csrf !== liveCsrf
    || fence.current.subjectKey !== subjectKey
  ) {
    const csrfRotated = fence.current.csrf !== liveCsrf
      && fence.current.actorId === liveActor
      && fence.current.subjectKey === subjectKey;
    fence.current = {
      actorId: liveActor,
      csrf: liveCsrf,
      subjectKey,
    };
    admittedAuthRef.current = null;
    if (csrfRotated) csrfEpochRef.current += 1;
    if (detail) setDetail("");
    if (done) setDone(false);
    if (reasonCode !== "inappropriate") setReasonCode("inappropriate");
    if (!signedIn && !authOpen) setAuthOpen(true);
  }

  const scope = `vc-report:${liveActor}:${subjectKey}:g${csrfEpochRef.current}`;

  const authMatches = Boolean(signedIn && actorId && csrfToken);

  const mutation = useSocialMutation<VenueCommunityReportReceipt>(
    scope,
    liveCsrf,
    () => {
      admittedAuthRef.current = null;
      setDone(true);
      setDetail("");
    },
    (failure) => {
      if (failure?.status === 401) {
        admittedAuthRef.current = null;
        setAuthOpen(true);
        setDetail("");
        setDone(false);
      }
    },
    true,
    {
      validatePending: (pending) => {
        if (pending.path !== "/v1/reports") return false;
        if (!venueCommunityReportSubjectMatchesBody(subjectRef.current, pending.body)) {
          return false;
        }
        const admitted = admittedAuthRef.current;
        if (!admitted || !actorId || !csrfToken) return false;
        return admitted.actorId === actorId && admitted.csrfToken === csrfToken;
      },
      validateSuccess: (data, pending) => {
        if (!isVenueCommunityReportReceipt(data)) return false;
        if (!pending || pending.path !== "/v1/reports") return false;
        return venueCommunityReportSubjectMatchesBody(subjectRef.current, pending.body);
      },
    },
  );

  function submit() {
    if (!signedIn || !actorId || !csrfToken || mutation.busy || mutation.pending || done) {
      return;
    }
    admittedAuthRef.current = { actorId, csrfToken };
    const body = buildVenueCommunityReportBody(
      subject,
      reasonCode,
      detail.trim() || null,
    );
    const started = mutation.run("/v1/reports", body);
    if (!started) admittedAuthRef.current = null;
  }

  function requestClose() {
    // In-flight close hides UI only — does not cancel the server request.
    if (mutation.busy) return;
    setDetail("");
    onClose();
  }

  function retrySafe() {
    const admitted = admittedAuthRef.current;
    if (
      !admitted
      || !actorId
      || !csrfToken
      || admitted.actorId !== actorId
      || admitted.csrfToken !== csrfToken
    ) {
      return;
    }
    mutation.retry();
  }

  if (!signedIn || authOpen) {
    return (
      <AuthChooser
        returnPath={authReturnPath}
        onClose={() => {
          setAuthOpen(false);
          onClose();
        }}
      />
    );
  }

  const formVisible = authMatches && !done;

  return (
    <ProfileDialog title={subjectTitle(subject)} onClose={requestClose}>
      {done ? (
        <p role="status" data-testid="venue-community-report-success">
          Жалоба принята к рассмотрению. Оценка и публикация не меняются автоматически.
        </p>
      ) : formVisible ? (
        <form
          className="gb-venue-community__report-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <p className="gb-venue-community__help">{subjectHelp(subject)}</p>
          <label className="profile-field">
            Причина
            <select
              value={reasonCode}
              disabled={mutation.busy || mutation.pending}
              onChange={(event) => {
                setReasonCode(event.target.value as VenueCommunityReportReasonCode);
              }}
            >
              {VENUE_COMMUNITY_REPORT_REASON_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="profile-field">
            Подробности
            <textarea
              rows={4}
              maxLength={1000}
              value={detail}
              disabled={mutation.busy || mutation.pending}
              onChange={(event) => setDetail(event.target.value)}
              data-testid="venue-community-report-detail"
            />
          </label>
          <Button
            type="submit"
            disabled={mutation.busy || mutation.pending}
            data-testid="venue-community-report-submit"
          >
            Отправить жалобу
          </Button>
        </form>
      ) : (
        <p role="status">
          Контекст входа или объекта жалобы изменился. Закройте окно и откройте жалобу снова.
        </p>
      )}
      <MutationNotice
        mutation={{
          notice: mutation.notice,
          pending: mutation.pending && authMatches,
          busy: mutation.busy,
          retry: retrySafe,
        }}
      />
    </ProfileDialog>
  );
}
