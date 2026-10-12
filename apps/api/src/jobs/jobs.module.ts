import { Global, Module } from "@nestjs/common";
import { JobEnqueueService } from "./job-enqueue.service";
import { SocialExpiryCleanupCommand } from "./social-expiry-cleanup.command";

@Global()
@Module({
  providers: [JobEnqueueService, SocialExpiryCleanupCommand],
  exports: [JobEnqueueService, SocialExpiryCleanupCommand],
})
export class JobsModule {}
