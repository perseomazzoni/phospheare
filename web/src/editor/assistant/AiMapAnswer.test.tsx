// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AiMapAnswer from "./AiMapAnswer";
import type { LiveStructure } from "./mapAnswer";
import type {
  MapArc,
  MapFitOnly,
  MapNode,
  MapOutcome,
  MapPassages,
} from "../../ai/domain/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // The title slot survives the JSON the mock prints, as it survives
    // real interpolation: the component splits the line on it.
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}:${JSON.stringify(values).replace(/\\u0001/g, "\u0001")}`
        : key,
    i18n: { language: "en" },
  }),
}));

afterEach(cleanup);

// Pins the `/map` answer on screen: its rows, its fold, its one button, and the
// rendering conditions that keep file text inert, text nodes in `<bdi>` and
// click targets only for live nodes.

/**
 * The mode a run would have stored on the block for this shape and scope
 * (`planMap`): positional where the nodes carry the beat they stand in, named
 * otherwise, and never positional on a Part.
 */
function modeFor(
  shape: MapArc["shape"],
  nodes: readonly MapNode[],
  scope: MapArc["scope"],
): MapArc["mode"] {
  if (shape === null) return "reading";
  if (shape === "herosjourney") return "hero";
  return scope.kind === "structure" && nodes.some((one) => one.standsIn)
    ? "positional"
    : "named";
}

function mapped(over: Partial<MapArc> = {}): MapArc {
  const base: Omit<MapArc, "kind" | "mode" | "shapeFrom"> & Partial<MapArc> = {
    shape: "threeact",
    scope: { kind: "structure" },
    structureRevision: "rev",
    nodes: [
      {
        sourceId: "node:P1",
        kind: "part",
        title: "Beginnings",
        standsIn: "setup",
        verdict: "no",
        reason: "It opens late.",
        anchor: { sourceId: "node:S1", quote: "The lamp goes out." },
      },
      {
        sourceId: "node:S1",
        kind: "section",
        parentId: "node:P1",
        title: "Lamp",
        standsIn: "setup",
      },
      {
        sourceId: "node:P2",
        kind: "part",
        title: "Middles",
        standsIn: "confrontation",
        verdict: "fits",
        reason: "It presses.",
      },
    ],
    coverage: { intended: 2, inspected: 2, skipped: [], complete: true },
    ...over,
  };
  return {
    kind: "arc",
    mode: modeFor(base.shape, base.nodes, base.scope),
    shapeFrom: "declared",
    ...base,
  };
}

const LIVE: LiveStructure = {
  revision: "rev",
  nodeIds: new Set(["node:P1", "node:S1", "node:P2"]),
};
const TITLES = new Map([
  ["node:P1", "Beginnings"],
  ["node:P2", "Middles"],
  ["node:S1", "Lamp"],
]);

function mount(
  answer: MapOutcome,
  props: Partial<Parameters<typeof AiMapAnswer>[0]> = {},
) {
  const handlers = {
    onOpenSource: vi.fn(),
    onShowEvidence: vi.fn(),
    onComplete: vi.fn(),
  };
  render(
    <AiMapAnswer
      mapped={answer}
      titles={TITLES}
      live={LIVE}
      model="qwen3:8b"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const rows = () => [...document.querySelectorAll(".ai-map-row")];

describe("a /map answer", () => {
  it("lists the Issues under their lede, then what already works in a closed fold", () => {
    mount(mapped());
    const ledes = [...document.querySelectorAll(".ai-lede")].map(
      (one) => one.textContent,
    );
    expect(ledes[1]).toBe('dock.map.issuesParts:{"count":1}');
    const fold = document.querySelector<HTMLDetailsElement>(
      "details.ai-map-working",
    );
    expect(fold?.open).toBe(false);
    expect(fold?.textContent).toContain("Middles");
    // The Section under a judged Part is drawn, never a row.
    expect(rows().map((one) => one.querySelector("bdi")?.textContent)).toEqual([
      "Beginnings",
      "Middles",
    ]);
    // No Resolve or Dismiss: a placement is a reading, not a task.
    expect(screen.queryByText("dock.finding.resolve")).toBeNull();
  });

  it("opens the fold when there is nothing else to read", () => {
    const answer = mapped();
    answer.nodes = answer.nodes.slice(2);
    mount(answer);
    expect(
      document.querySelector<HTMLDetailsElement>("details.ai-map-working")
        ?.open,
    ).toBe(true);
    expect(document.querySelectorAll(".ai-lede")).toHaveLength(1);
  });

  it("marks each row with its glyph, its colour class and a word", () => {
    mount(mapped());
    const [issue, working] = rows();
    expect(issue.querySelector(".ai-mark")?.classList).toContain("is-none");
    expect(issue.querySelector(".ui-visually-hidden")?.textContent).toBe(
      "dock.map.verdict.no",
    );
    expect(working.querySelector(".ai-mark")?.classList).toContain("is-full");
    // A mark's colour is a class from a closed lookup, never a style.
    // Nothing in the answer carries a style but the figure, which places
    // its labels by computed percentages — numbers the app worked out, never
    // file data — and whose own suite pins those styles.
    expect(
      document.querySelector(
        ".ai-map [style]:not(.ai-map-figure, .ai-map-figure *)",
      ),
    ).toBeNull();
  });

  it("opens a live node from its title and lands on its quote", () => {
    const handlers = mount(mapped());
    const [issue] = rows();
    fireEvent.click(issue.querySelector(".ai-cite") as HTMLElement);
    expect(handlers.onOpenSource).toHaveBeenCalledWith("node:P1");
    fireEvent.click(issue.querySelector(".ai-evidence") as HTMLElement);
    expect(handlers.onShowEvidence).toHaveBeenCalledWith({
      sourceId: "node:S1",
      quote: "The lamp goes out.",
    });
  });

  it("draws a gone node as its kept title, marked, and no button", () => {
    mount(mapped(), {
      live: { revision: "rev", nodeIds: new Set(["node:P2", "node:S1"]) },
    });
    const [issue, working] = rows();
    expect(issue.querySelector(".ai-cite")).toBeNull();
    expect(issue.querySelector(".ai-finding-title")?.textContent).toBe(
      "Beginnings · dock.map.gone",
    );
    expect(working.querySelector(".ai-cite")).toBeTruthy();
    // Nor is anything a button before the Structure has been read.
    cleanup();
    mount(mapped(), { live: undefined });
    expect(document.querySelector(".ai-cite")).toBeNull();
    expect(document.querySelector(".ai-map-row bdi")?.textContent).toBe(
      "Beginnings",
    );
  });

  // A node that is not live renders as plain text, not a button, and the
  // quote is a click target as much as the title is. So a quote is text on a
  // gone node, on a gone Section it lands on, and before the Structure has
  // been read.
  it("draws a quote as text once its node or its Section is gone, or before the Structure is read", () => {
    // Presence: everything live, the quote is a button.
    mount(mapped());
    expect(rows()[0].querySelector("button.ai-evidence")).toBeTruthy();
    cleanup();
    // The row's Part is gone: no button in the row, the quote still read.
    mount(mapped(), {
      live: { revision: "rev", nodeIds: new Set(["node:P2", "node:S1"]) },
    });
    expect(rows()[0].textContent).toContain("The lamp goes out.");
    expect(rows()[0].querySelector("button")).toBeNull();
    cleanup();
    // The Section the quote lands on is gone: the title opens the live
    // Part, the quote is text.
    mount(mapped(), {
      live: { revision: "rev", nodeIds: new Set(["node:P1", "node:P2"]) },
    });
    expect(rows()[0].querySelector(".ai-cite")).toBeTruthy();
    expect(rows()[0].textContent).toContain("The lamp goes out.");
    expect(rows()[0].querySelector("button.ai-evidence")).toBeNull();
    cleanup();
    // Not read yet: nothing in the row is a button.
    mount(mapped(), { live: undefined });
    expect(rows()[0].textContent).toContain("The lamp goes out.");
    expect(rows()[0].querySelector("button")).toBeNull();
  });

  it("keeps hostile titles, reasons and quotes as literal text in <bdi>", () => {
    const answer = mapped();
    answer.nodes[0] = {
      ...answer.nodes[0],
      title: '<img src=x onerror="alert(1)">',
      reason: "**x** [l](javascript:alert(1)) url(#x) \u202Eevil",
      anchor: { sourceId: "node:S1", quote: "<a href='javascript:x'>q</a>" },
    };
    mount(answer, { titles: new Map(), live: undefined });
    const map = document.querySelector(".ai-map") as HTMLElement;
    expect(map.querySelector("img, a, strong")).toBeNull();
    expect(map.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(map.textContent).toContain("**x** [l](javascript:alert(1))");
    expect(map.textContent).toContain("<a href='javascript:x'>q</a>");
    // A right-to-left override stays inside its own isolate.
    const evil = [...map.querySelectorAll("bdi")].find((one) =>
      one.textContent?.includes("\u202E"),
    );
    expect(evil?.textContent).toBe(
      "**x** [l](javascript:alert(1)) url(#x) \u202Eevil",
    );
    expect(
      map.querySelector("[style]:not(.ai-map-figure, .ai-map-figure *)"),
    ).toBeNull();
  });

  it("reads a Hero's Journey Section with its Part, and a Section enacting no stage with the ring", () => {
    mount(
      mapped({
        shape: "herosjourney",
        nodes: [
          { sourceId: "node:P1", kind: "part", title: "Beginnings" },
          {
            sourceId: "node:S1",
            kind: "section",
            parentId: "node:P1",
            title: "Lamp",
            reason: "Enacts no stage.",
          },
        ],
      }),
    );
    const [row] = rows();
    expect(row.querySelector(".ai-map-part")?.textContent).toBe(" Beginnings");
    expect(row.querySelector(".ai-mark")?.classList).toContain("is-none");
    // No stage, no key: the head is the mark and its word alone.
    expect(row.querySelector(".ai-finding-head")?.textContent).toBe(
      "dock.map.verdict.no",
    );
  });

  it("marks a Hero's Journey Section's gone Part on screen, as Copy does", () => {
    // The screen and Copy share one resolver, so both mark the Part gone.
    const hero = mapped({
      shape: "herosjourney",
      nodes: [
        { sourceId: "node:P1", kind: "part", title: "Beginnings" },
        {
          sourceId: "node:S1",
          kind: "section",
          parentId: "node:P1",
          title: "Lamp",
          stage: "call",
          verdict: "fits",
          reason: "It calls.",
        },
      ],
    });
    mount(hero);
    expect(rows()[0].querySelector(".ai-map-part")?.textContent).toBe(
      " Beginnings",
    );
    cleanup();
    mount(hero, { live: { revision: "rev", nodeIds: new Set(["node:S1"]) } });
    expect(rows()[0].querySelector(".ai-map-part")?.textContent).toBe(
      " Beginnings · dock.map.gone",
    );
  });

  it("names the model and says nothing else when it placed nothing", () => {
    const answer = mapped();
    answer.nodes = answer.nodes.map((one) => ({
      sourceId: one.sourceId,
      kind: one.kind,
      title: one.title,
    }));
    mount(answer, { model: "\u202Eqwen" });
    // The "placed nothing" lede, by its sentence: the header is a lede too.
    const none = [...document.querySelectorAll<HTMLElement>(".ai-lede")].find(
      (one) => one.textContent?.includes("dock.map.nonePlaced"),
    ) as HTMLElement;
    expect(none.querySelector("bdi")?.textContent).toBe("\u202Eqwen");
    expect(rows()).toEqual([]);
    expect(document.querySelector("details")).toBeNull();
  });

  it("reads a map with no structure as Part rows and one plain sentence", () => {
    mount(
      mapped({
        shape: null,
        nodes: [
          {
            sourceId: "node:P1",
            kind: "part",
            title: "Beginnings",
            reason: "It opens.",
          },
        ],
      }),
    );
    const [row] = rows();
    expect(row.querySelector(".ai-mark")).toBeNull();
    // Not by its class alone, which a rename would move: no glyph is
    // drawn on the row at all.
    expect(row.querySelector("svg")).toBeNull();
    expect(row.querySelector(".ai-finding-head")?.textContent).toBe("01");
    // The sentence teaches the four words, from the parser's table.
    expect(screen.getByText(/^dock\.map\.noStructure:/).textContent).toBe(
      `dock.map.noStructure:${JSON.stringify({
        threeact: "three-act",
        kishotenketsu: "kishotenketsu",
        freytagspyramid: "freytag",
        herosjourney: "hero",
      })}`,
    );
    expect(screen.queryByText(/dock.map.issues/)).toBeNull();
  });

  // The fit note sits after the coverage, and its button is the lowest.
  describe("the fit note", () => {
    const noted = (over: Partial<MapArc> = {}) =>
      mapped({
        suggestion: { shape: "kishotenketsu", reason: "It turns late." },
        ...over,
      });

    it("says the model's name and its reason as isolates, then the button", () => {
      const onMapWith = vi.fn();
      mount(noted(), { onMapWith });
      const note = screen.getByText(/dock\.map\.fit\.other/);
      const isolates = [...note.querySelectorAll("bdi")].map(
        (one) => one.textContent,
      );
      expect(isolates).toEqual(["qwen3:8b", "It turns late."]);
      fireEvent.click(
        screen.getByRole("button", { name: "dock.map.fit.mapWith" }),
      );
      expect(onMapWith).toHaveBeenCalledWith("kishotenketsu");
    });

    it("keeps the note but loses the button to any button above it", () => {
      mount(noted({ structureRevision: "old" }), { onMapWith: vi.fn() });
      expect(screen.getByText(/dock\.map\.fit\.other/)).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "dock.map.fit.mapWith" }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "dock.map.mapAgain" }),
      ).toBeTruthy();
    });

    it("has no button for the shape the map used, for none, or while running", () => {
      mount(noted({ suggestion: { shape: "threeact", reason: "Yes." } }), {
        onMapWith: vi.fn(),
      });
      expect(screen.getByText(/dock\.map\.fit\.declared/)).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "dock.map.fit.mapWith" }),
      ).toBeNull();
      cleanup();
      mount(noted({ suggestion: { shape: "none", reason: "Waits." } }), {
        onMapWith: vi.fn(),
      });
      expect(
        screen.queryByRole("button", { name: "dock.map.fit.mapWith" }),
      ).toBeNull();
      cleanup();
      mount(noted());
      expect(
        screen.queryByRole("button", { name: "dock.map.fit.mapWith" }),
      ).toBeNull();
    });

    it("replaces the reading's pointer at the words", () => {
      mount(
        mapped({
          mode: "reading",
          shape: null,
          nodes: [
            {
              sourceId: "node:P1",
              kind: "part",
              title: "Beginnings",
              reason: "It opens.",
            },
          ],
          suggestion: { shape: "threeact", reason: "It sets up and pays off." },
        }),
      );
      expect(screen.queryByText(/dock\.map\.noStructure/)).toBeNull();
      expect(screen.getByText(/dock\.map\.fit\.other/)).toBeTruthy();
    });
  });

  it("names a map of one Part's Part in its header, as its own isolate", () => {
    mount(mapped({ scope: { kind: "node", nodeId: "P1" } }));
    const header = document.querySelector(".ai-lede") as HTMLElement;
    expect(header.querySelector("bdi")?.textContent).toBe("Beginnings");
    expect(header.textContent).not.toContain("\u0001");
  });
});

describe("the button under a /map answer", () => {
  const unmapped = () =>
    mapped({
      coverage: {
        intended: 4,
        inspected: 2,
        skipped: [
          { sourceId: "node:S3", reason: "unmapped" },
          { sourceId: "node:S4", reason: "unmapped" },
        ],
        complete: false,
      },
    });

  it("draws nothing until the Structure has been read, then the button appears", () => {
    const answer = unmapped();
    const { rerender } = render(
      <AiMapAnswer
        mapped={answer}
        titles={TITLES}
        model="m"
        onOpenSource={vi.fn()}
        onShowEvidence={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(document.querySelector(".ai-widen")).toBeNull();
    rerender(
      <AiMapAnswer
        mapped={answer}
        titles={TITLES}
        live={LIVE}
        model="m"
        onOpenSource={vi.fn()}
        onShowEvidence={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(document.querySelector(".ai-widen")).toBeTruthy();
  });

  // A Section the model could not summarise is named and left out of the
  // button until the chat asks another model.
  it("says which Sections this model couldn't summarise and offers only the rest", () => {
    const blocked = mapped({
      coverage: {
        intended: 4,
        inspected: 2,
        skipped: [
          { sourceId: "node:S3", reason: "unsummarisable" },
          { sourceId: "node:S4", reason: "unmapped" },
        ],
        complete: false,
      },
    });
    mount(blocked, { stillMissing: (ids) => ids });
    expect(
      screen.getByText('dock.map.unsummarisable:{"count":1}'),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: 'dock.map.summariseMissing:{"count":1}',
      }),
    ).toBeTruthy();
    cleanup();
    mount(blocked, { stillMissing: (ids) => ids, lifted: true });
    expect(screen.queryByText(/dock.map.unsummarisable/)).toBeNull();
    expect(
      screen.getByRole("button", {
        name: 'dock.map.summariseMissing:{"count":2}',
      }),
    ).toBeTruthy();
  });

  it("summarises what a click would write, with the relay line before the button", () => {
    const handlers = mount(unmapped(), {
      stillMissing: (ids) => ids.slice(1),
      transitProvider: "OpenRouter",
    });
    expect(screen.getByText('dock.map.noSummary:{"count":2}')).toBeTruthy();
    const control = screen.getByRole("button", {
      name: 'dock.map.summariseMissing:{"count":1}',
    });
    const transit = screen.getByText(/dock.summariseTransit/);
    expect(
      transit.compareDocumentPosition(control) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(control);
    expect(handlers.onComplete).toHaveBeenCalledTimes(1);
  });

  it("keeps the note and draws no button or relay line while anything runs", () => {
    mount(unmapped(), {
      onComplete: undefined,
      transitProvider: "OpenRouter",
    });
    expect(screen.getByText('dock.map.noSummary:{"count":2}')).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /summariseMissing/ }),
    ).toBeNull();
    expect(screen.queryByText(/remoteTransit/)).toBeNull();
  });

  it("offers Map again once the Structure has changed, never the summaries", () => {
    mount(unmapped(), {
      live: { ...LIVE, revision: "other" },
      stillMissing: (ids) => ids,
    });
    expect(screen.getByText("dock.map.structureChanged")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "dock.map.mapAgain" }),
    ).toBeTruthy();
    expect(screen.queryByText(/summariseMissing/)).toBeNull();
  });

  it("offers Map again when the summaries came after the answer", () => {
    mount(unmapped(), { stillMissing: () => [] });
    expect(screen.getByText("dock.map.answerOutOfDate")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "dock.map.mapAgain" }),
    ).toBeTruthy();
  });

  it("says the Part is gone and offers nothing to click", () => {
    mount(mapped({ scope: { kind: "node", nodeId: "P1" } }), {
      live: { revision: "rev", nodeIds: new Set(["node:P2"]) },
    });
    expect(screen.getByText("dock.map.partGone")).toBeTruthy();
    expect(document.querySelector(".ai-widen button")).toBeNull();
  });
});

// A Section read as an arc of its own, with its ruler, the beats found with
// where each begins and the lines under them, and a Section read for its fit
// alone.
describe("a /map answer of one Section", () => {
  const anchor = (quote: string) => ({
    sourceId: "node:S1",
    quote,
    revision: "r1",
  });
  function section(
    states: MapPassages["passages"] = [
      {
        beat: "setup",
        state: "found",
        at: 0,
        anchor: anchor("The lamp goes out."),
        reason: "It opens dark.",
      },
      { beat: "confrontation", state: "missing", reason: "No one opposes." },
      { beat: "resolution", state: "unanswered" },
    ],
  ): MapPassages {
    return {
      kind: "passages",
      shape: "threeact",
      shapeFrom: "typed",
      scope: { kind: "node", nodeId: "S1" },
      sectionRevision: "r1",
      nodes: [{ sourceId: "node:S1", kind: "section", title: "Lamp" }],
      passages: states,
      coverage: { intended: 1, inspected: 1, skipped: [], complete: true },
    };
  }
  const fitOnly = (shape: "kishotenketsu" | "none"): MapFitOnly => ({
    kind: "fit",
    scope: { kind: "node", nodeId: "S1" },
    sectionRevision: "r1",
    nodes: [{ sourceId: "node:S1", kind: "section", title: "Lamp" }],
    coverage: { intended: 1, inspected: 1, skipped: [], complete: true },
    suggestion: { shape, reason: "It turns." },
  });
  const live = (revision: string | null): LiveStructure => ({
    ...LIVE,
    sections: new Map([["node:S1", revision]]),
  });
  const hints = () =>
    [...document.querySelectorAll(".dock-hint")].map(
      (one) => one.textContent ?? "",
    );

  it("draws each found beat's start on the ruler, and lists it under", () => {
    mount(section(), { live: live("r1") });
    expect(document.querySelector(".ai-map-ruler")).toBeTruthy();
    expect(document.querySelectorAll(".ai-map-start")).toHaveLength(1);
    expect(document.querySelectorAll(".ai-map-tick.is-field")).toHaveLength(2);
    expect(document.querySelector(".ai-map-legend")?.textContent).toBe(
      "create.partSetup",
    );
    expect(document.querySelector("figcaption")?.textContent).toContain(
      "dock.map.caption.section dock.map.caption.threeact",
    );
    const [row] = rows();
    expect(row.querySelector(".ai-finding-head")?.textContent).toBe(
      "create.partSetup",
    );
    expect(row.querySelector(".ai-finding-body bdi")?.textContent).toBe(
      "It opens dark.",
    );
    expect(row.textContent).toContain("The lamp goes out.");
    expect(row.textContent).toContain("dock.map.startsHere");
    // The beat not in the Section, then the one never placed, as hints.
    expect(hints().some((one) => one.startsWith("dock.map.missingBeats"))).toBe(
      true,
    );
    const unanswered = hints().find((one) =>
      one.startsWith("dock.map.unansweredBeats"),
    );
    expect(unanswered).toContain("qwen3:8b");
  });

  it("lands on a start only while the Section is unchanged", () => {
    const handlers = mount(section(), { live: live("r1") });
    fireEvent.click(document.querySelector(".ai-evidence") as HTMLElement);
    expect(handlers.onShowEvidence).toHaveBeenCalledWith(
      anchor("The lamp goes out."),
    );
    cleanup();
    for (const now of [live("r2"), undefined]) {
      mount(section(), { live: now });
      expect(rows()[0].textContent).toContain("The lamp goes out.");
      expect(document.querySelector("button.ai-evidence")).toBeNull();
      cleanup();
    }
  });

  it("says the Section changed, dims the ruler, and offers Map again with the Section's relay line", () => {
    const onComplete = vi.fn();
    mount(section(), {
      live: live("r2"),
      onComplete,
      transitProvider: "OpenRouter",
    });
    expect(screen.getByText("dock.map.sectionChanged")).toBeTruthy();
    expect(screen.queryByText("dock.map.structureChanged")).toBeNull();
    expect(
      document.querySelector(".ai-map-figure.is-ruler.is-stale"),
    ).toBeTruthy();
    expect(
      screen.getByText(/dock\.map\.remoteTransitSection/).textContent,
    ).toContain("OpenRouter");
    fireEvent.click(screen.getByRole("button", { name: "dock.map.mapAgain" }));
    expect(onComplete).toHaveBeenCalled();
  });

  it("says the Section is gone and offers nothing to click", () => {
    mount(section(), {
      live: { revision: "rev", nodeIds: new Set(["node:P1"]) },
    });
    expect(screen.getByText("dock.map.sectionGone")).toBeTruthy();
    expect(document.querySelector(".ai-widen button")).toBeNull();
  });

  it("names the model and draws no ruler when it placed nothing", () => {
    mount(
      section([
        { beat: "setup", state: "unanswered" },
        { beat: "confrontation", state: "unanswered" },
        { beat: "resolution", state: "unanswered" },
      ]),
      { live: live("r1") },
    );
    expect(document.querySelector(".ai-map-ruler")).toBeNull();
    // The "placed nothing" lede, by its sentence: the header is a lede too.
    const none = [...document.querySelectorAll<HTMLElement>(".ai-lede")].find(
      (one) => one.textContent?.includes("dock.map.nonePlaced"),
    ) as HTMLElement;
    expect(none.textContent).toContain("dock.map.nonePlacedBeats");
    expect(none.querySelector("bdi")?.textContent).toBe("qwen3:8b");
    expect(rows()).toHaveLength(0);
  });

  it("leads with the missing beats when nothing was found", () => {
    mount(
      section([
        { beat: "setup", state: "missing", reason: "No." },
        { beat: "confrontation", state: "missing", reason: "No." },
        { beat: "resolution", state: "unanswered" },
      ]),
      { live: live("r1") },
    );
    const ledes = [...document.querySelectorAll(".ai-lede")].map(
      (one) => one.textContent ?? "",
    );
    expect(ledes[1]).toMatch(/^dock\.map\.missingBeats/);
    expect(document.querySelector(".ai-findings")).toBeNull();
    expect(hints().some((one) => one.startsWith("dock.map.missingBeats"))).toBe(
      false,
    );
  });

  it("keeps a hostile reason and start as literal text", () => {
    mount(
      section([
        {
          beat: "setup",
          state: "found",
          at: 0.2,
          anchor: anchor("<img src=x onerror=alert(1)>"),
          reason: "<b>bold</b>",
        },
        { beat: "confrontation", state: "unanswered" },
        { beat: "resolution", state: "unanswered" },
      ]),
      { live: live("r1") },
    );
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector(".ai-map-row b")).toBeNull();
    expect(rows()[0].textContent).toContain("<b>bold</b>");
  });

  describe("read for its fit alone", () => {
    it("names its reach alone, then the note and its button", () => {
      const onMapWith = vi.fn();
      mount(fitOnly("kishotenketsu"), { live: live("r1"), onMapWith });
      const header = document.querySelector(".ai-lede") as HTMLElement;
      expect(header.textContent).toMatch(/^dock\.map\.headerNode/);
      expect(header.textContent).not.toContain("shapeDeclared");
      expect(header.querySelector("bdi")?.textContent).toBe("Lamp");
      expect(document.querySelector(".ai-map-ruler")).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "dock.map.fit.mapWith" }),
      );
      expect(onMapWith).toHaveBeenCalledWith("kishotenketsu");
      expect(screen.queryByText(/dock\.map\.noStructureSection/)).toBeNull();
    });

    it("teaches the structure words when there is no button to try", () => {
      mount(fitOnly("none"), { live: live("r1") });
      expect(screen.getByText(/dock\.map\.fit\.none/)).toBeTruthy();
      expect(
        screen.getByText(/dock\.map\.noStructureSection/).textContent,
      ).toContain('"herosjourney":"hero"');
    });
  });
});
