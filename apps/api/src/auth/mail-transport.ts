import { Inject, Injectable } from "@nestjs/common";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import { emailAuthEnabled } from "./email-security";
export type AuthMail = {
    to: string;
    code: string;
    expiresAt: Date;
    deliveryId: string;
};
export interface MailTransport {
    sendAuthCode(mail: AuthMail): Promise<{
        messageId: string;
    }>;
}
export class MailDeliveryError extends Error {
    constructor(public readonly kind: "temporary" | "permanent") { super("EMAIL_DELIVERY_FAILED"); }
}
/** TEST_ONLY memory sink. No mailbox API, file, console or public activation path. */
@Injectable()
export class FakeMailTransport implements MailTransport {
    private readonly mailbox = new Map<string, AuthMail>();
    private readonly failures = new Map<string, Array<"temporary" | "permanent">>();
    constructor(
    @Inject(APP_ENV)
    private readonly env: AppEnv) { }
    private assertTestOnly() { if (!emailAuthEnabled(this.env))
        throw new Error("FAKE_MAIL_TEST_ONLY"); }
    failNext(deliveryId: string, failures: Array<"temporary" | "permanent">): void {
        this.assertTestOnly();
        this.failures.set(deliveryId, [...failures]);
    }
    read(deliveryId: string): AuthMail | undefined {
        this.assertTestOnly();
        const mail = this.mailbox.get(deliveryId);
        return mail ? { ...mail } : undefined;
    }
    async sendAuthCode(mail: AuthMail): Promise<{
        messageId: string;
    }> {
        this.assertTestOnly();
        const failure = this.failures.get(mail.deliveryId)?.shift();
        if (failure)
            throw new MailDeliveryError(failure);
        this.mailbox.set(mail.deliveryId, { ...mail });
        return { messageId: `fake:${mail.deliveryId}` };
    }
}
