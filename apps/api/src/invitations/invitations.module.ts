import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OutboxService } from "../common/outbox.service";
import { GamesModule } from "../games/games.module";
import { DiscoveryProofHook } from "../messaging/discovery-proof.hook";
import { ParticipationsModule } from "../participations/participations.module";
import { ProfilesModule } from "../profiles/profiles.module";
import { RadarModule } from "../radar/radar.module";
import { SafetyModule } from "../safety/safety.module";
import { InvitationFeatureService } from "./invitation-feature";
import { InvitationsController } from "./invitations.controller";
import { InvitationsService } from "./invitations.service";

@Module({
  imports: [
    AuthModule,
    ProfilesModule,
    SafetyModule,
    forwardRef(() => GamesModule),
    forwardRef(() => ParticipationsModule),
    RadarModule,
  ],
  controllers: [InvitationsController],
  providers: [
    InvitationsService,
    InvitationFeatureService,
    DiscoveryProofHook,
    OutboxService,
  ],
  exports: [InvitationsService, InvitationFeatureService],
})
export class InvitationsModule {}
