import { GameRecommendationsModule } from "./game-recommendations/game-recommendations.module";
import { FriendshipsModule } from "./friendships/friendships.module";
import { Module } from "@nestjs/common";
import { CityHintController } from "./discovery/city-hint.controller";
import { APP_FILTER } from "@nestjs/core";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { ProblemExceptionFilter } from "./common/problem.filter";
import { CoreModule } from "./core.module";
import { GamesModule } from "./games/games.module";
import { HealthController } from "./health/health.controller";
import { InvitationsModule } from "./invitations/invitations.module";
import { JobsModule } from "./jobs/jobs.module";
import { GameChatModule } from "./game-chat/game-chat.module";
import { InboxModule } from "./inbox/inbox.module";
import { MessagingModule } from "./messaging/messaging.module";
import { OrganizersModule } from "./organizers/organizers.module";
import { ParticipationsModule } from "./participations/participations.module";
import { ProfilesModule } from "./profiles/profiles.module";
import { RadarModule } from "./radar/radar.module";
import { SafetyModule } from "./safety/safety.module";
import { TrainersModule } from "./trainers/trainers.module";
import { VenuesModule } from "./venues/venues.module";

@Module({
  imports: [
    CoreModule,
    JobsModule,
    AuthModule,
    AdminModule,
    OrganizersModule,
    VenuesModule,
    TrainersModule,
    GamesModule,
    ParticipationsModule,
    InvitationsModule,
    ProfilesModule,
    SafetyModule,
    FriendshipsModule,
    GameRecommendationsModule,
    RadarModule,
    MessagingModule,
    GameChatModule,
    InboxModule,
  ],
  controllers: [HealthController, CityHintController],
  providers: [{ provide: APP_FILTER, useClass: ProblemExceptionFilter }],
})
export class AppModule {
  static async close(): Promise<void> {
    await CoreModule.close();
  }
}
