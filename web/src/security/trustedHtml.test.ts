// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRUSTED_TYPES_POLICY } from "./csp";
import { htmlRenderer } from "../editor/engine/adapters/html";
import type { Doc } from "../editor/engine/domain/model";
import { answerEnv, markdown } from "../editor/components/safeMarkdown";

// jsdom has no Trusted Types, so the browser path is pinned against a fake
// factory installed on `globalThis`, and the module is re-imported per test
// because it creates its policy once. The dialect check runs in the helpers
// on both paths, so the dialect suites below need no factory.

interface FakePolicy {
  createHTML(input: string, ...args: unknown[]): TrustedHTML;
}

function installFactory() {
  const created: string[] = [];
  const marked = new WeakSet<object>();
  const factory = {
    createPolicy(
      name: string,
      rules: { createHTML: (s: string, ...args: unknown[]) => string },
    ) {
      created.push(name);
      const policy: FakePolicy = {
        createHTML(input, ...args) {
          const html = rules.createHTML(input, ...args);
          const value = { toString: () => html };
          marked.add(value);
          return value as unknown as TrustedHTML;
        },
      };
      return policy;
    },
  };
  (globalThis as { trustedTypes?: unknown }).trustedTypes = factory;
  return { created, isMarked: (value: unknown) => marked.has(value as object) };
}

async function load() {
  vi.resetModules();
  return import("./trustedHtml");
}

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

afterEach(() => {
  delete (globalThis as { trustedTypes?: unknown }).trustedTypes;
});

describe("without the API", () => {
  it("hands the string through, so every sink works as before", async () => {
    const { trustedHtml, setInnerHtml, parseDocument } = await load();
    expect(trustedHtml("<p>a</p>")).toBe("<p>a</p>");

    const el = document.createElement("div");
    setInnerHtml(el, "<p>a</p><p>b</p>");
    expect(el.children).toHaveLength(2);

    const page = parseDocument("<p>x</p>", "text/html");
    expect(page.body.textContent).toBe("x");
    const xml = parseDocument("<a><b/></a>", "application/xml");
    expect(xml.documentElement.localName).toBe("a");
  });

  it("still refuses markup outside the dialect at a rendered sink", async () => {
    const { trustedHtml, setInnerHtml, parseDocument } = await load();
    expect(() => trustedHtml('<p><img src="x" onerror="1"></p>')).toThrow(
      /<img>/,
    );
    const el = document.createElement("div");
    expect(() => setInnerHtml(el, "<p><script>1</script></p>")).toThrow(
      /script/,
    );
    expect(el.childNodes).toHaveLength(0);
    // The inert parse stays open to anything.
    expect(parseDocument("<script>1</script>", "text/html").body).toBeTruthy();
  });
});

describe("with the API", () => {
  it("creates one policy, by the name the CSP admits", async () => {
    const { created } = installFactory();
    const { trustedHtml } = await load();
    trustedHtml("a");
    trustedHtml("b");
    expect(created).toEqual([TRUSTED_TYPES_POLICY]);
  });

  it("marks rendered markup unchanged", async () => {
    const { isMarked } = installFactory();
    const { trustedHtml } = await load();
    const value = trustedHtml("<p>as rendered</p>");
    expect(isMarked(value)).toBe(true);
    expect(String(value)).toBe("<p>as rendered</p>");
  });

  it("hands back the same value for the same markup, so React leaves the sink alone", async () => {
    // React rewrites `innerHTML` whenever `__html` is a different object, and
    // a fresh `TrustedHTML` per render would replace the subtree each time,
    // a selection or focus inside it with it.
    installFactory();
    const { trustedHtml } = await load();
    const first = trustedHtml("<p>as rendered</p>");
    expect(trustedHtml("<p>as rendered</p>")).toBe(first);
    expect(trustedHtml("<p>other</p>")).not.toBe(first);
  });

  it("still refuses outside markup on a second ask", async () => {
    installFactory();
    const { trustedHtml } = await load();
    const bad = '<p><img src="x" onerror="1"></p>';
    expect(() => trustedHtml(bad)).toThrow(/<img>/);
    expect(() => trustedHtml(bad)).toThrow(/<img>/);
  });

  it("creates the policy on first use, not at import", async () => {
    // `csp.ts` is imported by the build's config, where no window exists, so
    // the module must load without touching the factory.
    const { created } = installFactory();
    await load();
    expect(created).toEqual([]);
  });

  it("refuses markup outside the dialect at a rendered sink", async () => {
    installFactory();
    const { trustedHtml, setInnerHtml } = await load();
    expect(() => trustedHtml('<p><img src="x" onerror="1"></p>')).toThrow(
      /<img>/,
    );
    const el = document.createElement("div");
    expect(() => setInnerHtml(el, "<p><script>1</script></p>")).toThrow(
      /script/,
    );
    expect(el.childNodes).toHaveLength(0);
  });

  it("parses anything into an inert document", async () => {
    installFactory();
    const { parseDocument } = await load();
    const page = parseDocument(
      '<script>globalThis.__marker = 1</script><img src="x" onerror="1"><p>t</p>',
      "text/html",
    );
    expect(page.body.textContent).toBe("t");
    expect((globalThis as { __marker?: number }).__marker).toBeUndefined();
    const xml = parseDocument("<a><b/></a>", "application/xml");
    expect(xml.documentElement.localName).toBe("a");
  });
});

describe("the rendered dialect", () => {
  it("admits everything the engine's renderer writes", async () => {
    const { checkRendered } = await load();
    const run = (
      text: string,
      bold = false,
      italic = false,
      monospace = false,
    ) => ({
      text,
      format: { bold, italic, monospace },
    });
    const doc: Doc = [
      { runs: [run("Title")], blockType: "h1", alignment: "center" },
      { runs: [run("Sub")], blockType: "h2", alignment: "right" },
      {
        runs: [
          run("a "),
          run("b", true),
          run("c", false, true),
          run("d", false, false, true),
          run("e", true, true, true),
        ],
        blockType: "paragraph",
        alignment: "justify",
      },
      { runs: [run("")], blockType: "paragraph", alignment: "left" },
      { runs: [run("")], blockType: "pagebreak", alignment: "left" },
      {
        runs: [run('<b>&amp;</b> "quoted"')],
        blockType: "paragraph",
        alignment: "left",
      },
    ];
    expect(() => checkRendered(htmlRenderer.render(doc), parse)).not.toThrow();
  });

  it("admits everything the Markdown renderer writes", async () => {
    const { checkRendered } = await load();
    const source = [
      "# One",
      "## Two",
      "### Three",
      "###### Six",
      "",
      'A *soft* **strong** ~~gone~~ `code` [link](https://example.org "A title") <https://example.org>.',
      "Mail [me](mailto:a@b.c) and [not this](javascript:alert(1)) <b>raw</b>.",
      "Line one  ",
      "Line two ![alt text](https://example.org/x.png)",
      "",
      "- a",
      "- b",
      "  - nested",
      "",
      "3. three",
      "4. four",
      "",
      "> quoted",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "    indented",
      "",
      "---",
      "",
      "| h | c | r |",
      "|:--|:-:|--:|",
      "| 1 | 2 | 3 |",
    ].join("\n");
    const html = markdown.render(source);
    // The corpus reached the shapes it was written for.
    expect(html).toContain('<a href="https://example.org" title="A title"');
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('<th style="text-align:center">');
    expect(html).toContain('<code class="language-ts">');
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain("<img");
    expect(() => checkRendered(html, parse)).not.toThrow();
  });

  it("admits a chat answer's citations and web marks", async () => {
    const { checkRendered } = await load();
    const env = answerEnv({
      web: { searched: false, citable: new Map(), cited: [] },
      titles: new Map([["node:S1", "Chapter one"]]),
      final: true,
      citationLabel: (title) => `Open ${title}`,
    });
    const html = markdown.render("As node:S1 says.", env);
    expect(html).toContain('<button type="button" class="ai-cite"');
    expect(() => checkRendered(html, parse)).not.toThrow();
    expect(() =>
      checkRendered('<p>Cited<sup class="ai-web-mark">1</sup>.</p>', parse),
    ).not.toThrow();
  });

  it("admits the Reference reader's aside wrapper and nothing like it", async () => {
    const { checkRendered } = await load();
    expect(() =>
      checkRendered('<div class="tpl-note"><p>a note</p></div>', parse),
    ).not.toThrow();
    expect(() =>
      checkRendered('<div class="tpl-note other"><p>x</p></div>', parse),
    ).toThrow(/<div class>/);
  });

  it.each([
    ['<p><img src="x" onerror="1"></p>', /<img>/],
    ["<script>1</script>", /head/],
    ["<p><script>1</script></p>", /<script>/],
    ["<style>p{}</style>", /head|<style>/],
    ['<iframe src="https://example.org"></iframe>', /<iframe>/],
    ['<svg><g onload="1"></g></svg>', /<svg>/],
    ["<math><mi>x</mi></math>", /<math>/],
    ['<a href="javascript:alert(1)">x</a>', /<a href>/],
    ['<a href="data:text/html,x">x</a>', /<a href>/],
    ['<a href="https://example.org" target="_top">x</a>', /<a target>/],
    ['<a href="https://example.org" rel="opener">x</a>', /<a rel>/],
    ['<a href="https://example.org" onclick="1">x</a>', /<a onclick>/],
    ['<p onclick="1">x</p>', /<p onclick>/],
    ['<p style="color:red">x</p>', /<p style>/],
    ['<p style="text-align:center;background:url(x)">x</p>', /<p style>/],
    ['<p id="x">x</p>', /<p id>/],
    [
      '<button type="submit" class="ai-cite" data-cite="a">x</button>',
      /<button type>/,
    ],
    [
      '<button type="button" class="other" data-cite="a">x</button>',
      /<button class>/,
    ],
    [
      '<button type="button" class="ai-cite" data-cite="a" onclick="1">x</button>',
      /<button onclick>/,
    ],
    ['<sup class="other">1</sup>', /<sup class>/],
    ['<code class="hljs">x</code>', /<code class>/],
    ['<ol start="x">x</ol>', /<ol start>/],
    ["<p>x</p><!-- c -->", /node of type 8/],
    ['<base href="https://example.org/">', /head/],
    ['<meta http-equiv="refresh" content="0">', /head/],
    ["<title>x</title><p>y</p>", /head/],
    ['<body onload="1"><p>x</p></body>', /frame/],
    ['<html lang="x"><p>x</p></html>', /frame/],
    ["<frameset></frameset>", /frame/],
    ["<form><input></form>", /<form>/],
    ["<details open><summary>x</summary></details>", /<details>/],
    ['<video src="x"></video>', /<video>/],
    ["<span>x</span>", /<span>/],
    ['<div class="x">x</div>', /<div class>/],
    ["<mark>x</mark>", /<mark>/],
  ])("refuses %s", async (html, reason) => {
    const { checkRendered } = await load();
    expect(() => checkRendered(html, parse)).toThrow(reason);
  });

  it("names the element or attribute refused, never the text around it", async () => {
    const { checkRendered } = await load();
    let message = "";
    try {
      checkRendered(
        '<p>the manuscript<span data-x="secret">text</span></p>',
        parse,
      );
    } catch (err) {
      message = String(err);
    }
    expect(message).toMatch(/<span>/);
    expect(message).not.toMatch(/manuscript|secret|text/);
  });
});
