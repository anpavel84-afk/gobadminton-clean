import "./generate-friendship-types.mjs";
import "./check-admin-protocol.mjs";
import "./generate-game-types.mjs";
import "./generate-unified-types.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import SwaggerParser from "@apidevtools/swagger-parser";

const root = dirname(fileURLToPath(import.meta.url));
const openapiPath = join(root, "..", "openapi.json");

const raw = JSON.parse(readFileSync(openapiPath, "utf8"));
if (raw.openapi !== "3.1.1") {
  throw new Error(`expected OpenAPI 3.1.1, got ${raw.openapi}`);
}

const api = await SwaggerParser.validate(openapiPath, {
  validate: { schema: true, spec: true },
});

const paths = Object.keys(api.paths ?? {});
for (const required of ["/health", "/ready", "/meta"]) {
  if (!paths.includes(required)) {
    throw new Error(`foundation path missing from contract: ${required}`);
  }
}

console.log(
  `CONTRACT CHECK: PASS (${paths.length} paths, OpenAPI ${api.openapi}, info ${api.info?.version})`,
);
