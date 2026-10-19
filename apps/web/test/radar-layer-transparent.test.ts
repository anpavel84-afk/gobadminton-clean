// @vitest-environment node
import { describe, expect, it } from "vitest";

async function readSource(...parts: string[]): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(path.join(__dirname, ...parts), "utf8");
}

const layerBlock = /(?:^|[{}])\s*\.gb-consumer\.gb-radar-layer\s*\{([^{}]*)\}/g;
function transparentLayer(css: string): boolean {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...uncommented.matchAll(layerBlock)].some((match) => {
    const body = match[1] ?? "";
    const declarations = new Map(body.split(";").map((declaration) => {
      const [property = "", ...value] = declaration.split(":");
      return [property.trim(), value.join(":").trim()];
    }));
    return declarations.get("background") === "transparent" && declarations.get("min-height") === "0";
  });
}

describe("shared Radar layer transparency", () => {
  it("requires both declarations in the actual standalone layer rule", async () => {
    const css = await readSource("../src/styles/radar-geographic.css");
    expect(transparentLayer(css)).toBe(true);
    const withoutBlock = css.replace(/\.gb-consumer\.gb-radar-layer\s*\{[^{}]*\}/g, "");
    expect(transparentLayer(withoutBlock)).toBe(false);
  });

  it.each([
    "/* .gb-consumer.gb-radar-layer { background: transparent; min-height: 0; } */",
    ".other { background: transparent; min-height: 0; }",
    ".gb-consumer { background: transparent; } .gb-radar-layer { min-height: 0; }",
    ".other .gb-consumer.gb-radar-layer { background: transparent; min-height: 0; }",
    ".gb-consumer.gb-radar-layer { background: transparent; }",
    ".gb-consumer.gb-radar-layer { min-height: 0; }",
    ".gb-consumer.gb-radar-layer { background: #f5f6f2; min-height: 0; }",
  ])("rejects an ineffective fixture: %s", (css) => {
    expect(transparentLayer(css)).toBe(false);
  });
});
