import type { Pool, PoolClient } from "pg";

/** Logical dump must exclude presence DATA. UNLOGGED is not an exclusion. */
export const RADAR_LOGICAL_DUMP_EXCLUDE_TABLE_DATA = [
  "radar_presences",
] as const;

export const RADAR_PG_DUMP_EXCLUDE_ARGS = RADAR_LOGICAL_DUMP_EXCLUDE_TABLE_DATA.map(
  (table) => `--exclude-table-data=${table}`,
);

export type SqlExecutor = {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export function sqlExecutorFromPg(db: Pool | PoolClient): SqlExecutor {
  return {
    async query<T = Record<string, unknown>>(text: string, values?: unknown[]) {
      const result = await db.query(text, values);
      return { rows: result.rows as T[], rowCount: result.rowCount };
    },
  };
}

/**
 * Coordinated restore/failover/flag-rollback step: empty ephemeral presence
 * BEFORE serving Radar traffic. Does not truncate durable rate budgets,
 * idempotency receipts, conversations, or invitations. Receipt replay must
 * not resurrect presence.
 */
export async function resetRadarPresenceBeforeServingTraffic(
  db: SqlExecutor,
): Promise<{ deleted: number }> {
  const counted = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM radar_presences`,
  );
  await db.query(`TRUNCATE radar_presences`);
  return { deleted: counted.rows[0]?.n ?? 0 };
}
