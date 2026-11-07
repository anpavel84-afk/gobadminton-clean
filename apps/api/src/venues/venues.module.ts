import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModerationModule } from "../moderation/moderation.module";
import { VenuesController } from "./venues.controller";
import { VenuesService } from "./venues.service";
import { VenueReviewsController } from "./venue-reviews.controller";
import { VenueReviewsService } from "./venue-reviews.service";

@Module({
  imports: [AuthModule, ModerationModule],
  controllers: [VenuesController, VenueReviewsController],
  providers: [VenuesService, VenueReviewsService],
  exports: [VenuesService, VenueReviewsService],
})
export class VenuesModule {}
