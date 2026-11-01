import { constants, closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { AppEnv } from "../config/env";
import { authMailContent, authMessageId } from "./auth-mail-template";
import { normalizeEmail } from "./email-security";
import { FakeMailTransport, MailDeliveryError, type AuthMail, type MailTransport } from "./mail-transport";

/** Read only in the worker. No credential is accepted from request/client input. */
export function readSmtpPassword(file: string): string {
    let fd: number | undefined;
    try {
        fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size < 1 || stat.size > 4096) {
            throw new Error();
        }
        // One optional line ending for installation with a secret-file editor.
        const password = readFileSync(fd, "utf8").replace(/\r?\n$/, "");
        if (!password || /[\r\n\0]/.test(password)) throw new Error();
        return password;
    } catch {
        throw new Error("SMTP_CREDENTIAL_UNAVAILABLE");
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

function classify(error: unknown): MailDeliveryError {
    const e = error as { responseCode?: number; code?: string } | null;
    // SMTP 4xx and network failures are retryable by the existing delivery queue.
    if (e?.responseCode !== undefined && e.responseCode >= 400 && e.responseCode < 500) return new MailDeliveryError("temporary");
    const permanent = (e?.responseCode !== undefined && e.responseCode >= 500 && e.responseCode < 600) ||
        ["EAUTH", "EENVELOPE", "EMESSAGE", "ESTREAM"].includes(e?.code ?? "");
    return new MailDeliveryError(permanent ? "permanent" : "temporary");
}

export class SmtpMailTransport implements MailTransport {
    private readonly client;
    constructor(private readonly env: AppEnv) {
        if (env.EMAIL_AUTH_TRANSPORT !== "smtp") throw new Error("SMTP_TRANSPORT_DISABLED");
        this.client = nodemailer.createTransport({
            host: env.MAIL_SMTP_HOST, port: env.MAIL_SMTP_PORT, secure: true,
            auth: { user: env.MAIL_SMTP_USERNAME, pass: readSmtpPassword(env.MAIL_AUTH_FILE) },
            tls: { rejectUnauthorized: true, minVersion: "TLSv1.2", servername: env.MAIL_SMTP_HOST },
            pool: false, logger: false, debug: false,
            connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
            dnsTimeout: 10_000, disableFileAccess: true, disableUrlAccess: true,
        } satisfies SMTPTransport.Options);
    }
    async verify(): Promise<void> {
        try { await this.client.verify(); } catch (error) { throw classify(error); }
    }
    async sendAuthCode(mail: AuthMail): Promise<{ messageId: string }> {
        try {
            if (normalizeEmail(mail.to).canonical !== mail.to || mail.expiresAt.getTime() <= Date.now()) {
                throw new MailDeliveryError("permanent");
            }
            const messageId = authMessageId(mail.deliveryId);
            const result = await this.client.sendMail({
                from: { name: "GoBadminton", address: this.env.MAIL_FROM_ADDRESS },
                replyTo: this.env.MAIL_REPLY_TO, to: { address: mail.to, name: "" },
                envelope: { from: this.env.MAIL_FROM_ADDRESS, to: [mail.to] },
                messageId, ...authMailContent(mail),
                disableFileAccess: true, disableUrlAccess: true,
            });
            if (result.rejected.length || !result.accepted.length) throw new MailDeliveryError("permanent");
            return { messageId };
        } catch (error) {
            if (error instanceof MailDeliveryError) throw error;
            throw classify(error);
        }
    }
}
export function createMailTransport(env: AppEnv): MailTransport {
    if (env.EMAIL_AUTH_TRANSPORT === "smtp") return new SmtpMailTransport(env);
    if (env.EMAIL_AUTH_TRANSPORT === "fake") return new FakeMailTransport(env);
    throw new Error("EMAIL_AUTH_DISABLED");
}
