import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Venue, VenueProfile } from "../src/lib/consumer-types";
import { VenueGallery } from "../src/components/consumer/venues/VenueGallery";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));

const url = (n: string) => `/v1/media/venue-covers/${n.repeat(64)}.png`;
const venue = (items: VenueProfile["gallery"]["items"], coverUrl?: string | null): Pick<Venue, "id" | "name" | "cover" | "profile"> => ({
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Зал",
  cover: { uploadedUrl: coverUrl === undefined ? url("a") : coverUrl, credit: { kind: "photo", text: "Фото: Клуб", url: "https://club.example" } },
  profile: {
    courtCount: null, amenities: { parking: null, showers: null }, description: null, updatedAt: null,
    gallery: { coverage: "ordered", items },
  },
});

describe("VenueGallery", () => {
  it("hides navigation for a single image and keeps honest fallback when empty", () => {
    const one = renderToStaticMarkup(<VenueGallery venue={venue([{ id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo", text: "Фото: Клуб", url: "https://club.example" } }])} />);
    expect(one).not.toContain("Предыдущее фото");
    expect(one).not.toContain("Следующее фото");
    expect(one).toContain(url("a"));
    const empty = renderToStaticMarkup(<VenueGallery venue={venue([], null)} />);
    expect(empty).toContain("/discovery/badminton-courts.jpg");
    expect(empty).not.toContain("Предыдущее фото");
  });

  it("shows controls for multi-image sheet and resets when venue id changes", () => {
    const multi = venue([
      { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo", text: "Фото: Один", url: "https://club.example/1" } },
      { id: "a0000000-0000-4000-8000-000000000012", url: url("b"), credit: { kind: "logo", text: "Логотип: Клуб", url: "https://club.example/logo" } },
    ]);
    const html = renderToStaticMarkup(<VenueGallery venue={multi} />);
    expect(html).toContain("Предыдущее фото");
    expect(html).toContain("Следующее фото");
    expect(html).toContain("1/2");
    expect(html).toContain("Фото: Один");
    const next = renderToStaticMarkup(<VenueGallery venue={{ ...multi, id: "a0000000-0000-4000-8000-000000000099" }} />);
    expect(next).toContain("1/2");
  });

  it("keeps compact picker/media free of nested interactive controls", () => {
    const html = renderToStaticMarkup(<VenueGallery venue={venue([
      { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo", text: "Фото: Один", url: "https://club.example/1" } },
      { id: "a0000000-0000-4000-8000-000000000012", url: url("b"), credit: { kind: "photo", text: "Фото: Два", url: "https://club.example/2" } },
    ])} size="compact" showCredit={false} />);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Предыдущее фото");
  });
});
