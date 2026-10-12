import type { PoolClient } from "pg";
import type { Db } from "pg-boss";

/**
 * Adapt an in-flight `pg.PoolClient` transaction for pg-boss `db` options.
 * Rollback of the domain transaction removes the enqueued job with it.
 */
export function fromPoolClient(client: PoolClient): Db {
  return {
    async executeSql(text: string, values?: unknown[]) {
      const result = await client.query(text, values as unknown[] | undefined);
      return { rows: result.rows };
    },
  };
}
