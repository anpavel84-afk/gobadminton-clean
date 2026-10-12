import { Global, Module } from "@nestjs/common";
import { ActorFenceService } from "../../src/common/actor-fence.service";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { MutationRunner } from "../../src/common/mutation-runner.service";
import type { AppEnv } from "../../src/config/env";
import { JobsModule } from "../../src/jobs/jobs.module";
import { APP_ENV, DATABASE_POOL } from "../../src/tokens";
import type { Pool } from "pg";

export function buildTestCoreModule(env: AppEnv, pool: Pool) {
  @Global()
  @Module({
    imports: [JobsModule],
    providers: [
      { provide: APP_ENV, useValue: env },
      { provide: DATABASE_POOL, useValue: pool },
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
      JobsModule,
    ],
  })
  class TestCoreModule {}

  return TestCoreModule;
}
