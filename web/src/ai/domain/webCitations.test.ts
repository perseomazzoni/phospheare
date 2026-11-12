// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { citationSegments } from "./citations";
import type { ChatTurn, WebSearchRecord } from "./types";
import {
  chatSearched,
  groupLabel,
  lastWebIndexOf,
  NO_WEB_CITATIONS,
  webCitations,
  webNumbers,
  type WebCitations,
  type WebSource,
} from "./webCitations";
import { clipAt, siteOf, WEB_TITLE_CHARACTERS } from "./webText";

// ── One walk, one answer per turn ────────────────────────────────────────────
//
// Every surface that shows a web source reads this walk: the
// markers, the list, the copy, the chat search and the replay line. These
// rows pin what the walk decides (the latch, the scope, the order, the one
// ordinal), so a second reading anywhere else has something to disagree
// with.

const AT = "2026-09-27T00:00:00.000Z";

function ask(id: string): ChatTurn {
  return {
    id,
    role: "user",
    text: "A question",
    createdAt: AT,
    outcome: "complete",
  };
}

function answer(id: string, text: string, web?: WebSearchRecord[]): ChatTurn {
  return {
    id,
    role: "assistant",
    text,
    createdAt: AT,
    outcome: "complete",
    ...(web ? { web } : {}),
  };
}

type Result = { id: string; url: string; title: string };

function searched(...results: Result[]): WebSearchRecord {
  return {
    callId: "call",
    engine: { kind: "wikipedia" },
    status: "searched",
    query: "a query",
    results,
  };
}

const DECLINED: WebSearchRecord = {
  callId: "call",
  engine: { kind: "wikipedia" },
  status: "declined",
};

/** A Wikipedia page, titled as it is keyed. */
const page = (id: string, name: string): Result => ({
  id,
  url: `https://en.wikipedia.org/wiki/${name}`,
  title: name,
});

/** A url `webUrl` keeps and `siteOf` refuses. */
const HOSTLESS = 'http://a"b;c(d).com/';

/** A host longer than DNS allows, which the WHATWG parser does not check. */
const TOO_LONG = `https://${Array.from({ length: 5 }, () => "a".repeat(60)).join(".")}.org/`;

function entryOf(
  entries: ReadonlyMap<string, WebCitations>,
  id: string,
): WebCitations {
  const entry = entries.get(id);
  if (!entry) throw new Error(`no entry for ${id}`);
  return entry;
}

const citedIds = (entries: ReadonlyMap<string, WebCitations>, id: string) =>
  entryOf(entries, id).cited.map((source) => source.id);

describe("webCitations: what each answer may cite", () => {
  it("resolves a turn's own results, as id, url, title and site", () => {
    const entries = webCitations([
      ask("q1"),
      answer("a1", "Rome fell in 1453 (web:2).", [
        searched(page("web:1", "Rome"), page("web:2", "Byzantium")),
      ]),
    ]);
    const entry = entryOf(entries, "a1");
    expect(entry.searched).toBe(true);
    expect(entry.cited).toEqual([
      {
        id: "web:2",
        url: "https://en.wikipedia.org/wiki/Byzantium",
        title: "Byzantium",
        site: "en.wikipedia.org",
        n: 1,
      },
    ]);
    expect([...entry.citable.keys()]).toEqual(["web:1", "web:2"]);
  });

  // The latch is chat-wide from the first search on. A follow-up turn that
  // searched nothing itself still answers after third-party text.
  it("latches a turn after a search that has no web of its own", () => {
    const entries = webCitations([
      ask("q1"),
      answer("a1", "Rome (web:1).", [searched(page("web:1", "Rome"))]),
      ask("q2"),
      answer("a2", "As I said."),
    ]);
    const entry = entryOf(entries, "a2");
    expect(entry).not.toBe(NO_WEB_CITATIONS);
    expect(entry.searched).toBe(true);
  });

  // A search never latches a turn that came before it.
  it("gives a turn before the chat's first search NO_WEB_CITATIONS", () => {
    const entries = webCitations([
      ask("q1"),
      answer("a1", "Before any search (web:1)."),
      ask("q2"),
      answer("a2", "Rome (web:1).", [searched(page("web:1", "Rome"))]),
    ]);
    expect(entryOf(entries, "a1")).toBe(NO_WEB_CITATIONS);
    expect(entryOf(entries, "a2").searched).toBe(true);
  });

  // Only a `searched` record latches or scopes: a declined search reached no
  // engine, and a failed one brought nothing back, even in a hand-edited
  // file that planted results on one.
  it("takes nothing from a failed or declined record", () => {
    const planted = {
      callId: "call",
      engine: { kind: "wikipedia" },
      status: "failed",
      query: "q",
      code: "timeout",
      reached: "yes",
      results: [page("web:5", "Planted")],
    } as unknown as WebSearchRecord;
    const alone = webCitations([answer("a1", "(web:5)", [DECLINED, planted])]);
    expect(entryOf(alone, "a1")).toBe(NO_WEB_CITATIONS);

    const beside = webCitations([
      answer("a1", "(web:5) and (web:1)", [
        planted,
        searched(page("web:1", "Rome")),
      ]),
    ]);
    expect(citedIds(beside, "a1")).toEqual(["web:1"]);
  });

  // An earlier turn's result is citable later only once an earlier turn
  // cited it: a result the model was shown and passed over is not a source
  // the conversation rests on.
  it("lets a later turn cite what an earlier turn cited, and nothing else it held", () => {
    const entries = webCitations([
      ask("q1"),
      answer("a1", "Byzantium (web:2).", [
        searched(
          page("web:1", "Rome"),
          page("web:2", "Byzantium"),
          page("web:3", "Venice"),
        ),
      ]),
      ask("q2"),
      answer("a2", "Again web:2, and web:3."),
    ]);
    expect(citedIds(entries, "a2")).toEqual(["web:2"]);
    expect([...entryOf(entries, "a2").citable.keys()]).toEqual(["web:2"]);
  });

  // A `web:7` a model invented in turn 2 never comes true when turn 5 mints
  // a real `web:7`. Only a resolved cite carries forward.
  it("never resolves an id cited before it was minted, nor lets that cite carry", () => {
    const early = [
      ask("q1"),
      answer("a1", "Rome (web:1).", [searched(page("web:1", "Rome"))]),
      ask("q2"),
      answer("a2", "And web:7 says so."),
    ];
    const minted = (text: string) =>
      webCitations([
        ...early,
        ask("q3"),
        answer("a3", text, [searched(page("web:7", "Venice"))]),
        ask("q4"),
        answer("a4", "As web:7 said."),
      ]);

    const uncited = minted("Nothing cited.");
    expect(citedIds(uncited, "a2")).toEqual([]);
    expect(entryOf(uncited, "a2").citable.has("web:7")).toBe(false);
    // Turn 2's cite never resolved, so it put nothing in scope for turn 6.
    expect(citedIds(uncited, "a4")).toEqual([]);

    // Turn 5 citing its own web:7 is what makes it citable later.
    const cited = minted("Venice (web:7).");
    expect(citedIds(cited, "a2")).toEqual([]);
    expect(entryOf(cited, "a4").cited[0]?.url).toBe(
      "https://en.wikipedia.org/wiki/Venice",
    );
  });

  // The latch is counted on records. A result with no nameable host is no
  // source, but the model still read it, so the turn is still inert.
  it("latches a turn whose one result has no host, and lists nothing", () => {
    for (const url of [HOSTLESS, TOO_LONG]) {
      const entries = webCitations([
        answer("a1", "It says so (web:1).", [
          searched({ id: "web:1", url, title: "Planted" }),
        ]),
        ask("q2"),
        answer("a2", "Still web:1."),
      ]);
      for (const id of ["a1", "a2"]) {
        const entry = entryOf(entries, id);
        expect(entry.searched).toBe(true);
        expect(entry.citable.size).toBe(0);
        expect(entry.cited).toEqual([]);
      }
    }
  });

  // The host is derived from the url every time. A file that stores a
  // `site` (or an excerpt) beside a result cannot get either onto a source.
  it("derives the site from the url, and a source is exactly id, url, title and site", () => {
    const planted = {
      id: "web:1",
      url: "https://evil.example/x",
      title: "Planted",
      site: "en.wikipedia.org",
      excerpt: "an excerpt",
    };
    const entries = webCitations([
      answer("a1", "(web:1) and (web:2)", [
        searched(planted, {
          id: "web:2",
          url: "https://www.example.org/p",
          title: "Example",
        }),
      ]),
    ]);
    const entry = entryOf(entries, "a1");
    expect(entry.cited.map((source) => source.site)).toEqual([
      "evil.example",
      "example.org",
    ]);
    expect(Object.keys(entry.cited[0] ?? {}).sort()).toEqual([
      "id",
      "n",
      "site",
      "title",
      "url",
    ]);
    expect(Object.keys(entry.citable.get("web:1") ?? {}).sort()).toEqual([
      "id",
      "site",
      "title",
      "url",
    ]);
  });

  // The title is clipped once, here, to what the model was shown, so the
  // list, the copy and the replay line all name a result the same way.
  // Astral characters, so a clip in UTF-16 units would split one.
  it("clips a source's title once, here, by code points", () => {
    const title = String.fromCodePoint(0x1d538).repeat(
      WEB_TITLE_CHARACTERS + 10,
    );
    const entries = webCitations([
      answer("a1", "(web:1)", [
        searched({ id: "web:1", url: "https://example.org/", title }),
      ]),
    ]);
    const source = entryOf(entries, "a1").cited[0];
    expect(source?.title).toBe(clipAt(title, WEB_TITLE_CHARACTERS));
    expect(Array.from(source?.title ?? "")).toHaveLength(WEB_TITLE_CHARACTERS);
    expect(entryOf(entries, "a1").citable.get("web:1")?.title).toBe(
      source?.title,
    );
  });

  // `n` is set in one place. `citable` holds bare sources, so an
  // earlier turn's number never rides into a later turn's list.
  it("sets n only on cited, and keeps citable bare", () => {
    const entries = webCitations([
      answer("a1", "Byzantium (web:2).", [
        searched(page("web:1", "Rome"), page("web:2", "Byzantium")),
      ]),
      ask("q2"),
      answer("a2", "Venice (web:5), and Byzantium (web:2).", [
        searched(page("web:5", "Venice")),
      ]),
    ]);
    expect(entryOf(entries, "a1").cited.map((one) => [one.id, one.n])).toEqual([
      ["web:2", 1],
    ]);
    expect(entryOf(entries, "a2").cited.map((one) => [one.id, one.n])).toEqual([
      ["web:5", 1],
      ["web:2", 2],
    ]);
    expect(entryOf(entries, "a2").citable.get("web:2")).not.toHaveProperty("n");
  });

  // The ordinal follows first citation, a repeat takes its first number, and
  // an unresolved id or a project id takes none.
  it("numbers by first citation, once each, counting only what resolved", () => {
    const entries = webCitations([
      answer("a1", "web:4 then web:9 then web:2, web:4 again, node:S1.", [
        searched(page("web:2", "Two"), page("web:4", "Four")),
      ]),
    ]);
    expect(entryOf(entries, "a1").cited.map((one) => [one.id, one.n])).toEqual([
      ["web:4", 1],
      ["web:2", 2],
    ]);
  });

  // Only the turn named `live` may be half an id at its end, and it is
  // named, never inferred. Held back from `cited` as the renderer holds its
  // marker back, so a row never shows for a `web:1` that becomes `web:12` a
  // token later.
  it("holds back the live turn's trailing id, and no other turn's", () => {
    const chat = (text: string) => [
      answer("a1", "Settled web:1", [searched(page("web:1", "One"))]),
      ask("q2"),
      answer("a2", text, [searched(page("web:12", "Twelve"))]),
    ];
    expect(citedIds(webCitations(chat("So web:1"), "a2"), "a2")).toEqual([]);
    expect(citedIds(webCitations(chat("So (web:1"), "a2"), "a2")).toEqual([]);
    // The settled turn ends in an id too, and is not the one streaming.
    expect(citedIds(webCitations(chat("So web:1"), "a2"), "a1")).toEqual([
      "web:1",
    ]);
    // Then `2` arrives, and the finished text cites web:12, not web:1.
    expect(citedIds(webCitations(chat("So web:12")), "a2")).toEqual(["web:12"]);
    expect(citedIds(webCitations(chat("So web:1")), "a2")).toEqual(["web:1"]);
  });

  // markdown-it trims a paragraph's trailing whitespace, so the screen still
  // holds a marker for `web:2\n`; the walk holds its row too.
  // Red under a walk that scans the live text untrimmed.
  it("holds back a live trailing id followed by whitespace, as the screen does", () => {
    const chat = (text: string) => [
      answer("a1", text, [
        searched(page("web:1", "One"), page("web:2", "Two")),
      ]),
    ];
    for (const tail of ["\n", " ", " \n\t"])
      expect(
        citedIds(webCitations(chat(`So web:1, then web:2${tail}`), "a1"), "a1"),
      ).toEqual(["web:1"]);
    // Settled, the same text cites both.
    expect(
      citedIds(webCitations(chat("So web:1, then web:2\n")), "a1"),
    ).toEqual(["web:1", "web:2"]);
  });
});

describe("webCitations reuses an unchanged entry by value", () => {
  // A settled answer must not re-render as another streams, so an equal
  // entry keeps its object. Equal means every field: a chat file edited under
  // the panel with the same ids and a new url must not keep the old url on
  // screen while the replay line names the new site.
  const base = (): ChatTurn[] => [
    ask("q1"),
    answer("a1", "Rome (web:1).", [searched(page("web:1", "Rome"))]),
    ask("q2"),
    answer("a2", "Byzantium (web:2).", [searched(page("web:2", "Byzantium"))]),
  ];

  it("keeps each unchanged turn's object, even from a file read again", () => {
    const turns = [answer("a0", "Before."), ...base()];
    const first = webCitations(turns);
    const again = webCitations(structuredClone(turns), undefined, first);
    for (const id of ["a0", "a1", "a2"])
      expect(entryOf(again, id)).toBe(entryOf(first, id));
  });

  const a2 = (turns: ChatTurn[]) => turns[3] as ChatTurn;
  const a2Record = (turns: ChatTurn[]) =>
    (a2(turns).web?.[0] as Extract<WebSearchRecord, { status: "searched" }>)
      .results;

  it.each([
    [
      "an id is added",
      (turns: ChatTurn[]) => {
        a2(turns).text = "Byzantium (web:2), Rome (web:1).";
      },
      (entry: WebCitations) =>
        expect(entry.cited.map((one) => one.id)).toEqual(["web:2", "web:1"]),
    ],
    [
      "a url changes under the same id",
      (turns: ChatTurn[]) => {
        (a2Record(turns)[0] as Result).url = "https://evil.example/Byzantium";
      },
      (entry: WebCitations) => {
        expect(entry.cited[0]?.url).toBe("https://evil.example/Byzantium");
        expect(entry.cited[0]?.site).toBe("evil.example");
      },
    ],
    [
      "a title changes under the same id",
      (turns: ChatTurn[]) => {
        (a2Record(turns)[0] as Result).title = "Costantinopoli";
      },
      (entry: WebCitations) =>
        expect(entry.cited[0]?.title).toBe("Costantinopoli"),
    ],
    [
      "a result it does not cite changes",
      (turns: ChatTurn[]) => {
        a2Record(turns).push(page("web:3", "Venice"));
      },
      (entry: WebCitations) =>
        expect([...entry.citable.keys()]).toEqual(["web:1", "web:2", "web:3"]),
    ],
  ])("gives a new object when %s", (_, change, reads) => {
    const previous = webCitations(base());
    const turns = base();
    change(turns);
    const next = webCitations(turns, undefined, previous);
    expect(entryOf(next, "a1")).toBe(entryOf(previous, "a1"));
    expect(entryOf(next, "a2")).not.toBe(entryOf(previous, "a2"));
    reads(entryOf(next, "a2"));
  });

  // The flip that matters most: an entry with nothing in it is equal in every
  // list to `NO_WEB_CITATIONS`, and only `searched` tells them apart.
  it("gives a new object when searched flips", () => {
    const previous = webCitations([answer("a1", "A link.", [DECLINED])]);
    expect(entryOf(previous, "a1")).toBe(NO_WEB_CITATIONS);
    const next = webCitations(
      [answer("a1", "A link.", [DECLINED, searched()])],
      undefined,
      previous,
    );
    expect(entryOf(next, "a1")).not.toBe(NO_WEB_CITATIONS);
    expect(entryOf(next, "a1").searched).toBe(true);
  });
});

describe("lastWebIndexOf: ids are never issued twice", () => {
  // A reloaded chat continues its numbering above the highest id any turn
  // holds, gaps included, so a new search never reuses an old id.
  it("is the highest id any turn holds, and 0 before any search", () => {
    expect(lastWebIndexOf([])).toBe(0);
    expect(lastWebIndexOf([ask("q1"), answer("a1", "", [DECLINED])])).toBe(0);
    expect(
      lastWebIndexOf([
        answer("a1", "", [
          searched(page("web:1", "One"), page("web:3", "Three")),
        ]),
        ask("q2"),
        answer("a2", "", [DECLINED, searched(page("web:7", "Seven"))]),
        answer("a3", "", [searched()]),
      ]),
    ).toBe(7);
  });

  // It reads records, not sources: a hostless result is no source, but its id
  // was issued, and issuing it again would give one id two pages.
  it("counts a hostless result's id, so it is never issued again", () => {
    const turns = [
      answer("a1", "(web:3)", [
        searched(page("web:1", "One"), {
          id: "web:3",
          url: HOSTLESS,
          title: "Planted",
        }),
      ]),
    ];
    expect(entryOf(webCitations(turns), "a1").citable.has("web:3")).toBe(false);
    expect(lastWebIndexOf(turns)).toBe(3);
  });
});

describe("webNumbers and groupLabel: the one ordinal, read (Q-F2)", () => {
  const entry = entryOf(
    webCitations([
      answer("a1", "Three (web:3), then one (web:1).", [
        searched(page("web:1", "One"), page("web:3", "Three")),
      ]),
    ]),
    "a1",
  );

  it("maps each cited id to its n, and nothing else", () => {
    expect(webNumbers(entry)).toEqual(
      new Map([
        ["web:3", 1],
        ["web:1", 2],
      ]),
    );
    expect(webNumbers(NO_WEB_CITATIONS).size).toBe(0);
  });

  // One label for the `<sup>` and the copy's `[1,3]`: numbers in the group's
  // own order, an id with no number left out rather than shown as a gap.
  it("labels a group in its own order, skipping an id with no number", () => {
    const numbers = webNumbers(entry);
    expect(groupLabel(["web:3", "web:1"], numbers)).toBe("1,2");
    expect(groupLabel(["web:1", "web:3"], numbers)).toBe("2,1");
    expect(groupLabel(["web:9", "web:1"], numbers)).toBe("2");
    expect(groupLabel([], numbers)).toBe("");
  });
});

// ── The view and the identity skip ───────────────────────────────────────────
//
// `citable` is a view over one insert-only log, and a turn that is the same
// object in an unbroken chain is not read at all. Both are allowed
// only because they answer what a fresh copy per turn answers. These rows
// hold them to that copy, written out below, and pin each fact the view and
// the skip rest on, so the day one of them stops being true, a row says
// which.

/** A search holding `web:N` for each N, every one a nameable page. */
function results(...numbers: number[]): WebSearchRecord {
  return searched(...numbers.map((n) => page(`web:${n}`, `Page_${n}`)));
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

/** What one turn may cite, as a fresh copy per turn. */
interface Copied {
  searched: boolean;
  citable: Map<string, WebSource>;
  cited: string[];
}

/**
 * The reference walk, the naive one: every answer copies what earlier turns
 * cited, then adds its own results that are not in it yet, the first id
 * winning as the codec's `issued` order does. Quadratic, and the definition
 * the view must answer as.
 */
function copyWalk(
  turns: readonly ChatTurn[],
  live?: string,
): Map<string, Copied> {
  const walked = new Map<string, Copied>();
  const earlier = new Map<string, WebSource>();
  let latched = false;
  for (const turn of turns) {
    if (turn.web?.some((record) => record.status === "searched"))
      latched = true;
    if (turn.role !== "assistant") continue;
    if (!latched) {
      walked.set(turn.id, { searched: false, citable: new Map(), cited: [] });
      continue;
    }
    const citable = new Map(earlier);
    for (const record of turn.web ?? [])
      if (record.status === "searched")
        for (const result of record.results) {
          const site = siteOf(result.url);
          if (site === null || earlier.has(result.id)) continue;
          citable.set(result.id, {
            id: result.id,
            url: result.url,
            title: clipAt(result.title, WEB_TITLE_CHARACTERS),
            site,
          });
        }
    const cited: string[] = [];
    for (const segment of citationSegments(
      turn.text,
      new Map(),
      turn.id !== live,
      citable,
    ))
      if (segment.kind === "web")
        for (const id of segment.ids) {
          const source = citable.get(id);
          if (!source || cited.includes(id)) continue;
          cited.push(id);
          if (!earlier.has(id)) earlier.set(id, source);
        }
    walked.set(turn.id, { searched: true, citable, cited });
  }
  return walked;
}

/**
 * Everything a `ReadonlyMap` answers, as plain values: every member, order
 * as arrays, and `forEach`'s third argument and `thisArg` included. `get` and
 * `has` are read before anything iterates, so a view that answers them from
 * the log and a view that answers them from its materialised copy are both
 * held to the same answer.
 */
function readView(
  view: ReadonlyMap<string, WebSource>,
  probes: readonly string[],
) {
  const has = probes.map((id) => view.has(id));
  const get = probes.map((id) => view.get(id));
  const each: unknown[] = [];
  const self = { self: true };
  view.forEach(function (this: unknown, value, key, map) {
    each.push([key, value, map === view, this === self]);
  }, self);
  return {
    has,
    get,
    size: view.size,
    keys: [...view.keys()],
    values: [...view.values()],
    entries: [...view.entries()],
    iterated: [...view],
    each,
  };
}

/** A whole walk as plain values: its key order, then each entry. */
function readWalk(
  entries: ReadonlyMap<string, WebCitations>,
  probes: readonly string[],
) {
  return {
    order: [...entries.keys()],
    entries: [...entries].map(([id, entry]) => ({
      id,
      searched: entry.searched,
      cited: entry.cited,
      citable: readView(entry.citable, probes),
    })),
  };
}

/** The ids a row reads every view at, issued and not. */
const PROBE_IDS = ["web:1", "web:2", "web:3", "web:4", "web:9"];

/** mulberry32: a fixed seed, so a red run is the same run every time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("citable is a view that answers as the copy did", () => {
  const PROBES = [
    "web:1",
    "web:2",
    "web:3",
    "web:4",
    "web:5",
    "web:6",
    "web:9",
  ];

  // The view against the copy through every member, and the negatives the
  // view's count exists for, each spelled out so the reference cannot share
  // a mistake with the view. Red under `firstAt !== undefined` ignoring the
  // count (a1 would hold web:5), under `<=` for `<` (a3 cited nothing, so its
  // count is web:5's position), and under own-wins.
  it("answers every ReadonlyMap member as a fresh copy per turn would", () => {
    const turns = [
      ask("q1"),
      answer("a1", "Rome web:1, a hostless web:3, and web:9 nobody issued.", [
        searched(page("web:1", "Rome"), page("web:2", "Byzantium"), {
          id: "web:3",
          url: HOSTLESS,
          title: "Planted",
        }),
      ]),
      ask("q2"),
      answer("a2", "Again web:1; web:2 was only held; web:3 has no host."),
      ask("q3"),
      answer("a3", "Nothing cited here."),
      ask("q4"),
      answer("a4", "Venice web:5.", [
        searched(page("web:4", "Genoa"), page("web:5", "Venice")),
      ]),
      ask("q5"),
      answer("a5", "Venice again web:5, and Genoa web:4, which a4 held.", [
        searched(page("web:6", "Pisa")),
      ]),
    ];
    const walked = webCitations(turns);
    const copied = copyWalk(turns);
    expect([...walked.keys()]).toEqual([...copied.keys()]);
    for (const [id, expected] of copied) {
      const entry = entryOf(walked, id);
      expect(entry.searched).toBe(expected.searched);
      expect(entry.cited.map((one) => one.id)).toEqual(expected.cited);
      expect(readView(entry.citable, PROBES)).toEqual(
        readView(expected.citable, PROBES),
      );
    }

    const citable = (id: string) => entryOf(walked, id).citable;
    // Held by an earlier turn, never cited by one.
    expect(citable("a2").has("web:2")).toBe(false);
    expect(citable("a5").has("web:4")).toBe(false);
    // Cited only by a later turn.
    expect(citable("a1").has("web:5")).toBe(false);
    expect(citable("a3").has("web:5")).toBe(false);
    expect(citable("a3").get("web:5")).toBeUndefined();
    // A result with no nameable host, and an id nobody issued.
    for (const id of ["a1", "a2", "a3", "a4", "a5"]) {
      expect(citable(id).has("web:3")).toBe(false);
      expect(citable(id).has("web:9")).toBe(false);
    }
    expect([...citable("a3").keys()]).toEqual(["web:1"]);
    expect([...citable("a5").keys()]).toEqual(["web:1", "web:5", "web:6"]);
  });

  // The log is shared by every view of one walk and appended as the walk
  // goes, so a view is only right if it never sees past its own count, and a
  // reused entry holds a view into its own walk's log, which the next walk
  // must never touch. A planted duplicate id resolves first-wins. Red under
  // own-wins, under the count ignored, and under a log shared between walks.
  it("never changes a view after its walk, and resolves a planted duplicate first-wins", () => {
    const ROME = "https://en.wikipedia.org/wiki/Rome";
    const turns = [
      ask("q1"),
      answer("a1", "Rome web:1.", [searched(page("web:1", "Rome"))]),
      ask("q2"),
      answer("a2", "Rome web:1, and Venice web:2.", [
        searched(
          { id: "web:1", url: "https://evil.example/Rome", title: "Planted" },
          page("web:2", "Venice"),
        ),
      ]),
    ];
    const first = webCitations(turns);
    // One view read now, and one left unread until after the next walk, so
    // a lazily built copy is held to the same answer as an eager one.
    const read = entryOf(first, "a1").citable;
    const before = readView(read, PROBES);
    const lazy = webCitations(turns);
    const unread = entryOf(lazy, "a1").citable;

    const a2 = entryOf(first, "a2");
    expect(a2.citable.get("web:1")?.url).toBe(ROME);
    expect(a2.cited.map((one) => [one.id, one.url])).toEqual([
      ["web:1", ROME],
      ["web:2", "https://en.wikipedia.org/wiki/Venice"],
    ]);

    const more = [
      ...turns,
      ask("q3"),
      answer("a3", "Venice web:2, Pisa web:3.", [
        searched(page("web:3", "Pisa")),
      ]),
    ];
    for (const previous of [first, lazy]) {
      const next = webCitations(more, undefined, previous);
      expect(entryOf(next, "a1")).toBe(entryOf(previous, "a1"));
      expect(citedIds(next, "a3")).toEqual(["web:2", "web:3"]);
    }
    expect(readView(read, PROBES)).toEqual(before);
    for (const view of [read, unread]) {
      expect([...view.keys()]).toEqual(["web:1"]);
      expect(view.size).toBe(1);
      expect(view.has("web:2")).toBe(false);
      expect(view.has("web:3")).toBe(false);
      expect(view.get("web:1")?.url).toBe(ROME);
    }
  });

  // A count, never a timing: a copy that sets every earlier citation again
  // for every answer is quadratic. The walk's Map writes stay within one
  // fixed multiple of turns + results + citations at N and at 4N. Red under
  // a view that materialises per turn.
  it("writes its Maps in a count linear in turns, results and citations", () => {
    const chatOf = (count: number) => {
      const turns: ChatTurn[] = [];
      for (let n = 1; n <= count; n += 1) {
        const own = 2 * n - 1;
        turns.push(
          ask(`q${n}`),
          answer(
            `a${n}`,
            n === 1
              ? `First web:${own}.`
              : `Own web:${own}, earlier web:${own - 2}.`,
            [results(own, own + 1)],
          ),
        );
      }
      return turns;
    };
    const N = 400;
    for (const count of [N, 4 * N]) {
      const turns = chatOf(count);
      const size = turns.length + 2 * count + (2 * count - 1);
      const set = vi.spyOn(Map.prototype, "set");
      let writes: number;
      try {
        webCitations(turns);
        writes = set.mock.calls.length;
      } finally {
        set.mockRestore();
      }
      expect(writes).toBeLessThanOrEqual(2 * size);
    }
  });
});

describe("webCitations reuses by identity, and only in an unbroken chain", () => {
  // A seeded sequence of every edit the app makes to a chat, none of them in
  // place, as the app never makes one; after each, the walk that reuses must
  // equal the walk that does not, by value, key order and every view member
  // included. `previous` decides identity, never value.
  //
  // 150 steps, each walked twice over a growing chat: CPU-bound and
  // deterministic, so its time is its work, and under coverage with the
  // whole suite sharing the CPU it outlasts vitest's default 5 s.
  // The bound is sized to the work, never a retry.
  const WALK_TIMEOUT_MS = 30_000;
  it(
    "a seeded walk with previous equals one without, after every edit",
    () => {
      const random = seeded(413);
      const pick = <T>(items: readonly T[]): T =>
        must(items[Math.floor(random() * items.length)]);
      let turns: ChatTurn[] = [ask("q0"), answer("a0", "Before any search.")];
      let live: string | undefined;
      let previous: Map<string, WebCitations> | undefined;
      let minted = 0;
      let pairs = 0;
      const mint = () => [(minted += 1), (minted += 1)];
      // Sometimes an id nobody has issued yet, which must stay unresolved.
      const cite = () => `web:${1 + Math.floor(random() * (minted + 2))}`;
      const answers = () => turns.filter((turn) => turn.role === "assistant");
      const middle = () => {
        const earlier = answers().slice(0, -1);
        return earlier.length > 0 ? pick(earlier) : undefined;
      };
      const replace = (turn: ChatTurn) => {
        turns = turns.map((one) => (one.id === turn.id ? turn : one));
      };

      const operations: Record<string, () => boolean> = {
        append: () => {
          pairs += 1;
          const id = `a${pairs}`;
          const ids = mint();
          turns = [
            ...turns,
            ask(`q${pairs}`),
            answer(
              id,
              `Pair ${pairs}: ${cite()} and ${cite()}`,
              random() < 0.7 ? [results(...ids)] : undefined,
            ),
          ];
          live = id;
          return true;
        },
        stream: () => {
          const turn = turns.find((one) => one.id === live);
          if (!turn) return false;
          const token = pick([
            " web:",
            String(1 + Math.floor(random() * Math.max(minted, 1))),
            ", ",
            " (web:2",
            ").",
          ]);
          replace({ ...turn, text: turn.text + token });
          return true;
        },
        settle: () => {
          if (live === undefined) return false;
          live = undefined;
          return true;
        },
        edit: () => {
          const turn = middle();
          if (!turn) return false;
          const record = turn.web?.find((one) => one.status === "searched");
          if (random() < 0.5 || !record || record.status !== "searched")
            replace({ ...turn, text: `${turn.text} ${cite()}` });
          else
            replace({
              ...turn,
              web: (turn.web ?? []).map((one) =>
                one === record
                  ? {
                      ...record,
                      results: record.results.map((result, index) =>
                        index === 0
                          ? {
                              ...result,
                              url: `https://edited.example/${pairs}`,
                            }
                          : result,
                      ),
                    }
                  : one,
              ),
            });
          return true;
        },
        remove: () => {
          const turn = middle();
          if (!turn) return false;
          const at = turns.indexOf(turn);
          const before = turns[at - 1];
          turns = turns.filter(
            (one) =>
              one !== turn && !(before?.role === "user" && one === before),
          );
          if (live === turn.id) live = undefined;
          return true;
        },
        search: () => {
          const turn = middle();
          if (!turn) return false;
          replace({ ...turn, web: [...(turn.web ?? []), results(...mint())] });
          return true;
        },
      };

      const ran = new Map<string, number>();
      let kept = 0;
      let rebuilt = 0;
      const names = Object.keys(operations);
      for (let step = 0; step < 150; step += 1) {
        // Appends are drawn more often, so the chat grows as it is edited.
        const name = random() < 0.25 ? "append" : pick(names);
        if (!must(operations[name])()) continue;
        ran.set(name, (ran.get(name) ?? 0) + 1);
        const probes = Array.from(
          { length: minted + 2 },
          (_, n) => `web:${n + 1}`,
        );
        const reused = webCitations(turns, live, previous);
        const fresh = webCitations(turns, live);
        expect(readWalk(reused, probes)).toEqual(readWalk(fresh, probes));
        for (const [id, entry] of reused) {
          if (previous?.get(id) !== entry) {
            rebuilt += 1;
            continue;
          }
          kept += 1;
          const other = must(fresh.get(id));
          expect(entry.cited).toEqual(other.cited);
          expect(readView(entry.citable, probes)).toEqual(
            readView(other.citable, probes),
          );
        }
        previous = reused;
      }
      // The sequence exercised what it names: every edit, and both outcomes.
      for (const name of names)
        expect(ran.get(name) ?? 0).toBeGreaterThanOrEqual(10);
      expect(kept).toBeGreaterThan(100);
      expect(rebuilt).toBeGreaterThan(100);
    },
    WALK_TIMEOUT_MS,
  );

  // The skip keeps the entry without reading the turn, so the log must still
  // learn what the turn cited: a later turn resolves an id that only a
  // skipped turn cited. Red under a skip that does not append.
  it("a skipped turn is the kept object, and its cited enters the log", () => {
    const turns = [
      ask("q1"),
      answer("a1", "Rome web:1.", [searched(page("web:1", "Rome"))]),
      ask("q2"),
      answer("a2", "Nothing cited."),
    ];
    const first = webCitations(turns);
    const next = webCitations(
      [...turns, ask("q3"), answer("a3", "As web:1 said.")],
      undefined,
      first,
    );
    expect(entryOf(next, "a1")).toBe(entryOf(first, "a1"));
    expect(entryOf(next, "a2")).toBe(entryOf(first, "a2"));
    expect(citedIds(next, "a3")).toEqual(["web:1"]);
    expect(entryOf(next, "a3").cited[0]?.url).toBe(
      "https://en.wikipedia.org/wiki/Rome",
    );
  });

  // Same object is not enough: a turn after a changed one may cite what the
  // changed one cites, so the chain breaks there. Turn 3 is the same object
  // it was and cites nothing, and still gets a new entry holding the new
  // url. Red under a skip that ignores the chain.
  it("the chain breaks at the first changed turn", () => {
    const a1 = answer("a1", "Rome web:1.", [searched(page("web:1", "Rome"))]);
    const a2 = answer("a2", "Nothing here.");
    const a3 = answer("a3", "Nor here.");
    const first = webCitations([ask("q1"), a1, ask("q2"), a2, ask("q3"), a3]);
    const moved = answer("a1", "Rome web:1.", [
      searched({
        id: "web:1",
        url: "https://moved.example/Rome",
        title: "Rome",
      }),
    ]);
    const next = webCitations(
      [ask("q1"), moved, ask("q2"), a2, ask("q3"), a3],
      undefined,
      first,
    );
    for (const id of ["a1", "a2", "a3"])
      expect(entryOf(next, id)).not.toBe(entryOf(first, id));
    expect(entryOf(next, "a3").citable.get("web:1")?.url).toBe(
      "https://moved.example/Rome",
    );
  });

  // The live turn's trailing id is held back. When the same object settles,
  // the id resolves, so liveness is part of what the skip checks.
  // Red under a skip that ignores `live`.
  it("a liveness change is not skipped", () => {
    const turns = [
      ask("q1"),
      answer("a1", "Rome web:1", [searched(page("web:1", "Rome"))]),
    ];
    const streaming = webCitations(turns, "a1");
    expect(citedIds(streaming, "a1")).toEqual([]);
    const settled = webCitations(turns, undefined, streaming);
    expect(entryOf(settled, "a1")).not.toBe(entryOf(streaming, "a1"));
    expect(citedIds(settled, "a1")).toEqual(["web:1"]);
  });

  // A removed turn moves every later turn's place, even when what they may
  // cite is the same (the removed turn cited nothing new): every turn after
  // the gap is walked again and gets a new entry. Red under a chain keyed on
  // identity alone.
  it("no skip across a removed turn", () => {
    const q2 = ask("q2");
    const a2 = answer("a2", "Again web:1.");
    const kept = [
      ask("q1"),
      answer("a1", "Rome web:1.", [searched(page("web:1", "Rome"))]),
      ask("q3"),
      answer("a3", "Still web:1."),
      ask("q4"),
      answer("a4", "Nothing."),
    ];
    const whole = [...kept.slice(0, 2), q2, a2, ...kept.slice(2)];
    const first = webCitations(whole);
    const next = webCitations(kept, undefined, first);
    expect(entryOf(next, "a1")).toBe(entryOf(first, "a1"));
    for (const id of ["a3", "a4"])
      expect(entryOf(next, id)).not.toBe(entryOf(first, id));
    expect(readWalk(next, PROBE_IDS)).toEqual(
      readWalk(webCitations(kept), PROBE_IDS),
    );
  });

  // A change or a removal upstream makes every later entry new, and each one
  // is the fresh value.
  // The change keeps the count (a1 cites one id either way), so only the
  // chain catches it. Red under a skip that ignores the chain.
  it("an earlier turn's change makes every later entry new", () => {
    const a1 = answer("a1", "Rome web:1.", [
      searched(page("web:1", "Rome"), page("web:2", "Byzantium")),
    ]);
    const rest = [
      ask("q2"),
      answer("a2", "As before."),
      ask("q3"),
      answer("a3", "Still."),
    ];
    const first = webCitations([ask("q1"), a1, ...rest]);
    const changed = [ask("q1"), { ...a1, text: "Byzantium web:2." }, ...rest];
    const next = webCitations(changed, undefined, first);
    for (const id of ["a1", "a2", "a3"])
      expect(entryOf(next, id)).not.toBe(entryOf(first, id));
    expect([...entryOf(next, "a2").citable.keys()]).toEqual(["web:2"]);
    expect(readWalk(next, PROBE_IDS)).toEqual(
      readWalk(webCitations(changed), PROBE_IDS),
    );
  });

  // The removed turn cited something new, so what every later turn may cite
  // changed though none of them did. Red under a chain keyed on identity
  // alone (a3 would keep citing the web:3 nobody cites any more).
  it("a removed earlier citing turn makes every later entry new", () => {
    const head = [
      ask("q1"),
      answer("a1", "Rome web:1.", [
        searched(page("web:1", "Rome"), page("web:2", "Byzantium")),
      ]),
    ];
    const tail = [
      ask("q3"),
      answer("a3", "As web:3 said."),
      ask("q4"),
      answer("a4", "Nothing."),
    ];
    const removed = [
      ask("q2"),
      answer("a2", "Venice web:3.", [searched(page("web:3", "Venice"))]),
    ];
    const first = webCitations([...head, ...removed, ...tail]);
    expect(citedIds(first, "a3")).toEqual(["web:3"]);
    const next = webCitations([...head, ...tail], undefined, first);
    expect(entryOf(next, "a1")).toBe(entryOf(first, "a1"));
    for (const id of ["a3", "a4"])
      expect(entryOf(next, id)).not.toBe(entryOf(first, id));
    expect(citedIds(next, "a3")).toEqual([]);
    expect(readWalk(next, PROBE_IDS)).toEqual(
      readWalk(webCitations([...head, ...tail]), PROBE_IDS),
    );
  });
});

// ── Count guards and first-wins ──────────────────────────────────────────────
//
// Three guards, each with a row that is red when the guard is removed.
// Each row compares by value with a walk that has no
// `previous`, which is what the guards exist to keep equal.

describe("the walk's count guards and first-wins iteration", () => {
  const ROME = "https://en.wikipedia.org/wiki/Rome";
  const values = (entry: WebCitations) => ({
    cited: entry.cited.map((one) => [one.id, one.url]),
    citable: [...entry.citable].map(([id, one]) => [id, one.url]),
    size: entry.citable.size,
  });

  // Red with `kept.citable.count === earlier.size` removed from the skip:
  // `a2` is the same object in an unbroken chain, so it would be skipped and
  // keep a row for `web:1`, a result the chat does not hold any more.
  it("does not skip a turn whose earlier citations shrank under it", () => {
    const a1 = answer("a1", "Rome (web:1).", [searched(page("web:1", "Rome"))]);
    const a2 = answer("a2", "Again (web:1), and (web:2).", [
      searched(page("web:2", "Venice")),
    ]);
    const first = webCitations([ask("q1"), a1, ask("q2"), a2]);
    expect(citedIds(first, "a2")).toEqual(["web:1", "web:2"]);

    const turns = [ask("q1"), { ...a1, web: undefined }, ask("q2"), a2];
    const next = webCitations(turns, undefined, first);
    const fresh = webCitations(turns);
    expect(citedIds(fresh, "a2")).toEqual(["web:2"]);
    expect(values(entryOf(next, "a2"))).toEqual(values(entryOf(fresh, "a2")));
  });

  // Red with `kept.citable.count === citable.count` removed from `keep`: a
  // new, equal `a2` cites the same and holds the same results, but may cite
  // fewer earlier ids, and the kept view would still answer for `web:1`.
  it("does not keep an equal entry whose citable scope changed", () => {
    const a1 = answer("a1", "Rome (web:1).", [searched(page("web:1", "Rome"))]);
    const a2 = answer("a2", "Only (web:2).", [
      searched(page("web:2", "Venice")),
    ]);
    const first = webCitations([ask("q1"), a1, ask("q2"), a2]);
    expect(entryOf(first, "a2").citable.has("web:1")).toBe(true);

    const turns = [ask("q1"), { ...a1, web: undefined }, ask("q2"), { ...a2 }];
    const next = webCitations(turns, undefined, first);
    const fresh = webCitations(turns);
    expect(entryOf(next, "a2").citable.has("web:1")).toBe(false);
    expect(values(entryOf(next, "a2"))).toEqual(values(entryOf(fresh, "a2")));
  });

  // Red with `CitableView.map()` letting an own result overwrite an earlier
  // citation: iteration must answer as `get` does, first-wins.
  it("iterates a planted duplicate first-wins, as get answers", () => {
    const entries = webCitations([
      ask("q1"),
      answer("a1", "Rome web:1.", [searched(page("web:1", "Rome"))]),
      ask("q2"),
      answer("a2", "Venice web:2.", [
        searched(
          { id: "web:1", url: "https://evil.example/Rome", title: "Planted" },
          page("web:2", "Venice"),
        ),
      ]),
    ]);
    const view = entryOf(entries, "a2").citable;
    expect(view.get("web:1")?.url).toBe(ROME);
    expect(view.size).toBe(2);
    expect([...view.values()].map((one) => one.url)).toEqual([
      ROME,
      "https://en.wikipedia.org/wiki/Venice",
    ]);
    const seen: string[] = [];
    view.forEach((one, id) => seen.push(`${id} ${one.url}`));
    expect(seen).toEqual([...view].map(([id, one]) => `${id} ${one.url}`));
    expect(seen[0]).toBe(`web:1 ${ROME}`);
  });
});

describe("a /verify verdict's sources", () => {
  const verifying = (
    text: string,
    web: WebSearchRecord[],
    verified: ChatTurn["verified"],
  ): ChatTurn => ({ ...answer("v", text, web), verifies: true, verified });

  it("cites the reasoning's ids first, then the rest of the verdict's, numbered in reading order", () => {
    const turns = [
      ask("q"),
      verifying(
        "It was 1889 (web:3).",
        [searched(page("web:1", "A"), page("web:2", "B"), page("web:3", "C"))],
        {
          verdict: "implausible",
          sources: [
            { id: "web:2", stance: "context" },
            { id: "web:3", stance: "contradicts", quote: "the three words" },
            { id: "web:1", stance: "supports" },
          ],
        },
      ),
    ];
    const cited = webCitations(turns).get("v")?.cited ?? [];
    expect(cited.map((one) => [one.id, one.n])).toEqual([
      ["web:3", 1],
      ["web:2", 2],
      ["web:1", 3],
    ]);
    // The quote never rides in `cited`, by structure.
    expect(Object.keys(cited[0] ?? {}).sort()).toEqual([
      "id",
      "n",
      "site",
      "title",
      "url",
    ]);
  });

  it("appends only the turn's OWN results, never an earlier answer's", () => {
    const turns = [
      ask("q1"),
      answer("a1", "Rome (web:1).", [searched(page("web:1", "Rome"))]),
      ask("q2"),
      verifying("It was 1889 (web:1).", [searched(page("web:2", "Paris"))], {
        verdict: "inconclusive",
        sources: [
          { id: "web:1", stance: "context" },
          { id: "web:2", stance: "context" },
        ],
      }),
    ];
    const cited = webCitations(turns).get("v")?.cited ?? [];
    // web:1 is cited by the text (an earlier result it may name), and the
    // verdict's own web:2 follows; web:1 as a verdict source adds nothing.
    expect(cited.map((one) => one.id)).toEqual(["web:1", "web:2"]);
    const tailOnly = webCitations([
      ...turns.slice(0, 3),
      verifying("No ids here.", [searched(page("web:2", "Paris"))], {
        verdict: "inconclusive",
        sources: [
          { id: "web:1", stance: "context" },
          { id: "web:2", stance: "context" },
        ],
      }),
    ]);
    expect(tailOnly.get("v")?.cited.map((one) => one.id)).toEqual(["web:2"]);
  });

  it("cites nothing from an unjudged or unsettled check", () => {
    for (const verified of [{ unjudged: "unchecked" as const }, undefined])
      expect(
        webCitations([
          ask("q"),
          verifying("No ids.", [searched(page("web:1", "A"))], verified),
        ]).get("v")?.cited,
      ).toEqual([]);
  });

  it("reuses a settled verdict's entry by identity on the next walk", () => {
    const turns = [
      ask("q"),
      verifying(
        "It was 1889 (web:1).",
        [searched(page("web:1", "A"), page("web:2", "B"))],
        {
          verdict: "implausible",
          sources: [{ id: "web:2", stance: "contradicts" }],
        },
      ),
    ];
    const first = webCitations(turns);
    const again = webCitations(turns, undefined, first);
    expect(again.get("v")).toBe(first.get("v"));
  });
});

describe("a chat continued from one that searched", () => {
  it("starts latched: a model link is inert before the chat's own first search", () => {
    const turns = [
      ask("q1"),
      answer("a1", "See [the story](https://x.example/)."),
    ];
    expect(webCitations(turns).get("a1")).toBe(NO_WEB_CITATIONS);
    const latched = webCitations(turns, undefined, undefined, true).get("a1");
    expect(latched?.searched).toBe(true);
    expect(latched?.cited).toEqual([]);
    expect(latched?.citable.size).toBe(0);
  });

  it("is carried by a search in the turns or by the flag, and nothing else", () => {
    const plain = [ask("q1"), answer("a1", "Hi.")];
    expect(chatSearched({ turns: plain })).toBe(false);
    expect(chatSearched({ turns: plain, searchedBefore: true })).toBe(true);
    expect(
      chatSearched({
        turns: [
          answer("a1", "Hi.", [
            { callId: "c", engine: { kind: "wikipedia" }, status: "declined" },
          ]),
        ],
      }),
    ).toBe(false);
    expect(
      chatSearched({
        turns: [
          answer("a1", "Hi.", [
            {
              callId: "c",
              engine: { kind: "wikipedia" },
              status: "searched",
              query: "q",
              results: [],
            },
          ]),
        ],
      }),
    ).toBe(true);
  });
});
