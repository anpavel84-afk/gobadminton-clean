import { describe, expect, it } from "vitest";
import {
  OUTBOX_BACKLOG_CLASSIFICATION,
  PG_BOSS_PINNED_VERSION,
  SOCIAL_EXPIRY_CLEANUP_QUEUE,
} from "../../src/jobs/constants";
import { fromPoolClient } from "../../src/jobs/from-pool-client";
import {
  isSocialExpiryCleanupPayload,
  sanitizeJobLogFields,
} from "../../src/jobs/payloads";

describe("LS-02 jobs adapter / payload guards", () => {
  it("pins pg-boss 12.36.0 and classifies outbox as evidence-only", () => {
    expect(PG_BOSS_PINNED_VERSION).toBe("12.36.0");
    expect(SOCIAL_EXPIRY_CLEANUP_QUEUE).toBe("social.expiry.cleanup");
    expect(OUTBOX_BACKLOG_CLASSIFICATION).toBe("KEEP_AS_EVIDENCE");
  });

  it("fromPoolClient delegates executeSql to PoolClient.query", async () => {
    const calls: Array<{ text: string; values: unknown[] | undefined }> = [];
    const client = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return { rows: [{ ok: 1 }] };
      },
    };
    const db = fromPoolClient(client as never);
    const result = await db.executeSql("SELECT $1::int AS ok", [1]);
    expect(result.rows).toEqual([{ ok: 1 }]);
    expect(calls).toEqual([{ text: "SELECT $1::int AS ok", values: [1] }]);
  });

  it("accepts only narrow payloads and sanitizes logs", () => {
    expect(isSocialExpiryCleanupPayload({ kind: "sweep" })).toBe(true);
    expect(
      isSocialExpiryCleanupPayload({
        kind: "looking_intent",
        userId: "u1",
        version: 2,
      }),
    ).toBe(true);
    expect(
      isSocialExpiryCleanupPayload({
        kind: "looking_intent",
        userId: "u1",
        version: "2",
      }),
    ).toBe(false);
    expect(
      isSocialExpiryCleanupPayload({
        kind: "looking_intent",
        userId: "u1",
        version: 1,
        lat: 55.75,
      }),
    ).toBe(true);
    expect(
      isSocialExpiryCleanupPayload({
        kind: "dm_request",
        conversationId: "c1",
        version: 1,
      }),
    ).toBe(true);
    expect(
      isSocialExpiryCleanupPayload({
        kind: "invitation",
        invitationId: "i1",
        version: 1,
      }),
    ).toBe(true);
    expect(
      isSocialExpiryCleanupPayload({
        kind: "invitation",
        invitationId: "i1",
      }),
    ).toBe(false);

    const fields = sanitizeJobLogFields({
      queue: SOCIAL_EXPIRY_CLEANUP_QUEUE,
      jobId: "j1",
      kind: "looking_intent",
      userId: "u1",
    });
    expect(fields).toMatchObject({
      queue: SOCIAL_EXPIRY_CLEANUP_QUEUE,
      jobId: "j1",
      kind: "looking_intent",
      userId: "u1",
    });
    expect(JSON.stringify(fields)).not.toMatch(/lat|lon|cell|message/i);
  });
});
