import { useEffect, useRef, useState } from "react";
import type { FriendshipView, SocialCapabilities } from "@gobadminton/contracts/friendship-types";
import type { Game } from "./consumer-types";
import { apiFetch } from "./api-client";
import { socialError } from "./messaging-presentation";

/** Wire types from accepted FR-3A OpenAPI / GamesService.recommendationSummary — not guessed. */
export type GameRecommendationGame = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

export type GameRecommendationPeer = {
  publicPlayerId: string;
  displayName: string;
};

export type GameRecommendation = {
  id: string;
  version: number;
  state: "active" | "withdrawn";
  createdAt: string;
  expiresAt: string;
  game: GameRecommendationGame;
  peer: GameRecommendationPeer;
};

export type GameRecommendationList = {
  items: GameRecommendation[];
  nextCursor: string | null;
  asOf: string;
};

export type GameRecommendationReceipt = {
  id: string;
  version: number;
  outcome: "sent" | "hidden" | "withdrawn";
};

export type GameRecommendationView = "received" | "sent";

export type RecommendableFriend = {
  friendshipId: string;
  publicPlayerId: string;
  displayName: string;
};

/** In-memory only — never sessionStorage/localStorage; no personal ids in browser storage. */
export type RecommendationPendingOp = {
  path: string;
  body: object;
  key: string;
  method: string;
  actorId: string;
};

const pendingByScope = new Map<string, RecommendationPendingOp>();
const listenersByScope = new Map<string, Set<() => void>>();
const ownersByScope = new Map<string, { actorId: string; token: number }>();
const inflightScopes = new Set<string>();
let ownerSeq = 0;

function notifyRecommendationPending(scope: string) {
  listenersByScope.get(scope)?.forEach((fn) => fn());
}

export function recommendationMutationScope(actorId: string, task: string): string {
  return `${actorId}:${task}`;
}

export function readRecommendationPending(scope: string, actorId: string): RecommendationPendingOp | null {
  const pending = pendingByScope.get(scope);
  return pending && pending.actorId === actorId ? pending : null;
}

export function writeRecommendationPending(scope: string, value: RecommendationPendingOp | null) {
  if (value) pendingByScope.set(scope, value);
  else pendingByScope.delete(scope);
  notifyRecommendationPending(scope);
}

export function subscribeRecommendationPending(scope: string, listener: () => void): () => void {
  let set = listenersByScope.get(scope);
  if (!set) {
    set = new Set();
    listenersByScope.set(scope, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listenersByScope.delete(scope);
  };
}

export function claimRecommendationMutationOwner(scope: string, actorId: string): number {
  const token = ++ownerSeq;
  ownersByScope.set(scope, { actorId, token });
  return token;
}

/** Drop callback ownership; unresolved UNKNOWN ops stay in the module Map. */
export function invalidateRecommendationMutationOwner(scope: string) {
  const current = ownersByScope.get(scope);
  if (current) ownersByScope.set(scope, { actorId: current.actorId, token: ++ownerSeq });
}

export function recommendationMutationOwnerActive(scope: string, actorId: string, token: number): boolean {
  const current = ownersByScope.get(scope);
  return Boolean(current && current.actorId === actorId && current.token === token);
}

/** Test/harness reset only — not for product UI. */
export function resetRecommendationPendingForTests() {
  pendingByScope.clear();
  listenersByScope.clear();
  ownersByScope.clear();
  inflightScopes.clear();
  ownerSeq = 0;
}

/**
 * Recommendation writes: same path/body/key across remount; explicit same-key retry;
 * late success after ownership loss does not publish into a new actor/view/game.
 */
export function useGameRecommendationMutation<T>(
  scope: string,
  actorId: string,
  csrf: string,
  onSuccess: (data: T) => void,
  onRefresh: () => void,
) {
  const [pending, setPending] = useState<RecommendationPendingOp | null>(() => readRecommendationPending(scope, actorId));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(() => (readRecommendationPending(scope, actorId) ? "Предыдущая отправка не подтверждена. Проверьте её результат." : ""));
  const [code, setCode] = useState("");
  const lock = useRef(false);
  const live = useRef(true);
  const ownerToken = useRef(0);
  const csrfRef = useRef(csrf);
  const onSuccessRef = useRef(onSuccess);
  const onRefreshRef = useRef(onRefresh);
  csrfRef.current = csrf;
  onSuccessRef.current = onSuccess;
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    live.current = true;
    ownerToken.current = claimRecommendationMutationOwner(scope, actorId);
    const sync = () => {
      const saved = readRecommendationPending(scope, actorId);
      setPending(saved);
      if (saved && !lock.current) {
        setNotice((prev) => prev || "Предыдущая отправка не подтверждена. Проверьте её результат.");
      }
      if (!saved && !lock.current) {
        setNotice((prev) => (prev.startsWith("Предыдущая") ? "" : prev));
      }
    };
    sync();
    const unsubscribe = subscribeRecommendationPending(scope, sync);
    const dropOwnership = () => {
      invalidateRecommendationMutationOwner(scope);
      ownerToken.current = 0;
    };
    window.addEventListener("gb-private-expired", dropOwnership);
    window.addEventListener("gb-session-changed", dropOwnership);
    return () => {
      live.current = false;
      unsubscribe();
      invalidateRecommendationMutationOwner(scope);
      window.removeEventListener("gb-private-expired", dropOwnership);
      window.removeEventListener("gb-session-changed", dropOwnership);
    };
  }, [scope, actorId]);

  async function perform(value: RecommendationPendingOp) {
    if (lock.current || inflightScopes.has(scope)) return;
    lock.current = true;
    inflightScopes.add(scope);
    setBusy(true);
    setNotice("");
    setCode("");
    writeRecommendationPending(scope, value);
    setPending(value);
    const token = ownerToken.current;
    try {
      const result = await apiFetch<T>(value.path, {
        method: value.method,
        body: JSON.stringify(value.body),
        csrfToken: csrfRef.current,
        headers: { "Idempotency-Key": value.key },
      });
      const owns = recommendationMutationOwnerActive(scope, actorId, token);
      if (result.ok) {
        writeRecommendationPending(scope, null);
        if (owns && live.current) {
          setPending(null);
          onSuccessRef.current(result.data);
        }
        return;
      }
      const unknown = result.status === 0 || result.status >= 500;
      if (!unknown) writeRecommendationPending(scope, null);
      if (owns && live.current) {
        setNotice(socialError(result));
        setCode(result.problem?.code ?? String(result.status));
        if (!unknown) {
          setPending(null);
          onRefreshRef.current();
        }
      }
    } finally {
      inflightScopes.delete(scope);
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }

  return {
    busy,
    pending: !!pending,
    pendingPath: pending?.path,
    notice,
    code,
    setNotice,
    run(path: string, body: object, method = "POST") {
      if (pending || lock.current || inflightScopes.has(scope)) return;
      const key = crypto.randomUUID();
      void perform({ path, body, method, key, actorId });
    },
    retry() {
      if (lock.current || inflightScopes.has(scope)) return;
      const saved = readRecommendationPending(scope, actorId) ?? pending;
      if (saved && saved.actorId === actorId) void perform(saved);
    },
  };
}

/** Product UI stays off while server keeps gameRecommendations:false (FR-3A). Do not override. */
export function recommendationsUiEnabled(capabilities: SocialCapabilities | null | undefined): boolean {
  return Boolean(capabilities?.gameRecommendations);
}

/**
 * Detail eligibility aligned with recommendationSummary: published public upcoming.
 * Full / deadline-closed games remain recommendable; cancelled/past/private are not.
 */
export function isRecommendableGame(game: Pick<Game, "status" | "visibility" | "startsAt">, now = Date.now()): boolean {
  if (game.status !== "published" || game.visibility !== "public") return false;
  const starts = Date.parse(game.startsAt);
  return Number.isFinite(starts) && starts > now;
}

/** Accepted friends with a server friendship id and visible peer only. */
export function recommendableFriends(items: FriendshipView[]): RecommendableFriend[] {
  const out: RecommendableFriend[] = [];
  for (const view of items) {
    if (view.relationship !== "friends" || !view.friendshipId || !view.peer) continue;
    out.push({
      friendshipId: view.friendshipId,
      publicPlayerId: view.peer.publicPlayerId,
      displayName: view.peer.displayName,
    });
  }
  return out;
}

export function listGameRecommendations(view: GameRecommendationView, cursor: string | null = null, limit = 20) {
  const query = new URLSearchParams({ view, limit: String(Math.min(20, Math.max(1, limit))) });
  if (cursor) query.set("cursor", cursor);
  return apiFetch<GameRecommendationList>(`/v1/me/game-recommendations?${query}`);
}

export function sendGameRecommendationPath(gameId: string) {
  return `/v1/games/${encodeURIComponent(gameId)}/recommendations`;
}

export function hideGameRecommendationPath(id: string) {
  return `/v1/me/game-recommendations/${encodeURIComponent(id)}/hide`;
}

export function withdrawGameRecommendationPath(id: string) {
  return `/v1/me/game-recommendations/${encodeURIComponent(id)}/withdraw`;
}

export function formatRecommendationWhen(game: GameRecommendationGame, locale = "ru-RU"): string {
  const start = new Date(game.startsAt);
  return new Intl.DateTimeFormat(locale, {
    timeZone: game.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(start);
}
