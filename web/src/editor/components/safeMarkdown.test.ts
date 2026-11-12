// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { answerEnv, markdown, type CitationEnv } from "./safeMarkdown";
import type { ChatTurn } from "../../ai/domain/types";
import {
  NO_WEB_CITATIONS,
  webCitations,
  type WebCitations,
} from "../../ai/domain/webCitations";

// The citation rule lives on the one hardened renderer, which the Reference
// reader and summaries share with the chat. These pin that it only
// ever acts when a chat answer asks it to, and that what it draws is built
// from escaped data rather than from anything the text supplied.

const SAMPLE = [
  "A note that mentions node:S1 and reference:world.md in passing.",
  "",
  "[node:S1](https://x.test) and `node:S1`",
].join("\n");

const env = (titles: [string, string][], final = true): CitationEnv => ({
  citations: new Map(titles),
  citationLabel: (title) => `Open ${title}`,
  final,
});

describe("the citation rule", () => {
  it("leaves every other surface's output exactly as it was", () => {
    // No env — the Reference reader, a summary — and an env with nothing to
    // cite: both render byte-for-byte what a plain instance with the same
    // parser settings draws; this one differs from it only in the hardening,
    // which this sample never touches.
    const baseline = new MarkdownIt({
      html: false,
      linkify: false,
      breaks: false,
    });
    const withoutRule = (text: string) =>
      baseline
        .render(text)
        .replace(
          /<a href="([^"]*)">/g,
          '<a href="$1" rel="noopener noreferrer nofollow" target="_blank">',
        );
    expect(markdown.render(SAMPLE)).toBe(withoutRule(SAMPLE));
    expect(markdown.render(SAMPLE, env([]))).toBe(withoutRule(SAMPLE));
  });

  it("draws a known id as an escaped button, and leaves links and code alone", () => {
    const html = markdown.render(
      SAMPLE,
      env([["node:S1", 'Ch. 1 <img src=x onerror="alert(1)">']]),
    );
    // One citation: the prose one. The link's text and the code span keep
    // the id as written.
    expect(html.match(/class="ai-cite"/g)).toHaveLength(1);
    expect(html).toContain(
      '<button type="button" class="ai-cite" data-cite="node:S1" aria-label="Open Ch. 1 &lt;img src=x onerror=&quot;alert(1)&quot;&gt;">Ch. 1 &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</button>',
    );
    expect(html).not.toContain("<img");
    expect(html).toContain(">node:S1</a>");
    expect(html).toContain("<code>node:S1</code>");
  });

  it("draws a citation inside a quoted passage, the way the rooms ask for one", () => {
    // A quoted sentence is set as a blockquote that ends with its source id
    // (`QUOTE_FORM` in `policy.ts`). The id must still become the citation
    // there, or every quote would lose its link.
    const html = markdown.render(
      "> The lamp was out when Mara came home. node:S1",
      env([["node:S1", "Ch. 1"]]),
    );
    expect(html).toMatch(
      /<blockquote>[\s\S]*class="ai-cite"[\s\S]*<\/blockquote>/,
    );
    expect(html).toContain("The lamp was out when Mara came home.");
  });

  it("holds back an id at the very end of an answer still arriving", () => {
    const titles: [string, string][] = [["node:S1", "Opening"]];
    expect(markdown.render("See node:S1", env(titles, false))).not.toContain(
      "ai-cite",
    );
    expect(markdown.render("See node:S1", env(titles, true))).toContain(
      "ai-cite",
    );
    // Only the last text is held back: an id earlier in the answer resolves.
    expect(
      markdown.render("node:S1 first.\n\nStill going", env(titles, false)),
    ).toContain("ai-cite");
  });
});

// ── Inert links in a searched chat ───────────────────────────────────────────
//
// A page the model read can have told it which href to write, and an href
// can carry the writer's prose in its query string. So once a chat
// has searched, no model link renders as a link, whatever Markdown spelled it,
// and its words stay, so the answer still reads. Every row counts anchors
// (zero) and checks the words, because a drop that took the words with it
// would pass an anchor count alone.

type Result = { id: string; url: string; title: string };

const RESULTS: Result[] = [
  { id: "web:1", url: "https://en.wikipedia.org/wiki/Rome", title: "Rome" },
  { id: "web:2", url: "https://www.example.org/two", title: "Two" },
  { id: "web:3", url: "https://en.wikipedia.org/wiki/Fall", title: "Fall" },
];

/** A turn that searched, so its entry comes from the domain, never by hand. */
function searchedTurn(text: string): ChatTurn {
  return {
    id: "w",
    role: "assistant",
    text,
    createdAt: "2026-09-27T00:00:00.000Z",
    outcome: "complete",
    web: [
      {
        callId: "c1",
        engine: { kind: "wikipedia" },
        status: "searched",
        query: "rome",
        results: RESULTS,
      },
    ],
  };
}

function entryOf(text: string): WebCitations {
  const entry = webCitations([searchedTurn(text)]).get("w");
  if (!entry) throw new Error("expected a web entry");
  return entry;
}

function envFor(web: WebCitations): CitationEnv {
  return answerEnv({
    web,
    titles: new Map(),
    final: true,
    citationLabel: (title) => `Open ${title}`,
  });
}

/** The text as a searched chat's answer draws it. */
const inert = (text: string) => markdown.render(text, envFor(entryOf(text)));
const anchors = (html: string) => html.match(/<a[\s>]/g)?.length ?? 0;

describe("inert links", () => {
  it("drops an inline link and keeps its words", () => {
    const html = inert("See [the page](https://x.example/p?q=prose) now.");
    expect(anchors(html)).toBe(0);
    expect(html).toBe("<p>See the page now.</p>\n");
  });

  it("drops full, collapsed and shortcut reference links, and their definition", () => {
    const html = inert(
      [
        "A [full one][r], a [r][] and a [r].",
        "",
        "[r]: https://x.example/ref",
      ].join("\n"),
    );
    expect(anchors(html)).toBe(0);
    expect(html).toBe("<p>A full one, a r and a r.</p>\n");
  });

  it("drops an autolink and keeps its text", () => {
    const html = inert("Read <https://x.example/p>.");
    expect(anchors(html)).toBe(0);
    expect(html).toBe("<p>Read https://x.example/p.</p>\n");
  });

  it("keeps a link's strong and code, without the link", () => {
    const html = inert("[**b** `c`](https://x.example)");
    expect(anchors(html)).toBe(0);
    expect(html).toBe("<p><strong>b</strong> <code>c</code></p>\n");
  });

  it("gives an image wrapped in a link its alt alone", () => {
    const html = inert(
      "[![alt](https://img.example/i.png)](https://l.example)",
    );
    expect(anchors(html)).toBe(0);
    expect(html).toBe("<p>alt</p>\n");
  });

  it("drops a link in a table cell and in a heading", () => {
    // Every `inline` token, not paragraphs alone.
    const html = inert(
      [
        "## A [heading](https://h.example)",
        "",
        "| Where |",
        "|---|",
        "| [a cell](https://c.example) |",
      ].join("\n"),
    );
    expect(anchors(html)).toBe(0);
    expect(html).toContain("<h2>A heading</h2>");
    expect(html).toContain("<td>a cell</td>");
  });

  it("leaves [web:1](https://x) as raw words, never a marker", () => {
    // A model link cannot dress itself as a source, even where `web:1`
    // resolves elsewhere in the same answer.
    const html = inert("Cited web:1, and [web:1](https://x).");
    expect(anchors(html)).toBe(0);
    expect(html).toBe(
      '<p>Cited<sup class="ai-web-mark">1</sup>, and web:1.</p>\n',
    );
  });

  it("drops links in a chat that searched and cites nothing", () => {
    // No project title and no web number to resolve: the pass still runs,
    // because being inert is a fact about the chat, not about this answer.
    const empty: WebCitations = {
      searched: true,
      citable: new Map(),
      cited: [],
    };
    const html = markdown.render("[x](https://x.example)", envFor(empty));
    expect(anchors(html)).toBe(0);
    expect(html).toBe("<p>x</p>\n");
  });

  it("fails closed on a malformed env that says only inertLinks", () => {
    // Read straight off the env, before the citation env's own checks: an
    // env missing its maps must not skip the drop.
    const html = markdown.render("[x](https://x.example)", {
      inertLinks: true,
    });
    expect(anchors(html)).toBe(0);
    expect(html).toBe("<p>x</p>\n");
  });

  it("keeps a link, hardened, in a chat that has not searched", () => {
    const html = markdown.render(
      "[x](https://x.example)",
      envFor(NO_WEB_CITATIONS),
    );
    expect(html).toBe(
      '<p><a href="https://x.example" rel="noopener noreferrer nofollow" target="_blank">x</a></p>\n',
    );
  });
});

describe("the web marker", () => {
  it("is a sup holding its number and nothing else", () => {
    // No href, no data attribute, no role: not a control, so the answer's
    // `[data-cite]` listener never sees it.
    const html = inert("Roma web:1.");
    expect(html).toBe('<p>Roma<sup class="ai-web-mark">1</sup>.</p>\n');
    for (const tag of html.match(/<sup[^>]*>/g) ?? [])
      expect(tag).toBe('<sup class="ai-web-mark">');
  });

  it("draws a group as one sup reading 1,3", () => {
    const html = inert(
      "Uno web:1, poi web:2. Roma cadde nel 1453 (web:1, web:3).",
    );
    expect(html).toContain(
      'Roma cadde nel 1453<sup class="ai-web-mark">1,3</sup>.',
    );
    expect(html).not.toMatch(/href|data-|role=/);
  });

  it("draws no marker for an id in a code span or a link's words (known limit)", () => {
    // Only prose `text` tokens resolve. The source keeps its
    // line under the number the prose citation gave it.
    const text = "Fonte web:2. `web:2` e [web:2](https://x).";
    const html = inert(text);
    expect(html.match(/ai-web-mark/g)).toHaveLength(1);
    expect(html).toContain("<code>web:2</code>");
    expect(html).toContain(" e web:2.");
    expect(entryOf(text).cited.map((one) => [one.id, one.n])).toEqual([
      ["web:2", 1],
    ]);
  });
});

describe("answerEnv", () => {
  it("is a fresh object every call, because a reused one leaks definitions", () => {
    // `markdown-it` writes `env.references` while it parses, so a
    // definition in one answer arms a bare `[r]` in the next through a
    // shared env. This row shows the leak, then that the builder never
    // hands the same object twice.
    const shared = envFor(NO_WEB_CITATIONS);
    markdown.render("First.\n\n[r]: https://leak.example", shared);
    expect(markdown.render("see [r]", shared)).toContain(
      'href="https://leak.example"',
    );
    expect(envFor(NO_WEB_CITATIONS)).not.toBe(envFor(NO_WEB_CITATIONS));
    markdown.render(
      "First.\n\n[r]: https://leak.example",
      envFor(NO_WEB_CITATIONS),
    );
    expect(markdown.render("see [r]", envFor(NO_WEB_CITATIONS))).toBe(
      "<p>see [r]</p>\n",
    );
  });

  it("derives inertLinks from the entry's searched", () => {
    // No caller supplies that boolean on its own.
    const searched = entryOf("Roma web:1.");
    expect(searched.searched).toBe(true);
    expect(envFor(searched).inertLinks).toBe(true);
    expect(envFor(NO_WEB_CITATIONS).inertLinks).toBe(false);
    expect(envFor(searched).webNumbers).toEqual(new Map([["web:1", 1]]));
  });
});

// ── One file configures the shared instance ──────────────────────────────────
//
// Nothing outside `safeMarkdown.ts` configures `markdown`. The chat, the
// Reference reader and summaries all render through the shared instance: a
// plugin, an option or a renderer rule added from another file would change
// what all three trust, unseen by this file's rows. A raw-source scan, the
// `boundaries.test.ts` idiom. It follows the binding, not the word: the
// files that make their own `MarkdownIt` (`project/referenceAnswers.ts`,
// `project/referenceNames.ts`) configure a `parser` of theirs, which is
// neither this instance nor this rule's business.

const SOURCES = import.meta.glob(
  ["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}"],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

const IMPORTS_MARKDOWN =
  /import\s*\{([^}]*)\}\s*from\s*["'][^"']*\/safeMarkdown["']/;

/** The local name a file gives the shared instance, if it imports it. */
function localName(source: string): string | null {
  const names = IMPORTS_MARKDOWN.exec(source)?.[1];
  if (!names) return null;
  const binding = /(?:^|,)\s*markdown(?:\s+as\s+(\w+))?\s*(?:,|$)/.exec(
    names.replace(/\s+/g, " "),
  );
  return binding ? (binding[1] ?? "markdown") : null;
}

function configures(source: string, name: string): boolean {
  const at = `\\b${name}\\s*\\.\\s*`;
  return [
    new RegExp(`${at}(?:use|set|enable|disable)\\s*\\(`),
    new RegExp(`${at}validateLink\\s*=[^=]`),
    new RegExp(`${at}(?:normalizeLink|normalizeLinkText)\\s*=[^=]`),
    new RegExp(`${at}renderer\\s*\\.\\s*rules\\s*\\.`),
    new RegExp(`${at}(?:core|block|inline)\\s*\\.\\s*ruler\\s*\\.`),
    new RegExp(`${at}options\\s*\\.`),
  ].some((pattern) => pattern.test(source));
}

describe("the shared instance", () => {
  it("is configured nowhere but safeMarkdown.ts", () => {
    const importers = Object.entries(SOURCES).flatMap(([path, source]) => {
      const name = localName(source);
      return name ? [[path, source, name] as const] : [];
    });
    // Not vacuous: the three readers that render through it are found.
    expect(importers.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        "/src/editor/assistant/AiTurn.tsx",
        "/src/editor/reference/ReferenceReader.tsx",
        "/src/editor/assistant/turnText.ts",
      ]),
    );
    const offenders = importers
      .filter(([, source, name]) => configures(source, name))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
    // And the one file that does configure it is seen doing so.
    const own = SOURCES["/src/editor/components/safeMarkdown.ts"] ?? "";
    expect(configures(own, "markdown")).toBe(true);
  });

  it("catches each kind of configuration it scans for", () => {
    // The self-check: every pattern bites, under an alias as well, and a
    // plain render or parse is not configuration.
    const importing =
      'import { answerEnv, markdown as md } from "./safeMarkdown";\n';
    expect(localName(importing)).toBe("md");
    for (const line of [
      "md.use(plugin);",
      "md.set({ html: true });",
      "md.enable('linkify');",
      "md.disable(['image']);",
      "md.validateLink = () => true;",
      "md.renderer.rules.image = undefined;",
      "md.core.ruler.push('x', () => undefined);",
      "md.options.html = true;",
    ])
      expect(configures(importing + line, "md")).toBe(true);
    expect(configures(importing + "md.render(text, env);", "md")).toBe(false);
    expect(configures(importing + "md.parse(text, env);", "md")).toBe(false);
  });
});
