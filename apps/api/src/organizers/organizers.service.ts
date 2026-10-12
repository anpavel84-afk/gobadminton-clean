import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../tokens";
import { forbidden, notFound, unprocessable } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";

export type OrganizerDto = {
  id: string;
  kind: "personal";
  displayName: string;
  publicContact: string;
  onboardingStatus: "active" | "suspended";
  role: "owner" | "manager";
};

export type CreateOrganizerInput = {
  displayName: string;
  publicContact: string;
};

@Injectable()
export class OrganizersService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly idempotency: IdempotencyService,
    private readonly mutations: MutationRunner,
  ) {}

  async createPersonal(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    input: CreateOrganizerInput,
  ): Promise<{ statusCode: number; body: OrganizerDto }> {
    const displayName = input.displayName?.trim() ?? "";
    const publicContact = input.publicContact?.trim() ?? "";
    if (displayName.length < 1 || displayName.length > 160) {
      throw unprocessable("ORGANIZER_DISPLAY_NAME_INVALID", "Некорректное имя организатора");
    }
    if (publicContact.length < 1 || publicContact.length > 320) {
      throw unprocessable(
        "ORGANIZER_PUBLIC_CONTACT_INVALID",
        "Некорректный публичный контакт организатора",
      );
    }

    const operation = "organizers.createPersonal";
    const requestHash = this.idempotency.requestHash({ displayName, publicContact });
    return this.mutations.runIdempotent<OrganizerDto>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async () => undefined,
      execute: async (client) => {
        const organizer = await client.query<{
          id: string;
          kind: "personal";
          display_name: string;
          public_contact: string;
          onboarding_status: "active" | "suspended";
        }>(
          `INSERT INTO organizers
             (kind, display_name, public_contact, onboarding_status, created_by_user_id)
           VALUES ('personal', $1, $2, 'active', $3)
           RETURNING id, kind, display_name, public_contact, onboarding_status`,
          [displayName, publicContact, userId],
        );
        const row = organizer.rows[0]!;
        await client.query(
          `INSERT INTO organizer_memberships
             (organizer_id, user_id, role, status)
           VALUES ($1, $2, 'owner', 'active')`,
          [row.id, userId],
        );
        const body: OrganizerDto = {
          id: row.id,
          kind: row.kind,
          displayName: row.display_name,
          publicContact: row.public_contact,
          onboardingStatus: row.onboarding_status,
          role: "owner",
        };
        return { statusCode: 201, body };
      },
    });
  }

  async listMine(userId: string): Promise<{ items: OrganizerDto[] }> {
    const result = await this.pool.query<{
      id: string;
      kind: "personal";
      display_name: string;
      public_contact: string;
      onboarding_status: "active" | "suspended";
      role: "owner" | "manager";
    }>(
      `SELECT o.id, o.kind, o.display_name, o.public_contact, o.onboarding_status, m.role
       FROM organizers o
       INNER JOIN organizer_memberships m
         ON m.organizer_id = o.id
       WHERE m.user_id = $1
         AND m.status = 'active'
         AND o.onboarding_status = 'active'
       ORDER BY o.created_at ASC, o.id ASC`,
      [userId],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        displayName: row.display_name,
        publicContact: row.public_contact,
        onboardingStatus: row.onboarding_status,
        role: row.role,
      })),
    };
  }

  async assertCanManage(
    client: PoolClient,
    organizerId: string,
    userId: string,
  ): Promise<void> {
    const result = await client.query<{ role: string; status: string }>(
      `SELECT m.role, m.status
       FROM organizer_memberships m
       INNER JOIN organizers o ON o.id = m.organizer_id
       WHERE m.organizer_id = $1
         AND m.user_id = $2
         AND o.onboarding_status = 'active'
       FOR UPDATE OF m`,
      [organizerId, userId],
    );
    const membership = result.rows[0];
    if (!membership) {
      throw notFound("ORGANIZER_NOT_FOUND", "Организатор не найден");
    }
    if (membership.status !== "active") {
      throw forbidden(
        "MEMBERSHIP_REVOKED",
        "Членство организатора отозвано",
      );
    }
    if (membership.role !== "owner" && membership.role !== "manager") {
      throw forbidden("ORGANIZER_FORBIDDEN", "Недостаточно прав организатора");
    }
  }

  async revokeMembershipForTests(
    organizerId: string,
    userId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE organizer_memberships
       SET status = 'revoked', revoked_at = now(), updated_at = now()
       WHERE organizer_id = $1 AND user_id = $2`,
      [organizerId, userId],
    );
  }
}
