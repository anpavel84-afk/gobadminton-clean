import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VenueCommunityRating } from "../src/components/consumer/venues/VenueCommunityRating";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", { href, ...props }, children),
}));

describe("#507 I1 VenueCommunityRating", () => {
  it("renders full labels and guest login handoff without photo upload controls", () => {
    const html = renderToStaticMarkup(
      createElement(VenueCommunityRating, {
        venueId: "10000000-0000-4000-8000-000000000001",
        signedIn: false,
        csrfToken: null,
        authReturnPath: "/venues/10000000-0000-4000-8000-000000000001",
      }),
    );
    expect(html).toContain("Оценки сообщества");
    expect(html).toContain("Загружаем оценки");
    expect(html).not.toContain("Добавить фото");
    expect(html).not.toContain("type=\"file\"");
  });
});
