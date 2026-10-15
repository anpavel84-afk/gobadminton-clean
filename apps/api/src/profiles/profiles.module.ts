import { DiscoveryPreferencesService } from "./discovery-preferences.service";
import { MeDiscoveryPreferenceController } from "./me-discovery-preference.controller";
import { GamePreferencesService } from "./game-preferences.service";
import { MeGamePreferencesController } from "./me-game-preferences.controller";
import { CoverController } from "./cover.controller";
import { AvatarController } from "./avatar.controller";
import { AvatarService } from "./avatar.service";
import { Module } from "@nestjs/common";
import { ModerationModule } from "../moderation/moderation.module";
import { AuthModule } from "../auth/auth.module";
import { MeLookingController } from "./me-looking.controller";
import { MeSocialProfileController } from "./me-social-profile.controller";
import { PlayersController } from "./players.controller";
import { ProfilesService } from "./profiles.service";
import { SocialFeatureService } from "./social-feature";

@Module({
  imports: [AuthModule, ModerationModule],
  controllers: [
    MeDiscoveryPreferenceController,
    MeGamePreferencesController,
    AvatarController,
    CoverController,
    MeSocialProfileController,
    MeLookingController,
    PlayersController,
  ],
  providers: [DiscoveryPreferencesService, GamePreferencesService, AvatarService, ProfilesService, SocialFeatureService],
  exports: [GamePreferencesService, ProfilesService, SocialFeatureService],
})
export class ProfilesModule {}
