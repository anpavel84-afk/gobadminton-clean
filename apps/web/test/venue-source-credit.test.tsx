import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VenueSourceCredit, safeCatalogSource } from "../src/components/consumer/venues/VenueSourceCredit";

const catalogSource = {
  provider: "badminton4u.ru" as const,
  venueId: "B4U-V-33540253",
  clubs: [
    { id: "B4U-C-208", name: "Badmclub НН", url: "https://badminton4u.ru/clubs/208" },
    { id: "B4U-C-209", name: "Второй клуб", url: "https://badminton4u.ru/clubs/209" },
  ],
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
});
