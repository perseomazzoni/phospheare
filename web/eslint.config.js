// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import eslintConfigPrettier from "eslint-config-prettier";

// The SPA's lint contract: `@eslint/js` recommended, `typescript-eslint`
// recommended, the React Hooks rules, and Prettier's rules pinned off so the
// two tools never conflict. Formatting is Prettier's job, gated in CI by
// `npm run format:check`.
//
// Every rule is a hard error, so a lint run that passes carries no lint debt.
// `react-refresh/only-export-components` is not enabled: it flags a file that
// exports a component beside a constant or helper, which this codebase does
// (context hooks exporting their accessor, the icon set), and fast refresh is
// a dev convenience, not a quality signal.
export default tseslint.config(
  {
    ignores: ["dist", "coverage", "node_modules", "test-results"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The syntactic rules, applied to every source and test file.
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // The classic React Hooks contract, both rules hard errors. The
      // plugin's v7 `recommended` preset also bundles the React Compiler
      // rules (refs, purity, set-state-in-effect, immutability), which flag
      // patterns this codebase uses legitimately: ref access in callbacks,
      // `Date.now()` in a derived description, setState at the head of an
      // effect. They stay off.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // Unused bindings are dead code. `ignoreRestSiblings` admits the
      // destructured omit-key idiom (`const { order, ...rest } = data`),
      // where naming the key documents what is dropped. There is no
      // `_`-prefix escape: a binding kept only to be discarded belongs in a
      // rest destructure, or it goes.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true },
      ],
      // A `!` assertion is a promise the compiler did not verify, so source
      // and tests narrow or guard instead. A test that expects a value to be
      // present asserts it rather than punching through with `!`.
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    // The one type-aware rule, for source and test files alike: an unhandled
    // promise is unhandled wherever it lives. `src/**` only, because the
    // parser resolves against tsconfig.json's `include: ["src"]`, and a config
    // file outside it has no project to belong to.
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    // The scripts are Node programs, not browser source, so they get the few
    // globals they use rather than the browser set.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        performance: "readonly",
      },
    },
  },
  eslintConfigPrettier,
);
