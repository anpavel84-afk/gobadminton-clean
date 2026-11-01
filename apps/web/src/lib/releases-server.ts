/** Server-only release projection fetch, DEV guard, and live SHA comparison.
 * Do not import from client components (uses process env + fixed-origin fetch).
 */

import {
  CURRENT_APPLICATION_VERSION,
  CURRENT_NAMED_RELEASE,
  TRUSTED_HISTORICAL_SEED,
  normalizeRepoSha40,
  runtimeBuildGitSha,
  shortSha,
  type HistoricalReleaseSeed,
  type NamedReleaseNotes,
} from "./releases";

export const DEV_RELEASES_HOST = "dev.gobadminton.ru";
export const TRUSTED_DEV_API_BASE_URL = "http://api:3000";
export const DEV_APP_ORIGIN = "https://dev.gobadminton.ru";
export const PROD_APP_ORIGIN = "https://gobadminton.ru";
export const RELEASE_INFO_DEV_URL = "https://dev.gobadminton.ru/__release-info/dev.json";
export const RELEASE_INFO_PROD_URL = "https://dev.gobadminton.ru/__release-info/prod.json";
export const RELEASE_FETCH_TIMEOUT_MS = 2500;

export type ReleaseEnvironment = "dev" | "prod";

export type AcceptedProjection = {
  release_id: string | null;
  source_sha: string;
  status: string;
  finished_at: string;
  api_digest: string | null;
  web_digest: string | null;
  kind?: string;
};

export type ReleaseProjection = {
  environment: ReleaseEnvironment;
  observed_at: string;
  pending: boolean;
  accepted: AcceptedProjection | null;
};

export type LiveEndpointState =
  | { state: "ok"; gitSha: string; applicationVersion?: string; apiVersion?: string; checkedAt: string }
  | { state: "unavailable"; detail: string; checkedAt: string }
  | { state: "unknown"; detail: string; checkedAt: string }
  | { state: "mismatch"; detail: string; webSha?: string; apiSha?: string; checkedAt: string };

export type EnvironmentLiveStatus = {
  environment: ReleaseEnvironment;
  checkedAt: string;
  web: LiveEndpointState;
  api: LiveEndpointState;
  projection: { state: "ok"; data: ReleaseProjection } | { state: "unavailable" | "malformed"; detail: string };
  acceptance:
    | { state: "accepted_current"; accepted: AcceptedProjection }
    | { state: "projection_only"; accepted: AcceptedProjection; reason: string }
    | { state: "mismatch"; accepted: AcceptedProjection; reason: string }
    | { state: "pending_or_none"; reason: string }
    | { state: "unavailable"; reason: string };
};

export type HistoryRow = {
  environment: ReleaseEnvironment;
  source_sha: string;
  application_version: string | null;
  version_label: string;
  title: string;
  release_id: string | null;
  accepted_at: string;
  status: string;
  kind?: string;
  owner_uat: string;
  origin: "seed" | "live_projection";
};

export type ReleasesPageModel = {
  build: { applicationVersion: string; gitSha: string };
  named: NamedReleaseNotes;
  environments: EnvironmentLiveStatus[];
  history: HistoryRow[];
  checkedAt: string;
};

export function normalizeApiBaseUrl(value: string | undefined | null): string {
  return (value ?? "").trim().replace(/\/$/, "");
}

export function isTrustedDevApiBase(apiBaseUrl: string | undefined | null = process.env.API_BASE_URL): boolean {
  return normalizeApiBaseUrl(apiBaseUrl) === TRUSTED_DEV_API_BASE_URL;
}

/** Exact DEV host plus trusted in-cluster API base. appEnv=mvp alone is insufficient. */
export function isTrustedDevReleasesRuntime(input: {
  host: string | null | undefined;
  apiBaseUrl?: string | null;
}): boolean {
  const host = (input.host ?? "").split(":")[0]?.toLowerCase() ?? "";
  return host === DEV_RELEASES_HOST && isTrustedDevApiBase(input.apiBaseUrl ?? process.env.API_BASE_URL);
}

function isoFromEpochCandidate(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  try {
    return date.toISOString();
  } catch {
    return null;
  }
}

/** Fail-soft: finite but out-of-Date-range numbers/strings (e.g. 1e30) return null, never throw. */
export function normalizeFinishedAt(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value > 1e12 ? value : value * 1000;
    return isoFromEpochCandidate(ms);
  }
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
      return normalizeFinishedAt(Number(trimmed));
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return isoFromEpochCandidate(parsed);
  }
  return null;
}

export function normalizeObservedAt(value: unknown): string | null {
  return normalizeFinishedAt(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseReleaseProjection(raw: unknown, expectedEnv: ReleaseEnvironment):
  | { ok: true; data: ReleaseProjection }
  | { ok: false; reason: "malformed" | "missing"; detail: string } {
  if (raw == null) return { ok: false, reason: "missing", detail: "пустое тело" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "malformed", detail: "ожидался объект projection" };
  }
  const body = raw as Record<string, unknown>;
  const environment = asNonEmptyString(body.environment)?.toLowerCase();
  if (environment !== expectedEnv) {
    return { ok: false, reason: "malformed", detail: `environment≠${expectedEnv}` };
  }
  const observed_at = normalizeObservedAt(body.observed_at);
  if (!observed_at) return { ok: false, reason: "malformed", detail: "observed_at недоступен" };
  const pending = body.pending === true;
  let accepted: AcceptedProjection | null = null;
  if (body.accepted != null) {
    if (typeof body.accepted !== "object" || Array.isArray(body.accepted)) {
      return { ok: false, reason: "malformed", detail: "accepted повреждён" };
    }
    const acc = body.accepted as Record<string, unknown>;
    const source_sha = normalizeRepoSha40(acc.source_sha);
    const status = asNonEmptyString(acc.status);
    const finished_at = normalizeFinishedAt(acc.finished_at);
    if (!source_sha || !status || !finished_at) {
      return { ok: false, reason: "malformed", detail: "accepted без source_sha/status/finished_at" };
    }
    const release_id = acc.release_id == null ? null : asNonEmptyString(acc.release_id);
    if (acc.release_id != null && release_id == null) {
      return { ok: false, reason: "malformed", detail: "release_id повреждён" };
    }
    accepted = {
      release_id,
      source_sha,
      status,
      finished_at,
      api_digest: asNonEmptyString(acc.api_digest),
      web_digest: asNonEmptyString(acc.web_digest),
      ...(asNonEmptyString(acc.kind) ? { kind: asNonEmptyString(acc.kind)! } : {}),
    };
  }
  return {
    ok: true,
    data: { environment: expectedEnv, observed_at, pending, accepted },
  };
}

async function fetchFixedJson(url: string, timeoutMs = RELEASE_FETCH_TIMEOUT_MS): Promise<
  | { ok: true; data: unknown; checkedAt: string }
  | { ok: false; detail: string; checkedAt: string }
> {
  const checkedAt = new Date().toISOString();
  if (url !== RELEASE_INFO_DEV_URL && url !== RELEASE_INFO_PROD_URL
    && !url.startsWith(`${DEV_APP_ORIGIN}/`) && !url.startsWith(`${PROD_APP_ORIGIN}/`)) {
    return { ok: false, detail: "запрещённый origin", checkedAt };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status}`, checkedAt: new Date().toISOString() };
    }
    const data: unknown = await response.json();
    return { ok: true, data, checkedAt: new Date().toISOString() };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "ошибка запроса";
    return { ok: false, detail, checkedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timer);
  }
}

export function parseWebHealth(raw: unknown): LiveEndpointState {
  const checkedAt = new Date().toISOString();
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { state: "unknown", detail: "некорректный /health", checkedAt };
  }
  const body = raw as Record<string, unknown>;
  if (body.status !== "ok") {
    return { state: "unavailable", detail: `status=${String(body.status)}`, checkedAt };
  }
  const rawSha = asNonEmptyString(body.gitSha);
  if (!rawSha) {
    return { state: "unknown", detail: "в /health нет gitSha (legacy)", checkedAt };
  }
  const gitSha = normalizeRepoSha40(rawSha);
  if (!gitSha) {
    return { state: "unknown", detail: "в /health неполный или неверный gitSha", checkedAt };
  }
  const applicationVersion = asNonEmptyString(body.applicationVersion) ?? undefined;
  return { state: "ok", gitSha, applicationVersion, checkedAt };
}

export function parseApiMeta(raw: unknown): LiveEndpointState {
  const checkedAt = new Date().toISOString();
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { state: "unknown", detail: "некорректный /v1/meta", checkedAt };
  }
  const body = raw as Record<string, unknown>;
  const rawSha = asNonEmptyString(body.gitSha);
  if (!rawSha) {
    return { state: "unknown", detail: "в /v1/meta нет gitSha", checkedAt };
  }
  const gitSha = normalizeRepoSha40(rawSha);
  if (!gitSha) {
    return { state: "unknown", detail: "в /v1/meta неполный или неверный gitSha", checkedAt };
  }
  const apiVersion = asNonEmptyString(body.apiVersion) ?? undefined;
  return { state: "ok", gitSha, apiVersion, checkedAt };
}

export function evaluateAcceptance(
  projection: ReleaseProjection | null,
  projectionError: string | null,
  web: LiveEndpointState,
  api: LiveEndpointState,
): EnvironmentLiveStatus["acceptance"] {
  if (!projection) {
    return { state: "unavailable", reason: projectionError ?? "projection недоступен" };
  }
  if (!projection.accepted || projection.accepted.status !== "ACCEPTED") {
    return {
      state: "pending_or_none",
      reason: projection.pending ? "есть pending, ACCEPTED нет" : "ACCEPTED в projection отсутствует",
    };
  }
  const accepted = projection.accepted;
  const acceptedSha = normalizeRepoSha40(accepted.source_sha);
  if (!acceptedSha) {
    return {
      state: "unavailable",
      reason: "accepted.source_sha не полный 40-hex — текущий выпуск не подтверждаем",
    };
  }
  if (web.state !== "ok" || api.state !== "ok") {
    return {
      state: "projection_only",
      accepted: { ...accepted, source_sha: acceptedSha },
      reason: "live SHA недоступны — не подтверждаем текущий ACCEPTED по runtime",
    };
  }
  const webSha = normalizeRepoSha40(web.gitSha);
  const apiSha = normalizeRepoSha40(api.gitSha);
  if (!webSha || !apiSha) {
    return {
      state: "projection_only",
      accepted: { ...accepted, source_sha: acceptedSha },
      reason: "live SHA неполный или неверный — не подтверждаем текущий ACCEPTED",
    };
  }
  if (webSha !== acceptedSha || apiSha !== acceptedSha) {
    return {
      state: "mismatch",
      accepted: { ...accepted, source_sha: acceptedSha },
      reason: `accepted ${shortSha(acceptedSha)} ≠ live web ${shortSha(webSha)} / api ${shortSha(apiSha)}`,
    };
  }
  if (webSha !== apiSha) {
    return {
      state: "mismatch",
      accepted: { ...accepted, source_sha: acceptedSha },
      reason: `web ${shortSha(webSha)} ≠ api ${shortSha(apiSha)}`,
    };
  }
  return { state: "accepted_current", accepted: { ...accepted, source_sha: acceptedSha } };
}

function seedTitleFor(sha: string): Pick<HistoryRow, "title" | "version_label" | "application_version" | "owner_uat"> {
  const hit = TRUSTED_HISTORICAL_SEED.find((row) => row.source_sha === sha);
  if (hit) {
    return {
      title: hit.title,
      version_label: hit.version_label,
      application_version: hit.application_version,
      owner_uat: hit.owner_uat,
    };
  }
  if (sha === runtimeBuildGitSha() && sha !== "unknown") {
    return {
      title: CURRENT_NAMED_RELEASE.title,
      version_label: CURRENT_APPLICATION_VERSION,
      application_version: CURRENT_APPLICATION_VERSION,
      owner_uat: CURRENT_NAMED_RELEASE.owner_uat,
    };
  }
  return {
    title: "Выпуск без записи в каталоге",
    version_label: "Неизвестный номер",
    application_version: null,
    owner_uat: "NOT_TESTED",
  };
}

export function buildHistoryRows(
  seed: readonly HistoricalReleaseSeed[],
  live: Array<ReleaseProjection | null>,
): HistoryRow[] {
  const rows: HistoryRow[] = [];
  const seen = new Set<string>();

  const push = (row: HistoryRow) => {
    const key = `${row.environment}|${row.source_sha}|${row.accepted_at}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  for (const release of seed) {
    for (const dep of release.deployments) {
      const accepted_at = normalizeFinishedAt(dep.accepted_at) ?? dep.accepted_at;
      push({
        environment: dep.environment === "prod" ? "prod" : "dev",
        source_sha: release.source_sha,
        application_version: release.application_version,
        version_label: release.version_label,
        title: release.title,
        release_id: dep.release_id,
        accepted_at,
        status: dep.status,
        ...(dep.kind ? { kind: dep.kind } : {}),
        owner_uat: release.owner_uat,
        origin: "seed",
      });
    }
  }

  for (const projection of live) {
    if (!projection?.accepted || projection.accepted.status !== "ACCEPTED") continue;
    const meta = seedTitleFor(projection.accepted.source_sha);
    const accepted_at = normalizeFinishedAt(projection.accepted.finished_at) ?? projection.accepted.finished_at;
    push({
      environment: projection.environment,
      source_sha: projection.accepted.source_sha,
      application_version: meta.application_version,
      version_label: meta.version_label,
      title: meta.title,
      release_id: projection.accepted.release_id,
      accepted_at,
      status: projection.accepted.status,
      ...(projection.accepted.kind ? { kind: projection.accepted.kind } : {}),
      owner_uat: meta.owner_uat,
      origin: "live_projection",
    });
  }

  return rows.sort((a, b) => Date.parse(b.accepted_at) - Date.parse(a.accepted_at));
}

async function loadEnvironment(environment: ReleaseEnvironment): Promise<EnvironmentLiveStatus> {
  const origin = environment === "dev" ? DEV_APP_ORIGIN : PROD_APP_ORIGIN;
  const projectionUrl = environment === "dev" ? RELEASE_INFO_DEV_URL : RELEASE_INFO_PROD_URL;
  const checkedAt = new Date().toISOString();

  const [webRes, apiRes, projRes] = await Promise.all([
    fetchFixedJson(`${origin}/health`),
    fetchFixedJson(`${origin}/v1/meta`),
    fetchFixedJson(projectionUrl),
  ]);

  const web: LiveEndpointState = webRes.ok
    ? parseWebHealth(webRes.data)
    : { state: "unavailable", detail: webRes.detail, checkedAt: webRes.checkedAt };
  const api: LiveEndpointState = apiRes.ok
    ? parseApiMeta(apiRes.data)
    : { state: "unavailable", detail: apiRes.detail, checkedAt: apiRes.checkedAt };

  let projection: EnvironmentLiveStatus["projection"];
  let projectionData: ReleaseProjection | null = null;
  if (!projRes.ok) {
    projection = { state: "unavailable", detail: projRes.detail };
  } else {
    const parsed = parseReleaseProjection(projRes.data, environment);
    if (!parsed.ok) {
      projection = { state: "malformed", detail: parsed.detail };
    } else {
      projection = { state: "ok", data: parsed.data };
      projectionData = parsed.data;
    }
  }

  if (web.state === "ok" && api.state === "ok" && web.gitSha !== api.gitSha) {
    const mismatch: LiveEndpointState = {
      state: "mismatch",
      detail: `web ${shortSha(web.gitSha)} ≠ api ${shortSha(api.gitSha)}`,
      webSha: web.gitSha,
      apiSha: api.gitSha,
      checkedAt,
    };
    return {
      environment,
      checkedAt,
      web: mismatch,
      api: mismatch,
      projection,
      acceptance: evaluateAcceptance(
        projectionData,
        projection.state === "ok" ? null : projection.detail,
        web,
        api,
      ),
    };
  }

  return {
    environment,
    checkedAt,
    web,
    api,
    projection,
    acceptance: evaluateAcceptance(
      projectionData,
      projection.state === "ok" ? null : projection.detail,
      web,
      api,
    ),
  };
}

export async function loadReleasesPageModel(): Promise<ReleasesPageModel> {
  const checkedAt = new Date().toISOString();
  const [dev, prod] = await Promise.all([loadEnvironment("dev"), loadEnvironment("prod")]);
  const liveProjections = [dev, prod].map((env) =>
    env.projection.state === "ok" ? env.projection.data : null,
  );
  const named: NamedReleaseNotes = {
    ...CURRENT_NAMED_RELEASE,
    source_sha: null,
  };
  const buildSha = runtimeBuildGitSha();
  const currentMatch = [dev, prod].find(
    (env) =>
      env.acceptance.state === "accepted_current"
      && env.acceptance.accepted.source_sha === buildSha
      && buildSha !== "unknown",
  );
  if (currentMatch && currentMatch.acceptance.state === "accepted_current") {
    named.source_sha = currentMatch.acceptance.accepted.source_sha;
  }

  return {
    build: { applicationVersion: CURRENT_APPLICATION_VERSION, gitSha: buildSha },
    named,
    environments: [dev, prod],
    history: buildHistoryRows(TRUSTED_HISTORICAL_SEED, liveProjections),
    checkedAt,
  };
}
