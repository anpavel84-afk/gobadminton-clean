import { Writable } from "node:stream";
import Fastify from "fastify";
import { ConsoleLogger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { apiLogger, ApiApplicationLogger } from "../../src/common/api-logger";

describe("production API logger pipeline", () => {
  it("retains request correlation and handler inputs without logging credentials, including errors", async () => {
    let output = "";
    const stream = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
    if (!apiLogger || typeof apiLogger !== "object") throw new Error("Logger must be enabled");
    const app = Fastify({ logger: { ...apiLogger, stream } });
    const secrets = ["CODE_CANARY", "STATE_CANARY", "COOKIE_CANARY", "BEARER_CANARY", "CSRF_CANARY", "ACTIVATION_CANARY", "TICKET_CANARY", "SESSION_CANARY"];
    const query = new URLSearchParams({ code: secrets[0]!, state: secrets[1]!, activation: secrets[5]!, ticket: secrets[6]!, session: secrets[7]! }).toString();
    const headers = { cookie: `session=${secrets[2]}`, authorization: `Bearer ${secrets[3]}`, "x-csrf-token": secrets[4]! };
    let callbacks = 0;
    for (const path of ["/v1/admin/auth/yandex/callback", "/v1/auth/yandex/callback"]) {
      app.get(path, async (req) => {
        expect(req.query).toMatchObject({ code: secrets[0], state: secrets[1] });
        callbacks++;
        return { ok: true };
      });
      app.get(`${path}/error`, async () => { throw new Error(secrets.join(" ")); });
    }
    app.post("/v1/admin/activation", async (req) => {
      req.log.error({ req, err: new Error(secrets.join(" ")), body: req.body }, secrets.join(" "));
      return { ok: true };
    });
    try {
      for (const path of ["/v1/admin/auth/yandex/callback", "/v1/auth/yandex/callback"]) {
        expect((await app.inject({ url: `${path}?${query}`, headers })).statusCode).toBe(200);
        expect((await app.inject({ url: `${path}/error?${query}`, headers })).statusCode).toBe(500);
      }
      await app.inject({ url: `/missing?${query}`, headers });
      await app.inject({ method: "POST", url: "/v1/admin/activation", headers, payload: { activation: secrets[5], ticket: secrets[6], session: secrets[7] } });
    } finally { await app.close(); }
    expect(callbacks).toBe(2);
    expect(output.length).toBeGreaterThan(0);
    for (const secret of secrets) expect(output).not.toContain(secret);
    expect(output).not.toContain("?code=");
    const records = output.trim().split("\n").map((line) => JSON.parse(line));
    expect(records.some((r) => r.req?.method === "GET" && r.req.path === "/v1/admin/auth/yandex/callback" && r.reqId)).toBe(true);
    expect(records.some((r) => r.res?.statusCode === 500)).toBe(true);
    expect(records.some((r) => r.err?.type === "RequestError" &&
      r.err.message === "Request failed" && r.err.stack === "Error details suppressed")).toBe(true);
  });

  it("suppresses Nest exception details before the console sink", () => {
    const sink = vi.spyOn(ConsoleLogger.prototype, "error").mockImplementation(() => undefined);
    try {
      new ApiApplicationLogger().error("PROVIDER_SECRET_CANARY", new Error("STACK_SECRET_CANARY").stack);
      expect(JSON.stringify(sink.mock.calls)).not.toContain("CANARY");
      expect(sink).toHaveBeenCalledOnce();
    } finally { sink.mockRestore(); }
  });
});
