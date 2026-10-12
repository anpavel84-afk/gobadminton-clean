import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const openapiPath = join(dirname(fileURLToPath(import.meta.url)), "..", "openapi.json");
const openapi = JSON.parse(readFileSync(openapiPath, "utf8")) as {
  info: { title: string; version: string };
  "x-document-status"?: string;
  paths: Record<string, unknown>;
};

export type ContractDocument = typeof openapi;
export const contractDocument = openapi;
export const contractMeta = {
  title: openapi.info.title,
  version: openapi.info.version,
  status: openapi["x-document-status"] ?? "UNKNOWN",
} as const;
export const foundationPaths = ["/health", "/ready", "/meta"] as const;

export type * from "./unified.generated.js";

export type * from "./game.generated.js";
