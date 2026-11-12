// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The Content-Security-Policy ──────────────────────────────────────────────
//
// Without a policy, `safeMarkdown.ts`, the one place untrusted text reaches
// the DOM as markup, would be the only defence instead of one layer of it.
// An XSS in this origin reaches:
//
//   - the account session: the cookie is HttpOnly, so script cannot read it,
//     but script in this origin can send requests that carry it;
//   - the writer's Google Drive grant: script in this origin acts as the
//     writer against their whole Drive, which holds their manuscripts;
//   - every `dangerouslySetInnerHTML` site, among them `ReferenceReader` and
//     `SnapshotPanel`, which render the writer's own files. The writer's
//     folder is not a trust boundary: a reference note arriving through a
//     shared Drive folder is attacker input.
//
// ── A meta tag, not a header ─────────────────────────────────────────────────
//
// A response header would be better, but no host is chosen, so there is no
// origin to configure. The policy travels inside the build
// artifact instead, so it is in force on whatever serves the SPA, with no
// deployment step to remember. Once a host exists, a response header is a
// strict improvement, and the directives a meta tag cannot carry are the
// reason to make it.
//
// ── What a meta policy cannot carry ──────────────────────────────────────────
//
// `frame-ancestors`, `report-uri`, `report-to` and `sandbox` are ignored in a
// meta-delivered policy. So clickjacking is not defended here and nothing
// reports violations; both wait for a response header, along with
// `X-Content-Type-Options: nosniff`, which has no meta form. `Referrer-Policy`
// does have one: `index.html` carries it as `<meta name="referrer">`.

/** The app's own origin as a source expression. */
const SELF = "'self'";

/**
 * Loopback, every spelling and every port.
 *
 * `normalizeOllamaEndpoint` (`ai/settings.ts`) accepts `localhost`,
 * `127.0.0.1` and `[::1]`, over http or https, on any port. A fixed port here
 * would break a writer who runs Ollama on a port other than 11434.
 *
 * `http://localhost` is a potentially trustworthy origin, so reaching it from
 * an https page is not mixed content; this list is the only gate.
 *
 * The IPv6 literal is absent. CSP's host-source grammar has no production for
 * a bracketed IPv6 address, and Chrome drops `http://[::1]:*` while logging
 * "contains an invalid source" as a console error twice on every page load.
 * `normalizeOllamaEndpoint` folds `[::1]` to `localhost` instead, the same
 * address by a name CSP can express.
 */
const LOOPBACK = [
  "http://localhost:*",
  "https://localhost:*",
  "http://127.0.0.1:*",
  "https://127.0.0.1:*",
];

/**
 * Google Drive's API origin. The app's own origin serves the bundle and the
 * identity service's `/identity/*` routes.
 *
 * `drive.google.com` and `accounts.google.com` are absent: the source uses
 * them only as navigations (a card's folder link, the consent screen), and
 * `connect-src` does not govern where a link may point.
 */
const DRIVE_API = "https://www.googleapis.com";

/**
 * OpenRouter's API, reached with the writer's own key for the key exchange,
 * the key's reading, the catalogue, chat and provider search.
 */
const OPENROUTER_API = "https://openrouter.ai";

/**
 * Wikipedia's editions, one per book language, for the keyless search. The
 * edition is the book's primary language subtag (`wikiLanguage`).
 */
const WIKIPEDIA = "https://*.wikipedia.org";

/**
 * GitHub's API, asked at most once a day for the newest release
 * (`release/compose.ts`). Only a release build reads it; the dev server asks
 * a same-origin stand-in.
 */
const GITHUB_API = "https://api.github.com";

/**
 * Where Google serves profile pictures; admitted for images only.
 *
 * `lh3` to `lh6` are interchangeable and chosen per request, so a wildcard
 * host here describes the service instead of widening it.
 */
const GOOGLE_AVATARS = "https://*.googleusercontent.com";

/**
 * The Trusted Types policy name. `trustedHtml.ts` creates the one policy by
 * this name, and the `trusted-types` directive admits no other, so a policy
 * created anywhere else, by a dependency or an injected script, is refused.
 * The name is what a violation message quotes, and it names what the policy
 * marks, never the product.
 */
export const TRUSTED_TYPES_POLICY = "rendered";

/**
 * `build` ships with the full program. `dev` relaxes it for `vite dev`.
 * `demo` ships with the demo site, which has no account, no Remote Storage
 * and no model or search provider, so it reaches nothing but its own origin.
 */
export type CspMode = "build" | "dev" | "demo";

/** The policy, as directive to source list. */
function directives(mode: CspMode): Record<string, string[]> {
  const dev = mode === "dev";
  const demo = mode === "demo";
  return {
    "default-src": [SELF],

    // The directive the policy exists for. `index.html` has one script, an
    // external module, and the app has no inline script, no `eval` and no
    // `new Function`, so `'self'` alone costs nothing in a build. It turns a
    // markdown-sanitizer regression from an exploit into a console error.
    //
    // Dev adds `'unsafe-inline'`: `@vitejs/plugin-react` injects the React
    // Refresh preamble as an inline module, with no nonce to give it. So a
    // violation of this directive shows only under `vite build` and preview,
    // never under `npm run dev`.
    "script-src": dev ? [SELF, "'unsafe-inline'"] : [SELF],

    // `'unsafe-inline'` is permanent here, not a dev concession. The CSS
    // object model (`root.style.setProperty`, React's `style={{...}}`) is
    // outside CSP, but two things are not:
    //
    // `theme/page.ts` creates a `<style>` element for the theme's own sheet
    // (`themes/<family>/theme.css`), and `style-src 'self'` would silently
    // unstyle every theme.
    //
    // The editor's surface is HTML the page parses (`engine/adapters/html.ts`),
    // where a paragraph's alignment is a `style="text-align: …"` attribute;
    // without `'unsafe-inline'` every aligned paragraph shows flush left.
    //
    // A nonce must be fresh per response, and a policy baked into a static
    // artifact has no response; it becomes possible once a host serves a
    // header. The remaining exposure is CSS-based exfiltration of attribute
    // values, not code execution.
    "style-src": [SELF, "'unsafe-inline'"],

    // `data:` is for inline SVG data URIs in the icon set. No `blob:`: the one
    // object URL the app makes is the export's download
    // (`editor/export/adapters/download.ts`), a link clicked once and revoked,
    // which the browser turns into a save and never renders as an image.
    //
    // `googleusercontent.com` serves the writer's Google avatar (`avatarUrl`
    // in `AuthContext`). Without it the avatar fails silently, as a blank
    // circle that no test notices. It admits images only, no script and no
    // connect.
    "img-src": demo ? [SELF, "data:"] : [SELF, "data:", GOOGLE_AVATARS],

    // The font families are self-hosted under `public/fonts/` with their OFL
    // licences beside them; nothing is fetched from a font CDN.
    "font-src": [SELF],

    // The privacy directive: the browser sends bytes only to the destinations
    // named here, so no adapter can quietly add one. `ws:` in dev is Vite's
    // HMR socket only.
    "connect-src": dev
      ? [
          SELF,
          DRIVE_API,
          OPENROUTER_API,
          WIKIPEDIA,
          ...LOOPBACK,
          "ws://localhost:*",
          "ws://127.0.0.1:*",
        ]
      : demo
        ? [SELF]
        : [SELF, DRIVE_API, OPENROUTER_API, WIKIPEDIA, GITHUB_API, ...LOOPBACK],

    "object-src": ["'none'"],

    // Stops injected markup from rewriting the base URL and re-pointing every
    // relative script and fetch at another origin.
    "base-uri": [SELF],

    // Stops injected markup from posting the DOM (a draft, a token in a
    // field) to an attacker's endpoint.
    "form-action": [SELF],

    // The app embeds nothing. `frame-ancestors`, which governs who may embed
    // the app, is a different directive that a meta-delivered policy cannot
    // carry.
    "frame-src": ["'none'"],

    "worker-src": [SELF],
    "manifest-src": [SELF],

    // Trusted Types. A browser with the API refuses a plain string at every
    // sink that turns text into DOM (`innerHTML`, `DOMParser`) and accepts
    // only a value the named policy minted (`trustedHtml.ts`). `script-src`
    // stops an injected script from running; this stops injected markup from
    // being written in the first place, unless it came through one of the
    // sanitizing renderers, whose output is what the helpers mark. The Drive
    // access token is readable by any script in this origin, so the fewer
    // ways markup reaches the DOM, the smaller that exposure.
    //
    // Build only. Under hot module replacement a changed module is evaluated
    // again, and a second policy by the same name is refused unless the
    // directive admits duplicates; and the dev client and the React Refresh
    // runtime are not the app's code to route through the policy. The E2E
    // build (`E2E_BUILD=1`) runs the suites under the directive.
    ...(dev
      ? {}
      : {
          "require-trusted-types-for": ["'script'"],
          "trusted-types": [TRUSTED_TYPES_POLICY],
        }),
  };
}

/**
 * Serializes the policy for a `<meta http-equiv>` content attribute.
 *
 * `build` is the policy that ships. `dev` is the same policy with two
 * relaxations (inline script for React Refresh, the HMR websocket), so
 * `npm run dev` enforces every other directive: a stray font CDN, a new fetch
 * destination or an `<img src="https://…">` fails in front of whoever added
 * it, instead of surviving to a build nobody ran.
 */
export function contentSecurityPolicy(mode: CspMode): string {
  return Object.entries(directives(mode))
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");
}

/** The charset declaration, which must stay in the first 1024 bytes. */
const CHARSET = /<meta\s+charset=["']?utf-8["']?\s*\/?>/i;

/**
 * Puts the policy into `index.html`, immediately after the charset
 * declaration.
 *
 * A meta-delivered policy governs only what the parser has not yet reached,
 * so it belongs early, but HTML requires the encoding declaration inside the
 * first 1024 bytes, and the policy is already about 630 of them. Placed at
 * the very top, it would push the charset near the limit, and one more source
 * would silently break encoding detection.
 *
 * So the charset stays first and the policy follows it. A charset declaration
 * loads no resource and runs no script, so nothing between them needs
 * governing.
 *
 * A missing charset declaration throws instead of falling back to prepending:
 * a build without the policy, or with broken encoding detection, is worse
 * than an unbuildable tree.
 */
export function injectCsp(html: string, mode: CspMode): string {
  const charset = CHARSET.exec(html);
  if (!charset)
    throw new Error(
      "index.html has no <meta charset> to anchor the Content-Security-Policy to " +
        "(src/security/csp.ts explains why the policy sits immediately after it).",
    );
  const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(mode)}" />`;
  return html.replace(charset[0], `${charset[0]}\n    ${meta}`);
}
