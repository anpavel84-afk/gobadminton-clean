import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

const nestSwc = swc.vite({
  module: { type: "es6" },
  jsc: {
    target: "es2022",
    parser: {
      syntax: "typescript",
      decorators: true,
    },
    transform: {
      legacyDecorator: true,
      decoratorMetadata: true,
    },
  },
});

export default defineConfig({
  // Nest DI requires emitDecoratorMetadata; Vitest's default esbuild transform does not.
  plugins: [nestSwc],
  test: {
    setupFiles: ["./test/vitest.setup.ts"],
    // Shared disposable DB: one integration file at a time.
    fileParallelism: false,
    projects: [
      {
        plugins: [nestSwc],
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
          environment: "node",
          setupFiles: ["./test/vitest.setup.ts"],
        },
      },
      {
        plugins: [nestSwc],
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          environment: "node",
          setupFiles: ["./test/vitest.setup.ts"],
          testTimeout: 240_000,
          hookTimeout: 240_000,
          // fileParallelism is root-only (not ProjectConfig); keep sequence serial here.
          sequence: { concurrent: false },
          // Fresh process per file avoids Nest/@Global provider bleed across suites.
          pool: "forks",
          isolate: true,
        },
      },
    ],
  },
});
