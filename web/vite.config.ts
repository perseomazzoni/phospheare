// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { injectCsp } from "./src/security/csp.ts";
import { injectProductName, PRODUCT } from "./src/product.ts";
import {
  describeFindings,
  findForbiddenMarkers,
  findForbiddenModules,
} from "./build/demoBoundary.ts";
import {
  DEMO_LEFT_OUT_PUBLIC,
  demoPageFiles,
  demoTwin,
  mayHaveTwin,
  publicTexts,
  pruneLocale,
} from "./build/demoBuild.ts";

/** The mode `build:demo` passes; it builds the demo site, not the program. */
const DEMO_MODE = "demo";

/**
 * Puts the Content-Security-Policy into the served HTML. It is injected
 * rather than written into `index.html` so the policy has one source
 * (`src/security/csp.ts`, which the tests read), and dev and build differ
 * only by the two relaxations that file documents. `ctx.server` is present
 * for `vite dev` and absent for `vite build`.
 */
function cspPlugin(demo: boolean): Plugin {
  return {
    name: "phospheare-csp",
    transformIndexHtml: {
      order: "pre",
      handler: (html, ctx) =>
        injectCsp(html, ctx.server ? "dev" : demo ? "demo" : "build"),
    },
  };
}

/**
 * Builds the demo site's page from `index.html`: the script points at the
 * demo root, `src/demo/main.tsx`, so the bundle holds only what that root
 * imports, and the manifest and home-screen icon links go, because the demo
 * is not a program to install. A page without the full root's script tag
 * throws: a demo build of the full program must not pass.
 */
function demoEntryPlugin(): Plugin {
  const full = 'src="/src/main.tsx"';
  return {
    name: "demo-entry",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => {
        if (!html.includes(full))
          throw new Error(
            `index.html has no ${full} to point at the demo root.`,
          );
        return html
          .replace(full, 'src="/src/demo/main.tsx"')
          .replace(/[ \t]*<link rel="manifest"[^>]*>\r?\n?/, "")
          .replace(/[ \t]*<link rel="apple-touch-icon"[^>]*>\r?\n?/, "");
      },
    },
  };
}

/**
 * Resolves each module `build/demoBuild.ts` lists to its `.demo` twin, so the
 * demo build carries the twin and never the original.
 */
function demoTwinPlugin(): Plugin {
  const srcRoot = fileURLToPath(new URL("./src", import.meta.url));
  return {
    name: "demo-twins",
    apply: "build",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!mayHaveTwin(source)) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      return resolved ? demoTwin(resolved.id, srcRoot) : null;
    },
  };
}

/**
 * Leaves the locale sections only the stripped features read out of the demo
 * build (`build/demoBuild.ts`). It runs before Vite turns the JSON into a
 * module, so the strings never reach a chunk.
 */
function demoLocalesPlugin(): Plugin {
  return {
    name: "demo-locales",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]src[\\/]locales[\\/][a-z]{2}\.json$/.test(id)) return null;
      return { code: JSON.stringify(pruneLocale(JSON.parse(code))), map: null };
    },
  };
}

/**
 * Copies the built page to each of the site's pages and to `404.html`
 * (`demoPageFiles`). The site's host serves files only, with no rewrite
 * rules, so a direct visit or a reload of `/legal` needs a file there; the
 * router in the copy reads the address. The full build has none: the desktop
 * program serves it.
 */
function demoPagesPlugin(): Plugin {
  let outDir = "";
  return {
    name: "demo-pages",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const page = readFileSync(resolve(outDir, "index.html"));
      for (const file of demoPageFiles()) {
        const target = resolve(outDir, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, page);
      }
    },
  };
}

/**
 * Ships the program's licence with the demo and removes the install icons
 * Vite copied from `public/` (`DEMO_LEFT_OUT_PUBLIC`).
 */
function demoPublicPlugin(): Plugin {
  let outDir = "";
  return {
    name: "demo-public",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "LICENSE.txt",
        source: readFileSync(new URL("../LICENSE", import.meta.url), "utf8"),
      });
    },
    closeBundle() {
      for (const file of DEMO_LEFT_OUT_PUBLIC)
        rmSync(resolve(outDir, file), { force: true });
    },
  };
}

/**
 * Fails the demo build when a module or a text outside the demo's boundary
 * reaches the emitted files (`build/demoBoundary.ts`). It reads the
 * modules each chunk renders, not the module graph: a barrel puts every
 * re-export into the graph, also those tree-shaking drops. The text files
 * Vite copies from `public/` are scanned with the bundle's, since they
 * ship beside it.
 */
function demoGatePlugin(): Plugin {
  const srcRoot = fileURLToPath(new URL("./src", import.meta.url));
  let publicDir = "";
  return {
    name: "demo-gate",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const rendered = new Set<string>();
        const texts: [string, string][] = [];
        for (const [file, output] of Object.entries(bundle)) {
          if (output.type === "chunk") {
            for (const [id, module] of Object.entries(output.modules))
              if (module.renderedLength > 0) rendered.add(id);
            texts.push([file, output.code]);
          } else if (typeof output.source === "string") {
            texts.push([file, output.source]);
          }
        }
        if (publicDir) texts.push(...publicTexts(publicDir));
        const info = (id: string) => this.getModuleInfo(id);
        const modules = findForbiddenModules(
          rendered,
          srcRoot,
          (id) => [
            ...(info(id)?.importers ?? []),
            ...(info(id)?.dynamicImporters ?? []),
          ],
          (id) => info(id)?.isEntry ?? false,
        );
        const markers = findForbiddenMarkers(texts);
        if (modules.length || markers.length)
          this.error(describeFindings(modules, markers));
      },
    },
  };
}

/**
 * Fills the public product name into the served HTML: the tab title and the
 * meta a link preview reads. It comes from `product.json` through
 * `src/product.ts`, so `index.html` names a placeholder, never the product.
 */
function productNamePlugin(demo: boolean): Plugin {
  return {
    name: "product-name",
    // Wrapped, not passed bare: Vite calls the handler with a second
    // argument (its context), which would land in `injectProductName`'s
    // optional `name` and throw.
    transformIndexHtml: {
      order: "pre",
      handler: (html) => injectProductName(html),
    },
    // The web app manifest carries the name an installed icon shows, so it
    // is written from the same source rather than kept as a static file a
    // rename would leave behind.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== `/${MANIFEST_FILE}`) return next();
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(manifestJson());
      });
    },
    generateBundle() {
      if (demo) return;
      this.emitFile({
        type: "asset",
        fileName: MANIFEST_FILE,
        source: manifestJson(),
      });
    },
  };
}

/**
 * Strips the HTML comments from the built page: they explain `index.html` to
 * its developers and would ship to every visitor. It runs last, after the
 * plugins that anchor on them, and the dev server keeps them. Removal repeats
 * until none is left, since one pass over a nested comment leaves a whole
 * `<!--` behind.
 */
function stripHtmlCommentsPlugin(): Plugin {
  return {
    name: "strip-html-comments",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html) => {
        let out = html;
        let before = "";
        while (out !== before) {
          before = out;
          out = out.replace(/[ \t]*<!--[\s\S]*?-->\r?\n?/g, "");
        }
        return out;
      },
    },
  };
}

const MANIFEST_FILE = "manifest.webmanifest";

/**
 * The installable app's card: the public name, the brand's night ground
 * (`docs/brand/study.html`) and the bust icons rendered by
 * `tools/brand/icons.mjs`. The app has no offline support and claims none.
 */
function manifestJson(): string {
  return JSON.stringify(
    {
      name: PRODUCT.name,
      short_name: PRODUCT.name,
      start_url: "/app",
      display: "standalone",
      background_color: "#07090D",
      theme_color: "#07090D",
      icons: [
        {
          src: "/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any maskable",
        },
        {
          src: "/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable",
        },
      ],
    },
    null,
    2,
  );
}

const RELEASE_FEED =
  "https://api.github.com/repos/perseomazzoni/phospheare/releases/latest";

/**
 * The dev and preview servers' stand-in for `RELEASE_FEED`, on the page's
 * own origin, so no copy run for development or for the E2E suites asks
 * GitHub. It answers "nothing published"; a spec answers it itself to show
 * the notice.
 */
const RELEASE_STAND_IN = "/__release/latest";

/**
 * The build's version and where it reads the newest release
 * (`release/compose.ts`). The version is `package.json`'s, which a release
 * tag carries, so a writer who builds a tag's source code gets that version
 * and the check. A release run also sets `VERSION` to its tag without the
 * `v`; the workflow stops if the two differ. `desktop/build.sh` stamps the same
 * value into the desktop program and the identity service. A production build
 * asks GitHub; the dev server and the E2E build ask the stand-in, and the unit
 * tests nothing. The demo site never checks: its policy admits no other
 * origin.
 */
function releaseDefines(mode: string): Record<string, string> {
  const tagged = process.env.VERSION?.trim();
  const own = (
    JSON.parse(
      readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    ) as {
      version: string;
    }
  ).version;
  const feed =
    mode === DEMO_MODE
      ? ""
      : tagged || mode === "production"
        ? RELEASE_FEED
        : mode === "e2e" || mode === "development"
          ? RELEASE_STAND_IN
          : "";
  return {
    __APP_VERSION__: JSON.stringify(tagged || own),
    __RELEASE_FEED__: JSON.stringify(feed),
    __RELEASE_TAG__: JSON.stringify(tagged ? `v${tagged}` : ""),
  };
}

function releaseStandInPlugin(): Plugin {
  const answer = (
    req: { url?: string },
    res: { statusCode: number; end: () => void },
    next: () => void,
  ) => {
    if (req.url?.split("?")[0] !== RELEASE_STAND_IN) return next();
    res.statusCode = 204;
    res.end();
  };
  return {
    name: "release-stand-in",
    configureServer: (server) => void server.middlewares.use(answer),
    configurePreviewServer: (server) => void server.middlewares.use(answer),
  };
}

export default defineConfig(({ mode }) => ({
  define: releaseDefines(mode),
  plugins: [
    react(),
    cspPlugin(mode === DEMO_MODE),
    productNamePlugin(mode === DEMO_MODE),
    stripHtmlCommentsPlugin(),
    releaseStandInPlugin(),
    ...(mode === DEMO_MODE
      ? [
          demoEntryPlugin(),
          demoTwinPlugin(),
          demoLocalesPlugin(),
          demoPagesPlugin(),
          demoPublicPlugin(),
          demoGatePlugin(),
        ]
      : []),
  ],
  base: "/",
  test: {
    // The Playwright specs (the e2e run and the landing's screenshot rig)
    // run only under `@playwright/test`, so vitest's `**/*.spec.ts` pattern
    // must not sweep them up.
    exclude: ["e2e/**", "scripts/shots/**"],
    // Snapshots that show a clock time hold the time zone they were recorded
    // in, so every machine runs the suite in that one.
    env: { TZ: "Europe/Rome" },
    // The theme contract test reads base.css to check the `:root` defaults
    // against the token list. Vitest stubs CSS imports to an empty string
    // unless asked not to, which would make that check pass vacuously.
    css: true,
    coverage: {
      provider: "v8",
      // Report the numbers even when a test fails: on a busy machine one
      // stray timing failure would otherwise leave the gate unmeasured. A
      // failing suite still fails the command.
      reportOnFailure: true,
      // Every source file the pattern matches is counted, including ones no
      // test imports; without it, deleting a test would improve the numbers.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.fixture.ts",
        // The live protocol qualification talks to the writer's real Ollama
        // and is skipped unless `PHOSPHEARE_OLLAMA_LIVE` is set; its body is
        // a manual harness, not unit surface (`CONTRIBUTING.md`).
        "src/**/*.live.test.{ts,tsx}",
        "src/vite-env.d.ts",
        "src/main.tsx",
        "src/demo/main.tsx",
        // Module wiring, like `main.tsx`: the lazy chunks' dynamic imports.
        // Covering it would pull the editor chunks into a test to prove that
        // `import()` imports.
        "src/editorChunk.ts",
      ],
      reporter: ["text", "html"],
      // One floor for the whole SPA, read only by a `--coverage` run. A change
      // to it is explained in its pull request, and it never moves only to
      // make a run pass. It sits a few tenths under the measurement, because
      // v8 counts a few statements differently from run to run.
      thresholds: {
        lines: 95.45,
        functions: 93.65,
        branches: 88.69,
        statements: 93.6,
      },
    },
  },
  build: {
    outDir: "dist",
    // The first versions with `light-dark()`. Below them Lightning CSS
    // rewrites it into `--lightningcss-light` and `--lightningcss-dark`, which
    // only a stylesheet's own `color-scheme` defines. The theme sets
    // `color-scheme` inline (`theme/page.ts`), so the rewritten value
    // is invalid and an SVG fill falls back to black.
    // `tools/check-built-css.mjs` fails the build if a rewrite returns.
    cssTarget: ["chrome123", "edge123", "firefox120", "safari17.5", "ios17.5"],
  },
  // The editor is a lazy chunk, and its exclusive dependency (markdown-it) is
  // not in the initial graph, so Vite's optimizer would discover it on the
  // first editor import and fully reload the page. In the Playwright suite
  // that reload lands mid-assertion and wipes the shelf under test, so the
  // known set is pre-optimized at server start.
  optimizeDeps: {
    include: [
      "markdown-it",
      "yaml",
      "i18next",
      "react-i18next",
      "react",
      "react-dom",
      "react-router",
      // The export's two libraries load with the first export, not the
      // editor: pre-bundled here so that first export is not the moment the
      // optimizer discovers them and full-reloads the page under the writer.
      "fflate",
      "pdfmake/build/pdfmake",
    ],
  },
  server: {
    // The identity service answers `/identity/*`. Proxying it keeps its
    // session cookie same-origin with the dev server, as in any deployment.
    // `PHOSPHEARE_IDENTITY_ORIGIN` names where it runs; by default the port
    // the README runs it on. Without it, sign-in reports the service
    // unavailable and the app writes in Local Storage.
    proxy: {
      "/identity": {
        target:
          process.env.PHOSPHEARE_IDENTITY_ORIGIN ?? "http://127.0.0.1:47821",
        changeOrigin: false,
      },
    },
  },
}));
