import base from "../../packages/tooling/eslint.config.mjs";

export default [
  ...base,
  {
    ignores: [".next/**"],
  },
];
