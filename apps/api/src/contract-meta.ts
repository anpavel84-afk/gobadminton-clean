import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

type OpenApiDocument = {
  info: { title: string; version: string };
  "x-document-status": string;
};

function loadContract(): OpenApiDocument {
  const candidates = [
    join(__dirname, "../node_modules/@gobadminton/contracts/openapi.json"),
    join(__dirname, "../../../packages/contracts/openapi.json"),
    join(dirname(__dirname), "node_modules/@gobadminton/contracts/openapi.json"),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8")) as OpenApiDocument;
    } catch {
      // try next candidate
    }
  }
  throw new Error("Unable to load @gobadminton/contracts/openapi.json");
}

const openapi = loadContract();

export const contractMeta = {
  title: openapi.info.title,
  version: openapi.info.version,
  status: openapi["x-document-status"],
} as const;
