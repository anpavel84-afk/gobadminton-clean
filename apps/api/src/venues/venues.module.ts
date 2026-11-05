import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { VenuesController } from "./venues.controller";
import { VenuesService } from "./venues.service";
import { VenueReviewsController } from "./venue-reviews.controller";
import { VenueReviewsService } from "./venue-reviews.service";

@Module({
  imports: [AuthModule],
  controllers: [VenuesController, VenueReviewsController],
  providers: [VenuesService, VenueReviewsService],
  exports: [VenuesService, VenueReviewsService],
})
export class VenuesModule {}
