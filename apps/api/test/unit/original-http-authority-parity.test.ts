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

/** CRLF → LF, then strip trailing whitespace on each line. */
function normalizeSourceText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(line => line.replace(/\s+$/u, ""))
    .join("\n");
}

/**
 * Shared region: from the first `export function forbiddenUrlScalars`
 * through the closing brace of `export function httpsCreditUrl`
 * (header comment and API-only `privateContactWebsite` are excluded).
 */
function extractSharedRegion(sourceText: string): string {
  const normalized = normalizeSourceText(sourceText);
  const start = normalized.indexOf(START_MARKER);
  if (start < 0) {
    throw new Error(`missing start marker: ${START_MARKER}`);
  }
  const endFn = normalized.indexOf(END_MARKER, start);
  if (endFn < 0) {
    throw new Error(`missing end marker: ${END_MARKER}`);
  }
  const braceOpen = normalized.indexOf("{", endFn);
  if (braceOpen < 0) {
    throw new Error(`missing end marker: unopened body for ${END_MARKER}`);
  }
  let depth = 0;
  let i = braceOpen;
  for (; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  if (depth !== 0) {
    throw new Error(`missing end marker: unclosed body for ${END_MARKER}`);
  }
  return normalized.slice(start, i);
}

describe("original-http-authority shared-region parity", () => {
  const apiSource = readFileSync(apiSourcePath, "utf8");
  const webSource = readFileSync(webSourcePath, "utf8");

  it("keeps the shared region of the real API and web copies identical", () => {
    const apiRegion = extractSharedRegion(apiSource);
    const webRegion = extractSharedRegion(webSource);
    expect(apiRegion).toBe(webRegion);
  });

  it("reports a difference when one character in the API shared region changes", () => {
    const apiRegion = extractSharedRegion(apiSource);
    const webRegion = extractSharedRegion(webSource);
    expect(apiRegion).toBe(webRegion);

    // One in-region character; markers stay intact so extraction still succeeds.
    const needle = "code <= 0x1f";
    expect(apiSource).toContain(needle);
    const mutatedApi = apiSource.replace(needle, "code <= 0x1e");
    const mutatedRegion = extractSharedRegion(mutatedApi);
    expect(mutatedRegion).not.toBe(webRegion);
  });

  it("throws a clear Error when the start or end marker is missing", () => {
    expect(() => extractSharedRegion("export function httpsCreditUrl() {}\n")).toThrow(
      /missing start marker/,
    );
    expect(() => extractSharedRegion("export function forbiddenUrlScalars() {}\n")).toThrow(
      /missing end marker/,
    );
  });

  it("requires the shared exported names in both copies", () => {
    const apiRegion = extractSharedRegion(apiSource);
    const webRegion = extractSharedRegion(webSource);
    for (const name of REQUIRED_EXPORTS) {
      expect(apiRegion, `API missing export ${name}`).toContain(`export function ${name}`);
      expect(webRegion, `web missing export ${name}`).toContain(`export function ${name}`);
    }
  });
});
