import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FriendshipsModule } from "../friendships/friendships.module";
import { GamesModule } from "../games/games.module";
import { GameRecommendationsController } from "./game-recommendations.controller";
import { GameRecommendationsService } from "./game-recommendations.service";
@Module({imports:[AuthModule,FriendshipsModule,GamesModule],controllers:[GameRecommendationsController],
  providers:[GameRecommendationsService],exports:[GameRecommendationsService]})
export class GameRecommendationsModule {}
