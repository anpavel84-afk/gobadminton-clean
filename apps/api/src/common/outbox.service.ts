import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";

@Injectable()
export class OutboxService {
  async enqueue(
    client: PoolClient,
    input: {
      type: string;
      aggregateType: string;
      aggregateId: string;
      aggregateVersion: number;
      payload: unknown;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events
         (type, aggregate_type, aggregate_id, aggregate_version, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        input.type,
        input.aggregateType,
        input.aggregateId,
        input.aggregateVersion,
        JSON.stringify(input.payload),
      ],
    );
  }
}
