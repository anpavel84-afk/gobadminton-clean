import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { Pool } from "pg";
import type { AppEnv } from "../config/env";
import { contractMeta } from "../contract-meta";
import { checkDatabase } from "../database/client";
import { APP_ENV, DATABASE_POOL } from "../tokens";

@Controller()
export class HealthController {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  @Get("health")
  getHealth() {
    return {
      status: "ok",
      service: this.env.SERVICE_NAME,
      appEnv: this.env.APP_ENV,
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  async getReady() {
    const database = await checkDatabase(this.pool);
    if (!database.ok) {
      throw new ServiceUnavailableException({
        status: "not_ready",
        database,
      });
    }

    return {
      status: "ready",
      database: {
        ok: true,
        postgresVersion: database.postgresVersion,
        postgisVersion: database.postgisVersion,
      },
    };
  }

  @Get("meta")
  getMeta() {
    return {
      service: this.env.SERVICE_NAME,
      apiVersion: contractMeta.version,
      appEnv: this.env.APP_ENV,
      nodeEnv: this.env.NODE_ENV,
      gitSha: this.env.GIT_SHA,
      publicOrigin: this.env.PUBLIC_API_ORIGIN,
      contract: contractMeta,
    };
  }
}
