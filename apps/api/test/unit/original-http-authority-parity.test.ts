import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const START_MARKER = "export function forbiddenUrlScalars";
const END_MARKER = "export function httpsCreditUrl";
const REQUIRED_EXPORTS = [
  "forbiddenUrlScalars",
  "originalHttpAuthority",
  "httpUrlAgreesWithOriginalAuthority",
  "httpsCreditUrl",
] as const;

const apiSourcePath = path.resolve(__dirname, "../../src/lib/original-http-authority.ts");
const webSourcePath = path.resolve(__dirname, "../../../web/src/lib/original-http-authority.ts");

function normalizeSource(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(line => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}

/** Shared region: from forbiddenUrlScalars through the end of httpsCreditUrl (header and API-only privateContactWebsite excluded). */
function extractSharedRegion(sourceText: string): string {
  const normalized = normalizeSource(sourceText);
  const start = normalized.indexOf(START_MARKER);
  if (start < 0) {
    throw new Error(`Missing start marker: ${START_MARKER}`);
  }
  const endFn = normalized.indexOf(END_MARKER, start);
  if (endFn < 0) {
    throw new Error(`Missing end marker: ${END_MARKER}`);
  }
  const openBrace = normalized.indexOf("{", endFn);
  if (openBrace < 0) {
    throw new Error(`Missing body for end marker: ${END_MARKER}`);
  }
  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) {
    throw new Error(`Unclosed function for end marker: ${END_MARKER}`);
  }
  return normalized.slice(start, end);
}

function sharedRegionsEqual(leftSource: string, rightSource: string): boolean {
  return extractSharedRegion(leftSource) === extractSharedRegion(rightSource);
}

describe("original-http-authority shared-region parity", () => {
  const apiText = readFileSync(apiSourcePath, "utf8");
  const webText = readFileSync(webSourcePath, "utf8");

  it("keeps the shared authority grammar identical between API and web copies", () => {
    expect(sharedRegionsEqual(apiText, webText)).toBe(true);
  });

  it("detects a single-character mutation inside the shared region", () => {
    const normalized = normalizeSource(apiText);
    const region = extractSharedRegion(apiText);
    const start = normalized.indexOf(START_MARKER);
    // Flip one character inside the shared body (after the start marker text) so markers remain intact.
    const flipAt = start + START_MARKER.length + 1;
    expect(normalized[flipAt]).toBeDefined();
    const flipped = normalized[flipAt] === "x" ? "y" : "x";
    const mutatedFull =
      normalized.slice(0, flipAt) + flipped + normalized.slice(flipAt + 1);
    expect(extractSharedRegion(mutatedFull)).not.toBe(region);
    expect(sharedRegionsEqual(apiText, mutatedFull)).toBe(false);
  });

  it("throws when the start or end marker is missing", () => {
    expect(() => extractSharedRegion("export function other() {}")).toThrow(/Missing start marker/);
    expect(() => extractSharedRegion(`${START_MARKER}() { return false; }\n`)).toThrow(/Missing end marker/);
  });

  it("requires the shared exported names in both copies", () => {
    const apiRegion = extractSharedRegion(apiText);
    const webRegion = extractSharedRegion(webText);
    for (const name of REQUIRED_EXPORTS) {
      expect(apiRegion.includes(`export function ${name}`)).toBe(true);
      expect(webRegion.includes(`export function ${name}`)).toBe(true);
    }
  });
});
