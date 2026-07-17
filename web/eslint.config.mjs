// ESLint flat config (v9+) — portado do .eslintrc.json legado na Fase 2.
// Os arquivos de public/app/ são scripts globais que compartilham funções entre
// si via escopo global do browser, então no-undef ficaria com milhares de falsos
// positivos — fica desligado lá e ligado no backend.
import js from "@eslint/js";

const regrasComuns = {
  "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  "no-console": "off",
  eqeqeq: ["warn", "always"],
  curly: "off",
  "no-throw-literal": "error",
  "prefer-const": "warn",
  "no-var": "warn",
  "no-empty": ["warn", { allowEmptyCatch: true }],
  // Herança do mojibake antigo (espaços irregulares em comentários) e regex
  // com escapes redundantes — inofensivos; warning até a limpeza gradual
  "no-irregular-whitespace": "warn",
  "no-useless-escape": "warn",
  "no-useless-assignment": "warn",
};

export default [
  { ignores: ["node_modules/", "public/libs/", "data/"] },
  // Backend (Node/CommonJS)
  {
    files: ["*.js", "routes/**/*.js", "services/**/*.js", "middleware/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { require: "readonly", module: "writable", process: "readonly", __dirname: "readonly", Buffer: "readonly", console: "readonly", setTimeout: "readonly", setInterval: "readonly", setImmediate: "readonly", clearTimeout: "readonly", URL: "readonly", URLSearchParams: "readonly", fetch: "readonly", AbortController: "readonly", AbortSignal: "readonly" },
    },
    rules: { ...js.configs.recommended.rules, ...regrasComuns },
  },
  // Frontend (browser, escopo global compartilhado entre arquivos)
  {
    files: ["public/app/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script" },
    rules: {
      ...js.configs.recommended.rules,
      ...regrasComuns,
      "no-undef": "off",
      "no-unused-vars": "off", // funções definidas num arquivo e usadas noutro
      "no-redeclare": "error", // pega colisão real entre os arquivos concatenados
    },
  },
];
