import { createHash } from "node:crypto";
import type { AuthMail } from "./mail-transport";

export function authMessageId(deliveryId: string): string {
    return `<auth.${createHash("sha256").update(deliveryId).digest("hex")}@gobadminton.ru>`;
}
export function authMailContent(mail: AuthMail): { subject: string; text: string; html: string } {
    if (!/^\d{8}$/.test(mail.code) || !Number.isFinite(mail.expiresAt.getTime())) {
        throw new Error("INVALID_AUTH_MAIL");
    }
    const expiry = mail.expiresAt.toISOString().replace("T", " ").replace(".000Z", " UTC");
    return {
        subject: "Код входа в GoBadminton",
        text: `Ваш код входа в GoBadminton: ${mail.code}\nКод действует до ${expiry}.\nНикому не сообщайте код. Если вы не запрашивали вход, проигнорируйте письмо.`,
        html: `<div lang="ru"><h1>Вход в GoBadminton</h1><p>Ваш одноразовый код:</p><p style="font-size:28px;letter-spacing:4px"><strong>${mail.code}</strong></p><p>Код действует до ${expiry}.</p><p>Никому не сообщайте код. Если вы не запрашивали вход, проигнорируйте письмо.</p></div>`,
    };
}
