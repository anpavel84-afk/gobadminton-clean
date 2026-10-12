import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { TrainersController } from "./trainers.controller";
import { TrainersService } from "./trainers.service";

@Module({
  imports: [AuthModule],
  controllers: [TrainersController],
  providers: [TrainersService],
  exports: [TrainersService],
})
export class TrainersModule {}
