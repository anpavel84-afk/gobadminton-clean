import { ProfilesModule } from "../profiles/profiles.module";
import { ModerationModule } from "../moderation/moderation.module";
import { VenueCoverService } from "../venues/venue-cover.service";
import { VenueGalleryService } from "../venues/venue-gallery.service";
import { AdminVenuesService } from "../venues/admin-venues.service";
import { AdminVenuesController } from "./venues.controller";
import { AdminCasesController } from "./cases.controller";
import { AdminCasesService } from "./cases.service";
import { CASE_EVIDENCE_POLICY, SyntheticCaseEvidencePolicy } from "./case-evidence-policy";
import { AdminUserRestrictionsController } from "./user-restrictions.controller";
import { AdminUserRestrictionsService } from "./user-restrictions.service";
import { GamesModule } from "../games/games.module";
import { AdminGameModerationController } from "./game-moderation.controller";
import { AdminGameModerationService } from "./game-moderation.service";
import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { ADMIN_PROVIDER_OVERRIDES, AdminProviders } from "./admin-providers";
@Module({
  imports: [GamesModule, ProfilesModule, ModerationModule],
  controllers: [AdminVenuesController, AdminCasesController, AdminController, AdminGameModerationController, AdminUserRestrictionsController],
  providers: [
    AdminCasesService,
    { provide: CASE_EVIDENCE_POLICY, useClass: SyntheticCaseEvidencePolicy },
    AdminService,
    AdminVenuesService,
    VenueGalleryService,
    VenueCoverService,
    AdminUserRestrictionsService,
    AdminGameModerationService,
    AdminProviders,
    { provide: ADMIN_PROVIDER_OVERRIDES, useValue: null },
  ],
  exports: [AdminService],
})
export class AdminModule {}
