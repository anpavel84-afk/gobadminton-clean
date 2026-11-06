import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VenuePreviewCard } from "../src/components/consumer/games/VenuePreviewCard";
import { VenueSourceCredit, safeCatalogSource } from "../src/components/consumer/venues/VenueSourceCredit";
import type { VenueSummary } from "../src/lib/consumer-types";

const catalogSource = {
  provider: "badminton4u.ru" as const,
  venueId: "B4U-V-33540253",
  clubs: [
    { id: "B4U-C-208", name: "Badmclub НН", url: "https://badminton4u.ru/clubs/208" },
    { id: "B4U-C-209", name: "Второй клуб", url: "https://badminton4u.ru/clubs/209" },
  ],
};

const previewVenue: VenueSummary = {
  id: "venue-1",
  name: "Городской теннисный центр",
  address: "г. Новосибирск, 1-е Мочищенское шоссе, 8",
  cityId: "city",
  timezone: "Asia/Novosibirsk",
  profile: {
    courtCount: null,
    amenities: { parking: null, showers: null },
    updatedAt: null,
    gallery: { coverage: "cover_only", items: [] },
    catalogSource,
  },
};

describe("VenueSourceCredit", () => {
  it("renders source link and club names; rejects unsafe urls", () => {
    const html = renderToStaticMarkup(<VenueSourceCredit catalogSource={catalogSource} />);
    expect(html).toContain("Источник: badminton4u.ru");
    expect(html).toContain("Badmclub НН");
    expect(html).toContain("Второй клуб");
    // Main «Источник» anchor targets the validated first club page, not the provider homepage.
    expect(html).toMatch(
      /href="https:\/\/badminton4u\.ru\/clubs\/208"[^>]*>Источник: badminton4u\.ru</,
    );
    expect(html).not.toContain('href="https://badminton4u.ru/"');
    expect(html).toContain('href="https://badminton4u.ru/clubs/208"');
    expect(html).toContain('href="https://badminton4u.ru/clubs/209"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(safeCatalogSource({
      ...catalogSource,
      clubs: [{ id: "B4U-C-208", name: "X", url: "https://evil.example/clubs/208" }],
    })).toBeNull();
    expect(safeCatalogSource({
      ...catalogSource,
      clubs: [{ id: "B4U-C-208", name: "<script>", url: "https://badminton4u.ru/clubs/208" }],
    })).toBeNull();
    expect(safeCatalogSource({
      ...catalogSource,
      clubs: [],
    })).toBeNull();
    expect(renderToStaticMarkup(<VenueSourceCredit catalogSource={null} />)).toBe("");
    expect(renderToStaticMarkup(<VenueSourceCredit catalogSource={undefined} />)).toBe("");
  });

  it("compactPrimary links the first club source only (not homepage); full keeps all clubs", () => {
    const compact = renderToStaticMarkup(
      <VenueSourceCredit catalogSource={catalogSource} variant="compactPrimary" />,
    );
    expect(compact).toContain('data-variant="compact-primary"');
    expect(compact).toContain("Источник: badminton4u.ru");
    expect(compact).toContain("Badmclub НН");
    expect(compact).toContain('href="https://badminton4u.ru/clubs/208"');
    expect(compact).not.toContain("Второй клуб");
    expect(compact).not.toContain('href="https://badminton4u.ru/clubs/209"');
    expect(compact).not.toContain('href="https://badminton4u.ru/"');
    const full = renderToStaticMarkup(<VenueSourceCredit catalogSource={catalogSource} variant="full" />);
    expect(full).toContain("Второй клуб");
    expect(full).toContain('href="https://badminton4u.ru/clubs/209"');
  });

  it("compact preview keeps 3-column row with source footer outside the select button", () => {
    const html = renderToStaticMarkup(
      <VenuePreviewCard venue={previewVenue} games={[]} gamesReady now={0} onOpen={() => {}} />,
    );
    expect(html).toContain('data-has-source="true"');
    expect(html).toContain("gb-venue-preview-button");
    expect(html).toContain("gb-venue-preview-source");
    expect(html).toContain("Городской теннисный центр");
    expect(html).toContain("Источник: badminton4u.ru");
    expect(html).toContain("Badmclub НН");
    // Compact footer: primary club only.
    expect(html).not.toContain("Второй клуб");
    // No anchors nested inside the row select button.
    const buttonOpen = html.indexOf('class="gb-venue-preview-button"');
    const buttonClose = html.indexOf("</button>", buttonOpen);
    const buttonHtml = html.slice(buttonOpen, buttonClose);
    expect(buttonHtml).not.toContain("<a ");
    expect(buttonHtml).not.toContain("Источник:");
    // Source footer is a sibling after the button.
    expect(html.indexOf("gb-venue-preview-source")).toBeGreaterThan(buttonClose);
  });
});
