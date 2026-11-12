// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { beforeAll, describe, expect, it } from "vitest";
import i18next, { type TFunction } from "i18next";
import en from "../../locales/en.json";
// Aliased: `it` is vitest's own.
import itLocale from "../../locales/it.json";
import { MAP_ANCHORS_MAX } from "../../ai";
import { MAP_SHAPES } from "../../ai/domain/structureShapes";
import {
  MAP_SHAPE_IDS,
  type MapNode,
  type MapArc,
  type MapFitOnly,
  type MapPassages,
} from "../../ai/domain/types";
import {
  beatLabelKey,
  fitNote,
  isIssue,
  mapAsText,
  mapFollowUp,
  mapGroups,
  mapHeader,
  mapTransit,
  markOf,
  nodeTitle,
  passageHead,
  rowKey,
  sectionLines,
  stageLabelKey,
  TITLE_SLOT,
  type LiveStructure,
} from "./mapAnswer";
import { interpolation } from "../../locales/i18nOptions";

// What a `/map` answer says, pinned against the real translator in both
// languages: a mocked `t` prints keys and cannot tell a missing label
// from a present one, nor pick a plural.

const translators: Record<"en" | "it", TFunction> = {} as never;
beforeAll(async () => {
  for (const [lng, locale] of [
    ["en", en],
    ["it", itLocale],
  ] as const) {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng,
      resources: { [lng]: { translation: locale } },
      interpolation,
    });
    translators[lng] = i18n.t.bind(i18n) as TFunction;
  }
});
const t = () => translators.en;

function node(over: Partial<MapNode> & { sourceId: string }): MapNode {
  return { kind: "part", title: over.sourceId.slice(5), ...over };
}

/** A positional Three Acts map of the whole Structure. */
function threeActs(): MapArc {
  return {
    kind: "arc",
    mode: "positional",
    shapeFrom: "declared",
    shape: "threeact",
    scope: { kind: "structure" },
    structureRevision: "rev",
    nodes: [
      node({
        sourceId: "node:P1",
        title: "Beginnings",
        standsIn: "setup",
        verdict: "partly",
        reason: "It opens late.",
        anchor: { sourceId: "node:S1", quote: "The lamp goes out." },
      }),
      node({
        sourceId: "node:S1",
        kind: "section",
        parentId: "node:P1",
        title: "Lamp",
        standsIn: "setup",
      }),
      node({
        sourceId: "node:P2",
        title: "Middles",
        standsIn: "confrontation",
        verdict: "fits",
        reason: "It presses.",
      }),
      node({
        sourceId: "node:P3",
        title: "Ends",
        standsIn: "resolution",
        verdict: "fits",
        outOfOrder: true,
        reason: "It comes early.",
      }),
      node({ sourceId: "node:P4", title: "Coda", standsIn: "resolution" }),
    ],
    coverage: {
      intended: 4,
      inspected: 3,
      skipped: [{ sourceId: "node:S4", reason: "unanswered" }],
      complete: false,
    },
  };
}

const LIVE: LiveStructure = {
  revision: "rev",
  nodeIds: new Set(["node:P1", "node:S1", "node:P2", "node:P3", "node:P4"]),
};
const TITLES = new Map([
  ["node:P1", "Beginnings"],
  ["node:P2", "Middles"],
  ["node:P3", "Ends"],
  ["node:P4", "Coda"],
]);

describe("the mark a node carries", () => {
  // The closed domain: verdict × a line or none × shape.
  const verdicts = ["fits", "partly", "no", undefined] as const;
  const shapes = ["threeact", "herosjourney", null] as const;
  it.each(
    verdicts.flatMap((verdict) =>
      [true, false].flatMap((said) =>
        shapes.map((shape) => [verdict, said, shape] as const),
      ),
    ),
  )("verdict %s, a line %s, on %s", (verdict, said, shape) => {
    const one = node({
      sourceId: "node:X",
      ...(verdict ? { verdict } : {}),
      ...(said ? { reason: "Why." } : {}),
    });
    const expected =
      shape === null
        ? null // a reading compares nothing
        : verdict === "fits"
          ? "full"
          : verdict === "partly"
            ? "partly"
            : verdict === "no"
              ? "none"
              : // A Hero's Journey Section enacting no stage: the ring.
                shape === "herosjourney" && said
                ? "none"
                : null;
    expect(markOf(one, shape)).toBe(expected);
  });
});

describe("the groups", () => {
  it("puts each placed node in exactly one list, and a fit out of order in Issues", () => {
    const groups = mapGroups(threeActs());
    expect(groups.issues.map((one) => one.sourceId)).toEqual([
      "node:P1",
      "node:P3",
    ]);
    expect(groups.working.map((one) => one.sourceId)).toEqual(["node:P2"]);
    expect(groups.readings).toEqual([]);
    // The Section under a judged Part, and the Part never answered, are in
    // neither list: drawn, never rows.
    expect(groups.units).toBe("part");
    expect(groups.asked).toBe(4);
    expect(isIssue(threeActs().nodes[2], "threeact")).toBe(false);
  });

  it("reads a map with no structure as readings only", () => {
    const reading: MapArc = {
      ...threeActs(),
      shape: null,
      nodes: [
        node({ sourceId: "node:P1", reason: "It opens." }),
        node({ sourceId: "node:P2" }),
      ],
    };
    const groups = mapGroups(reading);
    expect(groups.readings.map((one) => one.sourceId)).toEqual(["node:P1"]);
    expect(groups.issues).toEqual([]);
    expect(groups.working).toEqual([]);
  });

  // A map of one Part judges the Part's children (its own mini-arc), so a
  // Part whose children are Parts counts Parts, and one with both counts both.
  it("judges Sections on a Hero's Journey, and a Part's children on a map of one Part", () => {
    const hero: MapArc = {
      ...threeActs(),
      mode: "hero",
      shape: "herosjourney",
      nodes: [
        node({ sourceId: "node:P1" }),
        node({
          sourceId: "node:S1",
          kind: "section",
          parentId: "node:P1",
          reason: "No stage.",
        }),
      ],
    };
    expect(mapGroups(hero)).toMatchObject({ units: "section", asked: 1 });
    expect(mapGroups(hero).issues.map((one) => one.sourceId)).toEqual([
      "node:S1",
    ]);
    const part = (...children: MapNode[]): MapArc => ({
      ...threeActs(),
      mode: "named",
      scope: { kind: "node", nodeId: "P1" },
      nodes: [node({ sourceId: "node:P1" }), ...children],
    });
    const child = (sourceId: string, kind: MapNode["kind"]) =>
      node({ sourceId, kind, parentId: "node:P1", beat: "setup" });
    expect(
      mapGroups(part(child("node:A", "section"), child("node:B", "section"))),
    ).toMatchObject({ units: "section", asked: 2 });
    expect(
      mapGroups(part(child("node:A", "part"), child("node:B", "part"))).units,
    ).toBe("part");
    expect(
      mapGroups(part(child("node:A", "section"), child("node:B", "part"))),
    ).toMatchObject({ units: "mixed", asked: 2 });
  });
});

describe("the row's key", () => {
  it("numbers a Three Acts Part among the top-level Parts, then its beat", () => {
    const map = threeActs();
    expect(rowKey(map.nodes[0], map, t())).toBe("01 · Setup");
    expect(rowKey(map.nodes[3], map, t())).toBe("03 · Resolution");
  });

  it("names a station shape's beat alone", () => {
    const map: MapArc = {
      ...threeActs(),
      shape: "kishotenketsu",
      nodes: [node({ sourceId: "node:P1", standsIn: "ten", verdict: "no" })],
    };
    expect(rowKey(map.nodes[0], map, t())).toBe("Ten");
  });

  it("numbers a Hero's Journey stage, and gives a Section enacting none no key", () => {
    const map: MapArc = {
      ...threeActs(),
      shape: "herosjourney",
      nodes: [
        node({ sourceId: "node:S1", kind: "section", stage: "tests" }),
        node({ sourceId: "node:S2", kind: "section", reason: "No stage." }),
      ],
    };
    expect(rowKey(map.nodes[0], map, t())).toBe("6 · Tests, allies, enemies");
    expect(rowKey(map.nodes[1], map, t())).toBeNull();
  });

  // A map of one Part names each child's own beat, numbered among the
  // children on Three Acts; the header carries no Part beat, so the row is
  // where it is said.
  it("gives a beatless no and a nested Part no key, and a Part's children theirs", () => {
    const named: MapArc = {
      ...threeActs(),
      shape: "freytagspyramid",
      nodes: [node({ sourceId: "node:P1", verdict: "no" })],
    };
    expect(rowKey(named.nodes[0], named, t())).toBeNull();
    const part: MapArc = {
      ...threeActs(),
      mode: "named",
      scope: { kind: "node", nodeId: "P1" },
      nodes: [
        node({ sourceId: "node:P1" }),
        node({
          sourceId: "node:S1",
          kind: "section",
          parentId: "node:P1",
          beat: "setup",
          verdict: "fits",
        }),
        node({
          sourceId: "node:S2",
          kind: "section",
          parentId: "node:P1",
          beat: "resolution",
          verdict: "partly",
        }),
      ],
    };
    expect(rowKey(part.nodes[1], part, t())).toBe("01 · Setup");
    expect(rowKey(part.nodes[2], part, t())).toBe("02 · Resolution");
    // The Part itself is not one of its own units: no number, no beat.
    expect(rowKey(part.nodes[0], part, t())).toBeNull();
    const reading: MapArc = {
      ...threeActs(),
      shape: null,
      nodes: [
        node({ sourceId: "node:P1", reason: "a" }),
        node({ sourceId: "node:P9", parentId: "node:P1", reason: "b" }),
        node({ sourceId: "node:P2", reason: "c" }),
      ],
    };
    expect(reading.nodes.map((one) => rowKey(one, reading, t()))).toEqual([
      "01",
      null,
      "02",
    ]);
  });
});

describe("a node's title", () => {
  const one = node({ sourceId: "node:P1", title: "Old name" });
  it("keeps the stored title, unmarked, until the Structure is read", () => {
    expect(nodeTitle(one, TITLES, undefined)).toEqual({
      title: "Old name",
      gone: false,
    });
  });
  it("reads the live title while the node is there, and marks it once gone", () => {
    expect(nodeTitle(one, TITLES, LIVE)).toEqual({
      title: "Beginnings",
      gone: false,
    });
    expect(
      nodeTitle(one, TITLES, { revision: "rev", nodeIds: new Set() }),
    ).toEqual({ title: "Old name", gone: true });
  });
});

describe("the follow-up button", () => {
  const unmapped = (): MapArc => ({
    ...threeActs(),
    coverage: {
      intended: 4,
      inspected: 2,
      skipped: [
        { sourceId: "node:S3", reason: "unmapped" },
        { sourceId: "node:S4", reason: "unmapped" },
        { sourceId: "node:S5", reason: "too-large" },
      ],
      complete: false,
    },
  });
  const none = () => [] as readonly string[];
  const one = (ids: readonly string[]) => ids.slice(0, 1);

  it("says nothing until the Structure has been read", () => {
    expect(mapFollowUp(unmapped(), undefined, one)).toBe("pending");
  });

  it("counts the answer's own rows in the note and what a click would write on the button", () => {
    expect(mapFollowUp(unmapped(), LIVE, one)).toEqual({
      kind: "summarise",
      unmapped: 2,
      missing: 1,
    });
  });

  it("is out of date when none is missing any more, and silent with nothing unmapped", () => {
    expect(mapFollowUp(unmapped(), LIVE, none)).toEqual({ kind: "outOfDate" });
    // `too-large` and `unanswered` alone widen nothing a summary can fix.
    expect(mapFollowUp(threeActs(), LIVE, one)).toBeNull();
  });

  it("says the Structure changed on another fingerprint, and never offers the summaries then", () => {
    expect(
      mapFollowUp(unmapped(), { ...LIVE, revision: "other" }, one),
    ).toEqual({
      kind: "changed",
      canMapAgain: true,
    });
  });

  it("says the Structure changed when a node is gone, whatever the fingerprint", () => {
    const nodeIds = new Set(LIVE.nodeIds);
    nodeIds.delete("node:S1");
    expect(mapFollowUp(threeActs(), { revision: "rev", nodeIds }, one)).toEqual(
      {
        kind: "changed",
        canMapAgain: true,
      },
    );
  });

  it("offers no Map again when the Part a map of one Part covers is gone", () => {
    const part: MapArc = {
      ...threeActs(),
      scope: { kind: "node", nodeId: "P1" },
    };
    const nodeIds = new Set(LIVE.nodeIds);
    nodeIds.delete("node:P1");
    expect(mapFollowUp(part, { revision: "rev", nodeIds }, one)).toEqual({
      kind: "changed",
      canMapAgain: false,
    });
  });

  // "From the project" holds only while the stored shape matches the live
  // declaration, and a mismatch counts as stale.
  it("says the Structure changed when the project no longer declares the shape it was mapped on", () => {
    const live: LiveStructure = { ...LIVE, declared: "kishotenketsu" };
    expect(mapFollowUp(threeActs(), live, () => [])).toEqual({
      kind: "changed",
      canMapAgain: true,
    });
    // A typed map stands on the writer's word, never the declaration.
    const typed: MapArc = {
      ...threeActs(),
      mode: "named",
      shapeFrom: "typed",
    };
    expect(mapFollowUp(typed, live, () => [])).toBeNull();
  });
});

describe("the relay line", () => {
  it("says what a map sends, and first what summaries send, before either click", () => {
    const again = mapTransit("again", "OpenRouter", t());
    expect(again).toBe(
      t()("dock.map.remoteTransit", {
        provider: "OpenRouter",
        count: MAP_ANCHORS_MAX,
      }),
    );
    const summarise = mapTransit("summarise", "OpenRouter", t());
    expect(summarise.startsWith("To write the summaries")).toBe(true);
    expect(summarise).toContain("characters");
    expect(summarise.endsWith(again)).toBe(true);
  });
});

describe("the header", () => {
  // Every header says whose shape it is, and a Part's header names no beat:
  // a Part is its own arc, with the beats on its rows.
  it("names the whole manuscript, the shape, and whose shape it is", () => {
    expect(mapHeader(threeActs(), TITLES, LIVE, t())).toEqual({
      text: "Map of the whole manuscript · the project's structure: Three Acts",
    });
    expect(
      mapHeader(
        { ...threeActs(), mode: "named", shapeFrom: "typed" },
        TITLES,
        LIVE,
        t(),
      ).text,
    ).toBe(
      "Map of the whole manuscript · a structure chosen for this map: Three Acts",
    );
    // A reading has no shape to name.
    expect(
      mapHeader(
        { ...threeActs(), mode: "reading", shape: null, nodes: [] },
        TITLES,
        LIVE,
        t(),
      ).text,
    ).toBe("Map of the whole manuscript");
  });

  // Whose structure it is, against the live declaration: "the project's"
  // only while it is true, typed out or not.
  it("says the project's structure only while the project declares it", () => {
    const typed: MapArc = { ...threeActs(), shapeFrom: "typed" };
    const declaring = (declared: LiveStructure["declared"]) => ({
      ...LIVE,
      declared,
    });
    expect(mapHeader(typed, TITLES, declaring("threeact"), t()).text).toBe(
      "Map of the whole manuscript · the project's structure: Three Acts",
    );
    expect(mapHeader(typed, TITLES, declaring("kishotenketsu"), t()).text).toBe(
      "Map of the whole manuscript · a structure chosen for this map: Three Acts",
    );
    // Not the project's declared shape, and never typed: the shape alone,
    // and its Map again button says the rest.
    expect(
      mapHeader(threeActs(), TITLES, declaring("kishotenketsu"), t()).text,
    ).toBe("Map of the whole manuscript · Three Acts");
    expect(mapHeader(threeActs(), TITLES, declaring(null), t()).text).toBe(
      "Map of the whole manuscript · Three Acts",
    );
  });

  it("leaves the Part's title a slot, then the shape and whose it is", () => {
    const part: MapArc = {
      ...threeActs(),
      mode: "named",
      scope: { kind: "node", nodeId: "P1" },
    };
    const header = mapHeader(part, TITLES, LIVE, t());
    expect(header.text).toBe(
      `Map of “${TITLE_SLOT}” · the project's structure: Three Acts`,
    );
    expect(header.part).toEqual({ title: "Beginnings", gone: false });
  });
});

describe("the fit note", () => {
  it("names another shape with its button, the model's name left a slot", () => {
    const note = fitNote(
      {
        ...threeActs(),
        suggestion: { shape: "kishotenketsu", reason: "It turns." },
      },
      t(),
    );
    expect(note).toEqual({
      text: `Best fit, according to ${TITLE_SLOT}: ${t()("create.shape.kishotenketsu")}`,
      reason: "It turns.",
      mapWith: "kishotenketsu",
    });
  });

  it("says the project's own shape fits, with nothing to try", () => {
    expect(
      fitNote(
        { ...threeActs(), suggestion: { shape: "threeact", reason: "Yes." } },
        t(),
      ),
    ).toMatchObject({
      text: `Best fit, according to ${TITLE_SLOT}: Three Acts, the project's own structure`,
      mapWith: null,
    });
  });

  it("says none of the four, with no button, and nothing with no note", () => {
    expect(
      fitNote(
        { ...threeActs(), suggestion: { shape: "none", reason: "Waits." } },
        t(),
      ),
    ).toMatchObject({ mapWith: null, reason: "Waits." });
    expect(fitNote(threeActs(), t())).toBeNull();
  });

  it("is copied with the model named, and the button is not", () => {
    const text = mapAsText(
      {
        ...threeActs(),
        suggestion: { shape: "kishotenketsu", reason: "It turns." },
      },
      TITLES,
      LIVE,
      "qwen3:8b",
      t(),
    );
    expect(
      text.endsWith(
        `\n\nBest fit, according to qwen3:8b: ${t()("create.shape.kishotenketsu")}\n  It turns.`,
      ),
    ).toBe(true);
    expect(text).not.toContain("Map with this structure");
  });
});

describe("the answer as plain text", () => {
  it("says the header, the Issues, what already works and the coverage, in words", () => {
    expect(mapAsText(threeActs(), TITLES, LIVE, "qwen3:8b", t())).toBe(
      [
        "Map of the whole manuscript · the project's structure: Three Acts",
        "",
        "2 Parts don't fully fit where they stand",
        "partly fits · 01 · Setup · Beginnings",
        "  It opens late.",
        "  “The lamp goes out.”",
        "fits · 03 · Resolution · Ends · out of sequence",
        "  It comes early.",
        "",
        "Already working · 1",
        "fits · 02 · Confrontation · Middles",
        "  It presses.",
        "",
        "Sections considered: 3 of 4.",
      ].join("\n"),
    );
  });

  it("marks a gone node with its kept title, and never an id", () => {
    const text = mapAsText(
      threeActs(),
      TITLES,
      { revision: "rev", nodeIds: new Set(["node:P2", "node:P3"]) },
      "qwen3:8b",
      t(),
    );
    expect(text).toContain("Beginnings (no longer in the Structure)");
    expect(text).not.toContain("node:");
  });

  it("keeps a hostile title and reason literal", () => {
    const map = threeActs();
    map.nodes[0] = {
      ...map.nodes[0],
      title: '<img src=x onerror="alert(1)">',
      reason: "**x** [l](javascript:alert(1)) \u202Eevil",
    };
    const text = mapAsText(map, new Map(), undefined, "m", t());
    expect(text).toContain('<img src=x onerror="alert(1)">');
    expect(text).toContain("**x** [l](javascript:alert(1)) \u202Eevil");
    // No isolates added to the writer's clipboard.
    expect(text).not.toMatch(/[\u2066-\u2069]/);
  });

  it("names the model when it placed nothing", () => {
    const map = threeActs();
    map.nodes = map.nodes.map(({ verdict, reason, anchor, ...rest }) => {
      void verdict;
      void reason;
      void anchor;
      return rest;
    });
    expect(mapAsText(map, TITLES, LIVE, "qwen3:8b", t())).toContain(
      "qwen3:8b placed none of the 4 Parts",
    );
  });

  it("reads a map with no structure as the Parts and their readings", () => {
    const reading: MapArc = {
      ...threeActs(),
      shape: null,
      nodes: [node({ sourceId: "node:P1", reason: "It opens." })],
      coverage: { intended: 1, inspected: 1, skipped: [], complete: true },
    };
    expect(mapAsText(reading, TITLES, LIVE, "m", t())).toBe(
      [
        "Map of the whole manuscript",
        "",
        "01 · Beginnings",
        "  It opens.",
      ].join("\n"),
    );
  });
});

describe("the map's words, in both languages", () => {
  it.each(["en", "it"] as const)(
    "names every beat and every stage in %s",
    (lng) => {
      const translate = translators[lng];
      for (const shape of MAP_SHAPE_IDS)
        for (const beat of MAP_SHAPES[shape].beats) {
          const key = beatLabelKey(shape, beat.id);
          expect(key, `${shape}/${beat.id}`).not.toBeNull();
          expect(translate(key as string)).not.toBe(key);
        }
      for (const stage of MAP_SHAPES.herosjourney.stages ?? []) {
        const key = stageLabelKey(stage.id) as string;
        expect(translate(key)).not.toBe(key);
      }
      for (const verdict of ["fits", "partly", "no"])
        expect(translate(`dock.map.verdict.${verdict}`)).not.toContain("dock.");
    },
  );

  it.each(["en", "it"] as const)(
    "picks one and other for every counted line in %s",
    (lng) => {
      const translate = translators[lng];
      for (const key of [
        "dock.map.issuesParts",
        "dock.map.issuesSections",
        "dock.map.alreadyWorking",
        "dock.map.nonePlacedParts",
        "dock.map.nonePlacedSections",
        "dock.map.considered",
        "dock.map.noSummary",
        "dock.map.summariseMissing",
      ]) {
        const one = translate(key, { count: 1, total: 4, model: "M" });
        const many = translate(key, { count: 3, total: 4, model: "M" });
        expect(one, key).not.toContain("{{");
        expect(many, key).toContain("3");
        expect(one, key).not.toBe(key);
      }
    },
  );

  it("refuses a beat or a stage the tables do not have", () => {
    expect(beatLabelKey("threeact", "climax")).toBeNull();
    expect(stageLabelKey("prologue")).toBeNull();
  });
});

// A Section read as an arc of its own, and read for its fit.
describe("a map of one Section", () => {
  const section: MapNode = {
    sourceId: "node:S1",
    kind: "section",
    title: "Morning",
  };
  const anchor = (quote: string) => ({
    sourceId: "node:S1",
    quote,
    revision: "r1",
  });
  function passages(
    over: Partial<MapPassages> = {},
    states: MapPassages["passages"] = [
      {
        beat: "setup",
        state: "found",
        at: 0,
        anchor: anchor("Mira wakes."),
        reason: "She wakes.",
      },
      {
        beat: "confrontation",
        state: "found",
        at: 0.8,
        anchor: anchor("The door gives."),
        reason: "It gives.",
        outOfOrder: true,
      },
      { beat: "resolution", state: "missing", reason: "Nothing ends." },
    ],
  ): MapPassages {
    return {
      kind: "passages",
      shape: "threeact",
      shapeFrom: "typed",
      scope: { kind: "node", nodeId: "S1" },
      sectionRevision: "r1",
      nodes: [section],
      passages: states,
      coverage: { intended: 1, inspected: 1, skipped: [], complete: true },
      ...over,
    };
  }
  const fitOnly: MapFitOnly = {
    kind: "fit",
    scope: { kind: "node", nodeId: "S1" },
    sectionRevision: "r1",
    nodes: [section],
    coverage: { intended: 1, inspected: 1, skipped: [], complete: true },
    suggestion: { shape: "kishotenketsu", reason: "It turns, then joins." },
  };
  const live = (revision: string | null): LiveStructure => ({
    revision: "fingerprint",
    nodeIds: new Set(["node:S1"]),
    sections: new Map([["node:S1", revision]]),
  });

  it("names a found beat, and says when it is out of sequence", () => {
    const [setup, middle] = passages().passages;
    expect(passageHead("threeact", setup, t())).toBe("Setup");
    expect(passageHead("threeact", middle, t())).toBe(
      "Confrontation · out of sequence",
    );
    expect(passageHead("threeact", middle, translators.it)).toBe(
      "Confronto · fuori sequenza",
    );
  });

  describe("the lines under the rows", () => {
    const unanswered = (beat: string) => ({
      beat,
      state: "unanswered" as const,
    });

    it("says only that none was placed when nothing was found or missing", () => {
      const lines = sectionLines(
        passages({}, [
          unanswered("setup"),
          unanswered("confrontation"),
          unanswered("resolution"),
        ]),
        "Qwen",
        t(),
      );
      expect(lines).toEqual({
        none: "Qwen placed none of the 3 beats",
        missing: null,
        unanswered: null,
      });
    });

    it("names the missing beats, then the ones never placed, in beat order", () => {
      const lines = sectionLines(
        passages({}, [
          unanswered("setup"),
          { beat: "confrontation", state: "missing", reason: "No." },
          unanswered("resolution"),
        ]),
        "Qwen",
        t(),
      );
      expect(lines).toEqual({
        none: null,
        missing: "Not in this Section: Confrontation.",
        unanswered: "Qwen didn't place these beats: Setup, Resolution.",
      });
      const italian = sectionLines(
        passages({}, [
          { beat: "setup", state: "missing", reason: "No." },
          { beat: "confrontation", state: "missing", reason: "No." },
          unanswered("resolution"),
        ]),
        "Qwen",
        translators.it,
      );
      expect(italian.missing).toBe(
        "Non compaiono in questa Sezione: Presentazione, Confronto.",
      );
      expect(italian.unanswered).toBe(
        "Qwen non ha collocato questo momento: Risoluzione.",
      );
    });

    it("says nothing more when every beat was answered", () => {
      const all = passages({}, [
        {
          beat: "setup",
          state: "found",
          at: 0,
          anchor: anchor("Mira wakes."),
          reason: "She wakes.",
        },
        { beat: "confrontation", state: "missing", reason: "No." },
        { beat: "resolution", state: "missing", reason: "No." },
      ]);
      expect(sectionLines(all, "Qwen", t()).unanswered).toBeNull();
    });
  });

  it("offers Map again only once the Section's content has changed", () => {
    expect(mapFollowUp(passages(), undefined, undefined)).toBe("pending");
    expect(mapFollowUp(passages(), live("r1"), undefined)).toBeNull();
    expect(mapFollowUp(fitOnly, live("r1"), undefined)).toBeNull();
    expect(mapFollowUp(passages(), live("r2"), undefined)).toEqual({
      kind: "changed",
      canMapAgain: true,
    });
    // A Section gone has nothing to map again.
    expect(
      mapFollowUp(
        passages(),
        { revision: "fingerprint", nodeIds: new Set() },
        undefined,
      ),
    ).toEqual({ kind: "changed", canMapAgain: false });
  });

  it("says the whole Section travels, for either button", () => {
    for (const action of ["again", "summarise"] as const)
      expect(mapTransit(action, "OpenRouter", t(), true)).toBe(
        "For this map, the whole Section and the project's title, type, language, structure and word goal go from this device straight to OpenRouter.",
      );
    expect(mapTransit("again", "OpenRouter", translators.it, true)).toBe(
      "Per questa mappa OpenRouter riceve da questo dispositivo l'intera Sezione e i dati del progetto: titolo, tipo, lingua, struttura e obiettivo di parole.",
    );
  });

  it("heads a fit-only map with its reach alone", () => {
    const header = mapHeader(fitOnly, new Map(), live("r1"), t());
    expect(header.text).toBe(`Map of “${TITLE_SLOT}”`);
    expect(header.part).toEqual({ title: "Morning", gone: false });
    const typed = mapHeader(passages(), new Map(), live("r1"), t());
    expect(typed.text).toBe(
      `Map of “${TITLE_SLOT}” · a structure chosen for this map: Three Acts`,
    );
  });

  it("offers the fit note's button on a fit-only map", () => {
    expect(fitNote(fitOnly, t())).toEqual({
      text: `Best fit, according to ${TITLE_SLOT}: Kishōtenketsu (four acts)`,
      reason: "It turns, then joins.",
      mapWith: "kishotenketsu",
    });
  });

  it("copies what the answer says: each found beat, its reason and start, then the lines under them", () => {
    expect(mapAsText(passages(), new Map(), live("r1"), "Qwen", t())).toBe(
      [
        "Map of “Morning” · a structure chosen for this map: Three Acts",
        "",
        "Setup",
        "  She wakes.",
        "  “Mira wakes.”",
        "Confrontation · out of sequence",
        "  It gives.",
        "  “The door gives.”",
        "",
        "Not in this Section: Resolution.",
      ].join("\n"),
    );
  });

  it("copies a fit-only map as its header and its note", () => {
    expect(mapAsText(fitOnly, new Map(), live("r1"), "Qwen", t())).toBe(
      [
        "Map of “Morning”",
        "",
        "Best fit, according to Qwen: Kishōtenketsu (four acts)",
        "  It turns, then joins.",
      ].join("\n"),
    );
  });
});
