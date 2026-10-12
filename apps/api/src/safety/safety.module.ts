import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProfilesModule } from "../profiles/profiles.module";
import { BlocksController } from "./blocks.controller";
import { PairFenceService } from "./pair-fence.service";
import { ReportsController } from "./reports.controller";
import { SafetyService } from "./safety.service";

@Module({
  imports: [AuthModule, ProfilesModule],
  controllers: [BlocksController, ReportsController],
  providers: [SafetyService, PairFenceService],
  exports: [SafetyService, PairFenceService],
})
export class SafetyModule {}
