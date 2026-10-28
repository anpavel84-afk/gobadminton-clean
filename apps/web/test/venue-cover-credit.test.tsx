import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VenueCoverCredit } from "../src/components/consumer/venues/VenueCoverCredit";
import { httpsCreditUrl } from "../src/lib/original-http-authority";
import { websiteMatrixPositive } from "./fixtures/website-authority-matrix";

const entities: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#x27;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">" };
function unescapeAttr(value: string) {
  return value.replace(/&(?:amp|quot|lt|gt|apos|#x27);/g, entity => entities[entity] ?? entity);
}
function hrefs(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>/g)].map(match => unescapeAttr(/href="([^"]*)"/.exec(match[1] ?? "")?.[1] ?? ""));
}

describe("venue cover credit", () => {
  it.each(["photo", "logo"] as const)("links %s attribution safely", kind => {
    const text = kind === "photo" ? "Фото: Клуб" : "Логотип: Клуб";
    const html = renderToStaticMarkup(<VenueCoverCredit credit={{ kind, text, url: "https://club.example" }}/>);
    for (const value of [text, 'target="_blank"', 'rel="noopener noreferrer nofollow"', "↗", 'data-kind="'+kind+'"']) expect(html).toContain(value);
    expect(hrefs(html)).toEqual(["https://club.example/"]);
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

const creditCharset = /[^\x21-\x7e]|[\\<>"{}|^`]|%(?![0-9a-f]{2})/i;
function labelHost(hostname: string) {
  return hostname.startsWith("[") || (hostname.length <= 253 && hostname.split(".").every(part => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(part)));
}
/** Pre-existing credit policy. It does not know the authority grammar. */
function legacyCredit(input: string) {
  if (input.length > 300 || !input.startsWith("https://") || creditCharset.test(input)) return false;
  try {
    const url = new URL(input);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && labelHost(url.hostname);
  } catch { return false; }
}
function credit(url: unknown) {
  return renderToStaticMarkup(<VenueCoverCredit credit={{ kind: "photo", text: "Фото: Клуб", url: url as string | null }} />);
}
const authorityGrammar: unknown[] = [
  "https://@example.org/", "https://:@example.org/", "https:///@example.org/", "https:///:@example.org/",
  "https:////@example.org/", "https:////:@example.org/", "https:///@:@example.org/",
  "https://user@example.org/", "https://user:pass@example.org/", "https://u:@example.org/", "https://:p@example.org/",
  "https://a@b@example.org/", "https://@@example.org/",
  "https://example%40org/", "https://example%2Forg/", "https://example%5Corg/", "https://example%3A80/", "https://example%00org/",
  "https://%40example.org/", "https:///%40example.org/",
  "https://example.org:444/", "https://example.org:80/", "https://example.org:0/", "https://example.org:65536/",
  "https://example.org/\n", "https://example.org/\t", "https://example.org/\u0000", "https://example.org/%0a", "https://example.org/%00",
  "https://example.org/\ud800", "https://example.org/%C0%AF",
  "https:///@evil.example/phish", "https:///:@evil.example/", "https:////@evil.example/",
  "https://vk.com@evil.example/phish", "https://user:pass@evil.example/logo",
  "", " ", 42, false, {}, [], null, undefined,
];

describe("venue cover credit authority class", () => {
  it("returns the serialized href for valid credits and drops an over-long serialization", () => {
    const bomb = "https://a/?" + "'".repeat(97);
    expect(bomb).toHaveLength(108);
    expect(new URL(bomb).href).toHaveLength(302);
    expect(httpsCreditUrl(bomb)).toBeNull();
    expect(hrefs(credit(bomb))).toEqual([]);
    expect(credit(bomb)).toContain("Фото: Клуб");
    expect(credit(bomb)).not.toContain("<a");
    const preserved = [
      "https://club.example", "https://club.example/logo", "https://example.org/photos",
      "https://example.com", "https://example.com/", "https://example.invalid/",
      "https://example.org/@user", "https://example.org:443/a", "https://example.org/%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B",
      "https://[::1]/", "https:///example.org/path", "https://example.org/%40",
    ];
    for (const url of preserved) {
      const href = new URL(url).href;
      expect(href.length).toBeLessThanOrEqual(300);
      expect(httpsCreditUrl(url)).toBe(href);
      expect(hrefs(credit(url))).toEqual([href]);
    }
    const missed: string[] = [];
    for (const [input] of websiteMatrixPositive) {
      const expected = httpsCreditUrl(input);
      const links = hrefs(credit(input));
      if ((expected ?? "") !== links.join("|")) missed.push(`${input} => ${links.join("|")} expected ${expected ?? ""}`);
      if (expected && expected !== new URL(input).href) missed.push(`helper serialized ${input} => ${expected}`);
      if (!legacyCredit(input) && expected) missed.push(`weakened ${input}`);
    }
    expect(missed).toEqual([]);
    for (const url of [
      "https://example.org:0443/a", "https://example.org:00443/a", "https://example.org:/a",
      "https://[::1]:0443/", "https://[::1]:/",
    ]) {
      const html = credit(url);
      expect(httpsCreditUrl(url)).toBeNull();
      expect(html).not.toContain("<a");
      expect(html).not.toContain(url);
      expect(hrefs(html)).toEqual([]);
    }
  });

  it.each(authorityGrammar)("does not put authority-class credit %s into href", url => {
    const html = credit(url);
    expect(html).not.toContain("<a");
    expect(html).not.toContain("evil.example");
    expect(html).toContain("Фото: Клуб");
    expect(html).not.toContain("↗");
  });
});
