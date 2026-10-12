import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import manifest from "../src/app/manifest";
import { metadata, viewport } from "../src/app/layout";

vi.mock("next/font/google", () => ({ Onest: () => ({ variable: "font-onest", className: "onest" }) }));
vi.mock("../src/components/consumer/ViewportLock", () => ({ ViewportLock: () => null }));

describe("iPhone standalone install contract", () => {
  it("launches the same-origin app with canonical colors and no orientation lock", () => {
    const app = manifest();
    expect(app).toMatchObject({ name: "GoBadminton", short_name: "GoBadminton", start_url: "/", scope: "/", display: "standalone" });
    expect(app).not.toHaveProperty("orientation");
    const tokens = readFileSync(new URL("../src/styles/consumer-tokens.css", import.meta.url), "utf8");
    expect(tokens).toContain(`--gb-lime: ${app.theme_color};`);
    expect(tokens).toContain(`--gb-paper: ${app.background_color};`);
  });

  it("locks mobile/PWA viewport 1:1 and keeps Apple's status bar and touch icon", () => {
    expect(viewport).toMatchObject({
      width: "device-width",
      initialScale: 1,
      minimumScale: 1,
      maximumScale: 1,
      userScalable: false,
      viewportFit: "cover",
    });
    expect(metadata.appleWebApp).toEqual({ capable: true, title: "GoBadminton", statusBarStyle: "default" });
    expect(metadata.other).toMatchObject({ "apple-mobile-web-app-capable": "yes" });
    expect(metadata.icons).toMatchObject({ apple: [{ url: "/brand/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] });
  });

  it("ships real opaque PNGs at the advertised sizes with nonempty pixel data", () => {
    expect(manifest().icons).toEqual([
      { src: "/brand/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ]);
    for (const [file, size] of [["apple-touch-icon", 180], ["icon-192", 192], ["icon-512", 512]] as const) {
      const png = readFileSync(new URL(`../public/brand/pwa/${file}.png`, import.meta.url));
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
      expect(png[24]).toBe(8); // Eight-bit channels.
      expect(png[25]).toBe(2); // RGB, no transparency (Apple applies its own corner mask).
      const chunks: Buffer[] = [];
      for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset);
        if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
      }
      const pixels = inflateSync(Buffer.concat(chunks));
      expect(pixels.length).toBe(size * (size * 3 + 1));
      expect(new Set(pixels).size).toBeGreaterThan(20);
    }
  });
});
