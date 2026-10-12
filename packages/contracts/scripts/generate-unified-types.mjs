import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const schemas = JSON.parse(readFileSync(new URL("openapi.json", root), "utf8"))
  .components.schemas;
function type(s) {
  if (s.$ref) return s.$ref.split("/").at(-1);
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((x) => JSON.stringify(x)).join(" | ");
  if (s.oneOf || s.anyOf) return (s.oneOf ?? s.anyOf).map(type).join(" | ");
  if (Array.isArray(s.type))
    return s.type.map((t) => type({ ...s, type: t })).join(" | ");
  if (s.type === "array") return `Array<${type(s.items)}>`;
  if (s.type === "object")
    return `{ ${Object.entries(s.properties ?? {})
      .map(
        ([k, v]) =>
          `${JSON.stringify(k)}${s.required?.includes(k) ? "" : "?"}: ${type(v)}`,
      )
      .join("; ")} }`;
  return (
    {
      string: "string",
      integer: "number",
      number: "number",
      boolean: "boolean",
      null: "null",
    }[s.type] ?? "unknown"
  );
}
const names = new Set(
  Object.keys(schemas).filter((n) => n.startsWith("Unified")),
);
function dependencies(s) {
  if (s && typeof s === "object") {
    if (s.$ref) {
      const n = s.$ref.split("/").at(-1);
      if (!names.has(n)) {
        names.add(n);
        dependencies(schemas[n]);
      }
    }
    Object.values(s).forEach(dependencies);
  }
}
for (const n of names) dependencies(schemas[n]);
const output =
  "// Generated from openapi.json by scripts/generate-unified-types.mjs. Do not edit.\n" +
  Object.entries(schemas)
    .filter(([n]) => names.has(n))
    .map(([n, s]) => `export type ${n} = ${type(s)};\n`)
    .join("");
const path = new URL("src/unified.generated.ts", root);
if (!process.argv.includes("--write")) {
  if (readFileSync(path, "utf8") !== output)
    throw new Error("Unified OpenAPI types need regeneration");
} else {
  writeFileSync(path, output);
}
console.log(
  `Unified types ${!process.argv.includes("--write") ? "verified" : "generated"}: ${fileURLToPath(path)}`,
);
