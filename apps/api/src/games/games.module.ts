import { GameCoverService } from "./game-cover.service";
import { GameCoverController } from "./game-cover.controller";
import { GameAttendanceController } from "./game-attendance.controller";
import { GameAttendanceService } from "./game-attendance.service";
import { GameOutcomesController } from "./game-outcomes.controller";
import { GameOutcomesService } from "./game-outcomes.service";
import { ModerationModule } from "../moderation/moderation.module";
import { ProfilesModule } from "../profiles/profiles.module";
import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OutboxService } from "../common/outbox.service";
import { GameChatModule } from "../game-chat/game-chat.module";
import { InvitationsModule } from "../invitations/invitations.module";
import { ParticipationsModule } from "../participations/participations.module";
import { TrainersModule } from "../trainers/trainers.module";
import { GameAuthorityService } from "./game-authority.service";
import { GamesController } from "./games.controller";
import { GamesService } from "./games.service";
import { MeGamesController } from "./me-games.controller";

@Module({
  imports: [
    AuthModule,
    ModerationModule,
    ProfilesModule,
    TrainersModule,
    forwardRef(() => ParticipationsModule),
    forwardRef(() => InvitationsModule),
    GameChatModule,
  ],
  controllers: [
    GameCoverController,
    GameOutcomesController,
    GameAttendanceController,
    GamesController,
    MeGamesController,
  ],
  providers: [
    GameCoverService,
    GameAttendanceService,
    GameOutcomesService,
    GamesService,
    GameAuthorityService,
    OutboxService,
  ],
  exports: [GamesService, GameAuthorityService],
})
export class GamesModule {}
