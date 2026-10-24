import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VenueProfile } from "../src/lib/consumer-types";
import { VenuePublicContacts } from "../src/components/consumer/games/VenueSheet";
import { VenuePublicProfile } from "../src/components/consumer/venues/VenuePublicProfile";
import { websiteMatrixNegative, websiteMatrixPositive } from "./fixtures/website-authority-matrix";

const coverUrl = `/v1/media/venue-covers/${"a".repeat(64)}.png`;
const entities: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#x27;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">" };

function unescapeAttr(value: string) {
  return value.replace(/&(?:amp|quot|lt|gt|apos|#x27);/g, entity => entities[entity] ?? entity);
}
function anchors(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>/g)].map(match => unescapeAttr(/href="([^"]*)"/.exec(match[1] ?? "")?.[1] ?? ""));
}
function httpAnchors(html: string) {
  return anchors(html).filter(href => href.startsWith("http://") || href.startsWith("https://"));
}
function contactHtml(value: unknown) {
  return renderToStaticMarkup(<VenuePublicContacts value={value} />);
}
function galleryHtml(creditUrl: unknown) {
  const profile = {
    courtCount: 1, amenities: { parking: null, showers: null }, updatedAt: null,
    gallery: { coverage: "cover_only", items: [{ url: coverUrl, credit: { kind: "photo", text: "Фото: Спортзал", url: creditUrl } }] },
  } as VenueProfile;
  return renderToStaticMarkup(<VenuePublicProfile venue={{ profile, cover: { uploadedUrl: coverUrl }, publicContacts: null }} />);
}
function label(value: unknown) {
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return "function";
  if (value instanceof String) return `String(${value.toString()})`;
  try { return JSON.stringify(value); } catch { return String(value); }
}
function labelHost(hostname: string) {
  return hostname.startsWith("[") || (hostname.length <= 253 && hostname.split(".").every(part => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(part)));
}
/** Pre-existing contact policy on an already serialized href: http(s), no userinfo, no explicit port, DNS labels or a bracket host, bounded length. */
function legacyContactHref(href: string) {
  try {
    const url = new URL(href);
    return url.href === href && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.port
      && url.href.length <= 300 && labelHost(url.hostname);
  } catch { return false; }
}
const creditCharset = /[^\x21-\x7e]|[\\<>"{}|^`]|%(?![0-9a-f]{2})/i;
/** Pre-existing gallery credit policy on the original string. It does not know the authority grammar. */
function legacyCredit(input: string) {
  if (input.length > 300 || !input.startsWith("https://") || creditCharset.test(input)) return false;
  try {
    const url = new URL(input);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && labelHost(url.hostname);
  } catch { return false; }
}
function rawAuthority(input: string) {
  const prefix = /^(https?):/i.exec(input);
  if (!prefix) return null;
  let index = prefix[0].length, slashes = 0;
  while (input[index] === "/") { slashes += 1; index += 1; }
  if (slashes < 2) return null;
  const start = index;
  while (index < input.length && input[index] !== "/" && input[index] !== "?" && input[index] !== "#") index += 1;
  return input.slice(start, index);
}
function forbiddenScalar(input: string) {
  return [...input].some(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159) || character === "\\";
  });
}

describe("URL authority class in public venue contacts and gallery credit", () => {
  it("rejects the empty-userinfo family instead of publishing the normalized host", () => {
    const family = ["https:///@example.org/", "https:///:@example.org/", "https:////@example.org/", "https:////:@example.org/", "https:///@:@example.org/"];
    for (const website of family) {
      expect(httpAnchors(contactHtml({ website }))).toEqual([]);
      expect(contactHtml({ website })).not.toContain("example.org");
      expect(galleryHtml(website)).not.toContain("<img");
      expect(anchors(galleryHtml(website))).toEqual([]);
    }
  });

  it.each([
    "https://@example.org/", "https://:@example.org/", "https://user@example.org/", "https://user:pass@example.org/",
    "https://:p@example.org/", "https://u:@example.org/", "https://@@example.org/", "https://a@b@example.org/",
    "https://%75ser:%70ass@example.org", "https://%40example.org/", "https:///%40example.org/",
  ])("rejects literal and encoded userinfo %s", website => {
    expect(httpAnchors(contactHtml({ website }))).toEqual([]);
    expect(galleryHtml(website)).not.toContain("href=");
  });

  it.each([
    "https://example%2Forg/", "https://example%5Corg/", "https://example%40org/", "https://example%3A80/",
    "https://example%00org/", "https://%2565xample.org/", "https://example.org:80:90/", "https://example.org:%38%30/",
    "https://example\uff20evil.org/", "https://example\uff0fevil.org/", "https://example\uff1a80/",
  ])("rejects encoded or confusable authority delimiters %s", website => {
    expect(httpAnchors(contactHtml({ website }))).toEqual([]);
    expect(anchors(galleryHtml(website))).toEqual([]);
  });

  it.each([
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "javascript%3Aalert(1)", "data:text/html,x", "DaTa:text/html,x",
    "vbscript:x", "blob:https://example.org/id", "file:///x", "ws://example.org/", "ftp://example.org/",
    "//example.org", "/relative", "https:example.org", "https:/example.org", "http:\\host", "https:/\\example.org/",
    "https:\\\\example.org/", "https://example.org\\@evil.test",
  ])("rejects non-http(s) and slash-confused schemes %s", website => {
    expect(httpAnchors(contactHtml({ website }))).toEqual([]);
    expect(galleryHtml(website)).not.toContain("<img");
  });

  it.each([
    "https://example.org:444/", "https://example.org:65536/", "https://example.org:x/", "https://example.org:+80/",
    "https://example.org:0/", "https://example.org:80/", "https://:80/", "https://example.org:00080/",
  ])("keeps the no-explicit-port policy, including non-default and overflow ports %s", website => {
    expect(httpAnchors(contactHtml({ website }))).toEqual([]);
    expect(anchors(galleryHtml(website))).toEqual([]);
  });

  it("rejects controls, encoded controls, malformed UTF-8, lone surrogates, over-length values and non-strings", () => {
    const inputs: unknown[] = [
      "https://example.org/\n", "https://example.org/%0a", "https://example.org/%00", "https://example.org/%7F",
      "https://example.org/%C2%85", "https://example.org/%5C", "\thttps://example.org/", "https://exa\tmple.org/",
      "https://example.org/%C0%AF", "https://example.org/%", "https://example.org/%ZZ", "https://example.org/\ud800",
      "https://example.org/" + "a".repeat(281), "https://example.org/" + "я".repeat(47),
      "", " ", 42, false, {}, [], null, undefined, new String("https://example.org/"), () => "https://example.org/", 1n,
    ];
    for (const website of inputs) {
      expect(httpAnchors(contactHtml({ website }))).toEqual([]);
      expect(galleryHtml(website)).not.toContain("<img");
    }
  });

  it("rejects the same authority class when it would normalize onto an allowlisted messenger host", () => {
    const cases: [string, string, string][] = [
      ["telegram", "t.me", "/club"], ["whatsapp", "wa.me", "/79991234567"], ["vk", "vk.com", "/club"],
    ];
    for (const [kind, host, path] of cases) {
      for (const input of [
        `https://${host}${path}`,
        `https:///${host}${path}`,
        `https://${host}:443${path}`,
      ]) {
        expect(httpAnchors(contactHtml({ messengers: [{ kind, url: input }] }))).toEqual([`https://${host}${path}`]);
      }
      for (const input of [
        `https:///@${host}${path}`, `https:////@${host}${path}`, `https:///:@${host}${path}`, `https:////:@${host}${path}`,
        `https://user@${host}${path}`, `https://user:pass@${host}${path}`, `https://%40${host}${path}`,
        `http://${host}${path}`, `https://${host}/`, `https://${host}/a/..`, `https://${host}.evil.example${path}`,
        `https://${host}:444${path}`, `https://evil.example${path}`,
      ]) {
        expect(httpAnchors(contactHtml({ messengers: [{ kind, url: input }] }))).toEqual([]);
      }
    }
  });

  it("drops only the rejected website or messenger and keeps the safe neighbor", () => {
    for (const website of ["https:///@example.org/", "https:////:@example.org/", "https://%40example.org/", "https://example.org/\ud800"]) {
      const html = contactHtml({ phone: "+1234567", website, messengers: [{ kind: "telegram", url: "https://t.me/club" }] });
      expect(anchors(html).filter(href => href.startsWith("tel:"))).toEqual(["tel:+1234567"]);
      expect(httpAnchors(html)).toEqual(["https://t.me/club"]);
    }
    const html = contactHtml({ phone: "+1234567", website: "https://example.org/a", messengers: [{ kind: "vk", url: "https:///@vk.com/club" }] });
    expect(httpAnchors(html)).toEqual(["https://example.org/a"]);
    expect(html).toContain("tel:+1234567");
  });

  it("keeps safe contact destinations that the authority grammar accepts", () => {
    const rows: [unknown, string][] = [
      ["https://example.org/a", "https://example.org/a"],
      [" HTTP://Example.COM:80/a/../b ", "http://example.com/b"],
      ["https://пример.рф/contact", "https://xn--e1afmkfd.xn--p1ai/contact"],
      ["https:///example.org/path", "https://example.org/path"],
      ["https://example.org/@user", "https://example.org/@user"],
      ["https://example.org:443/a", "https://example.org/a"],
      ["https://[::1]/", "https://[::1]/"],
      [" ".repeat(310) + "https://example.com/", "https://example.com/"],
    ];
    for (const [website, href] of rows) expect(httpAnchors(contactHtml({ website }))).toEqual([href]);
  });

  it("keeps a canonical gallery credit and rejects a bad credit without hiding the other facts", () => {
    const safe = galleryHtml("https://example.org/photos");
    expect(safe).toContain(`src="${coverUrl}"`);
    expect(anchors(safe)).toEqual(["https://example.org/photos"]);
    expect(safe).toContain('rel="noopener noreferrer nofollow"');
    const damaged = galleryHtml("https:///@example.org/photos");
    expect(damaged).not.toContain("<img");
    expect(damaged).not.toContain("example.org");
    expect(damaged).toContain(">1<");
  });

  it("applies the #272 negative matrix to both sinks", () => {
    // Contact still trims before measuring the serialized href. The one matrix row of 281
    // leading spaces is that existing length policy, and it publishes the canonical host.
    const trimmedSpace = `${" ".repeat(281)}https://example.org/`;
    const contact: string[] = [], gallery: string[] = [];
    for (const input of websiteMatrixNegative) {
      const links = httpAnchors(contactHtml({ website: input }));
      if (input === trimmedSpace) {
        if (links.join("|") !== "https://example.org/") contact.push(`${label(input)} => ${links.join("|")}`);
      } else if (links.length) contact.push(label(input));
      const html = galleryHtml(input);
      if (anchors(html).length || html.includes("<img")) gallery.push(label(input));
    }
    expect(contact).toEqual([]);
    expect(gallery).toEqual([]);
  });

  it("keeps #272 positive destinations only where each sink's existing policy allows them", () => {
    const contact: string[] = [], gallery: string[] = [];
    for (const [input, href] of websiteMatrixPositive) {
      const links = httpAnchors(contactHtml({ website: input }));
      const allowed = legacyContactHref(href);
      if (allowed && links.join("|") !== href) contact.push(`${label(input)} => ${links.join("|")} expected ${href}`);
      if (!allowed && links.length) contact.push(`${label(input)} unexpectedly ${links.join("|")}`);
      const html = galleryHtml(input);
      const creditLinks = anchors(html);
      if (legacyCredit(input)) {
        if (creditLinks.join("|") !== input || !html.includes("<img")) gallery.push(`${label(input)} => ${creditLinks.join("|")}`);
      } else if (creditLinks.length || html.includes("<img")) gallery.push(`${label(input)} unexpectedly ${creditLinks.join("|")}`);
    }
    expect(contact).toEqual([]);
    expect(gallery).toEqual([]);
  });

  it("checks generated slash and structural-token families against an independent authority scanner", () => {
    const contact: string[] = [], gallery: string[] = [], messengers: string[] = [];
    const alphabet = ["/", "\\", "@", ":", "?", "#", "%"];
    const checkContact = (input: string) => {
      const links = httpAnchors(contactHtml({ website: input }));
      const trimmed = input.trim();
      let parsed: URL | null = null;
      try { parsed = new URL(trimmed); } catch { parsed = null; }
      const accept = !forbiddenScalar(input) && rawAuthority(trimmed) === "example.org" && parsed !== null
        && ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.port
        && parsed.href.length <= 300 && labelHost(parsed.hostname);
      const expected = accept ? parsed!.href : "";
      if ((links[0] ?? "") !== expected || links.length > 1) contact.push(`${label(input)} => ${links.join("|")} expected ${expected}`);
    };
    const checkGallery = (input: string) => {
      const html = galleryHtml(input);
      const links = anchors(html);
      const accept = legacyCredit(input) && rawAuthority(input) === "example.org";
      if (accept && (links.join("|") !== input || !html.includes("<img"))) gallery.push(`${label(input)} => ${links.join("|")}`);
      if (!accept && (links.length || html.includes("<img"))) gallery.push(`${label(input)} unexpectedly ${links.join("|")}`);
    };
    const checkMessenger = (input: string) => {
      const links = httpAnchors(contactHtml({ messengers: [{ kind: "telegram", url: input }] }));
      let parsed: URL | null = null;
      try { parsed = new URL(input); } catch { parsed = null; }
      const accept = !forbiddenScalar(input) && rawAuthority(input) === "t.me" && parsed !== null
        && parsed.protocol === "https:" && parsed.hostname === "t.me" && parsed.pathname !== "/" && !parsed.port
        && !parsed.username && !parsed.password && parsed.href.length <= 300;
      const expected = accept ? parsed!.href : "";
      if ((links[0] ?? "") !== expected || links.length > 1) messengers.push(`${label(input)} => ${links.join("|")} expected ${expected}`);
    };
    let tokens = [""];
    for (let length = 0; length <= 3; length += 1) {
      for (const token of tokens) {
        checkContact(`https:${token}example.org/`);
        checkGallery(`https:${token}example.org/`);
        checkMessenger(`https:${token}t.me/club`);
      }
      tokens = tokens.flatMap(token => alphabet.map(character => token + character));
    }
    for (const count of [2, 3, 4, 5, 8, 32, 279, 280]) {
      for (const userinfo of ["", "@", ":@", "u@", ":p@", "@@", "%40"]) {
        for (const suffix of ["/", "?@x", "#@x"]) {
          checkContact(`https:${"/".repeat(count)}${userinfo}example.org${suffix}`);
          checkGallery(`https:${"/".repeat(count)}${userinfo}example.org${suffix}`);
        }
        for (const suffix of ["/club", "/club?@x", "/club#@x"]) {
          checkMessenger(`https:${"/".repeat(count)}${userinfo}t.me${suffix}`);
        }
      }
    }
    expect(contact).toEqual([]);
    expect(gallery).toEqual([]);
    expect(messengers).toEqual([]);
  });
});
