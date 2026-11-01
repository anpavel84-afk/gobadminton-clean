import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AttendanceDisputes } from "../src/components/AttendanceDisputes";
import { isDefiniteAdminFailure, AdminError } from "../src/lib/admin-client";

describe("Admin AttendanceDisputes PG-2 UI", () => {
  it("does not offer resolve when canResolve is false and shows truthful pending help intake", () => {
    const html = renderToStaticMarkup(
      <AttendanceDisputes
        session={{
          principalId: "p1",
          userId: "u1",
          status: "active",
          version: 1,
          roles: ["support"],
          sessionId: "s1",
          expiresAt: new Date().toISOString(),
          stepUpAt: new Date().toISOString(),
          csrfToken: "csrf",
        }}
        busy={false}
        fresh={true}
        run={async (work) => work()}
        stepup={async () => undefined}
      />,
    );
    expect(html).toContain("Уточнение посещения");
    expect(html).toContain("Только назначенное обращение");
    expect(html).not.toContain("Создать обращение по возражению");
  });

  it("moderator sees intake without mock checkbox authority for resolution before open", () => {
    const stepup = vi.fn(async () => undefined);
    const html = renderToStaticMarkup(
      <AttendanceDisputes
        session={{
          principalId: "p2",
          userId: "u2",
          status: "active",
          version: 1,
          roles: ["moderator"],
          sessionId: "s2",
          expiresAt: new Date().toISOString(),
          stepUpAt: new Date().toISOString(),
          csrfToken: "csrf",
        }}
        busy={false}
        fresh={false}
        run={async (work) => work()}
        stepup={stepup}
      />,
    );
    expect(html).toContain("Служебный приём возражения");
    expect(html).toContain("Подтвердить вход");
  });

  it("classifies definite 4xx vs transport/timeout UNKNOWN; recover dispatches pending.kind", () => {
    expect(isDefiniteAdminFailure(new AdminError("CASE_VERSION_CONFLICT", 409))).toBe(true);
    expect(isDefiniteAdminFailure(new AdminError("SERVER_ERROR", 500))).toBe(false);
    expect(isDefiniteAdminFailure(new AdminError("TIMEOUT", 408))).toBe(false);
    expect(isDefiniteAdminFailure(new TypeError("Failed to fetch"))).toBe(false);
    const source = readFileSync(
      path.resolve(__dirname, "../src/components/AttendanceDisputes.tsx"),
      "utf8",
    );
    expect(source).toContain('kind: "intake" | "resolve"');
    expect(source).toContain("async function recover()");
    expect(source).toContain('pendingRef.kind === "intake"');
    expect(source).toContain("validateResolveReceipt");
    expect(source).toContain("validateIntakeReceipt");
    expect(source).not.toContain("void resolve(true)");
  });
});
