import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Venue, VenueProfile } from "../src/lib/consumer-types";
import { VenueGallery } from "../src/components/consumer/venues/VenueGallery";
import { VenuePreviewCard } from "../src/components/consumer/games/VenuePreviewCard";
import { VenuePickerDialog } from "../src/components/consumer/games/VenuePickerDialog";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, createPortal: (node: ReactNode) => node };
});

const url = (n: string) => `/v1/media/venue-covers/${n.repeat(64)}.png`;
const venue = (items: VenueProfile["gallery"]["items"], coverUrl?: string | null, coverCredit?: Venue["cover"]): Pick<Venue, "id" | "name" | "cover" | "profile"> => ({
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Зал",
  cover: coverCredit ?? { uploadedUrl: coverUrl === undefined ? url("a") : coverUrl, credit: { kind: "photo", text: "Фото: Клуб", url: "https://club.example" } },
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

  it("does not invent illustration credit for an unattributed legacy cover", () => {
    const html = renderToStaticMarkup(<VenueGallery venue={venue([], url("a"), { uploadedUrl: url("a"), credit: null })} />);
    expect(html).toContain(url("a"));
    expect(html).not.toContain("Иллюстрация");
    expect(html).toContain('data-cover="uploaded"');
  });

  it("starts on main image even when main is not position 0", () => {
    const multi = venue([
      { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo", text: "Фото: Один", url: "https://club.example/1" } },
      { id: "a0000000-0000-4000-8000-000000000012", url: url("b"), credit: { kind: "logo", text: "Логотип: Клуб", url: "https://club.example/logo" } },
    ], url("b"));
    const html = renderToStaticMarkup(<VenueGallery venue={multi} />);
    expect(html).toContain(url("b"));
    expect(html).toContain("2/2");
    expect(html).toContain("Логотип: Клуб");
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

  it("wires horizontal-drag click suppression and axis-locked pointer handlers", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../src/components/consumer/venues/VenueGallery.tsx", import.meta.url), "utf8"));
    expect(source).toContain("suppressClick");
    expect(source).toContain("onClickCapture");
    expect(source).toContain('currentDrag.axis = "x"');
    expect(source).toContain("SWIPE_THRESHOLD");
  });

  it("integrates gallery with morph slot in preview instead of bypassing", () => {
    const morph = <span data-testid="morph-slot" className="gb-venue-preview-cover" />;
    const html = renderToStaticMarkup(<VenuePreviewCard
      venue={venue([
        { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo", text: "Фото: Один", url: "https://club.example/1" } },
        { id: "a0000000-0000-4000-8000-000000000012", url: url("b"), credit: { kind: "photo", text: "Фото: Два", url: "https://club.example/2" } },
      ]) as never}
      games={[]}
      gamesReady
      now={0}
      onOpen={() => {}}
      coverSlot={morph}
    />);
    expect(html).toContain("gb-venue-gallery");
    expect(html).toContain('data-size="compact"');
    expect(html).toContain('data-testid="morph-slot"');
  });

  it("uses VenueGallery inside create-game venue picker options without nested nav buttons", () => {
    const pickerVenue = {
      id: "1",
      cityId: "a0000000-0000-4000-8000-000000000001",
      name: "Альфа",
      address: "Москва",
      timezone: "Europe/Moscow",
      cover: { uploadedUrl: url("a"), credit: { kind: "photo" as const, text: "Фото: Клуб", url: "https://club.example" } },
      profile: {
        courtCount: null, amenities: { parking: null, showers: null }, description: null, updatedAt: null,
        gallery: {
          coverage: "ordered" as const,
          items: [
            { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo" as const, text: "Фото: Один", url: "https://club.example/1" } },
            { id: "a0000000-0000-4000-8000-000000000012", url: url("b"), credit: { kind: "photo" as const, text: "Фото: Два", url: "https://club.example/2" } },
          ],
        },
      },
    };
    const html = renderToStaticMarkup(<VenuePickerDialog
      venues={[pickerVenue]}
      selectedId=""
      status="ready"
      onSelect={() => {}}
      onClose={() => {}}
      onRetry={() => {}}
    />);
    expect(html).toContain("gb-venue-gallery");
    expect(html).toContain('data-size="compact"');
    expect(html).not.toContain("Предыдущее фото");
    expect(html).toContain("Альфа");
  });
});
