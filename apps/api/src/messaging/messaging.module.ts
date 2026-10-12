import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProfilesModule } from "../profiles/profiles.module";
import { RadarModule } from "../radar/radar.module";
import { SafetyModule } from "../safety/safety.module";
import { ConversationsController } from "./conversations.controller";
import { ContactStateController } from "./contact-state.controller";
import { DiscoveryProofHook } from "./discovery-proof.hook";
import { DmFeatureService } from "./dm-feature";
import { MessagingService } from "./messaging.service";

@Module({
  imports: [AuthModule, ProfilesModule, SafetyModule, RadarModule],
  controllers: [ConversationsController, ContactStateController],
  providers: [MessagingService, DmFeatureService, DiscoveryProofHook],
  exports: [MessagingService, DmFeatureService],
})
export class MessagingModule {}
