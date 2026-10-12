import { randomInt } from "node:crypto";
import { domainToASCII } from "node:url";
import type { AppEnv } from "../config/env";
import { hmacSha256Hex } from "./crypto";
import { unprocessable } from "./problem";
export const EMAIL_BINDING_COOKIE = "__Host-gb_email_auth_binding";
export const EMAIL_DELIVERY_QUEUE = "auth.email.delivery";
export const EMAIL_DEAD_QUEUE = "auth.email.delivery.dead";
export const EMAIL_CLEANUP_QUEUE = "auth.email.cleanup";
export function emailAuthEnabled(env: AppEnv): boolean {
    return env.EMAIL_AUTH_TRANSPORT === "fake" && env.NODE_ENV === "test" && env.APP_ENV === "local"
        && [env.PUBLIC_API_ORIGIN, env.PUBLIC_WEB_ORIGIN].every(origin => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname));
}
export function normalizeEmail(input: unknown): {
    canonical: string;
    display: string;
} {
    const invalid = () => unprocessable("EMAIL_INVALID", "Некорректный email");
    if (typeof input !== "string" || input.length > 320)
        throw invalid();
    const display = input.trim().normalize("NFC");
    const parts = display.split("@");
    if (parts.length !== 2)
        throw invalid();
    const [local, domain] = parts as [
        string,
        string
    ];
    if (!local || local.length > 64 || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)
        || local.startsWith(".") || local.endsWith(".") || local.includes(".."))
        throw invalid();
    if (!/^[\p{L}\p{N}\p{M}.-]+$/u.test(domain))
        throw invalid();
    const ascii = domainToASCII(domain).toLowerCase();
    if (!ascii || ascii.length > 253 || !ascii.includes(".") || ascii.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
        throw invalid();
    const canonical = `${local.toLowerCase()}@${ascii}`;
    if (canonical.length > 254)
        throw invalid();
    return { canonical, display };
}
export function newEmailCode(): string { return randomInt(0, 100000000).toString().padStart(8, "0"); }
export function emailCodeHash(secret: string, id: string, generation: number, code: string): string {
    return hmacSha256Hex(secret, JSON.stringify(["email-code-v1", id, generation, code]));
}
export function maskEmail(email: string): string {
    const [local, domain] = email.split("@");
    return `${local?.slice(0, 1)}***@${domain}`;
}
