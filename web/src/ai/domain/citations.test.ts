// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  citableTitles,
  citationSegments,
  citationsAsText,
  namedByTitle,
  strippedOfWebIds,
  withoutWebIds,
} from "./citations";
import { webCitations } from "./webCitations";
import type { ChatTurn, ContextUse } from "./types";

const titles = new Map([
  ["node:S1", "Capitolo 1"],
  ["node:S12", "Capitolo 12"],
  ["reference:character--Maren Voss.md", "Maren Voss"],
]);

describe("citations in an answer", () => {
  it("reads a known id as its title", () => {
    expect(citationSegments("From node:S1, the tofu.", titles)).toEqual([
      { kind: "text", text: "From " },
      { kind: "cite", id: "node:S1", title: "Capitolo 1" },
      { kind: "text", text: ", the tofu." },
    ]);
  });

  it("keeps a sentence's full stop, and never reads a longer id as a shorter one", () => {
    expect(citationsAsText("See node:S12. And node:S1.", titles)).toBe(
      "See Capitolo 12. And Capitolo 1.",
    );
  });

  it("resolves an id with spaces and dots in it", () => {
    expect(
      citationsAsText("As reference:character--Maren Voss.md says.", titles),
    ).toBe("As Maren Voss says.");
  });

  it("leaves an id nobody listed exactly as the model wrote it", () => {
    expect(citationsAsText("See node:S99 and node:S1x.", titles)).toBe(
      "See node:S99 and node:S1x.",
    );
  });

  it("does not read the tail of a longer word as an id", () => {
    expect(citationsAsText("xnode:S1 here", titles)).toBe("xnode:S1 here");
  });

  it("resolves nothing when the turn can cite nothing", () => {
    expect(citationSegments("node:S1", new Map())).toEqual([
      { kind: "text", text: "node:S1" },
    ]);
  });

  it("does not resolve an id at the very end of a still-streaming answer", () => {
    // Every prefix of "…node:S12." as it arrives: the title shown is never
    // one the finished text would not show.
    const full = "Read node:S12.";
    for (let end = 1; end <= full.length; end += 1) {
      const cites = citationSegments(full.slice(0, end), titles, false)
        .filter((segment) => segment.kind === "cite")
        .map((segment) => (segment.kind === "cite" ? segment.id : ""));
      expect(cites.every((id) => id === "node:S12")).toBe(true);
    }
    expect(citationsAsText(full, titles)).toBe("Read Capitolo 12.");
  });

  it("does not try an id past its bounded length", () => {
    const long = `node:${"a".repeat(400)}`;
    const map = new Map([[long, "Too long"]]);
    expect(citationsAsText(long, map)).toBe(long);
  });
});

// Models wrap the ids they are told to write bare, and a wrapper such as
// GPT's `【…】` would reach the writer around every title.
describe("project ids inside brackets", () => {
  it("draws a bracket of resolved ids as the titles in parentheses", () => {
    expect(citationsAsText("The end [node:S1].", titles)).toBe(
      "The end (Capitolo 1).",
    );
    expect(
      citationsAsText(
        "Both (node:S1; reference:character--Maren Voss.md).",
        titles,
      ),
    ).toBe("Both (Capitolo 1, Maren Voss).");
    expect(citationSegments("See 【node:S12】.", titles)).toEqual([
      { kind: "text", text: "See " },
      { kind: "text", text: "(" },
      { kind: "cite", id: "node:S12", title: "Capitolo 12" },
      { kind: "text", text: ")" },
      { kind: "text", text: "." },
    ]);
  });

  it("reads a run of brackets with only space between them as one group", () => {
    expect(
      citationsAsText(
        "Rapid.【node:S1】【node:S12】 【node:S1】 Then.",
        titles,
      ),
    ).toBe("Rapid.(Capitolo 1, Capitolo 12, Capitolo 1) Then.");
  });

  it("keeps a bracket holding anything else exactly as written", () => {
    expect(citationsAsText("As [see node:S1] says.", titles)).toBe(
      "As [see Capitolo 1] says.",
    );
    // A fabricated id keeps its brackets, and so stays visible.
    expect(citationsAsText("As 【node:S1】【node:S99】 says.", titles)).toBe(
      "As (Capitolo 1)【node:S99】 says.",
    );
    expect(citationsAsText("An aside (in brackets).", titles)).toBe(
      "An aside (in brackets).",
    );
  });

  it("leaves a bracket still open as text", () => {
    expect(citationsAsText("See [node:S1", titles)).toBe("See [Capitolo 1");
  });
});

describe("what a turn may cite", () => {
  const use = (id: string): ContextUse =>
    ({
      id,
      kind: "manuscript",
      title: "captured",
      path: "",
      authority: "canonical",
      reason: "tool",
      coverage: "full-text",
      characters: 0,
    }) as unknown as ContextUse;

  it("is what it used and still exists, titled from the live catalogue", () => {
    const turn: ChatTurn = {
      id: "t",
      role: "assistant",
      text: "",
      createdAt: "2026-09-24T10:00:00.000Z",
      outcome: "complete",
      sources: [use("node:S1"), use("node:GONE")],
      tools: [
        {
          callId: "c",
          name: "read_source",
          status: "ok",
          sourceId: "node:S12",
        },
      ],
    };
    expect(citableTitles(turn, titles)).toEqual(
      new Map([
        ["node:S1", "Capitolo 1"],
        ["node:S12", "Capitolo 12"],
      ]),
    );
  });

  it("includes every source a search drew its excerpts from", () => {
    const turn: ChatTurn = {
      id: "t",
      role: "assistant",
      text: "",
      createdAt: "2026-09-24T10:00:00.000Z",
      outcome: "complete",
      tools: [
        {
          callId: "c",
          name: "grep_sources",
          status: "ok",
          sourceIds: ["node:S1", "node:GONE"],
        },
      ],
    };
    expect(citableTitles(turn, titles)).toEqual(
      new Map([["node:S1", "Capitolo 1"]]),
    );
  });
});

// ── Web ids, grouped ─────────────────────────────────────────────────────────
//
// Adjacent resolved web ids read as one marker on the word before them.
// Each row asserts the segments and, through the walk, the ids
// `cited` takes from the same text, so "absorption never changes `cited`" is
// checked on every row, not in one of its own. The fixture resolves web:1
// and web:3; web:9 is unknown.

const WEB = new Set(["web:1", "web:3"]);

const webSegments = (text: string, final = true) =>
  citationSegments(text, titles, final, WEB);

/** The ids the walk cites from `text`, with web:1 and web:3 in scope. */
function citedFrom(text: string): string[] {
  const results = ["web:1", "web:3"].map((id) => ({
    id,
    url: `https://example.org/${id.slice(4)}`,
    title: id,
  }));
  const turn: ChatTurn = {
    id: "a",
    role: "assistant",
    text,
    createdAt: "2026-09-27T00:00:00.000Z",
    outcome: "complete",
    web: [
      {
        callId: "c",
        engine: { kind: "wikipedia" },
        status: "searched",
        query: "q",
        results,
      },
    ],
  };
  return (webCitations([turn]).get("a")?.cited ?? []).map((one) => one.id);
}

describe("web ids in an answer (M1)", () => {
  it("reads adjacent resolved ids as one group, whatever separates them", () => {
    for (const between of [", ", "; ", " "]) {
      const text = `Rome web:1${between}web:3.`;
      expect(webSegments(text)).toEqual([
        { kind: "text", text: "Rome" },
        { kind: "web", ids: ["web:1", "web:3"], text: ` web:1${between}web:3` },
        { kind: "text", text: "." },
      ]);
      expect(citedFrom(text)).toEqual(["web:1", "web:3"]);
    }
  });

  // A model starting a sentence writes "Web:1", which must not show raw.
  // The prefix is read in any case and the id is canonical; it
  // still resolves only among the turn's own results, so "Web:9" stays words.
  it("reads a capitalised id as the result it names, and nothing else", () => {
    expect(webSegments("Web:1 places it in Rome.")).toEqual([
      { kind: "web", ids: ["web:1"], text: "Web:1" },
      { kind: "text", text: " places it in Rome." },
    ]);
    expect(citedFrom("Web:1 places it in Rome (WEB:3).")).toEqual([
      "web:1",
      "web:3",
    ]);
    expect(webSegments("Web:9 says otherwise.")).toEqual([
      { kind: "text", text: "Web:9 says otherwise." },
    ]);
    // Still arriving: "(Web:1, We" is held whole, as its lowercase twin is.
    expect(webSegments("Rome (Web:1, We", false)).toEqual([
      { kind: "text", text: "Rome (Web:1, We" },
    ]);
  });

  it("absorbs one wrapper and the whitespace before it", () => {
    expect(webSegments("Rome (web:1, web:3).")).toEqual([
      { kind: "text", text: "Rome" },
      { kind: "web", ids: ["web:1", "web:3"], text: " (web:1, web:3)" },
      { kind: "text", text: "." },
    ]);
    expect(citedFrom("Rome (web:1, web:3).")).toEqual(["web:1", "web:3"]);
    expect(webSegments("Rome [web:1].")).toEqual([
      { kind: "text", text: "Rome" },
      { kind: "web", ids: ["web:1"], text: " [web:1]" },
      { kind: "text", text: "." },
    ]);
    expect(citedFrom("Rome [web:1].")).toEqual(["web:1"]);
    // Two wrappers: the inner one goes, the outer stays as written.
    expect(webSegments("Rome ([web:1]).")).toEqual([
      { kind: "text", text: "Rome (" },
      { kind: "web", ids: ["web:1"], text: "[web:1]" },
      { kind: "text", text: ")." },
    ]);
    expect(citedFrom("Rome ([web:1]).")).toEqual(["web:1"]);
  });

  it("keeps a wrapper holding anything but ids, and still resolves the id", () => {
    expect(webSegments("Rome (see web:1).")).toEqual([
      { kind: "text", text: "Rome (see" },
      { kind: "web", ids: ["web:1"], text: " web:1" },
      { kind: "text", text: ")." },
    ]);
    expect(citedFrom("Rome (see web:1).")).toEqual(["web:1"]);
  });

  // A fabrication stays visible: an unknown id breaks the group, and is
  // left as the model wrote it between the two markers.
  it("breaks a group at an unresolved id, which stays as written", () => {
    expect(webSegments("A web:1, web:9, web:3.")).toEqual([
      { kind: "text", text: "A" },
      { kind: "web", ids: ["web:1"], text: " web:1" },
      { kind: "text", text: ", web:9," },
      { kind: "web", ids: ["web:3"], text: " web:3" },
      { kind: "text", text: "." },
    ]);
    expect(citedFrom("A web:1, web:9, web:3.")).toEqual(["web:1", "web:3"]);
    // Inside a wrapper too: the wrapper is not absorbed around an unknown id.
    expect(webSegments("Rome (web:1, web:9).")).toEqual([
      { kind: "text", text: "Rome (" },
      { kind: "web", ids: ["web:1"], text: "web:1" },
      { kind: "text", text: ", web:9)." },
    ]);
    expect(citedFrom("Rome (web:1, web:9).")).toEqual(["web:1"]);
  });

  it("leaves the comma after an unwrapped group to the sentence", () => {
    expect(webSegments("fonte web:1, che")).toEqual([
      { kind: "text", text: "fonte" },
      { kind: "web", ids: ["web:1"], text: " web:1" },
      { kind: "text", text: ", che" },
    ]);
    expect(citedFrom("fonte web:1, che")).toEqual(["web:1"]);
  });

  // While streaming, a wrapper open at the end is held whole, so a marker
  // never draws as "(¹" and then loses its bracket. Settled, it is a bracket.
  it("holds an unclosed wrapper at the tail while streaming, and not once settled", () => {
    expect(webSegments("Roma (web:1", false)).toEqual([
      { kind: "text", text: "Roma (web:1" },
    ]);
    for (const open of ["Roma (web:1, we", "Roma (web:1, "])
      expect(webSegments(open, false)).toEqual([{ kind: "text", text: open }]);
    expect(webSegments("Roma web:1", false)).toEqual([
      { kind: "text", text: "Roma web:1" },
    ]);
    expect(webSegments("Roma (web:1")).toEqual([
      { kind: "text", text: "Roma (" },
      { kind: "web", ids: ["web:1"], text: "web:1" },
    ]);
    expect(citedFrom("Roma (web:1")).toEqual(["web:1"]);
  });

  // "Resolved ids only": a project id is not a web id, so it resolves as a
  // project citation, the wrapper stays, and web:1 is a bare group of its
  // own.
  it("breaks a group at a project id, and keeps the wrapper", () => {
    expect(webSegments("See (node:S1, web:1).")).toEqual([
      { kind: "text", text: "See (" },
      { kind: "cite", id: "node:S1", title: "Capitolo 1" },
      { kind: "text", text: "," },
      { kind: "web", ids: ["web:1"], text: " web:1" },
      { kind: "text", text: ")." },
    ]);
    expect(citedFrom("See (node:S1, web:1).")).toEqual(["web:1"]);
  });

  // `CONTINUES` holds for web ids as for project ids: an id run into a word
  // on either side is no id, and `web:12` is never read as `web:1`.
  it("reads no id inside a longer id or word", () => {
    for (const text of ["web:1web:3", "xweb:1", "-web:1", "web:12"]) {
      expect(webSegments(text)).toEqual([{ kind: "text", text }]);
      expect(citedFrom(text)).toEqual([]);
    }
  });
});

// ── Transcripts leaving the chat ─────────────────────────────────────────────
//
// A transcript leaving the chat carries no id. The citation scan resolves,
// so it is strict: under-matching leaves words. The scrub removes, so it is
// loose: a compaction model normalises `Web: 4` into a live `web:4`, and
// over-matching costs only a word.

const ANY_WEB_ID = /web\s*:\s*\d/i;

describe("withoutWebIds", () => {
  it("leaves no id a model could read back, in any spelling", () => {
    for (const text of ["web:1", "web:12", "Web: 4", "WEB : 7", "cobweb: 12"])
      expect(withoutWebIds(`See ${text} here.`)).not.toMatch(ANY_WEB_ID);
    expect(withoutWebIds("see web:1 and Web: 4")).toBe(
      "see web source and web source",
    );
  });

  it("reads the cited form as (web source), never doubled", () => {
    expect(withoutWebIds("Rome fell (web:4).")).toBe("Rome fell (web source).");
  });

  it("holds no digit, and changes nothing the second time", () => {
    const once = withoutWebIds("web:1, Web: 22 and web : 333");
    expect(once).not.toMatch(/\d/);
    expect(withoutWebIds(once)).toBe(once);
  });
});

// A `/verify` fix: the one part of a verdict
// that must read as unsourced, so its ids go and nothing names a source in
// their place.
describe("strippedOfWebIds", () => {
  it("takes the ids out with a bracket that held only them, and closes up", () => {
    expect(strippedOfWebIds("Finished in 1889 (web:7).")).toBe(
      "Finished in 1889.",
    );
    expect(strippedOfWebIds("In 1889 [web:1, Web: 2; web :3], not 1887.")).toBe(
      "In 1889, not 1887.",
    );
    expect(strippedOfWebIds("As web:8 says, 1889.")).toBe("As says, 1889.");
    // A bracket that holds words keeps them.
    expect(strippedOfWebIds("In 1889 (per web:1).")).toBe("In 1889 (per).");
  });

  it("leaves no id in any spelling, and never the words web source", () => {
    for (const text of ["web:1", "web:12", "Web: 4", "WEB : 7", "cobweb: 12"]) {
      const out = strippedOfWebIds(`See ${text} here.`);
      expect(out).not.toMatch(ANY_WEB_ID);
      expect(out).not.toMatch(/web source/i);
    }
  });

  // Removing an id can join its neighbours into a new one.
  it("repeats until none is left, when a removal rejoins a new id", () => {
    for (const text of ["web:(web:1)3", "web: web:1 2", "wweb:1eb:web:2 3"])
      expect(strippedOfWebIds(text)).not.toMatch(ANY_WEB_ID);
    expect(strippedOfWebIds("web:(web:1)3")).toBe("");
  });

  it("changes nothing the second time, and nothing that holds no id", () => {
    const once = strippedOfWebIds("In 1889 (web:1), as Web: 2 says.");
    expect(strippedOfWebIds(once)).toBe(once);
    expect(strippedOfWebIds("Finished in 1889 (not 1887).")).toBe(
      "Finished in 1889 (not 1887).",
    );
  });
});

describe("a finding's prose, read by titles", () => {
  it("reads every Section id it names as the Section's title", () => {
    const named = new Map([
      ["node:EL4", "Elena Valli"],
      ["node:EL11", "Elena Valli - 3"],
    ]);
    expect(
      namedByTitle("EL4 lo dice di tre anni; node:EL11 di quattro.", named),
    ).toBe("“Elena Valli” lo dice di tre anni; “Elena Valli - 3” di quattro.");
    // An id the catalogue does not hold is left as written, and a word that
    // only contains the letters is not an id.
    expect(namedByTitle("EL99 e HOTEL4", named)).toBe("EL99 e HOTEL4");
  });
});
