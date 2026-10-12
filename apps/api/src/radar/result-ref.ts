import { createHmac, timingSafeEqual } from "node:crypto";
import {
  RADAR_POLICY_VERSION,
  RADAR_PROOF_TTL_SECONDS,
} from "./constants";

export type ResultRefPayload = {
  v: 1;
  viewerUserId: string;
  viewerSessionId: string;
  viewerActivationId: string;
  viewerVersion: number;
  targetUserId: string;
  targetActivationId: string;
  targetVersion: number;
  policyVersion: string;
  epoch: string;
  exp: number;
};

export function orderingEpoch(now: Date): string {
  const ms = 15 * 60 * 1000;
  const bucket = Math.floor(now.getTime() / ms) * ms;
  return new Date(bucket).toISOString();
}

export function dailyEpoch(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function stableRankScore(
  pepper: string,
  viewerUserId: string,
  targetUserId: string,
  epoch: string,
): number {
  const hex = createHmac("sha256", pepper)
    .update(`radar-rank:${viewerUserId}:${targetUserId}:${epoch}`, "utf8")
    .digest("hex")
    .slice(0, 12);
  return parseInt(hex, 16);
}

export function displaySlot(
  pepper: string,
  viewerUserId: string,
  targetUserId: string,
  now: Date,
): number {
  const hex = createHmac("sha256", pepper)
    .update(
      `radar-slot:${viewerUserId}:${targetUserId}:${dailyEpoch(now)}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 8);
  return parseInt(hex, 16) % 360;
}

export function resultId(
  pepper: string,
  viewerUserId: string,
  targetUserId: string,
  epoch: string,
): string {
  return createHmac("sha256", pepper)
    .update(`radar-result-id:${viewerUserId}:${targetUserId}:${epoch}`, "utf8")
    .digest("base64url")
    .slice(0, 32);
}

export function signResultRef(
  pepper: string,
  input: Omit<ResultRefPayload, "v" | "policyVersion" | "exp"> & {
    now: Date;
    proofTtlSeconds?: number;
  },
): string {
  const exp =
    Math.floor(input.now.getTime() / 1000) +
    (input.proofTtlSeconds ?? RADAR_PROOF_TTL_SECONDS);
  const payload: ResultRefPayload = {
    v: 1,
    viewerUserId: input.viewerUserId,
    viewerSessionId: input.viewerSessionId,
    viewerActivationId: input.viewerActivationId,
    viewerVersion: input.viewerVersion,
    targetUserId: input.targetUserId,
    targetActivationId: input.targetActivationId,
    targetVersion: input.targetVersion,
    policyVersion: RADAR_POLICY_VERSION,
    epoch: input.epoch,
    exp,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const sig = createHmac("sha256", pepper)
    .update(`radar-result-ref:${body}`, "utf8")
    .digest("base64url");
  return `${body}.${sig}`;
}

export function stampDiscoveryProof(
  pepper: string,
  proof: string | null | undefined,
): string | null {
  if (proof === undefined || proof === null || proof === "") return null;
  return createHmac("sha256", pepper)
    .update(`radar-discovery-proof:${proof}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

export function parseResultRef(
  pepper: string,
  token: string,
): ResultRefPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = createHmac("sha256", pepper)
    .update(`radar-result-ref:${body}`, "utf8")
    .digest("base64url");
  const left = Buffer.from(sig, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }
  let payload: ResultRefPayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as ResultRefPayload;
  } catch {
    return null;
  }
  if (
    payload.v !== 1 ||
    payload.policyVersion !== RADAR_POLICY_VERSION ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  return payload;
}

export function verifyResultRef(
  pepper: string,
  token: string,
  now: Date,
): ResultRefPayload | null {
  const payload = parseResultRef(pepper, token);
  if (!payload || payload.exp * 1000 <= now.getTime()) {
    return null;
  }
  return payload;
}
