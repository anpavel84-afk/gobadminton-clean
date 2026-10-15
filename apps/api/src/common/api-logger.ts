import { ConsoleLogger } from "@nestjs/common";
import type { FastifyServerOptions } from "fastify";

// Allowlist, rather than a growing list of credential/query/header names.
// Keep the raw request untouched: OAuth handlers still receive code and state.
export const apiLogger: FastifyServerOptions["logger"] = {
  serializers: {
    req: (req) => ({ method: req.method, path: String(req.url ?? "").split(/[?#]/, 1)[0] }),
    res: (res) => ({ statusCode: res.statusCode }),
    err: () => ({ type: "RequestError" }),
  },
  hooks: {
    // Fastify error/not-found messages may interpolate raw URLs or error.message.
    // Never forward free text, arbitrary objects, headers, bodies or error stacks.
    logMethod(args, method) {
      const value = args[0];
      const safe: Record<string, unknown> = {};
      if (value && typeof value === "object") {
        for (const key of ["req", "res", "err", "responseTime"] as const) {
          if (key in value) safe[key] = (value as Record<string, unknown>)[key];
        }
      }
      method.call(this, safe, "api_event");
    },
  },
};

// Nest's default exception logger prints unhandled provider error messages/stacks.
// Those can contain credentials even when Fastify request serialization is safe.
export class ApiApplicationLogger extends ConsoleLogger {
  override error(..._args: unknown[]): void {
    super.error("API error; details suppressed to protect credentials");
  }
}
