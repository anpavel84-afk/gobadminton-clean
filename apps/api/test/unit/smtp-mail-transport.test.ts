import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer as createTlsServer } from "node:tls";
import type { Socket } from "node:net";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { SMTPServer } from "smtp-server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../src/config/env";
import { fakeMailEnabled, emailAuthEnabled } from "../../src/auth/email-security";
import { FakeMailTransport } from "../../src/auth/mail-transport";
import { authMessageId } from "../../src/auth/auth-mail-template";
import { createMailTransport, readSmtpPassword, SmtpMailTransport } from "../../src/auth/smtp-mail-transport";

const secrets = {
    EMAIL_AUTH_HMAC_SECRET: "test-hmac-smtp-32-characters-long!!",
    EMAIL_AUTH_ENCRYPTION_SECRET: "test-encryption-smtp-32-characters-long!!",
    EMAIL_AUTH_RATE_SECRET: "test-rate-smtp-32-characters-long!!",
};
const base = { NODE_ENV: "test", APP_ENV: "local", DATABASE_URL: "postgres://test@127.0.0.1/test", PUBLIC_API_ORIGIN: "http://localhost:3000", PUBLIC_WEB_ORIGIN: "http://localhost:3001" };
const root = mkdtempSync(path.join(tmpdir(), "gb-smtp-"));
const file = path.join(root, "password");
const password = "synthetic-smtp-password";
const env = () => loadEnv({ ...base, ...secrets, EMAIL_AUTH_TRANSPORT: "smtp", MAIL_AUTH_FILE: file });
const mail = { to: "recipient@example.test", code: "01234567", deliveryId: "opaque-id:1", expiresAt: new Date(Date.now() + 600_000) };
let server: SMTPServer;
let port: number;
let rejectAuth = false;
let rejectData = false;
const messages: string[] = [];
const realCreate = nodemailer.createTransport.bind(nodemailer);

beforeAll(async () => {
    writeFileSync(file, password, { mode: 0o600 });
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(root, "key.pem"), "-out", path.join(root, "cert.pem"), "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
    server = new SMTPServer({
        secure: true, key: readFileSync(path.join(root, "key.pem")), cert: readFileSync(path.join(root, "cert.pem")), logger: false,
        onAuth(auth, _session, callback) {
            if (rejectAuth || auth.username !== "info@gobadminton.ru" || auth.password !== password) {
                const error = Object.assign(new Error("synthetic AUTH rejected"), { responseCode: 535 });
                callback(error); return;
            }
            callback(null, { user: "synthetic-user" });
        },
        onData(stream, _session, callback) {
            let content = "";
            stream.on("data", chunk => { content += String(chunk); });
            stream.on("end", () => {
                if (rejectData) { callback(Object.assign(new Error("synthetic temporary unavailable"), { responseCode: 451 })); return; }
                messages.push(content); callback();
            });
        },
    });
    server.on("error", () => undefined);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    port = (server.server.address() as AddressInfo).port;
});
afterEach(() => { vi.restoreAllMocks(); rejectAuth = false; rejectData = false; });
afterAll(async () => { await new Promise<void>(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
function fixtureTransport(overrides: Partial<SMTPTransport.Options> = {}) {
    vi.spyOn(nodemailer, "createTransport").mockImplementation(options => {
        const opts = options as SMTPTransport.Options;
        expect(opts).toMatchObject({ host: "mail.hosting.reg.ru", port: 465, secure: true, pool: false, logger: false, debug: false, tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" } });
        return realCreate({ ...opts, host: "127.0.0.1", port, tls: { ...opts.tls, servername: "localhost", ca: readFileSync(path.join(root, "cert.pem")) }, ...overrides });
    });
    return new SmtpMailTransport(env());
}
describe("SMTP auth delivery", () => {
    it("enables SMTP for server runtime while preserving strict fake isolation", () => {
        const smtp = env(); expect(emailAuthEnabled(smtp)).toBe(true); expect(fakeMailEnabled(smtp)).toBe(false);
        expect(() => new FakeMailTransport(smtp).read("anything")).toThrow("FAKE_MAIL_TEST_ONLY");
        expect(() => loadEnv({ ...base, ...secrets, EMAIL_AUTH_TRANSPORT: "fake", APP_ENV: "stage" })).toThrow();
        expect(() => loadEnv({ ...base, EMAIL_AUTH_TRANSPORT: "smtp" })).toThrow();
        expect(() => loadEnv({ ...base, ...secrets, EMAIL_AUTH_TRANSPORT: "smtp", MAIL_SMTP_SECURE: "false" })).toThrow();
        expect(() => loadEnv({ ...base, ...secrets, EMAIL_AUTH_TRANSPORT: "smtp", MAIL_FROM_ADDRESS: "attacker@example.test" })).toThrow();
        expect(() => createMailTransport(loadEnv(base))).toThrow("EMAIL_AUTH_DISABLED");
    });
    it("rejects empty, readable or symlink credentials with no value in errors", () => {
        const bad = path.join(root, "bad"); writeFileSync(bad, "", { mode: 0o600 });
        expect(() => readSmtpPassword(bad)).toThrow("SMTP_CREDENTIAL_UNAVAILABLE");
        writeFileSync(bad, password); chmodSync(bad, 0o644);
        expect(() => readSmtpPassword(bad)).toThrow("SMTP_CREDENTIAL_UNAVAILABLE");
        symlinkSync(file, path.join(root, "link"));
        expect(() => readSmtpPassword(path.join(root, "link"))).toThrow("SMTP_CREDENTIAL_UNAVAILABLE");
        expect(readSmtpPassword(file)).toBe(password);
    });
    it("authenticates via verified TLS and sends the real template with stable opaque Message-ID", async () => {
        const transport = fixtureTransport(); await transport.verify();
        const result = await transport.sendAuthCode(mail);
        expect(result).toEqual({ messageId: authMessageId(mail.deliveryId) });
        expect(messages.at(-1)!.replace(/\r\n[ \t]+/g, " ")).toContain(`Message-ID: ${result.messageId}`);
        const bodies = [...messages.at(-1)!.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?=----_NmP-)/g)]
            .map(match => Buffer.from(match[1]!, "base64").toString("utf8"));
        expect(bodies).toHaveLength(2);
        expect(bodies.every(body => body.includes("01234567") && body.includes("GoBadminton"))).toBe(true);
        expect(messages.at(-1)).toContain("Reply-To: info@gobadminton.ru");
        expect(messages.at(-1)).not.toContain(password);
        expect(result.messageId).not.toContain(mail.code);
        expect(result.messageId).not.toContain(mail.to);
    });
    it("wrong password is permanent and never leaks SMTP response or credentials", async () => {
        rejectAuth = true; const transport = fixtureTransport();
        await expect(transport.verify()).rejects.toMatchObject({ kind: "permanent", message: "EMAIL_DELIVERY_FAILED" });
        await expect(transport.sendAuthCode(mail)).rejects.toMatchObject({ kind: "permanent", message: "EMAIL_DELIVERY_FAILED" });
    });
    it("temporary SMTP error is retriable and keeps the generation's Message-ID", async () => {
        const transport = fixtureTransport(); rejectData = true;
        await expect(transport.sendAuthCode(mail)).rejects.toMatchObject({ kind: "temporary", message: "EMAIL_DELIVERY_FAILED" });
        rejectData = false;
        await expect(transport.sendAuthCode(mail)).resolves.toEqual({ messageId: authMessageId(mail.deliveryId) });
    });
    it("network refusal is temporary", async () => {
        const transport = fixtureTransport({ port: 1 });
        await expect(transport.sendAuthCode(mail)).rejects.toMatchObject({ kind: "temporary", message: "EMAIL_DELIVERY_FAILED" });
    });
    it("deliberately stalled TLS greeting times out with a sanitized temporary error", async () => {
        const sockets = new Set<Socket>();
        const stalled = createTlsServer({ key: readFileSync(path.join(root, "key.pem")), cert: readFileSync(path.join(root, "cert.pem")) }, socket => {
            sockets.add(socket); socket.on("close", () => sockets.delete(socket));
            // TLS succeeds, but this fixture never sends the SMTP greeting.
        });
        await new Promise<void>(resolve => stalled.listen(0, "127.0.0.1", resolve));
        try {
            const transport = fixtureTransport({ port: (stalled.address() as AddressInfo).port, greetingTimeout: 150 });
            const start = Date.now();
            await expect(transport.sendAuthCode(mail)).rejects.toMatchObject({ kind: "temporary", message: "EMAIL_DELIVERY_FAILED" });
            expect(Date.now() - start).toBeLessThan(3000);
        } finally {
            for (const socket of sockets) socket.destroy();
            await new Promise<void>(resolve => stalled.close(() => resolve()));
        }
    });
    it("rejects injected recipient, expired mail and invalid code before sending", async () => {
        const transport = fixtureTransport(); const before = messages.length;
        await expect(transport.sendAuthCode({ ...mail, to: "a@example.test\r\nBcc:b@example.test" })).rejects.toMatchObject({ message: "EMAIL_DELIVERY_FAILED" });
        await expect(transport.sendAuthCode({ ...mail, expiresAt: new Date(0) })).rejects.toMatchObject({ kind: "permanent" });
        await expect(transport.sendAuthCode({ ...mail, code: "<script>" })).rejects.toMatchObject({ message: "EMAIL_DELIVERY_FAILED" });
        expect(messages).toHaveLength(before);
    });
});
