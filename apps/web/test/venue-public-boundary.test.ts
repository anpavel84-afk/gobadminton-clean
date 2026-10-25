import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

// Follow executable local edges, including re-export barrels and lazy map/popups.
function reachable(entries: string[]): Map<string, string> {
  const visited = new Map<string, string>();
  function visit(file: string) {
    if (visited.has(file)) return;
    const source = readFileSync(file, "utf8");
    visited.set(file, source);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function edge(specifier: string) {
      if (!specifier.startsWith(".") || /\.(css|scss)$/.test(specifier)) return;
      const base = resolve(dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")]
        .find(candidate => existsSync(candidate) && /\.[cm]?[jt]sx?$/.test(candidate));
      if (!target) throw new Error(`Unresolved executable edge: ${file} -> ${specifier}`);
      visit(target);
    }
    function walk(node: ts.Node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        const typeOnly = clause?.isTypeOnly || (bindings && ts.isNamedImports(bindings) && !clause?.name && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly));
        if (!typeOnly) edge(node.moduleSpecifier.text);
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const types = node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(item => item.isTypeOnly);
        if (!types) edge(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (!arg || !ts.isStringLiteral(arg)) throw new Error(`Nonliteral dynamic import in ${file}`);
        edge(arg.text);
      }
      if (!ts.isImportTypeNode(node)) ts.forEachChild(node, walk);
    }
    walk(ast);
  }
  entries.forEach(visit);
  return visited;
}
it("public venue page and map cannot reach cover writes or admin endpoints", () => {
  const graph = reachable([
    resolve("src/components/consumer/venues/VenuePage.tsx"),
    resolve("src/components/consumer/games/GamesMapView.tsx"),
  ]);
  expect(graph.size).toBeGreaterThan(10);
  for (const [file, source] of graph) {
    expect(file).not.toMatch(/(?:VenueCoverEditor|venue-cover-api)\.[jt]sx?$/);
    expect(source, file).not.toContain("/v1/admin/");
  }
});
