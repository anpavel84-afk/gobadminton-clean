// Deterministic raster export of the complete canonical wordmark; no new mark.
// Run from the repository root: node apps/web/scripts/generate-pwa-icons.mjs
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import process from "node:process";
import { info } from "node:console";
import { URL } from "node:url";

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const brand = new URL("../public/brand/", import.meta.url);
const source = await readFile(new URL("go-badminton.svg", brand));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceHash = "139f0e578d41371c73e36bb844c0956fa86924a33360c15c1c7256def1a8ca71";
if (sha256(source) !== sourceHash) throw new Error("Canonical wordmark changed: review provenance before exporting");
await mkdir(new URL("pwa/", brand), { recursive: true });
const sizes = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [180, 192, 512];
for (const size of sizes) {
  if (![180, 192, 512].includes(size)) throw new Error("Unexpected icon size");
  // Fit the whole 144:39.6 logo into an 80%-width square, preserving its ratio.
  const logo = await sharp(source, { density: 600 }).resize({ width: Math.round(size * 0.8) }).png().toBuffer();
  const png = await sharp({ create: { width: size, height: size, channels: 3, background: "#a7f447" } })
    .composite([{ input: logo, gravity: "centre" }]).removeAlpha().png().toBuffer();
  await writeFile(new URL(`pwa/${size === 180 ? "apple-touch-icon" : `icon-${size}`}.png`, brand), png);
  info(`${size}x${size} ${sha256(png)}`);
}
