export type CommunityAggregateState = "empty" | "available" | "unavailable";

export type CommunityRatingSummary = {
  venueId: string;
  canonicalVenueId: string | null;
  average: number | null;
  count: number | null;
  state: CommunityAggregateState;
};

export type CommunityOwnVote = {
  venueId: string;
  canonicalVenueId: string;
  value: number | null;
  version: number;
  withdrawn: boolean;
  moderationState: "clear" | "withheld";
  allowedActions: {
    upsert: boolean;
    update: boolean;
    withdraw: boolean;
  };
};

export type CommunityOwnVoteResponse = {
  own: CommunityOwnVote | null;
  summary: CommunityRatingSummary;
};

export type CommunitySummariesResponse = {
  items: CommunityRatingSummary[];
};

function isSummary(value: unknown): value is CommunityRatingSummary {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.venueId === "string"
    && (row.canonicalVenueId === null || typeof row.canonicalVenueId === "string")
    && (row.average === null || typeof row.average === "number")
    && (row.count === null || typeof row.count === "number")
    && (row.state === "empty" || row.state === "available" || row.state === "unavailable")
  );
}

export function isCommunityOwnVoteResponse(value: unknown): value is CommunityOwnVoteResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return isSummary(row.summary) && (row.own === null || typeof row.own === "object");
}

/** Coalesce concurrent compact/card summary reads into one ≤200-id batch request. */
type BatchWaiter = {
  ids: string[];
  resolve: (items: CommunityRatingSummary[]) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
};

let batchQueue: BatchWaiter[] = [];
let batchFlushTimer: ReturnType<typeof setTimeout> | null = null;

async function executeSummariesRequest(
  venueIds: string[],
  signal?: AbortSignal,
): Promise<CommunityRatingSummary[]> {
  const unique = [...new Set(venueIds.filter(Boolean))].slice(0, 200);
  if (unique.length === 0) return [];
  const response = await fetch(
    `/v1/venue-community-summaries?venueIds=${encodeURIComponent(unique.join(","))}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) throw new Error("community_summaries_unavailable");
  const body = await response.json() as CommunitySummariesResponse;
  if (!body || !Array.isArray(body.items) || !body.items.every(isSummary)) {
    throw new Error("community_summaries_invalid");
  }
  return body.items;
}

function flushSummaryBatch(): void {
  batchFlushTimer = null;
  const waiters = batchQueue;
  batchQueue = [];
  if (waiters.length === 0) return;
  const live = waiters.filter((w) => !w.signal?.aborted);
  for (const w of waiters) {
    if (w.signal?.aborted) w.reject(new DOMException("Aborted", "AbortError"));
  }
  if (live.length === 0) return;
  const merged = [...new Set(live.flatMap((w) => w.ids))].slice(0, 200);
  void executeSummariesRequest(merged)
    .then((items) => {
      const byId = new Map(items.map((item) => [item.venueId, item]));
      for (const waiter of live) {
        if (waiter.signal?.aborted) {
          waiter.reject(new DOMException("Aborted", "AbortError"));
          continue;
        }
        waiter.resolve(waiter.ids.map((id) => byId.get(id)).filter((row): row is CommunityRatingSummary => Boolean(row)));
      }
    })
    .catch((error) => {
      for (const waiter of live) waiter.reject(error);
    });
}

export async function fetchCommunitySummaries(
  venueIds: string[],
  signal?: AbortSignal,
): Promise<CommunitySummariesResponse> {
  const unique = [...new Set(venueIds.filter(Boolean))].slice(0, 200);
  if (unique.length === 0) return { items: [] };
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const items = await new Promise<CommunityRatingSummary[]>((resolve, reject) => {
    batchQueue.push({ ids: unique, resolve, reject, signal });
    if (signal) {
      signal.addEventListener("abort", () => {
        // Flush still resolves live waiters; aborted ones reject in flush/execute.
      }, { once: true });
    }
    if (!batchFlushTimer) {
      batchFlushTimer = setTimeout(flushSummaryBatch, 0);
    }
  });
  return { items };
}

export async function fetchOwnCommunityRating(
  venueId: string,
  signal?: AbortSignal,
): Promise<CommunityOwnVoteResponse> {
  const response = await fetch(
    `/v1/venues/${encodeURIComponent(venueId)}/community-rating/me`,
    { cache: "no-store", credentials: "include", signal },
  );
  if (!response.ok) throw new Error("community_own_unavailable");
  const body = await response.json();
  if (!isCommunityOwnVoteResponse(body)) throw new Error("community_own_invalid");
  return body;
}

export async function upsertCommunityRating(input: {
  venueId: string;
  value: number;
  expectedVersion: number;
  csrfToken: string;
  idempotencyKey: string;
}): Promise<CommunityOwnVoteResponse> {
  const response = await fetch(
    `/v1/venues/${encodeURIComponent(input.venueId)}/community-rating`,
    {
      method: "PUT",
      cache: "no-store",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": input.csrfToken,
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({
        value: input.value,
        expectedVersion: input.expectedVersion,
      }),
    },
  );
  if (!response.ok) throw new Error("community_upsert_failed");
  const body = await response.json();
  if (!isCommunityOwnVoteResponse(body)) throw new Error("community_upsert_invalid");
  return body;
}

export async function withdrawCommunityRating(input: {
  venueId: string;
  expectedVersion: number;
  csrfToken: string;
  idempotencyKey: string;
}): Promise<CommunityOwnVoteResponse> {
  const response = await fetch(
    `/v1/venues/${encodeURIComponent(input.venueId)}/community-rating`,
    {
      method: "DELETE",
      cache: "no-store",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": input.csrfToken,
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({ expectedVersion: input.expectedVersion }),
    },
  );
  if (!response.ok) throw new Error("community_withdraw_failed");
  const body = await response.json();
  if (!isCommunityOwnVoteResponse(body)) throw new Error("community_withdraw_invalid");
  return body;
}

export function voteCountLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} оценка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} оценки`;
  return `${count} оценок`;
}

export function formatCommunityAverage(average: number): string {
  return average.toFixed(1).replace(".", ",");
}

export function compactCommunitySummaryText(summary: CommunityRatingSummary | null | undefined): string {
  if (!summary || summary.state === "unavailable") return "Оценки недоступны";
  if (summary.state === "empty" || summary.count === 0 || summary.average === null) {
    return "Пока нет оценок";
  }
  return `★ ${formatCommunityAverage(summary.average)} · ${voteCountLabel(summary.count ?? 0)}`;
}
