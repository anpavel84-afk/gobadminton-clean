import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OutboxService } from "../common/outbox.service";
import { GameChatModule } from "../game-chat/game-chat.module";
import { GamesModule } from "../games/games.module";
import { ParticipationsController } from "./participations.controller";
import { ParticipationsService } from "./participations.service";

@Module({
  imports: [AuthModule, forwardRef(() => GamesModule), GameChatModule],
  controllers: [ParticipationsController],
  providers: [ParticipationsService, OutboxService],
  exports: [ParticipationsService],
})
export class ParticipationsModule {}
