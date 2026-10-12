import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RadarProofService } from "../radar/radar-proof.service";

/**
 * Optional first-contact seam used by DM and GameInvitation.
 * Ordinary directory contact does not require Radar / proof.
 */
@Injectable()
export class DiscoveryProofHook {
  constructor(private readonly proofs: RadarProofService) {}

  usesGeographicFence(proof: unknown): boolean {
    return this.proofs.usesGeographicFence(proof);
  }

  async assertFinalProof(
    client: PoolClient,
    input: {
      actorId: string;
      sessionId: string;
      targetUserId: string;
      discoveryProof?: string | null;
    },
  ): Promise<void> {
    await this.proofs.assertFinalGeographicProof(client, input);
  }

  async assertOptionalProof(
    client: PoolClient,
    input: {
      actorId: string;
      sessionId: string;
      targetUserId: string;
      discoveryProof?: string | null;
    },
  ): Promise<void> {
    await this.proofs.assertOptionalDiscoveryProof(client, input);
  }
}
