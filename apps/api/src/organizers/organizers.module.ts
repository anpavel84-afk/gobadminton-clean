import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModerationModule } from "../moderation/moderation.module";
import { OrganizersController } from "./organizers.controller";
import { OrganizersService } from "./organizers.service";

@Module({
  imports: [AuthModule, ModerationModule],
  controllers: [OrganizersController],
  providers: [OrganizersService],
  exports: [OrganizersService],
})
export class OrganizersModule {}
