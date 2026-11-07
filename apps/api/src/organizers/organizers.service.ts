import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../tokens";
import { unprocessable } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import {
  ContentModerationService,
  type TextBatchApproval,
} from "../moderation/moderation.service";
import type { TextFieldCandidate } from "../moderation/text-policy";

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
    private readonly moderation: ContentModerationService,
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
    const receipt = {
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async () => undefined,
    };
    const replay = await this.mutations.findReplay<OrganizerDto>(receipt);
    if (replay) return replay;

    const textFields: TextFieldCandidate[] = [
      {
        surface: "organizer_display_name",
        text: displayName,
        fieldId: "displayName",
      },
      {
        surface: "organizer_public_contact",
        text: publicContact,
        fieldId: "publicContact",
      },
    ];
    const textApproval: TextBatchApproval = await this.moderation.approveTexts(
      userId,
      textFields,
    );

    return this.mutations.runIdempotent<OrganizerDto>({
      ...receipt,
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
        await this.moderation.bindTexts(
          client,
          textApproval,
          [
            { surface: "organizer_display_name", text: row.display_name },
            { surface: "organizer_public_contact", text: row.public_contact },
          ],
          {
            entityKind: "organizer",
            entityId: row.id,
            resourceVersion: 1,
            actorUserId: userId,
            bindingKind: "publication",
          },
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
}
