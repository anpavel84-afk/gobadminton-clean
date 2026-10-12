import { describe, expect, it } from "vitest";
import { normalizeEmail, newEmailCode, emailCodeHash, emailAuthEnabled } from "../../src/auth/email-security";
import { isEmailDeliveryPayload } from "../../src/auth/email-delivery";
import { loadEnv } from "../../src/config/env";
import { FakeMailTransport } from "../../src/auth/mail-transport";

const secrets = {
  EMAIL_AUTH_HMAC_SECRET: "test-only-hmac-secret-email-32chars!!",
  EMAIL_AUTH_ENCRYPTION_SECRET: "test-only-encrypt-secret-email-32chars!!",
  EMAIL_AUTH_RATE_SECRET: "test-only-rate-secret-email-32chars!!",
};
const base = {NODE_ENV:"test", APP_ENV:"local", DATABASE_URL:"postgres://test@127.0.0.1/test",PUBLIC_API_ORIGIN:"http://127.0.0.1:3000", PUBLIC_WEB_ORIGIN:"http://127.0.0.1:3001"};
describe("email security", () => {
  it("normalizes IDNA/case/outer whitespace and preserves plus/dots", () => {
    expect(normalizeEmail(" A.B+tag@ПРИМЕР.РФ ").canonical).toBe("a.b+tag@xn--e1afmkfd.xn--p1ai");
    expect(normalizeEmail("a.b@example.com").canonical).not.toBe(normalizeEmail("ab@example.com").canonical);
    expect(normalizeEmail("a+tag@example.com").canonical).not.toBe(normalizeEmail("a@example.com").canonical);
  });
  it.each(["Имя <a@example.com>","a..b@example.com","ю@example.com","a@example.com/path","a@example.com:80","a@example.com#x","a@example%2ecom","a\r\n@example.com","a@localhost","a@-bad.com","a@example.com.","a".repeat(65)+"@example.com"])("rejects %s", value => expect(() => normalizeEmail(value)).toThrow());
  it("uses eight digits including leading zeros and generation/id-specific MAC", () => {
    for(let i=0;i<100;i++) expect(newEmailCode()).toMatch(/^\d{8}$/);
    expect(emailCodeHash("secret","id",1,"12345678")).not.toBe(emailCodeHash("secret","id",2,"12345678"));
    expect(emailCodeHash("secret","id",1,"12345678")).not.toBe(emailCodeHash("secret","other",1,"12345678"));
  });
  it("accepts only minimal job payload", () => {
    const job={challengeId:"11111111-1111-4111-8111-111111111111",generation:1};
    expect(isEmailDeliveryPayload(job)).toBe(true);
    expect(isEmailDeliveryPayload({...job,code:"12345678"})).toBe(false);
    expect(isEmailDeliveryPayload({...job,generation:0})).toBe(false);
  });
  it("defaults disabled and forbids public fake configuration or reused secrets", () => {
    const disabled=loadEnv(base);expect(emailAuthEnabled(disabled)).toBe(false);
    expect(() => new FakeMailTransport(disabled).read("id")).toThrow("TEST_ONLY");
    const test=loadEnv({...base,...secrets,EMAIL_AUTH_TRANSPORT:"fake"});expect(emailAuthEnabled(test)).toBe(true);
    for(const overrides of [{APP_ENV:"mvp"},{NODE_ENV:"production"},{PUBLIC_WEB_ORIGIN:"https://gobadminton.ru"},{HOST:"0.0.0.0"},{EMAIL_AUTH_RATE_SECRET:secrets.EMAIL_AUTH_HMAC_SECRET}]) {
      expect(() => loadEnv({...base,...secrets,EMAIL_AUTH_TRANSPORT:"fake",...overrides})).toThrow();
    }
  });
});
