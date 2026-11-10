import { ProfilesModule } from "../profiles/profiles.module";
import { VenuePhotoCandidatesController, VenuePhotoCandidatesService } from "./venue-photo-candidates";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModerationModule } from "../moderation/moderation.module";
import { VenuesController } from "./venues.controller";
import { VenuesService } from "./venues.service";
import { VenueReviewsController } from "./venue-reviews.controller";
import { VenueReviewsService } from "./venue-reviews.service";

@Module({
  imports: [AuthModule, ModerationModule, ProfilesModule],
  controllers: [VenuesController, VenueReviewsController, VenuePhotoCandidatesController],
  providers: [VenuesService, VenueReviewsService, VenuePhotoCandidatesService],
  exports: [VenuesService, VenueReviewsService, VenuePhotoCandidatesService],
})
export class VenuesModule {}
