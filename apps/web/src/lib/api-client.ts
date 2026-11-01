import type { GamePreferences, PatchGamePreferences } from "@gobadminton/contracts/game-types";
import type { DeleteCoverCommand } from "@gobadminton/contracts";
import { foregroundUpdates } from "./foreground-updates";
import { privateViews } from "./private-view";
import type {
  AbuseReportReceipt,
  AttendanceDispute,
  AttendanceHistoryPage,
  AttendanceRecord,
  AttendanceValue,
  BlockReceipt,
  City,
  CreateAbuseReportInput,
  CreateGameInput,
  CreateVenueInput,
  Game,
  GamePage,
  GameResults,
  LookingForGamePutInput,
  LookingIntent,
  LinkedProvidersResponse,
  ManagedGame,
  ManagedGamePage,
  Me,
  MeGameResultsPage,
  OwnSocialProfile,
  Participation,
  ParticipationPage,
  PatchSocialProfileInput,
  Problem,
  PlayerAvatar,
  PublicPlayer,
  PublicPlayerPage,
  RevokeOtherSessionsResponse,
  SessionsResponse,
  SocialProfileVisibilityInput,
  TrainerProfile,
  Venue,
  VenueSummary,
} from "./consumer-types";
import { resolveApiBaseUrl } from "./api";
import { avatarAbortable } from "./avatar-preprocess";

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number; problem?: Problem; retryAfterSeconds?: number };

function browserBase(): string {
  if (typeof window !== "undefined") {
    // Same-origin /v1 via Moscow nginx (prod) or Next rewrite (local).
    return "";
  }
  return resolveApiBaseUrl();
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "") + "gb";
  }
  return `gb${Date.now()}${Math.random().toString(16).slice(2)}xxxxxx`.slice(0, 24);
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { csrfToken?: string; idempotent?: boolean } = {},
): Promise<ApiResult<T>> {
  const { csrfToken, idempotent = false, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  headers.set("Accept", "application/json");
  if (rest.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  if (idempotent || (rest.method && rest.method !== "GET" && rest.method !== "HEAD")) {
    headers.set("Idempotency-Key", headers.get("Idempotency-Key") ?? newIdempotencyKey());
  }

  const hadPrivateSession = foregroundUpdates.hasSession;
  const privateGeneration = foregroundUpdates.currentGeneration;
  const viewGeneration = privateViews.currentGeneration;
  // Public reads and auth-provider failures do not establish session expiry.
  const privateRequest = path === "/v1/me" || path.startsWith("/v1/me/") ||
    (!!csrfToken && !path.startsWith("/v1/auth/"));
  try {
    const response = await fetch(`${browserBase()}${path}`, {
      ...rest,
      headers,
      credentials: "include",
      cache: "no-store",
    });
    const body = await parseBody(response);
    if (!response.ok) {
      if (response.status === 401 && privateRequest &&
          (hadPrivateSession || privateViews.hasView(viewGeneration)) &&
          !rest.signal?.aborted && privateGeneration === foregroundUpdates.currentGeneration &&
          viewGeneration === privateViews.currentGeneration && typeof window !== "undefined") {
        foregroundUpdates.clear(); window.dispatchEvent(new Event("gb-private-expired"));
      }
      const problem =
        body && typeof body === "object" && "code" in body
          ? (body as Problem)
          : undefined;
      return {
        ok: false,
        status: response.status,
        error: problem?.title ?? `HTTP ${response.status}`,
        problem,
        retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
      };
    }
    return { ok: true, status: response.status, data: body as T };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Network request failed",
    };
  }
}

export function listCities() {
  return apiFetch<{ items: City[] }>("/v1/cities");
}

export function listGames(query: {
  cityId?: string;
  startsFrom?: string;
  startsBefore?: string;
  activityKind?: "regular" | "trainer_led";
  cursor?: string;
  limit?: number;
}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (query.cityId) params.set("cityId", query.cityId);
  if (query.startsFrom) params.set("startsFrom", query.startsFrom);
  if (query.startsBefore) params.set("startsBefore", query.startsBefore);
  if (query.activityKind) params.set("activityKind", query.activityKind);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return apiFetch<GamePage>(`/v1/games${qs ? `?${qs}` : ""}`, { signal });
}

export type VenueCatalogPage = {
  items: VenueSummary[];
  nextCursor: string | null;
};

/** Read catalog entries, not just venues referenced by currently active games. */
export function listVenueCatalogPage(cityId: string, cursor?: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ cityId, limit: "50" });
  if (cursor) params.set("cursor", cursor);
  return apiFetch<VenueCatalogPage>(`/v1/venues?${params.toString()}`, { signal });
}

/** Fetch every city page; never silently return a partially loaded catalog. */
export async function listAllCityVenues(cityId: string, signal?: AbortSignal): Promise<ApiResult<VenueSummary[]>> {
  const items = new Map<string, VenueSummary>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await listVenueCatalogPage(cityId, cursor, signal);
    if (signal?.aborted) return { ok: false, status: 0, error: "Загрузка отменена." };
    if (!result.ok) return result;
    for (const venue of result.data.items) {
      if (venue.cityId === cityId) items.set(venue.id, venue);
    }
    const next = result.data.nextCursor;
    if (!next) return { ok: true, status: 200, data: [...items.values()] };
    if (cursors.has(next)) return { ok: false, status: 0, error: "Каталог площадок вернул повторяющуюся страницу." };
    cursors.add(next);
    cursor = next;
  }
  return { ok: false, status: 0, error: "Не удалось загрузить полный каталог площадок." };
}

/** Bounded complete snapshot; never present partial pagination as an exact count. */
export async function listAllUpcomingCityGames(cityId: string, signal?: AbortSignal): Promise<ApiResult<Game[]>> {
  const games = new Map<string, Game>();
  const cursors = new Set<string>();
  const startsFrom = new Date().toISOString();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await listGames({ cityId, startsFrom, cursor, limit: 50 }, signal);
    if (signal?.aborted) return { ok: false, status: 0, error: "Загрузка отменена." };
    if (!result.ok) return result;
    for (const game of result.data.items) if (game.venue.cityId === cityId) games.set(game.id, game);
    const next = result.data.nextCursor;
    if (!next) return { ok: true, status: 200, data: [...games.values()] };
    if (cursors.has(next)) return { ok: false, status: 0, error: "Повтор страницы расписания." };
    cursors.add(next); cursor = next;
  }
  return { ok: false, status: 0, error: "Полное расписание недоступно. Уточните город." };
}

export function getGame(gameId: string) {
  return apiFetch<Game>(`/v1/games/${gameId}`);
}

export function createGame(input: CreateGameInput, csrfToken: string) {
  return apiFetch<Game>("/v1/games", {
    method: "POST",
    body: JSON.stringify(input),
    csrfToken,
    idempotent: true,
  });
}

export function publishGame(gameId: string, expectedVersion: number, csrfToken: string) {
  return apiFetch<Game>(`/v1/games/${gameId}/publish`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
    csrfToken,
    idempotent: true,
  });
}

export function createVenue(input: CreateVenueInput, csrfToken: string) {
  return apiFetch<Venue>("/v1/venues", {
    method: "POST",
    body: JSON.stringify(input),
    csrfToken,
    idempotent: true,
  });
}

export function getMe() {
  return apiFetch<Me>("/v1/me");
}

export function listMyParticipations(cursor?: string) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<ParticipationPage>(`/v1/me/participations${qs}`);
}

/** Read every page before allowing participation-affecting actions. */
export async function listAllMyParticipations(): Promise<ApiResult<Participation[]>> {
  const items: Participation[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listMyParticipations(cursor);
    if (!page.ok) return page;
    items.push(...page.data.items);
    if (!page.data.nextCursor) return { ok: true, status: page.status, data: items };
    cursor = page.data.nextCursor;
  }
}

export function listMyManagedGames(query: { cursor?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return apiFetch<ManagedGamePage>(`/v1/me/games${qs ? `?${qs}` : ""}`);
}

/** Collect all authoritative managed Games across cursor pages (owner + manager). */
export async function listAllMyManagedGames(): Promise<
  ApiResult<ManagedGame[]>
> {
  const items: ManagedGame[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listMyManagedGames({ cursor, limit: 50 });
    if (!page.ok) return page;
    items.push(...page.data.items);
    if (!page.data.nextCursor) {
      return { ok: true, status: page.status, data: items };
    }
    cursor = page.data.nextCursor;
  }
}

/** Collect authoritative created-by-me Games across cursor pages. */
export async function listMyCreatedGames(): Promise<
  ApiResult<ManagedGame[]>
> {
  const managed = await listAllMyManagedGames();
  if (!managed.ok) return managed;
  return {
    ok: true,
    status: managed.status,
    data: managed.data.filter((item) => item.management.createdByMe),
  };
}

/** Resolve one managed Game by id from /v1/me/games (owner or manager). */
export async function getMyManagedGame(
  gameId: string,
): Promise<ApiResult<ManagedGame | null>> {
  let cursor: string | undefined;
  for (;;) {
    const page = await listMyManagedGames({ cursor, limit: 50 });
    if (!page.ok) return page;
    const hit = page.data.items.find((item) => item.id === gameId);
    if (hit) return { ok: true, status: page.status, data: hit };
    if (!page.data.nextCursor) {
      return { ok: true, status: page.status, data: null };
    }
    cursor = page.data.nextCursor;
  }
}

/** Resolve one created-by-me managed Game by id (paginated). */
export async function getMyCreatedGame(
  gameId: string,
): Promise<ApiResult<ManagedGame | null>> {
  const managed = await getMyManagedGame(gameId);
  if (!managed.ok) return managed;
  if (!managed.data || !managed.data.management.createdByMe) {
    return { ok: true, status: managed.status, data: null };
  }
  return managed;
}

export function requestParticipation(
  gameId: string,
  expectedGameVersion: number,
  csrfToken: string,
) {
  return apiFetch<Participation>(`/v1/games/${gameId}/participations`, {
    method: "POST",
    body: JSON.stringify({ expectedGameVersion }),
    csrfToken,
    idempotent: true,
  });
}

export function listGameParticipations(
  gameId: string,
  query: { cursor?: string; limit?: number } = {},
) {
  const params = new URLSearchParams();
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return apiFetch<ParticipationPage>(
    `/v1/games/${gameId}/participations${qs ? `?${qs}` : ""}`,
  );
}

/** Read every applicant page before manager mutations. */
export async function listAllGameParticipations(
  gameId: string,
): Promise<ApiResult<Participation[]>> {
  const items: Participation[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listGameParticipations(gameId, { cursor, limit: 50 });
    if (!page.ok) return page;
    items.push(...page.data.items);
    if (!page.data.nextCursor) {
      return { ok: true, status: page.status, data: items };
    }
    cursor = page.data.nextCursor;
  }
}

export function confirmParticipation(
  participationId: string,
  expectedVersion: number,
  csrfToken: string,
) {
  return apiFetch<Participation>(
    `/v1/participations/${participationId}/confirm`,
    {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
      csrfToken,
      idempotent: true,
    },
  );
}

export function rejectParticipation(
  participationId: string,
  expectedVersion: number,
  reason: string,
  csrfToken: string,
) {
  return apiFetch<Participation>(
    `/v1/participations/${participationId}/reject`,
    {
      method: "POST",
      body: JSON.stringify({ expectedVersion, reason }),
      csrfToken,
      idempotent: true,
    },
  );
}

export function removeParticipation(
  participationId: string,
  expectedVersion: number,
  reason: string,
  csrfToken: string,
) {
  return apiFetch<Participation>(
    `/v1/participations/${participationId}/remove`,
    {
      method: "POST",
      body: JSON.stringify({ expectedVersion, reason }),
      csrfToken,
      idempotent: true,
    },
  );
}

export function withdrawParticipation(
  participationId: string,
  expectedVersion: number,
  csrfToken: string,
) {
  return apiFetch<Participation>(
    `/v1/participations/${participationId}/withdraw`,
    {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
      csrfToken,
      idempotent: true,
    },
  );
}

export function getTrainerProfile() {
  return apiFetch<TrainerProfile>("/v1/me/trainer-profile");
}

export function upsertTrainerProfile(
  input: {
    selfDeclared: true;
    displayName: string;
    bio?: string | null;
    expectedVersion?: number;
  },
  csrfToken: string,
) {
  return apiFetch<TrainerProfile>("/v1/me/trainer-profile", {
    method: "PUT",
    body: JSON.stringify(input),
    csrfToken,
    idempotent: true,
  });
}

export function deactivateTrainerProfile(
  expectedVersion: number,
  csrfToken: string,
) {
  return apiFetch<TrainerProfile>("/v1/me/trainer-profile/deactivate", {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
    csrfToken,
    idempotent: true,
  });
}

export function listAuthProviders() {
  return apiFetch<{ providers: Array<"vk" | "yandex"> }>("/v1/auth/providers");
}

export function startAuth(provider: "vk" | "yandex", returnPath: string) {
  const qs = new URLSearchParams({ returnPath });
  return apiFetch<{ authorizationUrl: string }>(
    `/v1/auth/${provider}/start?${qs.toString()}`,
  );
}

export async function logout(csrfToken: string, options: { signal?: AbortSignal; notifySession?: boolean } = {}) {
  const generation = foregroundUpdates.currentGeneration;
  const result = await apiFetch<null>("/v1/auth/logout", {
    method: "POST",
    body: JSON.stringify({}),
    csrfToken,
    idempotent: true,
    signal: options.signal,
  });
  if (options.notifySession !== false && !options.signal?.aborted && generation === foregroundUpdates.currentGeneration && typeof window !== "undefined") window.dispatchEvent(new Event("gb-session-changed"));
  return result;
}

export function listLinkedProviders() {
  return apiFetch<LinkedProvidersResponse>("/v1/me/linked-providers");
}

export function startLinkProvider(
  provider: "vk" | "yandex",
  returnPath: string,
  csrfToken: string,
) {
  return apiFetch<{ authorizationUrl: string }>(
    `/v1/me/linked-providers/${provider}/link`,
    {
      method: "POST",
      body: JSON.stringify({ returnPath }),
      csrfToken,
    },
  );
}

export function unlinkProvider(provider: "vk" | "yandex", csrfToken: string) {
  return apiFetch<LinkedProvidersResponse>(
    `/v1/me/linked-providers/${provider}`,
    {
      method: "DELETE",
      csrfToken,
    },
  );
}

export function listMySessions() {
  return apiFetch<SessionsResponse>("/v1/me/sessions");
}

export function revokeMySession(sessionId: string, csrfToken: string) {
  return apiFetch<SessionsResponse>(`/v1/me/sessions/${sessionId}`, {
    method: "DELETE",
    csrfToken,
  });
}

export function revokeOtherSessions(csrfToken: string) {
  return apiFetch<RevokeOtherSessionsResponse>("/v1/me/sessions/revoke-others", {
    method: "POST",
    body: JSON.stringify({}),
    csrfToken,
    idempotent: true,
  });
}

export function listPlayers(query: {
  cursor?: string;
  limit?: number;
  cityId?: string;
  areaKey?: string;
  name?: string;
  looking?: boolean;
  trainer?: boolean;
} = {}) {
  const params = new URLSearchParams();
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cityId) params.set("cityId", query.cityId);
  if (query.areaKey) params.set("areaKey", query.areaKey);
  if (query.name) params.set("name", query.name);
  if (query.looking !== undefined) params.set("looking", String(query.looking));
  if (query.trainer !== undefined) params.set("trainer", String(query.trainer));
  const qs = params.toString();
  return apiFetch<PublicPlayerPage>(`/v1/players${qs ? `?${qs}` : ""}`);
}

export function getPlayer(publicPlayerId: string, signal?: AbortSignal) {
  return apiFetch<PublicPlayer>(`/v1/players/${encodeURIComponent(publicPlayerId)}`, { signal });
}

export function getMySocialProfile() {
  return apiFetch<OwnSocialProfile>("/v1/me/social-profile");
}

export function patchMySocialProfile(
  input: PatchSocialProfileInput,
  csrfToken: string,
) {
  return apiFetch<OwnSocialProfile>("/v1/me/social-profile", {
    method: "PATCH",
    body: JSON.stringify(input),
    csrfToken,
    idempotent: true,
  });
}

export function putMySocialProfileVisibility(
  input: SocialProfileVisibilityInput,
  csrfToken: string,
) {
  return apiFetch<OwnSocialProfile>("/v1/me/social-profile/visibility", {
    method: "PUT",
    body: JSON.stringify(input),
    csrfToken,
    idempotent: true,
  });
}

export function putMyLookingForGame(
  input: LookingForGamePutInput,
  csrfToken: string,
) {
  return apiFetch<LookingIntent>("/v1/me/looking-for-game", {
    method: "PUT",
    body: JSON.stringify(input),
    csrfToken,
    idempotent: true,
  });
}

export function deleteMyLookingForGame(csrfToken: string) {
  return apiFetch<LookingIntent>("/v1/me/looking-for-game", {
    method: "DELETE",
    body: JSON.stringify({}),
    csrfToken,
    idempotent: true,
  });
}

export function putMyBlock(publicPlayerId: string, csrfToken: string) {
  return apiFetch<BlockReceipt>(`/v1/me/blocks/${publicPlayerId}`, {
    method: "PUT",
    body: JSON.stringify({}),
    csrfToken,
    idempotent: true,
  });
}

export function deleteMyBlock(publicPlayerId: string, csrfToken: string) {
  return apiFetch<BlockReceipt>(`/v1/me/blocks/${publicPlayerId}`, {
    method: "DELETE",
    body: JSON.stringify({}),
    csrfToken,
    idempotent: true,
  });
}

export function createAbuseReport(
  input: CreateAbuseReportInput,
  csrfToken: string,
) {
  return apiFetch<AbuseReportReceipt>("/v1/reports", {
    method: "POST",
    body: JSON.stringify(input),
    csrfToken,
    idempotent: true,
  });
}

export function getGameResults(gameId: string, query: {
  revisionsLimit?: number;
  revisionsCursor?: string;
  rosterLimit?: number;
  rosterCursor?: string;
} = {}) {
  const params = new URLSearchParams();
  if (query.revisionsLimit) params.set("revisionsLimit", String(query.revisionsLimit));
  if (query.revisionsCursor) params.set("revisionsCursor", query.revisionsCursor);
  if (query.rosterLimit) params.set("rosterLimit", String(query.rosterLimit));
  if (query.rosterCursor) params.set("rosterCursor", query.rosterCursor);
  const qs = params.toString();
  return apiFetch<GameResults>(`/v1/games/${gameId}/results${qs ? `?${qs}` : ""}`);
}

export function putGameOutcome(
  gameId: string,
  input: { expectedVersion: number; outcome: "held" | "not_held"; reason?: string },
  csrfToken: string,
) {
  return apiFetch<GameResults>(`/v1/games/${gameId}/outcome`, {
    method: "PUT",
    body: JSON.stringify(input),
    csrfToken,
    idempotent: true,
  });
}

export function putGameAttendance(
  gameId: string,
  contextId: string,
  input: {
    expectedVersion: number;
    value: AttendanceValue;
    late?: boolean;
    correctionReason?: string;
  },
  csrfToken: string,
) {
  return apiFetch<AttendanceRecord>(`/v1/games/${gameId}/attendance/${contextId}`, {
    method: "PUT",
    body: JSON.stringify(input),
    csrfToken,
    idempotent: true,
  });
}

export function bulkPresentAttendance(
  gameId: string,
  input: {
    items: Array<{ contextId: string; expectedVersion: number }>;
    confirmedExactSelection: true;
  },
  csrfToken: string,
) {
  return apiFetch<{ items: AttendanceRecord[] }>(`/v1/games/${gameId}/attendance/bulk-present`, {
    method: "POST",
    body: JSON.stringify(input),
    csrfToken,
    idempotent: true,
  });
}

export function acknowledgeAttendance(
  gameId: string,
  contextId: string,
  attendanceVersion: number,
  csrfToken: string,
) {
  return apiFetch<AttendanceRecord>(
    `/v1/games/${gameId}/attendance/${contextId}/acknowledgements`,
    {
      method: "POST",
      body: JSON.stringify({ attendanceVersion }),
      csrfToken,
      idempotent: true,
    },
  );
}

export function disputeAttendance(
  gameId: string,
  contextId: string,
  input: { attendanceVersion: number; explanation: string },
  csrfToken: string,
) {
  return apiFetch<AttendanceDispute>(`/v1/games/${gameId}/attendance/${contextId}/disputes`, {
    method: "POST",
    body: JSON.stringify(input),
    csrfToken,
    idempotent: true,
  });
}

export function getAttendanceHistory(gameId: string, contextId: string, limit = 20) {
  return apiFetch<AttendanceHistoryPage>(
    `/v1/games/${gameId}/attendance/${contextId}/history?limit=${limit}`,
  );
}

export function getAttendanceDispute(disputeId: string) {
  return apiFetch<AttendanceDispute>(`/v1/attendance-disputes/${disputeId}`);
}

export function withdrawAttendanceDispute(
  disputeId: string,
  input: { expectedVersion: number; reason?: string },
  csrfToken: string,
) {
  return apiFetch<AttendanceDispute>(`/v1/attendance-disputes/${disputeId}/withdraw`, {
    method: "POST",
    body: JSON.stringify(input),
    csrfToken,
    idempotent: true,
  });
}

export function listMyGameResults(query: { limit?: number; cursor?: string } = {}) {
  const params = new URLSearchParams();
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  const qs = params.toString();
  return apiFetch<MeGameResultsPage>(`/v1/me/game-results${qs ? `?${qs}` : ""}`);
}

/** Both RFC Retry-After forms; never schedule an earlier retry. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : undefined;
}

export const AVATAR_NETWORK_MS = 20_000;
export const AVATAR_RECONCILE_MS = 5_000;
async function avatarRequest<T>(path: string, init: RequestInit & { csrfToken?: string }, deadline: number, parentSignal?: AbortSignal): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", abort, { once: true });
  if (parentSignal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new DOMException("Avatar request timed out", "TimeoutError")), deadline);
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    return await avatarAbortable(apiFetch<T>(path, { ...init, signal: controller.signal }), controller.signal);
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : "Avatar request aborted" };
  } finally {
    clearTimeout(timer); parentSignal?.removeEventListener("abort", abort);
  }
}

export function reconcileMyAvatar(signal?: AbortSignal) {
  return avatarRequest<OwnSocialProfile>("/v1/me/social-profile", {}, AVATAR_RECONCILE_MS, signal);
}

export function changeMyAvatar(file: Blob | null, expectedVersion: number, csrfToken: string, signal?: AbortSignal) {
  return avatarRequest<{ version: number; avatar: PlayerAvatar }>("/v1/me/avatar", {
    method: file ? "PUT" : "DELETE", csrfToken,
    headers: { "X-Profile-Version": String(expectedVersion), ...(file ? { "Content-Type": file.type } : {}) },
    ...(file ? { body: file } : {}),
  }, AVATAR_NETWORK_MS, signal);
}

/** Private reusable game contact; unrelated to the public player directory. */
export function getGamePreferences() {
  return apiFetch<GamePreferences>("/v1/me/game-preferences");
}

export function patchGamePreferences(input: PatchGamePreferences, csrfToken: string) {
  return apiFetch<GamePreferences>("/v1/me/game-preferences", { method: "PATCH", body: JSON.stringify(input), csrfToken, idempotent: true });
}

export type { CoverReceipt } from "@gobadminton/contracts";
import type { CoverReceipt } from "@gobadminton/contracts";
export function getMyCover(signal?: AbortSignal) {
  return avatarRequest<CoverReceipt>("/v1/me/cover", {}, AVATAR_RECONCILE_MS, signal);
}
/** Shared CAS recovery must refresh every profile field along with its version. */
export function reconcileMyCover(signal?: AbortSignal) {
  return avatarRequest<OwnSocialProfile>("/v1/me/social-profile", {}, AVATAR_RECONCILE_MS, signal);
}
export function changeMyCover(file: Blob | null, expectedVersion: number, csrfToken: string, signal?: AbortSignal) {
  return avatarRequest<CoverReceipt>("/v1/me/cover", {
    method: file ? "PUT" : "DELETE", csrfToken,
    headers: { "X-Profile-Version": String(expectedVersion), "Content-Type": file ? file.type : "application/json" },
    body: file ?? JSON.stringify({ expectedVersion } satisfies DeleteCoverCommand),
  }, AVATAR_NETWORK_MS, signal);
}
