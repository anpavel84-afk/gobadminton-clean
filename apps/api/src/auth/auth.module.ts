import { AuthMethodService } from "./auth-method.service";
import { EmailAuthController } from "./email-auth.controller";
import { EmailAuthService } from "./email-auth.service";
import { FakeMailTransport } from "./mail-transport";
import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthTransactionService } from "./auth-transaction.service";
import { ConsumerAuthService } from "./consumer-auth.service";
import { IdentityService } from "./identity.service";
import { MeController } from "./me.controller";
import { AUTH_PROVIDER_OVERRIDES, ProviderRegistry } from "./providers/registry";
import { SessionService } from "./session.service";

@Module({
  controllers: [AuthController, MeController, EmailAuthController],
  providers: [
    AuthService,
    AuthMethodService,
    EmailAuthService,
    FakeMailTransport,
    AuthTransactionService,
    ConsumerAuthService,
    IdentityService,
    SessionService,
    ProviderRegistry,
    { provide: AUTH_PROVIDER_OVERRIDES, useValue: null },
  ],
  exports: [
    AuthService,
    ConsumerAuthService,
    IdentityService,
    SessionService,
    ProviderRegistry,
  ],
})
export class AuthModule {}
