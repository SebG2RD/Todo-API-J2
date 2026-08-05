const js = require("@eslint/js");

// Globals déclarés à la main plutôt qu'importés d'un paquet supplémentaire :
// la liste est courte, et elle dit exactement ce que ce code a le droit d'utiliser.
const nodeGlobals = {
  require: "readonly",
  module: "writable",
  exports: "writable",
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  URL: "readonly",
};

const jestGlobals = {
  describe: "readonly",
  test: "readonly",
  expect: "readonly",
  jest: "readonly",
  beforeAll: "readonly",
  afterAll: "readonly",
  beforeEach: "readonly",
  afterEach: "readonly",
};

module.exports = [
  { ignores: ["node_modules/**", "coverage/**"] },

  js.configs.recommended,

  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: nodeGlobals,
    },
    rules: {
      // La pipeline doit échouer sur un vrai défaut, pas sur un console.log.
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },

  {
    files: ["tests/**/*.js"],
    languageOptions: { globals: { ...nodeGlobals, ...jestGlobals } },
  },
];
