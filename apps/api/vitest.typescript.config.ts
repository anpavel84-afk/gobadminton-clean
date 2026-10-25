import path from "node:path";
import ts from "typescript";
import { defineConfig, type Plugin } from "vitest/config";

// Explicit fallback for isolated source checks where native SWC is unavailable.
// Keep Nest's legacy decorators and DI metadata; typecheck remains a separate check.
const compiler: Plugin = {
  name: "typescript-test-transform",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith(".ts") || id.includes("/node_modules/")) return;
    return ts.transpileModule(source, {
      fileName: id,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        sourceMap: true,
      },
    }).outputText;
  },
};

export default defineConfig({
  root: __dirname,
  plugins: [compiler],
  test: {
    environment: "node",
    setupFiles: [path.join(__dirname, "test/vitest.setup.ts")],
    include: ["test/unit/**/*.test.ts", "test/integration/friends-s1.disposable.test.ts"],
    fileParallelism: false,
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
});
