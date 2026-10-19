import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VenueCoverCredit } from "../src/components/consumer/venues/VenueCoverCredit";

describe("venue cover credit", () => {
  it.each(["photo", "logo"] as const)("links %s attribution safely", kind => {
    const text = kind === "photo" ? "Фото: Клуб" : "Логотип: Клуб";
    const html = renderToStaticMarkup(<VenueCoverCredit credit={{ kind, text, url: "https://club.example" }}/>);
    for (const value of [text, 'href="https://club.example"', 'target="_blank"', 'rel="noopener noreferrer nofollow"', "↗", 'data-kind="'+kind+'"']) expect(html).toContain(value);
  });
  it("renders illustration without a link", () => {
    const html = renderToStaticMarkup(<VenueCoverCredit credit={{ kind: "illustration", text: "Иллюстрация", url: "https://club.example" }}/>);
    expect(html).toContain("Иллюстрация");
    expect(html).toContain('data-kind="illustration"');
    expect(html).not.toContain("<a");
  });
  it("omits absent credits", () => {
    expect(renderToStaticMarkup(<VenueCoverCredit/>)).toBe("");
    expect(renderToStaticMarkup(<VenueCoverCredit credit={null}/>)).toBe("");
  });
  it.each(["http://club.example", "javascript:alert(1)", null])("renders unsafe or missing URL %s as text", url => {
    const html = renderToStaticMarkup(<VenueCoverCredit credit={{ kind: "photo", text: "Фото: <script>&", url }}/>);
    expect(html).not.toContain("<a");
    expect(html).toContain("Фото: &lt;script&gt;&amp;");
    expect(html).not.toContain("↗");
  });
});
