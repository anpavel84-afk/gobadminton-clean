import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { sealSecret } from "../auth/crypto";
import {
  badRequest,
  conflict,
  notFound,
  unprocessable,
} from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import type {
  PushEventPreferencesDto,
  PushPreferenceBody,
  PushPreferenceResultDto,
  PushRegisterBody,
  PushRegisterResultDto,
  PushStateDto,
} from "./push.dto";
import {
  WEB_PUSH_MAX_DEVICES,
  accountFence,
  validatePushEndpoint,
  validatePushKeys,
} from "./push.policy";

const EVENT_PREF_OFF: PushEventPreferencesDto = {
  invites: false,
  applicationDecisions: false,
  newApplications: false,
  gameChanges: false,
  outcomeReminders: false,
};

type PrefRow = {
  enabled: boolean;
  version: number;
  notify_invites: boolean;
  notify_application_decisions: boolean;
  notify_new_applications: boolean;
  notify_game_changes: boolean;
  notify_outcome_reminders: boolean;
};

function mapEventPrefs(row: PrefRow | undefined): PushEventPreferencesDto {
  if (!row) return { ...EVENT_PREF_OFF };
  return {
    invites: row.notify_invites === true,
    applicationDecisions: row.notify_application_decisions === true,
    newApplications: row.notify_new_applications === true,
    gameChanges: row.notify_game_changes === true,
    outcomeReminders: row.notify_outcome_reminders === true,
  };
}

function parseEventPreferences(
  raw: unknown,
): Partial<PushEventPreferencesDto> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw unprocessable("PUSH_EVENT_PREFERENCE_INVALID", "Некорректные группы уведомлений");
  }
  const body = raw as Record<string, unknown>;
  const allowed = new Set([
    "invites",
    "applicationDecisions",
    "newApplications",
    "gameChanges",
    "outcomeReminders",
  ]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw unprocessable("PUSH_EVENT_PREFERENCE_INVALID", "Некорректные группы уведомлений");
    }
  }
  const out: Partial<PushEventPreferencesDto> = {};
  for (const key of allowed) {
    if (!(key in body)) continue;
    if (typeof body[key] !== "boolean") {
      throw unprocessable("PUSH_EVENT_PREFERENCE_INVALID", "Некорректные группы уведомлений");
    }
    out[key as keyof PushEventPreferencesDto] = body[key] as boolean;
  }
  return out;
}

export const WEB_PUSH_TRANSPORT = Symbol("WEB_PUSH_TRANSPORT");

@Injectable()
export class PushService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly idempotency: IdempotencyService,
    private readonly mutations: MutationRunner,
    @Optional()
    @Inject(WEB_PUSH_TRANSPORT)
    _transport?: unknown,
  ) {
    void _transport;
    void this.pool;
  }

  featureEnabled(): boolean {
    return this.env.WEB_PUSH_ENABLED === true;
  }

  private assertFeature(): void {
    if (!this.featureEnabled()) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
  }

  async getState(
    userId: string,
    sessionId: string,
  ): Promise<PushStateDto> {
    if (!this.featureEnabled()) {
      return {
        featureAvailable: false,
        preferenceEnabled: false,
        preferenceVersion: 0,
        eventPreferences: { ...EVENT_PREF_OFF },
        vapidPublicKey: null,
        accountFence: null,
        deviceCount: 0,
        maxDevices: WEB_PUSH_MAX_DEVICES,
        currentDevice: null,
        devices: [],
      };
    }
    const client = await this.pool.connect();
    try {
      const pref = await client.query<PrefRow>(
        `SELECT enabled, version,
                notify_invites, notify_application_decisions,
                notify_new_applications, notify_game_changes,
                notify_outcome_reminders
         FROM web_push_preferences WHERE user_id = $1`,
        [userId],
      );
      const devices = await client.query<{
        id: string;
        session_id: string;
        created_at: Date;
      }>(
        `SELECT id, session_id, created_at FROM web_push_subscriptions
         WHERE user_id = $1 AND unbound_at IS NULL
         ORDER BY created_at ASC
         LIMIT $2`,
        [userId, WEB_PUSH_MAX_DEVICES],
      );
      const list = devices.rows.map((row) => ({
        id: row.id,
        current: row.session_id === sessionId,
        createdAt: row.created_at.toISOString(),
      }));
      const current = list.find((d) => d.current) ?? null;
      return {
        featureAvailable: true,
        preferenceEnabled: pref.rows[0]?.enabled === true,
        preferenceVersion: pref.rows[0]?.version ?? 0,
        eventPreferences: mapEventPrefs(pref.rows[0]),
        vapidPublicKey: this.env.VAPID_PUBLIC_KEY ?? null,
        accountFence: accountFence(this.env.AUTH_PEPPER, userId),
        deviceCount: list.length,
        maxDevices: WEB_PUSH_MAX_DEVICES,
        currentDevice: current,
        devices: list,
      };
    } finally {
      client.release();
    }
  }

  async setPreference(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    body: PushPreferenceBody,
  ): Promise<{ statusCode: number; body: PushPreferenceResultDto }> {
    this.assertFeature();
    if (typeof body.enabled !== "boolean") {
      throw unprocessable("PUSH_PREFERENCE_INVALID", "Некорректное значение preference");
    }
    const expectedVersion =
      body.expectedVersion === undefined || body.expectedVersion === null
        ? 0
        : Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw unprocessable("EXPECTED_VERSION_INVALID", "Некорректный expectedVersion");
    }
    const eventPatch = parseEventPreferences(body.eventPreferences);
    const operation = "push.preference.set";
    const requestHash = this.idempotency.requestHash({
      enabled: body.enabled,
      expectedVersion,
      eventPreferences: eventPatch ?? null,
    });
    return this.mutations.runIdempotent<PushPreferenceResultDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async () => undefined,
      execute: async (client) => {
        await client.query(`SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE`, [
          actorId,
        ]);
        const existing = await client.query<PrefRow>(
          `SELECT enabled, version,
                  notify_invites, notify_application_decisions,
                  notify_new_applications, notify_game_changes,
                  notify_outcome_reminders
           FROM web_push_preferences WHERE user_id = $1 FOR UPDATE`,
          [actorId],
        );
        const currentVersion = existing.rows[0]?.version ?? 0;
        if (currentVersion !== expectedVersion) {
          throw conflict(
            "PUSH_PREFERENCE_VERSION_CONFLICT",
            "Настройка уведомлений изменилась. Обновите данные.",
          );
        }
        const nextEvents = {
          ...mapEventPrefs(existing.rows[0]),
          ...(eventPatch ?? {}),
        };
        if (!existing.rows[0]) {
          const inserted = await client.query<PrefRow>(
            `INSERT INTO web_push_preferences (
               user_id, enabled, version, updated_at,
               notify_invites, notify_application_decisions,
               notify_new_applications, notify_game_changes,
               notify_outcome_reminders
             ) VALUES ($1, $2, 1, now(), $3, $4, $5, $6, $7)
             RETURNING enabled, version,
                       notify_invites, notify_application_decisions,
                       notify_new_applications, notify_game_changes,
                       notify_outcome_reminders`,
            [
              actorId,
              body.enabled,
              nextEvents.invites,
              nextEvents.applicationDecisions,
              nextEvents.newApplications,
              nextEvents.gameChanges,
              nextEvents.outcomeReminders,
            ],
          );
          return {
            statusCode: 200,
            body: {
              preferenceEnabled: inserted.rows[0]!.enabled,
              preferenceVersion: inserted.rows[0]!.version,
              eventPreferences: mapEventPrefs(inserted.rows[0]),
            },
          };
        }
        const cur = existing.rows[0];
        const sameMaster = cur.enabled === body.enabled;
        const sameEvents =
          cur.notify_invites === nextEvents.invites &&
          cur.notify_application_decisions === nextEvents.applicationDecisions &&
          cur.notify_new_applications === nextEvents.newApplications &&
          cur.notify_game_changes === nextEvents.gameChanges &&
          cur.notify_outcome_reminders === nextEvents.outcomeReminders;
        if (sameMaster && sameEvents) {
          return {
            statusCode: 200,
            body: {
              preferenceEnabled: cur.enabled,
              preferenceVersion: cur.version,
              eventPreferences: mapEventPrefs(cur),
            },
          };
        }
        const updated = await client.query<PrefRow>(
          `UPDATE web_push_preferences
           SET enabled = $2,
               notify_invites = $3,
               notify_application_decisions = $4,
               notify_new_applications = $5,
               notify_game_changes = $6,
               notify_outcome_reminders = $7,
               version = version + 1,
               updated_at = now()
           WHERE user_id = $1
           RETURNING enabled, version,
                     notify_invites, notify_application_decisions,
                     notify_new_applications, notify_game_changes,
                     notify_outcome_reminders`,
          [
            actorId,
            body.enabled,
            nextEvents.invites,
            nextEvents.applicationDecisions,
            nextEvents.newApplications,
            nextEvents.gameChanges,
            nextEvents.outcomeReminders,
          ],
        );
        return {
          statusCode: 200,
          body: {
            preferenceEnabled: updated.rows[0]!.enabled,
            preferenceVersion: updated.rows[0]!.version,
            eventPreferences: mapEventPrefs(updated.rows[0]),
          },
        };
      },
    });
  }

  async registerDevice(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    body: PushRegisterBody,
  ): Promise<{ statusCode: number; body: PushRegisterResultDto }> {
    this.assertFeature();
    const validated = validatePushEndpoint(body.endpoint);
    const keys = validatePushKeys(body.keys ?? {});
    const operation = "push.subscription.register";
    const requestHash = this.idempotency.requestHash({
      endpointHash: validated.endpointHash,
      p256dh: keys.p256dh,
      auth: keys.auth,
    });
    return this.mutations.runIdempotent<PushRegisterResultDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, receipt) => {
        const row = await client.query<{ id: string; user_id: string }>(
          `SELECT id, user_id FROM web_push_subscriptions WHERE id = $1`,
          [receipt.id],
        );
        if (!row.rows[0] || row.rows[0].user_id !== actorId) {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
      },
      execute: async (client) => {
        await client.query(`SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE`, [
          actorId,
        ]);
        const session = await client.query<{ id: string }>(
          `SELECT id FROM app_sessions
           WHERE id = $1 AND user_id = $2
             AND revoked_at IS NULL AND expires_at > now()
           FOR SHARE`,
          [sessionId, actorId],
        );
        if (!session.rows[0]) {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }

        const existing = await client.query<{
          id: string;
          user_id: string;
          session_id: string;
          unbound_at: Date | null;
        }>(
          `SELECT id, user_id, session_id, unbound_at
           FROM web_push_subscriptions
           WHERE endpoint_hash = $1
           FOR UPDATE`,
          [validated.endpointHash],
        );

        const endpointSealed = sealSecret(this.env.AUTH_PEPPER, validated.endpoint);
        const p256dhSealed = sealSecret(this.env.AUTH_PEPPER, keys.p256dh);
        const authSealed = sealSecret(this.env.AUTH_PEPPER, keys.auth);

        if (existing.rows[0]) {
          const row = existing.rows[0];
          if (row.user_id !== actorId) {
            if (row.unbound_at == null) {
              const foreignSession = await client.query<{ ok: boolean }>(
                `SELECT true AS ok FROM app_sessions
                 WHERE id = $1 AND user_id = $2
                   AND revoked_at IS NULL AND expires_at > now()`,
                [row.session_id, row.user_id],
              );
              if (foreignSession.rows[0]) {
                throw conflict(
                  "PUSH_ENDPOINT_OWNED",
                  "Подписка уже привязана к другой сессии",
                );
              }
            }
            // Old foreign session invalid — rebind to current actor/session.
            await client.query(
              `UPDATE web_push_subscriptions
               SET user_id = $2,
                   session_id = $3,
                   endpoint_sealed = $4,
                   p256dh_sealed = $5,
                   auth_sealed = $6,
                   endpoint_host = $7,
                   unbound_at = NULL,
                   updated_at = now()
               WHERE id = $1`,
              [
                row.id,
                actorId,
                sessionId,
                endpointSealed,
                p256dhSealed,
                authSealed,
                validated.host,
              ],
            );
            await this.enforceDeviceCap(client, actorId, row.id);
            const count = await this.activeDeviceCount(client, actorId);
            return {
              statusCode: 200,
              body: {
                id: row.id,
                accountFence: accountFence(this.env.AUTH_PEPPER, actorId),
                deviceCount: count,
              },
            };
          }
          // Same account: refresh keys / rebind session (account switch on same browser).
          await client.query(
            `UPDATE web_push_subscriptions
             SET session_id = $2,
                 endpoint_sealed = $3,
                 p256dh_sealed = $4,
                 auth_sealed = $5,
                 endpoint_host = $6,
                 unbound_at = NULL,
                 updated_at = now()
             WHERE id = $1`,
            [
              row.id,
              sessionId,
              endpointSealed,
              p256dhSealed,
              authSealed,
              validated.host,
            ],
          );
          await this.enforceDeviceCap(client, actorId, row.id);
          const count = await this.activeDeviceCount(client, actorId);
          return {
            statusCode: 200,
            body: {
              id: row.id,
              accountFence: accountFence(this.env.AUTH_PEPPER, actorId),
              deviceCount: count,
            },
          };
        }

        const countBefore = await this.activeDeviceCount(client, actorId);
        if (countBefore >= WEB_PUSH_MAX_DEVICES) {
          throw conflict(
            "PUSH_DEVICE_LIMIT",
            "Достигнут лимит устройств для уведомлений",
          );
        }
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO web_push_subscriptions (
             user_id, session_id, endpoint_hash, endpoint_sealed,
             p256dh_sealed, auth_sealed, endpoint_host
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            actorId,
            sessionId,
            validated.endpointHash,
            endpointSealed,
            p256dhSealed,
            authSealed,
            validated.host,
          ],
        );
        const id = inserted.rows[0]!.id;
        return {
          statusCode: 201,
          body: {
            id,
            accountFence: accountFence(this.env.AUTH_PEPPER, actorId),
            deviceCount: countBefore + 1,
          },
        };
      },
    });
  }

  async unsubscribeDevice(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    subscriptionId: string,
  ): Promise<{ statusCode: number; body: { unbound: true } }> {
    this.assertFeature();
    if (typeof subscriptionId !== "string" || !/^[0-9a-f-]{36}$/i.test(subscriptionId)) {
      throw badRequest("PUSH_SUBSCRIPTION_ID_INVALID", "Некорректный идентификатор подписки");
    }
    const operation = "push.subscription.unsubscribe";
    const requestHash = this.idempotency.requestHash({ subscriptionId });
    return this.mutations.runIdempotent<{ unbound: true }>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async () => undefined,
      execute: async (client) => {
        const row = await client.query<{ id: string; unbound_at: Date | null }>(
          `SELECT id, unbound_at FROM web_push_subscriptions
           WHERE id = $1 AND user_id = $2
           FOR UPDATE`,
          [subscriptionId, actorId],
        );
        if (!row.rows[0]) {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }
        if (row.rows[0].unbound_at == null) {
          await client.query(
            `UPDATE web_push_subscriptions
             SET unbound_at = now(), updated_at = now()
             WHERE id = $1`,
            [subscriptionId],
          );
        }
        return { statusCode: 200, body: { unbound: true } };
      },
    });
  }

  async unsubscribeCurrentDevice(
    actorId: string,
    sessionId: string,
    idempotencyKey: string,
    body: { endpoint?: unknown },
  ): Promise<{ statusCode: number; body: { unbound: true } }> {
    this.assertFeature();
    const validated = validatePushEndpoint(body.endpoint);
    const operation = "push.subscription.unsubscribe_current";
    const requestHash = this.idempotency.requestHash({
      endpointHash: validated.endpointHash,
    });
    return this.mutations.runIdempotent<{ unbound: true }>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async () => undefined,
      execute: async (client) => {
        await client.query(
          `UPDATE web_push_subscriptions
           SET unbound_at = COALESCE(unbound_at, now()), updated_at = now()
           WHERE user_id = $1 AND endpoint_hash = $2 AND unbound_at IS NULL`,
          [actorId, validated.endpointHash],
        );
        return { statusCode: 200, body: { unbound: true } };
      },
    });
  }

  /** Same-TX unbind for session revocation paths (no Nest cycle). */
  static async unbindSessions(
    client: PoolClient,
    sessionIds: string[],
  ): Promise<void> {
    if (sessionIds.length === 0) return;
    // Probe first: UPDATE on a missing relation aborts the TX (42P01), so a
    // catch-and-return leaves revoke COMMIT as a silent rollback. Skip only when
    // the table is genuinely absent (pre-0055 partial fixtures); real errors propagate.
    const installed = await client.query<{ name: string | null }>(
      `SELECT to_regclass('public.web_push_subscriptions')::text AS name`,
    );
    if (!installed.rows[0]?.name) {
      return;
    }
    await client.query(
      `UPDATE web_push_subscriptions
       SET unbound_at = COALESCE(unbound_at, now()), updated_at = now()
       WHERE session_id = ANY($1::uuid[]) AND unbound_at IS NULL`,
      [sessionIds],
    );
  }

  private async activeDeviceCount(
    client: PoolClient,
    userId: string,
  ): Promise<number> {
    const row = await client.query<{ n: string | number }>(
      `SELECT count(*)::int AS n FROM web_push_subscriptions
       WHERE user_id = $1 AND unbound_at IS NULL`,
      [userId],
    );
    return Number(row.rows[0]?.n ?? 0);
  }

  private async enforceDeviceCap(
    client: PoolClient,
    userId: string,
    keepId: string,
  ): Promise<void> {
    const rows = await client.query<{ id: string }>(
      `SELECT id FROM web_push_subscriptions
       WHERE user_id = $1 AND unbound_at IS NULL
       ORDER BY (id = $2) DESC, created_at ASC`,
      [userId, keepId],
    );
    if (rows.rows.length <= WEB_PUSH_MAX_DEVICES) return;
    const drop = rows.rows.slice(WEB_PUSH_MAX_DEVICES).map((r) => r.id);
    await client.query(
      `UPDATE web_push_subscriptions
       SET unbound_at = now(), updated_at = now()
       WHERE id = ANY($1::uuid[])`,
      [drop],
    );
  }
}
