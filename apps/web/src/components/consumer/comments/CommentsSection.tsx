"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  createEntityCommentPath,
  deleteEntityCommentPath,
  isCommentView,
  listEntityComments,
  publicCommentModerationNotice,
  updateEntityCommentPath,
} from "../../../lib/comments-api";
import type { CommentEntityKind, EntityComment, EntityCommentPage } from "../../../lib/comments-types";
import type { Me } from "../../../lib/consumer-types";
import { Button } from "../Button";
import { MutationNotice } from "../messages/MessageComposition";
import { useSocialMutation } from "../messages/useSocialMutation";
import { AuthChooser, Avatar, ProfileDialog } from "../players/ProfileComposition";
import { ConversationSafety } from "../messages/ConversationSafety";
import { VenueCommunityReportDialog } from "../venues/VenueCommunityReportDialog";
import type { VenueCommunityReportSubject } from "../../../lib/venue-community-api";
import "../../../styles/comments.css";

const TEXT_MAX = 1000;
const COLLAPSE_LINES = 4;

type Props = {
  kind: CommentEntityKind;
  entityId: string;
  me: Me | null;
  description: string;
  authReturnPath: string;
  /** Parent currently public/available — host gate; do not mount otherwise. */
  parentPublic: boolean;
  /** Optional section heading; default «Комментарии». */
  title?: string;
  /** Optional DOM id for page anchors (e.g. venue #discussion). */
  sectionId?: string;
  onUnresolvedChange?: (unresolved: boolean) => void;
};

/** In-memory actor+csrf identity — never logged or written to storage keys/DOM. */
type AuthIdentity = { actor: string; csrf: string };

/** Immutable read context bound to a loaded page — hide on mismatch before effects. */
type PageReadBind = {
  kind: CommentEntityKind;
  entityId: string;
  actor: string;
  csrf: string;
};

function authIdentityOf(me: Me | null): AuthIdentity {
  return { actor: me?.id ?? "guest", csrf: me?.csrfToken ?? "" };
}

function sameAuth(a: AuthIdentity, b: AuthIdentity): boolean {
  return a.actor === b.actor && a.csrf === b.csrf;
}

function pageBindMatches(bind: PageReadBind | null, kind: CommentEntityKind, entityId: string, auth: AuthIdentity): boolean {
  return Boolean(
    bind
    && bind.kind === kind
    && bind.entityId === entityId
    && bind.actor === auth.actor
    && bind.csrf === auth.csrf,
  );
}

function commentTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function textReady(value: string): boolean {
  return Boolean(value.replace(/^\s+|\s+$/gu, "").length);
}

function unicodeLen(value: string): number {
  return [...value].length;
}

export function CommentsSection({
  kind,
  entityId,
  me,
  description,
  authReturnPath,
  parentPublic,
  title = "Комментарии",
  sectionId,
  onUnresolvedChange,
}: Props) {
  const headingId = useId();
  const [authOpen, setAuthOpen] = useState(false);
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState<EntityCommentPage | null>(null);
  /** Bind loaded page to the kind/entity/actor-session that fetched it. */
  const [pageBind, setPageBind] = useState<PageReadBind | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState("");
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [expandedReplies, setExpandedReplies] = useState<Record<string, EntityComment[]>>({});
  const [replyCursors, setReplyCursors] = useState<Record<string, string | null>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EntityComment | null>(null);
  const [expandedText, setExpandedText] = useState<Record<string, boolean>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  /** Venue-community comment report only (kind=venue). Never player/review fallback. */
  const [reportSubject, setReportSubject] = useState<VenueCommunityReportSubject | null>(null);
  const [reportAuthOpen, setReportAuthOpen] = useState(false);
  /** Bumps only for guest public reactivation when host me stays null after private-expired. */
  const [guestReadEpoch, setGuestReadEpoch] = useState(0);
  const generation = useRef(0);
  /** Session/expiry fence: late GET/mutation callbacks ignored until host reactivates. */
  const sessionLive = useRef(true);
  const liveKind = useRef(kind);
  const liveEntity = useRef(entityId);
  const liveAuth = useRef(authIdentityOf(me));
  const liveGuest = useRef(me === null);
  const hostAuth = authIdentityOf(me);
  const actorKey = hostAuth.actor;
  const hostCsrf = hostAuth.csrf;
  liveKind.current = kind;
  liveEntity.current = entityId;
  liveAuth.current = hostAuth;
  liveGuest.current = me === null;
  const scope = `comments:${kind}:${entityId}:${actorKey}`;
  /** Sync hide privileged UI when entity/actor props cross a boundary (before paint). */
  const boundarySeen = useRef({ kind, entityId, actor: actorKey });
  if (
    boundarySeen.current.kind !== kind
    || boundarySeen.current.entityId !== entityId
    || boundarySeen.current.actor !== actorKey
  ) {
    boundarySeen.current = { kind, entityId, actor: actorKey };
    if (draft) setDraft("");
    if (replyDraft) setReplyDraft("");
    if (replyFor !== null) setReplyFor(null);
    if (editId !== null) setEditId(null);
    if (editDraft) setEditDraft("");
    if (deleteTarget !== null) setDeleteTarget(null);
    if (menuFor !== null) setMenuFor(null);
    if (status) setStatus("");
    if (reportSubject !== null) setReportSubject(null);
    if (reportAuthOpen) setReportAuthOpen(false);
    if (Object.keys(expandedReplies).length) setExpandedReplies({});
    if (Object.keys(replyCursors).length) setReplyCursors({});
    if (Object.keys(expandedText).length) setExpandedText({});
  }
  /** Render fence: never paint prior actor/entity page (count/body/mine) before effects. */
  const currentPage = pageBindMatches(pageBind, kind, entityId, hostAuth) && sessionLive.current
    ? page
    : null;

  function clearPrivilegedSurface() {
    setDraft("");
    setReplyDraft("");
    setReplyFor(null);
    setEditId(null);
    setEditDraft("");
    setDeleteTarget(null);
    setMenuFor(null);
    setStatus("");
    setReportSubject(null);
    setReportAuthOpen(false);
    setExpandedReplies({});
    setReplyCursors({});
    setExpandedText({});
  }

  function openVenueCommentReport(item: EntityComment) {
    if (kind !== "venue" || item.deleted || item.entityKind !== "venue") return;
    if (!Number.isInteger(item.version) || item.version < 1) return;
    if (!me?.id || !me.csrfToken) {
      setReportAuthOpen(true);
      return;
    }
    setReportSubject({
      subjectKind: "venue_comment",
      venueId: entityId,
      commentId: item.id,
      expectedVersion: item.version,
    });
  }

  function fenceSession() {
    sessionLive.current = false;
    generation.current += 1;
    clearPrivilegedSurface();
  }

  function sameContext(kindSnap: CommentEntityKind, entitySnap: string, authSnap: AuthIdentity) {
    return sessionLive.current
      && liveKind.current === kindSnap
      && liveEntity.current === entitySnap
      && sameAuth(liveAuth.current, authSnap);
  }

  /** Settlement fence: reject before useSocialMutation save(null), not only in onSuccess. */
  function settlementLive(): boolean {
    return sessionLive.current
      && liveKind.current === kind
      && liveEntity.current === entityId
      && sameAuth(liveAuth.current, hostAuth);
  }

  const reload = useCallback(async (cursor?: string | null, append = false) => {
    const current = ++generation.current;
    const kindSnap = kind;
    const entitySnap = entityId;
    const authSnap = { ...liveAuth.current };
    const bind: PageReadBind = {
      kind: kindSnap,
      entityId: entitySnap,
      actor: authSnap.actor,
      csrf: authSnap.csrf,
    };
    if (!append) {
      setState("loading");
      setPage(null);
      setPageBind(null);
    }
    const result = await listEntityComments(kindSnap, entitySnap, {
      cursor: cursor ?? undefined,
      order,
      limit: 20,
    });
    if (current !== generation.current) return;
    if (!sameContext(kindSnap, entitySnap, authSnap)) return;
    if (!result.ok) {
      if (!append) {
        setPage(null);
        setPageBind(null);
        setState("error");
      }
      return;
    }
    if (result.data.entityKind !== kindSnap || result.data.entityId !== entitySnap) {
      if (!append) {
        setPage(null);
        setPageBind(null);
        setState("error");
      }
      return;
    }
    // Accept only responses that still match the exact bound fence.
    if (!pageBindMatches(bind, liveKind.current, liveEntity.current, liveAuth.current)) return;
    if (!sessionLive.current) return;
    setPage((prev) => {
      if (!append || !prev || prev.entityId !== entitySnap) return result.data;
      return {
        ...result.data,
        items: [...prev.items, ...result.data.items],
        visibleCount: result.data.visibleCount,
      };
    });
    setPageBind(bind);
    setState("ready");
  }, [kind, entityId, order]);

  useEffect(() => {
    if (!parentPublic) {
      fenceSession();
      setPage(null);
      setPageBind(null);
      setState("loading");
      return;
    }
    // Host me/csrf, entity boundary, or guest epoch: reactivate with fresh public read (no getMe).
    sessionLive.current = true;
    liveAuth.current = { actor: actorKey, csrf: hostCsrf };
    setPage(null);
    setPageBind(null);
    clearPrivilegedSurface();
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [parentPublic, reload, actorKey, hostCsrf, guestReadEpoch]);

  useEffect(() => {
    const onExpired = () => {
      // Clear privileged UI immediately; do not GET/getMe (avoids 401 → private-expired loop).
      fenceSession();
      // Guest me=null unchanged: host deps do not change — one bounded public reactivation.
      if (liveGuest.current) {
        setGuestReadEpoch((n) => n + 1);
      }
    };
    const onSession = () => {
      fenceSession();
      // New me/csrf arrives via host props; actor+csrf effect reactivates + fresh public read.
      // Guest-only: same as private-expired when host me stays null.
      if (liveGuest.current) {
        setGuestReadEpoch((n) => n + 1);
      }
    };
    window.addEventListener("gb-private-expired", onExpired);
    window.addEventListener("gb-session-changed", onSession);
    return () => {
      window.removeEventListener("gb-private-expired", onExpired);
      window.removeEventListener("gb-session-changed", onSession);
    };
  }, []);

  const mutation = useSocialMutation<EntityComment>(
    scope,
    hostCsrf,
    (data, pending) => {
      if (!settlementLive()) return;
      if (!pending || data.entityKind !== kind || data.entityId !== entityId) return;
      setStatus("Комментарий сохранён.");
      if (pending.method === "POST" && !(pending.body as { parentCommentId?: string }).parentCommentId) {
        setDraft("");
      }
      if (pending.method === "POST" && (pending.body as { parentCommentId?: string }).parentCommentId) {
        setReplyDraft("");
        setReplyFor(null);
      }
      if (pending.method === "PUT") {
        setEditId(null);
        setEditDraft("");
      }
      if (pending.method === "DELETE") {
        setDeleteTarget(null);
        document.getElementById(headingId)?.focus();
      }
      void reload();
      if (data.parentCommentId) void loadReplies(data.parentCommentId, true);
    },
    () => {
      if (!settlementLive()) return;
      void reload();
    },
    Boolean(me),
    {
      holdCorruptStorage: true,
      validatePending: (pending) => {
        const pathOk = pending.path === createEntityCommentPath(kind, entityId)
          || /^\/v1\/comments\/[0-9a-f-]{36}$/i.test(pending.path);
        if (!pathOk) return false;
        if (pending.method === "POST") {
          const body = pending.body as { text?: unknown; parentCommentId?: unknown };
          return typeof body.text === "string"
            && (body.parentCommentId == null || typeof body.parentCommentId === "string");
        }
        if (pending.method === "PUT") {
          const body = pending.body as { text?: unknown; expectedVersion?: unknown };
          return typeof body.text === "string" && typeof body.expectedVersion === "number";
        }
        if (pending.method === "DELETE") {
          return typeof (pending.body as { expectedVersion?: unknown }).expectedVersion === "number";
        }
        return false;
      },
      validateSuccess: (data, pending) => {
        // Reject stale/expired/local context BEFORE shared-hook settlement (save null).
        if (!settlementLive()) return false;
        if (!pending || !isCommentView(data)) return false;
        if (data.entityKind !== kind || data.entityId !== entityId) return false;
        if (pending.method === "POST") {
          const body = pending.body as { text: string; parentCommentId?: string | null };
          if (data.deleted || data.body !== body.text) return false;
          if ((body.parentCommentId ?? null) !== (data.parentCommentId ?? null)) return false;
          return data.mine === true;
        }
        if (pending.method === "PUT") {
          const body = pending.body as { text: string; expectedVersion: number };
          // Bind to exact pending.path comment id — unrelated same version/body rejected.
          if (pending.path !== updateEntityCommentPath(data.id)) return false;
          return !data.deleted && data.body === body.text && data.version === body.expectedVersion + 1 && data.mine;
        }
        if (pending.method === "DELETE") {
          const body = pending.body as { expectedVersion: number };
          if (pending.path !== deleteEntityCommentPath(data.id)) return false;
          return data.deleted && data.body === null && data.version === body.expectedVersion + 1 && data.mine;
        }
        return false;
      },
    },
  );

  useEffect(() => { onUnresolvedChange?.(Boolean(mutation.busy || mutation.pending)); }, [mutation.busy, mutation.pending, onUnresolvedChange]);

  async function loadReplies(parentId: string, reset = false) {
    const current = generation.current;
    const kindSnap = kind;
    const entitySnap = entityId;
    const authSnap = { ...liveAuth.current };
    const cursor = reset ? undefined : replyCursors[parentId] ?? undefined;
    const result = await listEntityComments(kindSnap, entitySnap, {
      parentCommentId: parentId,
      cursor,
      order: "asc",
      limit: 20,
    });
    if (current !== generation.current) return;
    if (!sameContext(kindSnap, entitySnap, authSnap)) return;
    if (!result.ok || result.data.entityId !== entitySnap) return;
    setExpandedReplies((prev) => ({
      ...prev,
      [parentId]: reset
        ? result.data.items
        : [...(prev[parentId] ?? []), ...result.data.items],
    }));
    setReplyCursors((prev) => ({ ...prev, [parentId]: result.data.nextCursor }));
  }

  function admitMutation(
    path: string,
    body: object,
    method: "POST" | "PUT" | "DELETE" = "POST",
  ): boolean {
    if (!sessionLive.current || !me) return false;
    // Bound page write capability gates create/edit/delete alike (server 403 otherwise).
    if (!currentPage?.canCreate) return false;
    return mutation.run(path, body, method);
  }

  /** User retry: reactivate guest public fence without getMe / mutation replay. */
  function retryPublicRead() {
    if (!sessionLive.current && liveGuest.current) {
      sessionLive.current = true;
      liveAuth.current = { actor: "guest", csrf: "" };
    }
    void reload();
  }

  if (!parentPublic) return null;

  const locked = mutation.busy || mutation.pending;
  const pageReady = Boolean(currentPage) && state === "ready";
  const count = currentPage?.visibleCount;
  const canCreate = Boolean(currentPage?.canCreate);
  /** Prefer moderation field/retry hints; drafts clear only on validated success. */
  const moderationNotice = publicCommentModerationNotice({ code: mutation.code });
  const mutationNotice = {
    notice: moderationNotice ?? mutation.notice,
    pending: mutation.pending,
    busy: mutation.busy,
    retry: mutation.retry,
  };
  /** Drop stale own edit/delete chrome when bound write capability is revoked. */
  if (currentPage && !canCreate) {
    if (editId !== null) setEditId(null);
    if (editDraft) setEditDraft("");
    if (deleteTarget !== null) setDeleteTarget(null);
  }

  return (
    <section
      className="gb-comments"
      id={sectionId}
      aria-labelledby={headingId}
      data-entity-kind={kind}
    >
      <header className="gb-comments__header">
        <div className="gb-comments__title-row">
          <h2 id={headingId} tabIndex={-1}>{title}</h2>
          {typeof count === "number" && pageReady ? (
            <span className="gb-comments__count" aria-label={`${count} комментариев`}>{count}</span>
          ) : null}
          <label className="gb-comments__order">
            <span className="gb-sr-only">Порядок</span>
            <select
              value={order}
              disabled={state === "loading" || locked}
              onChange={(e) => setOrder(e.target.value === "desc" ? "desc" : "asc")}
            >
              <option value="asc">Сначала старые</option>
              <option value="desc">Сначала новые</option>
            </select>
          </label>
        </div>
        <p className="gb-comments__description">{description}</p>
      </header>

      {!me ? (
        <div className="gb-comments__auth" role="note">
          <p>Войдите, чтобы оставить комментарий. Чтение доступно без входа.</p>
          <Button variant="outline" onClick={() => setAuthOpen(true)}>Войти</Button>
        </div>
      ) : pageReady && canCreate ? (
        <form
          className="gb-comments__composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (!textReady(draft) || locked) return;
            const text = draft.replace(/^\s+|\s+$/gu, "");
            if (unicodeLen(text) > TEXT_MAX) return;
            admitMutation(createEntityCommentPath(kind, entityId), { text, parentCommentId: null });
          }}
        >
          <Avatar name={me.displayName || "Вы"} tone="lime" className="avatar avatar--lime gb-comments__avatar" />
          <label className="gb-comments__field">
            <span>Ваш комментарий</span>
            <textarea
              rows={3}
              maxLength={TEXT_MAX}
              value={draft}
              disabled={locked}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ваш комментарий"
            />
          </label>
          <Button type="submit" disabled={locked || !textReady(draft)} loading={mutation.busy && !mutation.pending}>
            Отправить
          </Button>
        </form>
      ) : pageReady && me ? (
        <div className="gb-comments__auth" role="note">
          <p>Чтение доступно. Отправка комментариев сейчас недоступна.</p>
        </div>
      ) : null}

      <MutationNotice mutation={mutationNotice} />
      {status ? <p className="gb-comments__status" role="status">{status}</p> : null}

      {state === "loading" && !currentPage ? <p className="gb-comments__feedback" role="status">Загружаем комментарии…</p> : null}
      {state === "error" ? (
        <div className="gb-comments__feedback" role="alert">
          <p>Не удалось загрузить комментарии.</p>
          <Button variant="outline" onClick={() => retryPublicRead()}>Попробовать снова</Button>
        </div>
      ) : null}
      {pageReady && currentPage && currentPage.items.length === 0 ? (
        <p className="gb-comments__empty" role="status">Пока нет комментариев. Начните разговор.</p>
      ) : null}

      {currentPage && currentPage.items.length > 0 ? (
        <ul className="gb-comments__list">
          {currentPage.items.map((item) => (
            <li key={item.id} className="gb-comments__item">
              <CommentArticle
                item={item}
                entityKind={kind}
                expanded={Boolean(expandedText[item.id])}
                onExpand={() => setExpandedText((prev) => ({ ...prev, [item.id]: true }))}
                menuOpen={menuFor === item.id}
                onMenu={() => setMenuFor((cur) => (cur === item.id ? null : item.id))}
                onCloseMenu={() => setMenuFor(null)}
                me={me}
                canCreate={canCreate}
                locked={locked}
                editing={editId === item.id}
                editDraft={editDraft}
                onEditDraft={setEditDraft}
                onStartEdit={() => {
                  setEditId(item.id);
                  setEditDraft(item.body ?? "");
                  setMenuFor(null);
                }}
                onCancelEdit={() => { setEditId(null); setEditDraft(""); }}
                onSaveEdit={() => {
                  if (!canCreate || !item.mine || !textReady(editDraft) || locked) return;
                  const text = editDraft.replace(/^\s+|\s+$/gu, "");
                  admitMutation(updateEntityCommentPath(item.id), {
                    text,
                    expectedVersion: item.version,
                  }, "PUT");
                }}
                onDelete={() => {
                  if (!canCreate || !item.mine) return;
                  setDeleteTarget(item);
                  setMenuFor(null);
                }}
                onReportVenueComment={() => openVenueCommentReport(item)}
                replyOpen={replyFor === item.id}
                replyDraft={replyDraft}
                onReplyDraft={setReplyDraft}
                onToggleReply={() => {
                  setReplyFor((cur) => (cur === item.id ? null : item.id));
                  setReplyDraft("");
                  if (!expandedReplies[item.id] && item.replyCount > 0) void loadReplies(item.id, true);
                }}
                onSubmitReply={() => {
                  if (!canCreate || !textReady(replyDraft) || locked) return;
                  const text = replyDraft.replace(/^\s+|\s+$/gu, "");
                  admitMutation(createEntityCommentPath(kind, entityId), {
                    text,
                    parentCommentId: item.id,
                  });
                }}
                replies={expandedReplies[item.id]}
                replyCursor={replyCursors[item.id]}
                onShowReplies={() => void loadReplies(item.id, !expandedReplies[item.id])}
                onMoreReplies={() => void loadReplies(item.id, false)}
                expandedTextMap={expandedText}
                onExpandText={(id) => setExpandedText((prev) => ({ ...prev, [id]: true }))}
                onReportVenueReply={(reply) => openVenueCommentReport(reply)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {currentPage?.nextCursor ? (
        <Button
          variant="outline"
          className="gb-comments__more"
          disabled={state === "loading" || locked}
          onClick={() => void reload(currentPage.nextCursor, true)}
        >
          Показать ещё
        </Button>
      ) : null}

      {deleteTarget && canCreate ? (
        <ProfileDialog
          title="Удалить комментарий?"
          onClose={() => { if (!mutation.busy) setDeleteTarget(null); }}
        >
          <p>Текст комментария будет скрыт. Ответы в ветке сохранятся.</p>
          <div className="gb-comments__dialog-actions">
            <Button
              variant="outline"
              autoFocus
              disabled={mutation.busy}
              onClick={() => setDeleteTarget(null)}
            >
              Отмена
            </Button>
            <Button
              variant="dark"
              disabled={mutation.busy || mutation.pending}
              onClick={() => {
                admitMutation(deleteEntityCommentPath(deleteTarget.id), {
                  expectedVersion: deleteTarget.version,
                }, "DELETE");
              }}
            >
              Удалить
            </Button>
          </div>
        </ProfileDialog>
      ) : null}

      {authOpen ? (
        <AuthChooser returnPath={authReturnPath} onClose={() => setAuthOpen(false)} />
      ) : null}

      {reportAuthOpen ? (
        <AuthChooser returnPath={authReturnPath} onClose={() => setReportAuthOpen(false)} />
      ) : null}

      {reportSubject && kind === "venue" ? (
        <VenueCommunityReportDialog
          subject={reportSubject}
          actorId={me?.id ?? null}
          csrfToken={me?.csrfToken ?? null}
          authReturnPath={authReturnPath}
          onClose={() => setReportSubject(null)}
        />
      ) : null}
    </section>
  );
}

function CommentArticle({
  item,
  entityKind,
  expanded,
  onExpand,
  menuOpen,
  onMenu,
  onCloseMenu,
  me,
  canCreate,
  locked,
  editing,
  editDraft,
  onEditDraft,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReportVenueComment,
  replyOpen,
  replyDraft,
  onReplyDraft,
  onToggleReply,
  onSubmitReply,
  replies,
  replyCursor,
  onShowReplies,
  onMoreReplies,
  expandedTextMap,
  onExpandText,
  onReportVenueReply,
}: {
  item: EntityComment;
  entityKind: CommentEntityKind;
  expanded: boolean;
  onExpand: () => void;
  menuOpen: boolean;
  onMenu: () => void;
  onCloseMenu: () => void;
  me: Me | null;
  canCreate: boolean;
  locked: boolean;
  editing: boolean;
  editDraft: string;
  onEditDraft: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onReportVenueComment: () => void;
  replyOpen: boolean;
  replyDraft: string;
  onReplyDraft: (value: string) => void;
  onToggleReply: () => void;
  onSubmitReply: () => void;
  replies?: EntityComment[];
  replyCursor?: string | null;
  onShowReplies: () => void;
  onMoreReplies: () => void;
  expandedTextMap: Record<string, boolean>;
  onExpandText: (id: string) => void;
  onReportVenueReply: (reply: EntityComment) => void;
}) {
  const author = item.author ?? { displayName: "Игрок", publicPlayerId: null, avatar: { uploadedUrl: null, providerUrl: null }, profilePublic: false };
  const canWriteOwn = Boolean(item.mine && canCreate);
  // Server `mine` is the only own-authority signal — never invent publicId fallback or self-safety.
  const canAuthorSafety = Boolean(
    me && !item.mine && author.profilePublic && author.publicPlayerId,
  );
  /** Venue discussion report only — never game comments or private peer-review paths. */
  const canVenueCommunityReport = entityKind === "venue"
    && !item.deleted
    && Number.isInteger(item.version)
    && item.version >= 1;
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (!menuRef.current?.contains(event.target as Node)) onCloseMenu();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        event.preventDefault(); onCloseMenu();
        menuRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen, onCloseMenu]);

  return (
    <article className={`gb-comment${item.deleted ? " is-deleted" : ""}`}>
      {item.deleted ? (
        <p className="gb-comment__tombstone">Комментарий удалён</p>
      ) : (
        <>
          <header className="gb-comment__meta">
            <Avatar
              name={author.displayName}
              avatar={author.avatar}
              tone="yellow"
              className="avatar avatar--yellow gb-comments__avatar"
            />
            <div className="gb-comment__identity">
              {author.profilePublic && author.publicPlayerId ? (
                <Link href={`/players/${encodeURIComponent(author.publicPlayerId)}`}>{author.displayName}</Link>
              ) : (
                <strong>{author.displayName}</strong>
              )}
              <time dateTime={item.createdAt}>{commentTime(item.createdAt)}{item.edited ? " · изменён" : ""}</time>
            </div>
            {canWriteOwn || canAuthorSafety || canVenueCommunityReport ? (
              <div className="gb-comment__menu" ref={menuRef}>
                <button
                  type="button"
                  className="gb-comment__menu-trigger"
                  aria-label="Действия с комментарием"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  onClick={onMenu}
                >
                  ⋯
                </button>
                {menuOpen ? (
                  <div className="gb-comment__menu-panel" role="menu">
                    {canWriteOwn ? (
                      <>
                        <button type="button" role="menuitem" disabled={locked} onClick={onStartEdit}>Изменить</button>
                        <button type="button" role="menuitem" className="danger" disabled={locked} onClick={onDelete}>Удалить</button>
                      </>
                    ) : null}
                    {canVenueCommunityReport ? (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={locked}
                        data-testid="venue-community-report-comment"
                        onClick={() => {
                          onReportVenueComment();
                        }}
                      >
                        Пожаловаться
                      </button>
                    ) : null}
                    {canAuthorSafety && me && author.publicPlayerId ? (
                      <div className="gb-comment__safety" role="none">
                        <p>Действие в отношении автора, не отдельная жалоба на комментарий.</p>
                        <ConversationSafety
                          playerId={author.publicPlayerId}
                          me={me}
                          onBlocked={onCloseMenu}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </header>

          {editing && canCreate ? (
            <form
              className="gb-comments__composer gb-comments__composer--inline"
              onSubmit={(e) => { e.preventDefault(); onSaveEdit(); }}
            >
              <label className="gb-comments__field">
                <span>Редактирование</span>
                <textarea
                  rows={3}
                  maxLength={TEXT_MAX}
                  value={editDraft}
                  disabled={locked}
                  onChange={(e) => onEditDraft(e.target.value)}
                />
              </label>
              <div className="gb-comments__dialog-actions">
                <Button type="button" variant="outline" disabled={locked} onClick={onCancelEdit}>Отмена</Button>
                <Button type="submit" disabled={locked || !textReady(editDraft)}>Сохранить</Button>
              </div>
            </form>
          ) : (
            <CommentBody text={item.body ?? ""} expanded={expanded} onExpand={onExpand} />
          )}

          {me && canCreate ? (
            <div className="gb-comment__actions">
              <button type="button" className="gb-comment__reply-toggle" onClick={onToggleReply} disabled={locked}>
                Ответить
              </button>
            </div>
          ) : null}
        </>
      )}

      {item.replyCount > 0 ? (
        <button
          type="button"
          className="gb-comment__thread-toggle"
          aria-expanded={Boolean(replies)}
          onClick={onShowReplies}
        >
          {replies ? "Скрыть ответы" : `Показать ответы · ${item.replyCount}`}
        </button>
      ) : null}

      {replies ? (
        <ul className="gb-comment__replies">
          {replies.map((reply) => (
            <li key={reply.id}>
              <article className={`gb-comment gb-comment--reply${reply.deleted ? " is-deleted" : ""}`}>
                {reply.deleted ? (
                  <p className="gb-comment__tombstone">Комментарий удалён</p>
                ) : (
                  <>
                    <header className="gb-comment__meta">
                      <Avatar
                        name={reply.author?.displayName ?? "Игрок"}
                        avatar={reply.author?.avatar}
                        tone="yellow"
                        className="avatar avatar--yellow gb-comment__reply-avatar"
                      />
                      <div className="gb-comment__identity">
                        {reply.author?.profilePublic && reply.author.publicPlayerId ? (
                          <Link href={`/players/${encodeURIComponent(reply.author.publicPlayerId)}`}>
                            {reply.author.displayName}
                          </Link>
                        ) : (
                          <strong>{reply.author?.displayName ?? "Игрок"}</strong>
                        )}
                        <time dateTime={reply.createdAt}>{commentTime(reply.createdAt)}</time>
                      </div>
                      {entityKind === "venue"
                        && !reply.deleted
                        && Number.isInteger(reply.version)
                        && reply.version >= 1 ? (
                          <button
                            type="button"
                            className="gb-textbutton"
                            data-testid="venue-community-report-reply"
                            onClick={() => onReportVenueReply(reply)}
                          >
                            Пожаловаться
                          </button>
                        ) : null}
                    </header>
                    <CommentBody
                      text={reply.body ?? ""}
                      expanded={Boolean(expandedTextMap[reply.id])}
                      onExpand={() => onExpandText(reply.id)}
                    />
                  </>
                )}
              </article>
            </li>
          ))}
        </ul>
      ) : null}

      {replies && replyCursor ? (
        <Button variant="outline" onClick={onMoreReplies}>Ещё ответы</Button>
      ) : null}

      {replyOpen && me && canCreate ? (
        <form
          className="gb-comments__composer gb-comments__composer--reply"
          onSubmit={(e) => { e.preventDefault(); onSubmitReply(); }}
        >
          <label className="gb-comments__field">
            <span>Ответ</span>
            <textarea
              rows={2}
              maxLength={TEXT_MAX}
              value={replyDraft}
              disabled={locked}
              onChange={(e) => onReplyDraft(e.target.value)}
              placeholder="Ваш ответ"
            />
          </label>
          <Button type="submit" disabled={locked || !textReady(replyDraft)}>Ответить</Button>
        </form>
      ) : null}
    </article>
  );
}

function CommentBody({ text, expanded, onExpand }: { text: string; expanded: boolean; onExpand: () => void }) {
  // Four-line clamp only with explicit expand — HTML always rendered as text via React.
  const long = text.length > 220 || text.split("\n").length > COLLAPSE_LINES;
  return (
    <div className="gb-comment__body">
      <p className={long && !expanded ? "gb-comment__text is-clamped" : "gb-comment__text"}>{text}</p>
      {long && !expanded ? (
        <button type="button" className="gb-comment__expand" onClick={onExpand}>Читать полностью</button>
      ) : null}
    </div>
  );
}
