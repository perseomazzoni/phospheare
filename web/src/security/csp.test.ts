// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { TRUSTED_TYPES_POLICY, contentSecurityPolicy, injectCsp } from "./csp";
import { DEFAULT_AI, normalizeOllamaEndpoint } from "../ai/settings";
// `?raw` reads a source file from a test, as `theme/contract.test.ts` does
// with the stylesheets. It keeps the web workspace free of `@types/node`,
// and Vite resolves it at build time.
import BASE_CSS from "../styles/base.css?raw";
import PAGE_TS from "../theme/page.ts?raw";
import INDEX_HTML from "../../index.html?raw";

// The policy is a security control with no runtime of its own: nothing fails
// when a directive is widened, which is the failure a CSP invites. So every
// property that makes it worth having is pinned here, and a property about a
// source file is checked against the file, not a copy of it.

/** Parse the serialized policy back into directive → sources. */
const parse = (policy: string): Map<string, string[]> =>
  new Map(
    policy.split("; ").map((part) => {
      const [name, ...sources] = part.split(" ");
      return [name ?? "", sources];
    }),
  );

const build = () => parse(contentSecurityPolicy("build"));
const dev = () => parse(contentSecurityPolicy("dev"));
const demo = () => parse(contentSecurityPolicy("demo"));

describe("the shipped policy", () => {
  it("allows no inline script, which is the whole point", () => {
    // With this line `safeMarkdown.ts` is not the only defence: an escape
    // from the sanitizer is a console error instead of script running against
    // the writer's Drive grant.
    expect(build().get("script-src")).toEqual(["'self'"]);
  });

  it("names no inline script in ANY mode's script-src but dev's", () => {
    // Dev's relaxation is allowed; a third mode must not inherit it.
    expect(dev().get("script-src")).toContain("'unsafe-inline'");
    expect(build().get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("forbids plugins, foreign base URLs, foreign form posts and framing", () => {
    const policy = build();
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("frame-src")).toEqual(["'none'"]);
    // Injected markup escapes an origin without running a script of its own
    // in these two ways: rewriting the base so relative URLs re-point, or
    // posting the DOM somewhere else.
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
  });

  it("never allows a wildcard, and never allows http: or https: as a scheme source", () => {
    // `connect-src https:` reads as a restriction and is barely one. Every
    // directive is swept, so an addition cannot put a bare scheme or a lone
    // `*` beside the specific hosts.
    for (const [directive, sources] of build())
      for (const source of sources) {
        expect(source, directive).not.toBe("*");
        expect(source, directive).not.toBe("https:");
        expect(source, directive).not.toBe("http:");
      }
  });

  it("admits the writer's Google avatar, and images are the ONLY thing it admits", () => {
    // The writer's `avatarUrl` is at `https://lh3.googleusercontent.com/...`.
    // A blocked image is only a console entry and a blank circle, so nothing
    // else would catch its loss.
    const policy = build();
    expect(policy.get("img-src")).toContain("https://*.googleusercontent.com");

    // Google picks `lh3` to `lh6` per request, so the host is a wildcard. A
    // wildcard is the one source that could widen this policy, so it is pinned
    // to `img-src` alone: in `script-src` or `connect-src` the same words
    // would be a different decision.
    for (const [directive, sources] of policy)
      if (directive !== "img-src")
        expect(sources.join(" "), directive).not.toContain("googleusercontent");
  });

  it("admits data: for images and nowhere else", () => {
    // The icon set uses inline SVG data URIs. `data:` in script-src or
    // connect-src would be an exfiltration channel and an execution one.
    const policy = build();
    expect(policy.get("img-src")).toContain("data:");
    for (const [directive, sources] of policy)
      if (directive !== "img-src")
        expect(sources, directive).not.toContain("data:");
  });
});

describe("the destinations the policy admits", () => {
  it("admits Drive, OpenRouter, Wikipedia and GitHub and no other third party", () => {
    const external = (build().get("connect-src") ?? []).filter(
      (source) =>
        source !== "'self'" && !/localhost|127\.0\.0\.1|\[::1\]/.test(source),
    );
    expect(external).toEqual([
      "https://www.googleapis.com",
      "https://openrouter.ai",
      "https://*.wikipedia.org",
      "https://api.github.com",
    ]);
  });

  it("admits GitHub only in a shipped build", () => {
    expect((dev().get("connect-src") ?? []).join(" ")).not.toContain("github");
    expect((demo().get("connect-src") ?? []).join(" ")).not.toContain("github");
  });

  it("admits loopback on ANY port, because the writer chooses Ollama's", () => {
    // A fixed 11434 would break a writer running Ollama elsewhere, with a
    // message about a policy they never set. `ai/settings.ts` accepts any
    // valid port, and the policy must match it.
    const sources = build().get("connect-src") ?? [];
    expect(sources).toContain("http://localhost:*");
    expect(sources).toContain("http://127.0.0.1:*");
    expect(sources.some((source) => /localhost:11434/.test(source))).toBe(
      false,
    );
  });

  it("admits every endpoint `normalizeOllamaEndpoint` can RETURN", () => {
    // The policy must cover what the normalizer produces, not what it
    // accepts. The two differ: `[::1]` is accepted and folded to `localhost`,
    // because CSP cannot express the bracketed form.
    //
    // The row drives the real function. Scraping the allow-list out of
    // `settings.ts` with a regex truncates on the `]` inside `"[::1]"`.
    const admits = (origin: string): boolean => {
      const url = new URL(origin);
      return (build().get("connect-src") ?? []).some((source) => {
        const match = /^(https?):\/\/([^:]+):\*$/.exec(source);
        return (
          match?.[1] === url.protocol.replace(":", "") &&
          match[2] === url.hostname
        );
      });
    };

    for (const typed of [
      "http://localhost:11434",
      "http://localhost:1234",
      "http://127.0.0.1:11434",
      "https://localhost:8443",
      "http://[::1]:11434",
      "http://[::1]:9999",
    ])
      expect(admits(normalizeOllamaEndpoint(typed)), typed).toBe(true);
  });

  it("is reachable for the default endpoint the app ships with", () => {
    // Whatever `DEFAULT_AI` points at must be admitted, or the assistant is
    // dead on arrival behind its own policy.
    const sources = (build().get("connect-src") ?? []).join(" ");
    const { hostname, protocol } = new URL(DEFAULT_AI.endpoint);
    expect(sources).toContain(`${protocol}//${hostname}:*`);
  });

  it("does not admit the Drive origins that are navigations, not connections", () => {
    // A card's folder link and the consent screen are places the browser goes,
    // not places the app fetches from. Listing them would widen `connect-src`
    // for no reason; `form-action` and `frame-src` are what govern them.
    const sources = (build().get("connect-src") ?? []).join(" ");
    expect(sources).not.toContain("drive.google.com");
    expect(sources).not.toContain("accounts.google.com");
  });

  it("admits the HMR socket in dev only", () => {
    expect((dev().get("connect-src") ?? []).join(" ")).toContain(
      "ws://localhost:*",
    );
    expect((build().get("connect-src") ?? []).join(" ")).not.toContain("ws:");
  });
});

describe("the fonts and styles the app actually has", () => {
  it("admits no font CDN, because every family is self-hosted", () => {
    // Every `@font-face` rule in `base.css` points at `/fonts/*.woff2` under
    // `public/`. A family added from a CDN fails here, not as a font that
    // does not load in production.
    expect(BASE_CSS).toContain("@font-face");
    expect(BASE_CSS).not.toMatch(/src:\s*url\(["']?https?:/);
    expect(build().get("font-src")).toEqual(["'self'"]);
  });

  it("keeps inline styles for the ONE reason that needs them", () => {
    // React's `style={{}}` prop and the theme tokens go through the CSS object
    // model, which CSP does not govern. The one governed case is the `<style>`
    // element `theme/page.ts` creates for the theme's sheet, which
    // holds all of its paint: `style-src 'self'` would leave every theme
    // unpainted. The directive is worth reconsidering only when the sheet
    // stops arriving as a `<style>` element.
    expect(PAGE_TS).toContain('createElement("style")');
    expect(build().get("style-src")).toContain("'unsafe-inline'");
  });
});

describe("Trusted Types", () => {
  it("requires them in the build, for the one policy `trustedHtml.ts` creates", () => {
    const policy = build();
    expect(policy.get("require-trusted-types-for")).toEqual(["'script'"]);
    // The name alone, no `'allow-duplicates'`: a dependency or an injected
    // script that creates a policy of its own, by this name or another, is
    // refused.
    expect(policy.get("trusted-types")).toEqual([TRUSTED_TYPES_POLICY]);
  });

  it("leaves dev without them, where HMR re-evaluates modules", () => {
    expect(dev().has("require-trusted-types-for")).toBe(false);
    expect(dev().has("trusted-types")).toBe(false);
  });

  // Every file in the tree that is not a test. A sink added anywhere fails
  // here, in jsdom, before it fails as a Trusted Types violation in a browser
  // that enforces the directive.
  const SOURCES = import.meta.glob(
    ["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!./trustedHtml.ts"],
    { eager: true, query: "?raw", import: "default" },
  ) as Record<string, string>;

  it("sees every source file", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
  });

  it("lets no source file assign innerHTML or parse with DOMParser except through the policy", () => {
    for (const [file, text] of Object.entries(SOURCES)) {
      expect(text, file).not.toMatch(/\.innerHTML\s*=[^=]/);
      expect(text, file).not.toMatch(/\.outerHTML\s*=[^=]/);
      expect(text, file).not.toMatch(
        /insertAdjacentHTML|createContextualFragment|srcdoc|document\.write/,
      );
      expect(text, file).not.toMatch(/parseFromString\(/);
    }
  });

  it("marks every __html through the policy", () => {
    let sinks = 0;
    for (const [file, text] of Object.entries(SOURCES))
      for (const match of text.matchAll(/__html:\s*([^}]+)/g)) {
        sinks++;
        expect(match[1].trim(), file).toMatch(/^trustedHtml\(/);
      }
    // The three readers of the writer's own files and the model's answers.
    expect(sinks).toBe(3);
  });
});

describe("what a meta-delivered policy cannot do", () => {
  it("emits no directive that a <meta> silently ignores", () => {
    // CSP3 drops `frame-ancestors`, `report-uri`, `report-to` and `sandbox`
    // when the policy arrives in a meta element. Emitting one would read as
    // clickjacking defended when it is not. They belong to whatever response
    // header a future host serves.
    const policy = contentSecurityPolicy("build");
    for (const ignored of [
      "frame-ancestors",
      "report-uri",
      "report-to",
      "sandbox",
    ])
      expect(policy, ignored).not.toContain(ignored);
  });
});

describe("the HTML that carries it", () => {
  const html = INDEX_HTML;

  it("does not hand-write the policy, so there is one source", () => {
    // The `phospheare-csp` plugin in `vite.config.ts` injects the meta tag. A
    // second copy in the HTML would be the one a reader edits, and the one
    // nothing tests.
    expect(html).not.toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("src/security/csp.ts");
  });

  it("sets the referrer policy, which is the one companion meta can carry", () => {
    // An app URL names a project id. It leaves as an origin or not at all.
    expect(html).toContain(
      '<meta name="referrer" content="strict-origin-when-cross-origin" />',
    );
  });

  it("keeps the charset declaration inside the first 1024 bytes", () => {
    // A meta-delivered policy belongs early, but HTML requires the encoding
    // declaration within the first 1024 bytes, and the policy alone is about
    // 630 of them. Prepended, one more source host could break encoding
    // detection with nothing failing to say so.
    const injected = injectCsp(html, "build");
    const charset = injected.indexOf("<meta charset=");
    const csp = injected.indexOf("Content-Security-Policy");
    expect(charset).toBeGreaterThanOrEqual(0);
    expect(charset).toBeLessThan(csp);
    expect(
      new TextEncoder().encode(injected.slice(0, charset)).length,
    ).toBeLessThan(1024);
  });

  it("refuses to build rather than ship HTML it could not protect", () => {
    // Injecting it somewhere else would produce a build that is unprotected,
    // or one whose encoding detection is broken. An unbuildable tree is
    // cheaper than either.
    expect(() =>
      injectCsp("<!doctype html><html><head></head></html>", "build"),
    ).toThrow(/no <meta charset>/);
  });

  it("injects exactly one policy, whatever the mode", () => {
    for (const mode of ["build", "dev", "demo"] as const) {
      const injected = injectCsp(html, mode);
      // Matched on the attribute, not the bare phrase: `index.html` names the
      // policy in a comment pointing at its source.
      const tags = injected.match(/http-equiv="Content-Security-Policy"/g);
      expect(tags, mode).toHaveLength(1);
    }
  });
});

describe("the demo site's policy", () => {
  it("connects to its own origin only", () => {
    expect(demo().get("connect-src")).toEqual(["'self'"]);
  });

  it("loads images from its own origin and data URIs only", () => {
    expect(demo().get("img-src")).toEqual(["'self'", "data:"]);
  });

  it("keeps every other directive of the shipped policy", () => {
    const shipped = build();
    for (const [directive, sources] of demo()) {
      if (directive === "connect-src" || directive === "img-src") continue;
      expect(sources, directive).toEqual(shipped.get(directive));
    }
    expect([...demo().keys()]).toEqual([...shipped.keys()]);
  });
});
