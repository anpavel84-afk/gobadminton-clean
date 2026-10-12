import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OrganizersController } from "./organizers.controller";
import { OrganizersService } from "./organizers.service";

@Module({
  imports: [AuthModule],
  controllers: [OrganizersController],
  providers: [OrganizersService],
  exports: [OrganizersService],
})
export class OrganizersModule {}
