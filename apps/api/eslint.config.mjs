import base from "../../packages/tooling/eslint.config.mjs";

export default [
  ...base,
  {
    rules: {
      "no-console": "off",
      // Nest DI needs runtime class imports for emitDecoratorMetadata.
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
];
