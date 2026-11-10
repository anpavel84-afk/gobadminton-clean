import { ProfilesModule } from "../profiles/profiles.module";
import { CommentPhotosController, CommentPhotosService } from "./comment-photos";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModerationModule } from "../moderation/moderation.module";
import { SafetyModule } from "../safety/safety.module";
import { CommentsController } from "./comments.controller";
import { CommentsService } from "./comments.service";

@Module({
  imports: [AuthModule, SafetyModule, ModerationModule, ProfilesModule],
  controllers: [CommentsController, CommentPhotosController],
  providers: [CommentsService, CommentPhotosService],
  exports: [CommentsService],
})
export class CommentsModule {}
