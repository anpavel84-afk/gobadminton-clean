import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SafetyModule } from "../safety/safety.module";
import { PlayInterestsController } from "./play-interests.controller";
import { PlayInterestsService } from "./play-interests.service";

@Module({
  imports: [AuthModule, SafetyModule],
  controllers: [PlayInterestsController],
  providers: [PlayInterestsService],
  exports: [PlayInterestsService],
})
export class PlayInterestsModule {}
