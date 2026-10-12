import { UnifiedPlayersController } from "./unified.controller";
import { UnifiedPlayersService } from "./unified.service";
import { UnifiedPublishingService } from "./unified-publishing.service";
import { SafetyModule } from "../safety/safety.module";
import { GeographicRadarService } from "./geographic.service";
import { GeographicRadarController } from "./geographic.controller";
import { ProfilesModule } from "../profiles/profiles.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MeRadarController } from "./me-radar.controller";
import { RadarBudgetService } from "./radar-budget.service";
import { RadarDemoService } from "./radar-demo";
import { RadarFeatureService } from "./radar-feature";
import { RadarPreviewController } from "./radar-preview.controller";
import { RadarProofService } from "./radar-proof.service";
import { RadarService } from "./radar.service";

@Module({
  imports: [AuthModule, ProfilesModule, SafetyModule],
  controllers: [UnifiedPlayersController, MeRadarController, RadarPreviewController, GeographicRadarController],
  providers: [
    UnifiedPlayersService,
    UnifiedPublishingService,
    RadarService,
    GeographicRadarService,
    RadarFeatureService,
    RadarDemoService,
    RadarBudgetService,
    RadarProofService,
  ],
  exports: [RadarService, RadarFeatureService, RadarProofService],
})
export class RadarModule {}
