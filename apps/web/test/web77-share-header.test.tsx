import { createElement, type AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { publicGameUrl, shareGameUrl, copyGameUrl } from "../src/lib/game-share";
import { ConversationHeader } from "../src/components/consumer/messages/MessageComposition";
import { ConversationSafety } from "../src/components/consumer/messages/ConversationSafety";
vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));
const url = "https://gobadminton.ru/games/public-game";
describe("WEB77 public game sharing", () => {
  it("uses origin and only the encoded route id, discarding current queries and credentials", () => {
    expect(publicGameUrl("https://user:secret@gobadminton.ru/my-games/other?token=secret#debug", "public-game")).toBe(url);
    expect(publicGameUrl("https://gobadminton.ru", "a/b?token=x#debug")).toBe("https://gobadminton.ru/games/a%2Fb%3Ftoken%3Dx%23debug");
  });
  it("sends only a URL through native share and preserves the navigator receiver", async () => {
    const writeText = vi.fn();
    const environment = { clipboard: { writeText }, async share(data: { url: string }) { expect(this).toBe(environment); expect(data).toEqual({ url }); } };
    expect(await shareGameUrl(url, environment)).toBe("shared"); expect(writeText).not.toHaveBeenCalled();
  });
  it("treats AbortError as cancellation without clipboard fallback", async () => {
    const writeText = vi.fn();
    expect(await shareGameUrl(url, { share: async () => { throw { name: "AbortError" }; }, clipboard: { writeText } })).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });
  it("offers explicit copy after genuine native failure without claiming success", async () => {
    const writeText = vi.fn();
    expect(await shareGameUrl(url, { share: async () => { throw new Error("denied"); }, clipboard: { writeText } })).toBe("fallback"); expect(writeText).not.toHaveBeenCalled();
  });
  it("copies canonical URL when native is unavailable", async () => {
    const writeText = vi.fn(async () => {});
    expect(await shareGameUrl(url, { clipboard: { writeText } })).toBe("copied"); expect(writeText).toHaveBeenCalledWith(url);
  });
  it("never reports success on denied or missing clipboard", async () => {
    expect(await copyGameUrl(url, {})).toBe("copy_failed");
    expect(await shareGameUrl(url, { clipboard: { writeText: async () => { throw new Error("denied"); } } })).toBe("copy_failed");
  });
});
describe("WEB77 identity and safety presentation", () => {
  it("combines avatar/name/status into exactly one accessible public profile link", () => {
    const html = renderToStaticMarkup(createElement(ConversationHeader, { name: "Мария", subtitle: "На связи", playerId: "peer/id" }));
    expect(html.match(/href="\/players\//g)).toHaveLength(1);
    expect(html).toContain('href="/players/peer%2Fid"'); expect(html).toContain('aria-label="Профиль игрока: Мария"'); expect(html).toContain("avatar--yellow"); expect(html).toContain("На связи"); expect(html).toContain("Назад к сообщениям");
  });
  it("does not fabricate profile navigation for unavailable identity", () => {
    expect(renderToStaticMarkup(createElement(ConversationHeader, { name: "Переписка", subtitle: "Сообщения" }))).not.toContain('/players/');
  });
  it("keeps safety behind accessible overflow with no redundant profile link", () => {
    const html = renderToStaticMarkup(createElement(ConversationSafety, { playerId: "peer", me: { id: "own", displayName: "Own", locale: "ru", linkedProviders: [], csrfToken: "synthetic" }, overflow: true, onBlocked: vi.fn() }));
    expect(html).toContain('aria-haspopup="menu"'); expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain("Заблокировать"); expect(html).not.toContain("/players/");
  });
});
