import { createElement, type AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConversationHeader } from "../src/components/consumer/messages/MessageComposition";
import { profileFromConversationPath, safeProfileReturnPath } from "../src/lib/profile-return";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));

describe("DM to public profile return navigation", () => {
  it("encodes the selected conversation and participant into the profile route", () => {
    const profilePath = profileFromConversationPath("peer / one", "thread? / one");
    const profile = new URL(profilePath, "https://gobadminton.invalid");
    expect(profile.pathname).toBe("/players/peer%20%2F%20one");
    expect(safeProfileReturnPath(profile.searchParams.get("returnTo"))).toBe("/messages?conversation=thread%3F%20%2F%20one");
    const markup = renderToStaticMarkup(createElement(ConversationHeader, {
      playerId: "peer",
      conversationId: "thread-one",
      name: "Мария",
      subtitle: "Принята",
    }));
    expect(markup).toContain('href="/players/peer?returnTo=%2Fmessages%3Fconversation%3Dthread-one"');
  });

  it("accepts only a single local direct-conversation route", () => {
    expect(safeProfileReturnPath("/messages?conversation=thread-1")).toBe("/messages?conversation=thread-1");
    expect(safeProfileReturnPath("/players?returnTo=%2Fmessages%3Fconversation%3Dthread-1")).toBe("/players");
    expect(safeProfileReturnPath("//evil.example/messages?conversation=thread-1")).toBe("/players");
    expect(safeProfileReturnPath("https://evil.example/messages?conversation=thread-1")).toBe("/players");
    expect(safeProfileReturnPath("/messages?conversation=thread-1&to=peer")).toBe("/players");
    expect(safeProfileReturnPath("/messages?conversation=thread-1&conversation=thread-2")).toBe("/players");
    expect(safeProfileReturnPath("/messages?conversation=")).toBe("/players");
  });

  it("keeps ordinary profile entry on Players when origin is absent or invalid", () => {
    expect(safeProfileReturnPath(null)).toBe("/players");
    expect(safeProfileReturnPath("/games")).toBe("/players");
  });
});
