module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module"
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  env: {
    node: true,
    es2022: true
  },
  ignorePatterns: ["dist/", "node_modules/", "**/generated/**"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
  },
  overrides: [
    {
      // apps/training-playground (docs/DECISIONS.md D-057) is the only .tsx source in this repo today -- scoped here rather than widening the base config's env/parserOptions for every other workspace.
      files: ["apps/*/src/**/*.tsx", "apps/*/src/**/*.ts"],
      env: { browser: true, node: false },
      parserOptions: { ecmaFeatures: { jsx: true } }
    }
  ]
};
