import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SafetyModule } from "../safety/safety.module";
import { FriendshipsController } from "./friendships.controller";
import { FriendshipsService } from "./friendships.service";
@Module({ imports: [AuthModule, SafetyModule], controllers: [FriendshipsController], providers: [FriendshipsService], exports: [FriendshipsService] })
export class FriendshipsModule {}
