import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactAction, ContactNote, contactAction } from "../src/components/consumer/players/ContactAction";
import { acquireRadarLocation } from "../src/components/consumer/radar/RadarSessionProvider";
import { RadarController } from "../src/lib/radar-controller";
import { compatibleRadarConfig, UNIFIED_WIRE } from "../src/lib/unified-directory";
import type { ContactState } from "../src/lib/messaging-types";
import type { ApiResult } from "../src/lib/api-client";

afterEach(() => vi.unstubAllGlobals());
const failure = (status: number): ApiResult<ContactState> => ({ ok: false, status, error: `HTTP ${status}` });
const render = (result: ApiResult<ContactState> | null, auth = "ready") => renderToStaticMarkup(<><ContactAction result={result} auth={auth} peer="peer" canInvite retryAuth={() => {}} /><ContactNote result={result} /></>);
describe("legacy contact action fails closed while preserving messaging navigation", () => {
  it("renders 404 as unavailable without permission, retry loop, conversation or invitation", () => {
    const html = render(failure(404));
    expect(html).toContain("Общение сейчас недоступно");
    expect(html).not.toMatch(/href=|Пригласить|Запрос отправлен|Первый контакт|Запрос на общение|Дождитесь принятия|Повторить|К переписке/);
  });
  it.each([[401, "Войти, чтобы написать"], [403, "Нет доступа"], [409, "Возможность общения изменилась"], [429, "немного позже"], [500, "Не удалось проверить"]])("keeps HTTP %i truthful", (status, title) => {
    const html = render(failure(status as number)); expect(html).toContain(title);
    expect(html).not.toMatch(/Пригласить|Запрос отправлен|К переписке|Первый контакт|Запрос на общение/);
    if (status !== 401) expect(html).not.toContain('href="/messages');
  });
  it("does not suppress auth errors with the legacy fallback", () => {
    expect(render(failure(404), "error")).toContain("Не удалось проверить возможность общения");
    expect(render(null)).toContain("Проверяем");
  });
  it("preserves authoritative accepted/pending/first-contact routing without approval copy and rejects mismatched targets", () => {
    for (const state of ["accepted", "pending_incoming", "pending_outgoing"] as const) {
      const html = render({ ok: true, status: 200, data: { state, targetPublicPlayerId: "peer", conversationId: "conversation", version: 1 } });
      expect(html).toContain('href="/messages?conversation=conversation"');
      expect(html).not.toMatch(/Запрос отправлен|Первый контакт|Запрос на общение|Дождитесь принятия|Ответить на запрос|Открыть запрос/);
    }
    const none = render({ ok: true, status: 200, data: { state: "none", targetPublicPlayerId: "peer", canRequestContact: true } });
    expect(none).toContain('href="/messages?to=peer"');
    expect(none).toContain("Написать");
    expect(none).not.toMatch(/Первый контакт|Запрос на общение|first-contact-note/);
    expect(render({ ok: true, status: 200, data: { state: "accepted", targetPublicPlayerId: "another", conversationId: "secret", version: 1 } })).not.toContain("secret");
    expect(contactAction({ state: "none", targetPublicPlayerId: "peer", canRequestContact: false } as unknown as ContactState).href).toBeUndefined();
  });
});
describe("unknown/disabled Radar capability never invokes browser GPS", () => {
  it("rejects acquisition even when an older status claims live exposure", async () => {
    const gps = vi.fn(); vi.stubGlobal("document", { hidden: false }); vi.stubGlobal("window", { isSecureContext: true }); vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: gps } });
    const c = new RadarController(); c.view = { ...c.view, exposureMode: "live" };
    await expect(acquireRadarLocation(c)).rejects.toMatchObject({ code: 2 });
    c.configure(compatibleRadarConfig({ exposureMode: "live", unifiedDirectory: { enabled: true, contractVersion: UNIFIED_WIRE, disclosure: { text: "consent" } }, publishingV2: { enabled: false }, cities: [] }));
    await expect(acquireRadarLocation(c)).rejects.toMatchObject({ code: 2 });
    expect(gps).not.toHaveBeenCalled();
  });
  it("retains explicit live acquisition for compatible enabled configuration", async () => {
    const gps = vi.fn((success: (position: unknown) => void) => success({ coords: { latitude: 1, longitude: 2, accuracy: 50 }, timestamp: 0 }));
    vi.stubGlobal("document", { hidden: false }); vi.stubGlobal("window", { isSecureContext: true }); vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: gps } });
    const c = new RadarController(); c.configure(compatibleRadarConfig({ exposureMode: "live", unifiedDirectory: { enabled: true, contractVersion: UNIFIED_WIRE, disclosure: { text: "consent" } }, publishingV2: { enabled: true }, cities: [] }));
    await expect(acquireRadarLocation(c)).resolves.toMatchObject({ latitude: 1, longitude: 2 }); expect(gps).toHaveBeenCalledOnce();
  });
});
