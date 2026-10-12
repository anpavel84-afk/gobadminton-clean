import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GameChatController } from "./game-chat.controller";
import { GameChatFeatureService } from "./game-chat-feature";
import { GameChatService } from "./game-chat.service";

@Module({
  imports: [AuthModule],
  controllers: [GameChatController],
  providers: [GameChatService, GameChatFeatureService],
  exports: [GameChatService, GameChatFeatureService],
})
export class GameChatModule {}
