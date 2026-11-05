import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { parse, uuid } from "./dto";
import {
  venueReviewIntakeSchema,
  venueReviewPendingPageSchema,
} from "./venue-reviews.dto";
import { AdminVenueReviewsService } from "./venue-reviews.service";

@Controller("admin")
export class AdminVenueReviewsController {
  constructor(private readonly reviews: AdminVenueReviewsService) {}

  @Get("venue-reviews/pending-intakes")
  @Header("Cache-Control", "no-store")
  listPending(@Query() query: unknown, @Req() request: FastifyRequest) {
    this.reviews.enabled();
    return this.reviews.listPending(request, parse(venueReviewPendingPageSchema, query));
  }

  @Post("cases/venue-review-intake")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  intake(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    this.reviews.enabled();
    return this.reviews.intake(request, key, parse(venueReviewIntakeSchema, body));
  }

  @Get("cases/:id/venue-review-source")
  @Header("Cache-Control", "no-store")
  source(@Param("id") id: string, @Req() request: FastifyRequest) {
    this.reviews.enabled();
    return this.reviews.readSource(request, parse(uuid, id));
  }
}
