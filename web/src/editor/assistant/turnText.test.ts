// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import { indexText, plainOf, titleOf, turnAsText } from "./turnText";
import { answerEnv, markdown } from "../components/safeMarkdown";
import { citableTitles } from "../../ai/domain/citations";
import type {
  ChatRecord,
  ChatTurn,
  WebSearchRecord,
} from "../../ai/domain/types";
import {
  NO_WEB_CITATIONS,
  webCitations,
  type WebCitations,
} from "../../ai/domain/webCitations";
import { CHAT_MAX_BYTES, serializeChat } from "../../ai/adapters/chatCodec";

const t = ((key: string) => key) as unknown as TFunction;
const titles = new Map([["node:S1", "Opening"]]);
const context = { titles, web: NO_WEB_CITATIONS, t, offersMap: true };

function answer(extra: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: "a",
    role: "assistant",
    text: "As node:S1 says.",
    createdAt: "2026-09-25T00:00:00.000Z",
    outcome: "complete",
    tools: [
      { callId: "c", name: "read_source", status: "ok", sourceId: "node:S1" },
    ],
    ...extra,
  };
}

describe("titleOf", () => {
  it("reads a listed source by its title and a gone one as gone, never its id", () => {
    expect(titleOf("node:S1", titles, t)).toBe("Opening");
    expect(titleOf("node:S9", titles, t)).toBe("dock.sourceGone");
  });
});

describe("turnAsText", () => {
  it("reads an answer's citations as the titles a person reads", () => {
    expect(turnAsText(answer(), context)).toBe("As Opening says.");
  });

  it("has nothing for a question, an empty answer, or a /where answer", () => {
    expect(turnAsText(answer({ role: "user" }), context)).toBeNull();
    expect(turnAsText(answer({ text: "  " }), context)).toBeNull();
    // Its text is the history line; the writer reads its rows.
    expect(
      turnAsText(
        answer({
          text: "node:S1 · The lamp goes out.",
          located: {
            matches: [{ sourceId: "node:S1", quote: "The lamp goes out." }],
            coverage: {
              intended: 1,
              inspected: 1,
              skipped: [],
              complete: true,
            },
          },
        }),
        context,
      ),
    ).toBeNull();
  });

  it("copies a review answer's findings, not only its count line", () => {
    // A review answer's text is one line ("Completed the … review with n
    // findings."); what the writer reads is the findings under it, so the
    // copy carries them, not a count and nothing it counted.
    const copied = turnAsText(
      answer({
        text: "Completed the continuity review with 1 finding.",
        tools: [],
        findings: [
          {
            id: "f1",
            severity: "major",
            title: "The gate changes colour",
            explanation: "Green in the opening, red two pages on.",
            evidence: [{ sourceId: "node:S1", quote: "the green gate" }],
            status: "open",
          },
        ],
        review: {
          runId: "r1",
          task: "continuity",
          scope: { kind: "structure" },
        },
      }),
      context,
    );
    expect(copied).toContain("The gate changes colour");
    expect(copied).toContain("Green in the opening, red two pages on.");
    expect(copied).toContain("the green gate");
    expect(copied).toContain("Opening");
    expect(copied).not.toContain("node:");
  });
});

// ── Fixtures for the plain shape and the index ───────────────────────────────
//
// The web entries are never written by hand: each comes from
// `webCitations` over a turn that carries a real `searched` record, because
// the entry's numbering and its `searched` latch are the domain's to decide,
// and a hand-made one could agree with a copy that the domain would not.

afterEach(() => {
  vi.restoreAllMocks();
});

const STAMP = "2026-09-25T00:00:00.000Z";

type Result = { id: string; url: string; title: string };

const ROME: Result = {
  id: "web:1",
  url: "https://en.wikipedia.org/wiki/Rome",
  title: "Rome",
};
const TWO: Result = {
  id: "web:2",
  url: "https://www.example.org/two",
  title: "Two",
};
const FALL: Result = {
  id: "web:3",
  url: "https://en.wikipedia.org/wiki/Fall_of_Constantinople",
  title: "Fall of Constantinople",
};

function searchedRecord(
  results: readonly Result[],
  callId = "c1",
): WebSearchRecord {
  return {
    callId,
    engine: { kind: "wikipedia" },
    status: "searched",
    query: "rome",
    results: [...results],
  };
}

/** An answer in a chat that searched: its own record holds `results`. */
function searchedAnswer(
  text: string,
  results: readonly Result[] = [ROME, TWO, FALL],
): ChatTurn {
  return {
    id: "w",
    role: "assistant",
    text,
    createdAt: STAMP,
    outcome: "complete",
    web: [searchedRecord(results)],
  };
}

function entryOf(turn: ChatTurn): WebCitations {
  const entry = webCitations([turn]).get(turn.id);
  if (!entry) throw new Error("expected a web entry");
  return entry;
}

const NO_TITLES: ReadonlyMap<string, string> = new Map();

/** The copy's body, parsed as `turnText` parses it: the renderer's own env. */
function plain(
  text: string,
  web: WebCitations = NO_WEB_CITATIONS,
  known: ReadonlyMap<string, string> = NO_TITLES,
): string {
  return plainOf(
    text,
    answerEnv({
      web,
      titles: known,
      final: true,
      citationLabel: (title) => title,
    }),
  );
}

/** The same body in a chat that searched, where every model link is inert. */
function inertPlain(text: string): string {
  return plain(text, entryOf(searchedAnswer(text)));
}

/** What the screen draws for the same text and the same entry. */
function screenOf(text: string, web: WebCitations = NO_WEB_CITATIONS) {
  return markdown.render(
    text,
    answerEnv({
      web,
      titles: NO_TITLES,
      final: true,
      citationLabel: (title) => title,
    }),
  );
}

// ── Copy: the plain shape ────────────────────────────────────────────────────
//
// Byte-exact, every one: the copy is one writer over the renderer's tokens,
// and each row names the token type it pins. Red under a regex flattener
// (it cannot tell a list marker from a hyphen), a token type the writer
// forgot, or a second scan of the text.

describe("plainOf: blocks", () => {
  it("parts two paragraphs by one blank line, with no trailing whitespace", () => {
    expect(plain("First one.\n\nSecond one.")).toBe(
      "First one.\n\nSecond one.",
    );
  });

  it("gives a heading as its own paragraph, without its #", () => {
    expect(plain("# Title\n\nBody.\n\n### Deeper")).toBe(
      "Title\n\nBody.\n\nDeeper",
    );
  });

  it("drops emphasis, strong, strike and backticks, keeping their words", () => {
    expect(plain("*a* **b** ~~c~~ `d`")).toBe("a b c d");
  });

  it("writes a bullet list one item a line", () => {
    expect(plain("- a\n- b")).toBe("- a\n- b");
  });

  it("counts an ordered list from its start, as the screen numbers it", () => {
    expect(plain("3. a\n4. b")).toBe("3. a\n4. b");
    expect(screenOf("3. a\n4. b")).toContain('<ol start="3">');
  });

  it("indents a nested list two spaces per level", () => {
    expect(plain("- a\n  - b\n    - c\n- d")).toBe("- a\n  - b\n    - c\n- d");
  });

  it("gives a tight and a loose list the same one line per item", () => {
    expect(plain("- a\n- b")).toBe("- a\n- b");
    expect(plain("- a\n\n- b")).toBe("- a\n- b");
  });

  it("keeps a quote's marker on every line, blank ones included", () => {
    expect(plain("> a\n>\n> b")).toBe("> a\n>\n> b");
  });

  it("keeps one marker per quote level", () => {
    expect(plain("> > deep")).toBe("> > deep");
  });

  it("marks every line of a list inside a quote", () => {
    expect(plain("> - a\n> - b")).toBe("> - a\n> - b");
  });

  it("gives a fenced block's content verbatim, without fences, blank lines kept", () => {
    expect(
      plain("Before.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter."),
    ).toBe("Before.\n\nconst a = 1;\n\nconst b = 2;\n\nAfter.");
  });

  it("gives an indented block the same", () => {
    expect(
      plain("Before.\n\n    const a = 1;\n\n    const b = 2;\n\nAfter."),
    ).toBe("Before.\n\nconst a = 1;\n\nconst b = 2;\n\nAfter.");
  });

  it("writes a table one row a line, cells parted by tabs, no pipes and no delimiter row", () => {
    expect(
      plain("| Year | Event |\n|---|---|\n| 1204 | Sack |\n| 1453 | Fall |"),
    ).toBe("Year\tEvent\n1204\tSack\n1453\tFall");
  });

  it("keeps a hard break as a newline and a soft one as a space", () => {
    expect(plain("a  \nb")).toBe("a\nb");
    expect(plain("a\nb")).toBe("a b");
  });

  it("gives a rule nothing", () => {
    expect(plain("---")).toBe("");
    expect(plain("a\n\n---\n\nb")).toBe("a\n\nb");
  });

  it("gives an image its alt, in a live turn and in an inert one", () => {
    // As the screen shows it (`renderer.rules.image`): a url on the
    // clipboard is an image the next Markdown paste target fetches.
    expect(plain("![alt](https://i.example/p.png)")).toBe("alt");
    expect(inertPlain("![alt](https://i.example/p.png)")).toBe("alt");
  });

  it("reads entities and escapes as the screen does", () => {
    expect(plain("a &amp; b")).toBe("a & b");
    expect(plain("\\*not em\\*")).toBe("*not em*");
  });
});

describe("plainOf: links", () => {
  it("copies a live link as its words and its href", () => {
    // In a chat that has not searched the writer can reach that url on
    // screen, so the copy says where the click goes. Red under words only.
    expect(plain("[words](https://a.example/p?q=1)")).toBe(
      "words (https://a.example/p?q=1)",
    );
  });

  it("copies the href the screen's anchor carries, never the source spelling", () => {
    // markdown-it normalises a destination before the anchor gets it; the
    // copy reads the token's `href`, so the two cannot disagree. Red under
    // re-reading the source text, which would copy `café` raw. A non-ASCII
    // path is the spelling that tells the two apart.
    const source = "[words](https://a.example/café?q=é)";
    const href = /href="([^"]*)"/.exec(screenOf(source))?.[1];
    expect(href).toBe("https://a.example/caf%C3%A9?q=%C3%A9");
    expect(plain(source)).toBe(`words (${href})`);
  });

  it("copies an autolink once, never url (url), in a live turn and an inert one", () => {
    // Its words are the url.
    expect(plain("<https://a.example>")).toBe("https://a.example");
    expect(inertPlain("<https://a.example>")).toBe("https://a.example");
  });

  it("copies a link validateLink refused as the characters the screen shows", () => {
    // Not a link token at all, so there is no href to write: the screen
    // prints the literal text, and the copy is proven equal to it.
    const source = "[click](javascript:alert(1))";
    expect(screenOf(source)).toBe(`<p>${source}</p>\n`);
    expect(plain(source)).toBe(source);
  });

  it("copies a live reference link as words and href, and its definition as nothing", () => {
    expect(plain("[x][1]\n\n[1]: https://a.example")).toBe(
      "x (https://a.example)",
    );
  });

  it("keeps the accepted residual: literal image syntax in code copies literally", () => {
    // An accepted residual: `plainOf` writes literally what the
    // screen shows literally, so a code span holding image syntax reaches the
    // clipboard as that syntax, and a Markdown paste target can fetch it. The
    // url is on screen, the paste is the writer's gesture; closing it would
    // need a second definition of Markdown, and the copy keeps one. Pinned so
    // a change to it is a decision.
    expect(inertPlain("`![](https://e.x/?q=b)`")).toBe("![](https://e.x/?q=b)");
  });

  it("parses each call with a fresh env, so no definition carries over", () => {
    // Through `answerEnv`: markdown-it writes `env.references` as it
    // parses, and a reused env would arm `[r]` in the next answer.
    expect(plain("[r]: https://leak.example")).toBe("");
    expect(plain("see [r]")).toBe("see [r]");
  });
});

describe("plainOf: citations and web groups", () => {
  it("reads a web group as its numbers, through the core rule (M1)", () => {
    // web:1 and web:2 are cited first, so web:3 is the third: the group
    // reads "1,3", and the space before it goes, as on screen.
    const text = "Uno web:1, poi web:2. Roma cadde nel 1453 (web:1, web:3).";
    expect(inertPlain(text)).toBe("Uno[1], poi[2]. Roma cadde nel 1453[1,3].");
  });

  it("keeps the comma after an unwrapped group", () => {
    expect(inertPlain("fonte web:1, che")).toBe("fonte[1], che");
  });

  it("leaves an unresolved web id raw", () => {
    expect(inertPlain("Vedi web:9.")).toBe("Vedi web:9.");
  });

  it("keeps an id in a code span or a link's text raw, while its line is listed (known limit)", () => {
    // The core rule resolves prose `text` tokens only, so the screen draws
    // no marker in code or in a link's words, and the copy matches it. The
    // source is still listed under the number the prose citation gave it.
    // Red under a re-scan of the copy's text.
    const turn = searchedAnswer(
      "Fonte web:2. In code `web:2` e [web:2](https://x).",
    );
    const web = entryOf(turn);
    const html = screenOf(turn.text, web);
    expect(html.match(/ai-web-mark/g)).toHaveLength(1);
    expect(html).toContain("<code>web:2</code>");
    expect(turnAsText(turn, { ...context, titles: NO_TITLES, web })).toBe(
      "Fonte[1]. In code web:2 e web:2.\n\n[1] Two · https://www.example.org/two",
    );
  });

  it("prints a token type it does not know as the text it carries", () => {
    // The default branch: a new inline kind loses no words on the
    // clipboard before anyone teaches it. Red under a throw, or silence.
    const tokens = markdown.parse("placeholder", {});
    const child = tokens[1]?.children?.[0];
    if (!child) throw new Error("expected an inline child");
    child.type = "future_kind";
    child.content = "carried words";
    vi.spyOn(markdown, "parse").mockReturnValueOnce(tokens);
    expect(plain("anything")).toBe("carried words");
  });
});

// ── The index: what chat search finds ────────────────────────────────────────
//
// `indexText` is the module-level, `t`-free builder `DocumentTree` hands the
// assistant. It is the copy's body plus `[n] Title · host` lines, so a model
// url in a chat that searched is never findable, and one in a chat that did
// not is found exactly as the screen shows it.

function indexed(turn: ChatTurn, web = entryOf(turn)): string {
  return indexText(turn, { titles: NO_TITLES, web });
}

describe("indexText", () => {
  it("holds no https:// for an inert turn's link, reference link and image", () => {
    const turn = searchedAnswer(
      [
        "See [a page](https://evil.example/?q=secret), [a ref][r] and ![img](https://img.example/p.png) (web:1).",
        "",
        "[r]: https://ref.example/x",
      ].join("\n"),
    );
    const text = indexed(turn);
    expect(text).not.toContain("https://");
    expect(text).toBe(
      "See a page, a ref and img[1].\n[1] Rome · en.wikipedia.org",
    );
  });

  it("indexes an autolink's visible text, in both kinds of turn", () => {
    // Its url is its words, and those are on screen.
    const live = answer({ text: "Read <https://a.example/p>.", tools: [] });
    expect(indexed(live, NO_WEB_CITATIONS)).toBe("Read https://a.example/p.");
    expect(indexed(searchedAnswer("Read <https://a.example/p>."))).toBe(
      "Read https://a.example/p.",
    );
  });

  it("indexes a live turn's model link as words (href), today's reach", () => {
    const live = answer({
      text: "Read [this](https://a.example/p).",
      tools: [],
    });
    expect(indexed(live, NO_WEB_CITATIONS)).toBe(
      "Read this (https://a.example/p).",
    );
  });

  it("lines sources as [n] Title · host, and an untitled one as [n] host, whole", () => {
    // Never cut: the index is searched, not read at a glance, and a cut host
    // would make a site unfindable by its name.
    const long = {
      id: "web:1",
      url: "https://aaaaaaaaaaaaaaaaaaaa.bbbb.evil.example/p",
      title: "",
    };
    const turn = searchedAnswer("A web:1 and B web:2.", [long, TWO]);
    expect(indexed(turn)).toBe(
      "A[1] and B[2].\n[1] aaaaaaaaaaaaaaaaaaaa.bbbb.evil.example\n[2] Two · example.org",
    );
  });

  it("leaves an unresolved web:9 raw", () => {
    expect(indexed(searchedAnswer("Vedi web:9."))).toBe("Vedi web:9.");
  });

  it("shares one body with the copy", () => {
    // Two thin projections of one body. Strip each one's source lines and
    // what is left is the same text. Red under two producers.
    const turn = searchedAnswer(
      [
        "## Heading",
        "",
        "Fell in 1453 (web:1, web:3), and [held](https://m.example/x) web:2.",
        "",
        "- one",
        "  - two",
        "",
        "> quoted",
        "",
        "| A | B |",
        "|---|---|",
        "| 1 | 2 |",
      ].join("\n"),
    );
    const web = entryOf(turn);
    const lines = web.cited.length;
    expect(lines).toBe(3);
    const copy = turnAsText(turn, { ...context, titles: NO_TITLES, web }) ?? "";
    const index = indexed(turn, web);
    const body = (text: string) =>
      text.split("\n").slice(0, -lines).join("\n").trimEnd();
    expect(body(index)).toBe(body(copy));
    expect(body(index)).toContain("- one\n  - two\n\n> quoted\n\nA\tB\n1\t2");
  });

  it("parses each assistant turn once per call, and never a user turn", () => {
    // One `markdown.parse` per assistant turn per index build. A timing
    // assertion would be a flake; a count is not.
    // The loop is `searchDocuments`' own shape — one walk per chat, one
    // builder call per assistant turn.
    const chats = [
      chat("a", [
        question("q1"),
        { ...searchedAnswer("One web:1."), id: "a1" },
        question("q2"),
        { ...searchedAnswer("Two web:2."), id: "a2" },
      ]),
      chat("b", [question("q3"), answer({ id: "b1" })]),
    ];
    const parse = vi.spyOn(markdown, "parse");
    const texts = indexChats(chats);
    expect(texts).toEqual([
      "One[1].\n[1] Rome · en.wikipedia.org",
      "Two[1].\n[1] Two · example.org",
      "As Opening says.",
    ]);
    expect(parse).toHaveBeenCalledTimes(3);
  });
});

// ── The index keeps each answer's text ───────────────────────────────────────
//
// `indexText` keeps a turn's text in a `WeakMap`, because the chat
// search rebuilds its documents on every keystroke of the query and each
// answer is a Markdown parse. A hit must be exactly the text a fresh build
// would give:
// same turn object, same web entry object, titles equal by value. These rows
// hold each half of that key, and the count that says a hit is a hit.

describe("indexText's cache", () => {
  const OPENING = new Map([["node:S1", "Opening"]]);

  // Red under a cache that is never hit (one parse again), and under one
  // keyed on the titles map's identity (the search makes a new map a call).
  it("a hit parses nothing", () => {
    const turn = searchedAnswer("Rome web:1, as node:S1 says.");
    const web = entryOf(turn);
    const first = indexText(turn, { titles: new Map(OPENING), web });
    expect(first).toBe(
      "Rome[1], as Opening says.\n[1] Rome · en.wikipedia.org",
    );
    const parse = vi.spyOn(markdown, "parse");
    expect(indexText(turn, { titles: new Map(OPENING), web })).toBe(first);
    expect(parse).not.toHaveBeenCalled();
  });

  // A source renamed between two keystrokes is the one the next reads:
  // same turn, same entry, a title changed under the same id.
  // Red under a cache that ignores the titles.
  it("a renamed title is never served stale", () => {
    const turn = searchedAnswer("As node:S1 says.");
    const web = entryOf(turn);
    expect(indexText(turn, { titles: OPENING, web })).toBe("As Opening says.");
    const renamed = new Map([["node:S1", "The Threshold"]]);
    expect(indexText(turn, { titles: renamed, web })).toBe(
      "As The Threshold says.",
    );
    // A title the answer may cite that was not listed before misses too.
    const more = new Map([...renamed, ["node:S2", "Second"]]);
    const parse = vi.spyOn(markdown, "parse");
    indexText(turn, { titles: more, web });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  // The turn is the very object it was, but what it cites is not: an
  // earlier answer's url moved, so its entry is a new object with the new
  // host (`webCitations`' `previous` keeps an entry only while it is equal).
  // Red under a cache that ignores the entry.
  it("a new entry object is a miss", () => {
    const first = { ...searchedAnswer("Rome web:1.", [ROME]), id: "a1" };
    const follow = answer({ id: "a2", text: "As web:1 said.", tools: [] });
    const before = webCitations([
      question("q1"),
      first,
      question("q2"),
      follow,
    ]);
    const was = before.get("a2") ?? NO_WEB_CITATIONS;
    expect(indexText(follow, { titles: NO_TITLES, web: was })).toBe(
      "As[1] said.\n[1] Rome · en.wikipedia.org",
    );
    const moved = {
      ...first,
      web: [searchedRecord([{ ...ROME, url: "https://moved.example/Rome" }])],
    };
    const after = webCitations(
      [question("q1"), moved, question("q2"), follow],
      undefined,
      before,
    );
    const now = after.get("a2") ?? NO_WEB_CITATIONS;
    expect(now).not.toBe(was);
    expect(indexText(follow, { titles: NO_TITLES, web: now })).toBe(
      "As[1] said.\n[1] Rome · moved.example",
    );
  });

  // An edited answer is a new turn object (the app never edits one in
  // place), so its text is read again even with the same entry and titles.
  it("a new turn object is a miss", () => {
    const turn = answer();
    const web = NO_WEB_CITATIONS;
    expect(indexText(turn, { titles: OPENING, web })).toBe("As Opening says.");
    const edited = { ...turn, text: "As node:S1 said, once." };
    expect(indexText(edited, { titles: OPENING, web })).toBe(
      "As Opening said, once.",
    );
  });
});

function question(id: string): ChatTurn {
  return {
    id,
    role: "user",
    text: "Tell me about the walls.",
    createdAt: STAMP,
    outcome: "complete",
  };
}

function chat(id: string, turns: ChatTurn[]): ChatRecord {
  return {
    schemaVersion: 1,
    id,
    title: `Chat ${id}`,
    kind: "general",
    createdAt: STAMP,
    updatedAt: STAMP,
    preferences: {
      personaId: "persona-fixture",
      model: { providerId: "ollama", modelId: "llama" },
      pinnedSourceIds: [],
    },
    turns,
  } as ChatRecord;
}

const CATALOGUE: ReadonlyMap<string, string> = new Map([
  ["node:S1", "Opening"],
]);

/** One index build, as `searchDocuments(indexText)` runs it. */
function indexChats(chats: readonly ChatRecord[]): string[] {
  const texts: string[] = [];
  for (const one of chats) {
    const web = webCitations(one.turns);
    for (const turn of one.turns)
      if (turn.role === "assistant")
        texts.push(
          indexText(turn, {
            titles: citableTitles(turn, CATALOGUE),
            web: web.get(turn.id) ?? NO_WEB_CITATIONS,
          }),
        );
  }
  return texts;
}

/**
 * The same build as the app runs it: each chat's last walk handed back as
 * `previous`, as `searchDocuments` does with its `searchWalks`, so an
 * unchanged answer keeps its entry object and the cache can hit.
 */
function indexChatsWarm(
  chats: readonly ChatRecord[],
  walks: Map<string, Map<string, WebCitations>>,
): string[] {
  const texts: string[] = [];
  for (const one of chats) {
    const web = webCitations(one.turns, undefined, walks.get(one.id));
    walks.set(one.id, web);
    for (const turn of one.turns)
      if (turn.role === "assistant")
        texts.push(
          indexText(turn, {
            titles: citableTitles(turn, CATALOGUE),
            web: web.get(turn.id) ?? NO_WEB_CITATIONS,
          }),
        );
  }
  return texts;
}

// ── The index over the largest chat the codec admits ─────────────────────────
//
// Measured, never asserted: this row's duration, read from the verbose
// reporter as the median of five runs, is the cost the builder's `WeakMap`
// exists to spare. The row itself asserts the count and that nothing
// came back empty. The fixture is built once, outside the row, so the row's
// time is one index build and nothing else.

/**
 * An answer from a realistic mix: every block kind, two model links, three
 * web groups.
 */
function richAnswer(n: number, base: number): ChatTurn {
  const ids = [base, base + 1, base + 2].map((one) => `web:${one}`);
  const text = [
    `## The walls, part ${n}`,
    "",
    `Constantinople fell in 1453 (${ids[0]}, ${ids[1]}), and the walls [had held](https://model.example/walls?part=${n}) for a thousand years ${ids[2]}.`,
    "",
    "- the Theodosian walls",
    "- the chain across the Golden Horn",
    "  - its towers on either shore",
    "",
    "```",
    "1453-05-29 dawn",
    "```",
    "",
    "| Year | Event |",
    "|---|---|",
    "| 1204 | Sack |",
    "| 1453 | Fall |",
    "",
    `See also [the siege](https://model.example/siege) and what node:S1 says (${ids[1]}; ${ids[2]}).`,
  ].join("\n");
  return {
    id: `answer-${n}`,
    role: "assistant",
    text,
    createdAt: STAMP,
    outcome: "complete",
    tools: [
      {
        callId: `r${n}`,
        name: "read_source",
        status: "ok",
        sourceId: "node:S1",
      },
    ],
    web: [
      searchedRecord(
        ids.map((id, index) => ({
          id,
          url: `https://en.wikipedia.org/wiki/Walls_${base + index}`,
          title: `Walls of Constantinople, entry ${base + index}`,
        })),
        `s${n}`,
      ),
    ],
  };
}

function wallsChat(id: string, pairs: number): ChatRecord {
  const turns: ChatTurn[] = [];
  for (let n = 0; n < pairs; n += 1)
    turns.push(
      {
        ...question(`${id}-q${n}`),
        text: `Tell me about the walls, part ${n}.`,
      },
      richAnswer(n, n * 3 + 1),
    );
  return chat(id, turns);
}

describe("the index at the codec's bound", () => {
  const fixture = { chats: [] as ChatRecord[], answers: 0, bytes: 0 };
  const bytesOf = (one: ChatRecord) =>
    new TextEncoder().encode(serializeChat(one)).byteLength;

  beforeAll(() => {
    // One chat just under `CHAT_MAX_BYTES`, the bound read from the codec
    // and never quoted. A pair's bytes grow with its ids, so the first
    // estimate overshoots; it steps back until the file fits.
    const empty = bytesOf(wallsChat("big", 0));
    const pair = bytesOf(wallsChat("big", 1)) - empty;
    let pairs = Math.floor((CHAT_MAX_BYTES - empty) / pair);
    let big = wallsChat("big", pairs);
    fixture.bytes = bytesOf(big);
    while (fixture.bytes > CHAT_MAX_BYTES) {
      pairs -= Math.ceil((fixture.bytes - CHAT_MAX_BYTES) / pair);
      big = wallsChat("big", pairs);
      fixture.bytes = bytesOf(big);
    }
    // And fifty ordinary chats of forty turns.
    const others = Array.from({ length: 50 }, (_, index) =>
      wallsChat(`chat-${index}`, 20),
    );
    fixture.chats = [big, ...others];
    fixture.answers = pairs + 50 * 20;
  }, 120_000);

  it("indexes the largest chat the codec admits", () => {
    expect(fixture.bytes).toBeLessThanOrEqual(CHAT_MAX_BYTES);
    expect(fixture.bytes).toBeGreaterThan(CHAT_MAX_BYTES * 0.99);
    const texts = indexChats(fixture.chats);
    expect(texts).toHaveLength(fixture.answers);
    expect(texts.every((text) => text.length > 0)).toBe(true);
  }, 120_000);

  // The count behind the cache: a second keystroke over the same chats,
  // walked as the app walks them, parses nothing at all. Red under a cache
  // that misses, and under a walk that drops `previous`.
  it("parses nothing on a warm second build", () => {
    const walks = new Map<string, Map<string, WebCitations>>();
    const cold = indexChatsWarm(fixture.chats, walks);
    const parse = vi.spyOn(markdown, "parse");
    const warm = indexChatsWarm(fixture.chats, walks);
    expect(parse).not.toHaveBeenCalled();
    expect(warm).toEqual(cold);
    expect(warm).toHaveLength(fixture.answers);
  }, 120_000);
});

describe("turnAsText: a /verify answer", () => {
  const RECORD: WebSearchRecord = {
    callId: "c1",
    engine: { kind: "provider", providerId: "openrouter" },
    status: "searched",
    query: "q",
    results: [
      { id: "web:1", url: "https://example.org/a", title: "A" },
      { id: "web:2", url: "https://example.org/b", title: "B" },
    ],
  };
  const verify = (extra: Partial<ChatTurn> = {}) =>
    answer({
      tools: undefined,
      text: "B says otherwise web:2.",
      verifies: true,
      verified: {
        verdict: "doubtful",
        sources: [
          { id: "web:1", stance: "context" },
          { id: "web:2", stance: "contradicts", quote: "not in 1887" },
        ],
        fix: "Say 1889.",
      },
      web: [RECORD],
      ...extra,
    });
  const quoted = ((key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${String(values.text)})` : key) as unknown as TFunction;
  const copy = (turn: ChatTurn) =>
    turnAsText(turn, {
      titles,
      web: webCitations([turn]).get(turn.id) ?? NO_WEB_CITATIONS,
      t: quoted,
      offersMap: true,
    });

  it("writes the verdict, the reasoning, the rows with their quotes, then the fix", () => {
    // No Wikipedia hint: the search went to the wider web.
    expect(copy(verify())).toBe(
      [
        "dock.verify.verdict.doubtful",
        "B says otherwise[1].",
        "[1] B · https://example.org/b\n    dock.verify.quoted(not in 1887)\n[2] A · https://example.org/a",
        "dock.verify.fix\nSay 1889.",
      ].join("\n\n"),
    );
  });

  it("is an unjudged check's own line, never the model's", () => {
    expect(
      copy(
        verify({
          text: "Claim not checked: no search came back.",
          verified: { unjudged: "unchecked" },
        }),
      ),
    ).toBe("dock.verify.unjudged.unchecked");
  });

  it("is nothing for a check that never settled", () => {
    // Its text is empty while written ahead; an interrupted check with any
    // text at all still has no verdict to copy.
    expect(copy(verify({ verified: undefined, outcome: "interrupted" }))).toBe(
      null,
    );
    expect(
      copy(verify({ verified: undefined, text: "", outcome: "failed" })),
    ).toBe(null);
  });
});

describe("turnAsText: a /verify verdict that rests on no source", () => {
  it("writes the verdict and the reasoning, and no empty rows block", () => {
    const turn = answer({
      tools: undefined,
      text: "Nothing shown settles it.",
      verifies: true,
      verified: { verdict: "inconclusive", sources: [] },
      web: [
        {
          callId: "c1",
          engine: { kind: "provider", providerId: "openrouter" },
          status: "searched",
          query: "q",
          results: [{ id: "web:1", url: "https://example.org/a", title: "A" }],
        },
      ],
    });
    expect(
      turnAsText(turn, {
        titles,
        web: webCitations([turn]).get(turn.id) ?? NO_WEB_CITATIONS,
        t,
        offersMap: true,
      }),
    ).toBe("dock.verify.verdict.inconclusive\n\nNothing shown settles it.");
  });
});

// "Web:1" at a sentence's start copies as the source it names, as its
// lowercase twin does, never as the raw id.
describe("a capitalised web id in the copy", () => {
  it("copies as its lowercase twin does", () => {
    const upper = "Web:1 places the fall in 1453.";
    const lower = "web:1 places the fall in 1453.";
    const copied = plain(upper, entryOf(searchedAnswer(upper)));
    expect(copied).toBe(plain(lower, entryOf(searchedAnswer(lower))));
    expect(copied).not.toContain("Web:1");
  });
});
