import "reflect-metadata";

// Integration suites share one disposable PostGIS; allow more pool clients
// for concurrent injects (last-seat races) without connection starvation.
if (!process.env.DATABASE_POOL_MAX) {
  process.env.DATABASE_POOL_MAX = "20";
}

// Explicit synthetic moderation harness. Non-test configuration has no fake/default bypass.
process.env.CONTENT_MODERATION_PROVIDER = "fake";
process.env.CONTENT_MODERATION_FINGERPRINT_SECRET = "m1-synthetic-test-fingerprint-secret-only";
