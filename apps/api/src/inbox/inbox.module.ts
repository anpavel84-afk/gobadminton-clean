import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GameChatModule } from "../game-chat/game-chat.module";
import { MessagingModule } from "../messaging/messaging.module";
import { InboxController } from "./inbox.controller";
import { InboxFeatureService } from "./inbox-feature";
import { InboxService } from "./inbox.service";

@Module({
  imports: [AuthModule, MessagingModule, GameChatModule],
  controllers: [InboxController],
  providers: [InboxService, InboxFeatureService],
  exports: [InboxService, InboxFeatureService],
})
export class InboxModule {}
