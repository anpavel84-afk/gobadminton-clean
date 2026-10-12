import { Global, Module } from "@nestjs/common";
import { ActorFenceService } from "./common/actor-fence.service";
import { IdempotencyService } from "./common/idempotency.service";
import { MutationRunner } from "./common/mutation-runner.service";
import { loadEnv } from "./config/env";
import { createDatabase } from "./database/client";
import { APP_ENV, DATABASE_POOL } from "./tokens";

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);

@Global()
@Module({
  providers: [
    { provide: APP_ENV, useValue: env },
    { provide: DATABASE_POOL, useValue: database.pool },
    IdempotencyService,
    ActorFenceService,
    MutationRunner,
  ],
  exports: [
    APP_ENV,
    DATABASE_POOL,
    IdempotencyService,
    ActorFenceService,
    MutationRunner,
  ],
})
export class CoreModule {
  static async close(): Promise<void> {
    await database.pool.end();
  }
}
