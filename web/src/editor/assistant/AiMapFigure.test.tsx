// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { EDITOR_CSS } from "../editorSheets.fixture";
import AiMapFigure from "./AiMapFigure";
import AiMapAnswer from "./AiMapAnswer";
import type { MapNode, MapArc } from "../../ai/domain/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: "en" },
  }),
}));

afterEach(cleanup);

// Pins the figure above a `/map` answer's rows: drawn by the app from the
// stored answer, carrying none of the writer's or the model's words, not a
// control, and dimmed once the Structure has moved past it.

const HOSTILE = '<img src=x onerror="alert(1)"> url(#x) javascript:x';

function part(over: Partial<MapNode> & { sourceId: string }): MapNode {
  return { kind: "part", title: HOSTILE, reason: HOSTILE, ...over };
}

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

function mapped(
  shape: MapArc["shape"],
  nodes: MapNode[],
  over: Partial<MapArc> = {},
): MapArc {
  return {
    kind: "arc",
    mode: modeFor(shape, nodes, over.scope ?? { kind: "structure" }),
    shapeFrom: "declared",
    shape,
    scope: { kind: "structure" },
    structureRevision: "rev",
    nodes,
    coverage: { intended: 1, inspected: 1, skipped: [], complete: true },
    ...over,
  };
}

const SHAPES: Record<string, MapArc> = {
  threeact: mapped("threeact", [
    part({
      sourceId: "node:P1",
      standsIn: "setup",
      verdict: "fits",
      words: 10,
    }),
    part({
      sourceId: "node:P2",
      standsIn: "confrontation",
      verdict: "no",
      words: 30,
    }),
  ]),
  kishotenketsu: mapped("kishotenketsu", [
    part({ sourceId: "node:P1", standsIn: "ki", verdict: "partly" }),
  ]),
  freytagspyramid: mapped("freytagspyramid", [
    part({ sourceId: "node:P1", beat: "climax", verdict: "fits" }),
  ]),
  herosjourney: mapped("herosjourney", [
    part({ sourceId: "node:P1", verdict: undefined, reason: undefined }),
    part({
      sourceId: "node:S1",
      kind: "section",
      parentId: "node:P1",
      stage: "ordeal",
      verdict: "fits",
    }),
  ]),
};

const figure = () => document.querySelector("figure.ai-map-figure");

describe.each(Object.entries(SHAPES))("the %s figure", (shape, answer) => {
  it("draws the shape with the answer's discs, hidden and not a control", () => {
    render(<AiMapFigure mapped={answer} stale={false} />);
    expect(figure()?.classList).toContain(`is-${shape}`);
    // Only the drawing's own discs: the caption's key always carries three,
    // so counting the whole figure passes even with the drawn discs at 0×0.
    expect(
      figure()?.querySelectorAll(".ai-map-drawing .ai-mark").length,
    ).toBeGreaterThan(0);
    const drawing = figure()?.querySelector(".ai-map-drawing");
    expect(drawing?.getAttribute("aria-hidden")).toBe("true");
    expect(figure()?.querySelector("button, a, [tabindex]")).toBeNull();
    // The caption stays readable: its source and its key.
    expect(figure()?.querySelector("figcaption")?.textContent).toContain(
      `dock.map.caption.${shape}`,
    );
  });

  it("carries none of the writer's or the model's words, and no attribute from them", () => {
    render(<AiMapFigure mapped={answer} stale={false} />);
    const html = figure()?.outerHTML ?? "";
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("url(#");
    // Colours from classes on tokens, never an attribute; nothing that could
    // pull in a resource or a document.
    // The drawing's own SVGs (the discs are the kit's icons, in
    // `currentColor`, and are not drawing).
    const drawn = [
      ...(figure()?.querySelectorAll(
        ".ai-map-line, .ai-map-fields, .ai-map-circle > svg",
      ) ?? []),
    ];
    expect(drawn.length).toBeGreaterThan(0);
    for (const svg of drawn)
      expect(
        svg.querySelector("[fill], [stroke], foreignObject, use, a"),
      ).toBeNull();
    expect(figure()?.querySelector("foreignObject, use, a")).toBeNull();
    // No link of any spelling: `href`, `xlink:href`.
    for (const el of figure()?.querySelectorAll("*") ?? [])
      expect([...el.attributes].some((one) => one.name.endsWith("href"))).toBe(
        false,
      );
    // Every inline style is a position the app worked out: an allowlist of
    // properties, each a number in px or %, or a clamp/calc of them —
    // nothing a replayed file could turn into a value of its own.
    const VALUE =
      /^(-?[\d.]+(px|%)|0|max\([\d.]+px, [\d.]+%\)|translateX?\(-?[\d.]+%(, -?[\d.]+%)?\))$/;
    for (const el of figure()?.querySelectorAll("[style]") ?? []) {
      const style = (el as HTMLElement).style;
      expect(style.length).toBeGreaterThan(0);
      for (const property of [...style]) {
        expect(["left", "right", "top", "height", "transform"]).toContain(
          property,
        );
        expect(style.getPropertyValue(property)).toMatch(VALUE);
      }
    }
  });

  it("dims the drawing once the Structure has moved", () => {
    render(<AiMapFigure mapped={answer} stale />);
    expect(figure()?.classList).toContain("is-stale");
  });
});

describe("how the lines are drawn", () => {
  it("stretches the straight figures and never the circle", () => {
    render(<AiMapFigure mapped={SHAPES.threeact} stale={false} />);
    const stretched = [
      ...(figure()?.querySelectorAll(".ai-map-line, .ai-map-fields") ?? []),
    ];
    expect(stretched.length).toBeGreaterThan(0);
    for (const svg of stretched)
      expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    cleanup();
    render(<AiMapFigure mapped={SHAPES.herosjourney} stale={false} />);
    expect(
      figure()
        ?.querySelector(".ai-map-circle > svg")
        ?.getAttribute("preserveAspectRatio"),
    ).toBeNull();
  });

  it("says each Part is drawn to its words only when the bar is drawn", () => {
    render(<AiMapFigure mapped={SHAPES.threeact} stale={false} />);
    expect(figure()?.textContent).toContain("dock.map.caption.threeactShares");
    expect(figure()?.querySelectorAll(".ai-map-field")).toHaveLength(2);
    cleanup();
    const uncounted = mapped(
      "threeact",
      SHAPES.threeact.nodes.map(({ words, ...rest }) => {
        void words;
        return rest;
      }),
    );
    render(<AiMapFigure mapped={uncounted} stale={false} />);
    expect(figure()?.querySelector(".ai-map-field")).toBeNull();
    expect(figure()?.textContent).not.toContain("threeactShares");
    // The marks still stand, on Field's line.
    expect(figure()?.querySelectorAll(".ai-mark.is-full")).toHaveLength(2);
  });

  it("names Vogler's twelve stages in the caption", () => {
    render(<AiMapFigure mapped={SHAPES.herosjourney} stale={false} />);
    const legend = figure()?.querySelectorAll(".ai-map-legend li") ?? [];
    expect(legend).toHaveLength(12);
    expect(legend[7].textContent).toBe("dock.map.stage.ordeal");
    expect(figure()?.querySelectorAll(".ai-map-number")).toHaveLength(12);
  });
});

describe("where the figure stands in the answer", () => {
  const LIVE = {
    revision: "rev",
    nodeIds: new Set(["node:P1", "node:P2"]),
  };

  it("sits above the Issues, and nothing else moves for it", () => {
    render(
      <AiMapAnswer
        mapped={SHAPES.threeact}
        titles={new Map()}
        live={LIVE}
        model="m"
        onOpenSource={vi.fn()}
        onShowEvidence={vi.fn()}
      />,
    );
    const lede = document.querySelectorAll(".ai-lede")[1];
    expect(
      (figure() as Element).compareDocumentPosition(lede) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The header is still first.
    expect(
      document.querySelector(".ai-map")?.firstElementChild?.className,
    ).toBe("ai-lede");
  });

  it("dims once the Structure has changed, and the rows do not", () => {
    render(
      <AiMapAnswer
        mapped={SHAPES.threeact}
        titles={new Map()}
        live={{ ...LIVE, revision: "other" }}
        model="m"
        onOpenSource={vi.fn()}
        onShowEvidence={vi.fn()}
      />,
    );
    expect(figure()?.classList).toContain("is-stale");
    expect(
      document.querySelector(".ai-map-row.is-stale, .ai-findings.is-stale"),
    ).toBeNull();
  });

  // A map of one Part draws its figure; a reading and a map with
  // nothing placed draw none.
  it("draws nothing for a reading, or nothing placed", () => {
    const cases = [
      mapped(null, [part({ sourceId: "node:P1", verdict: undefined })]),
      mapped("threeact", [
        { sourceId: "node:P1", kind: "part", title: "t", standsIn: "setup" },
      ]),
    ];
    for (const answer of cases) {
      render(
        <AiMapAnswer
          mapped={answer}
          titles={new Map()}
          live={LIVE}
          model="m"
          onOpenSource={vi.fn()}
          onShowEvidence={vi.fn()}
        />,
      );
      expect(figure()).toBeNull();
      // Presence in the same row: the answer itself did render.
      expect(document.querySelector(".ai-map")).toBeTruthy();
      cleanup();
    }
  });

  // A Part is its own mini-arc, so its children take the beats and the
  // figure is drawn rooted at the Part, with the units caption.
  it("draws a map of one Part, its children on the beats", () => {
    const child = (sourceId: string, beat: string) =>
      part({
        sourceId,
        kind: "section",
        parentId: "node:P1",
        beat,
        verdict: "fits",
        words: 10,
      });
    render(
      <AiMapAnswer
        mapped={mapped(
          "threeact",
          [
            part({ sourceId: "node:P1", verdict: undefined }),
            child("node:S1", "setup"),
            child("node:S2", "confrontation"),
          ],
          { scope: { kind: "node", nodeId: "P1" } },
        )}
        titles={new Map()}
        live={LIVE}
        model="m"
        onOpenSource={vi.fn()}
        onShowEvidence={vi.fn()}
      />,
    );
    expect(figure()).toBeTruthy();
    expect(figure()?.textContent).toContain(
      "dock.map.caption.threeactSharesUnits",
    );
  });
});

describe("defects in the /map figure", () => {
  /** Only the drawing's discs: the caption's key always carries three. */
  const drawnMarks = () =>
    document.querySelectorAll(".ai-map-drawing .ai-mark");

  it("keeps a Hero's Journey disc its own size: the circle's drawing rule does not reach it", () => {
    // jsdom cascades a stylesheet into getComputedStyle, so the rule that
    // sizes the circle's SVG can be read against the disc it also matches.
    const sheet = document.createElement("style");
    sheet.textContent = EDITOR_CSS;
    document.head.append(sheet);
    try {
      render(<AiMapFigure mapped={SHAPES.herosjourney} stale={false} />);
      const disc = document.querySelector(".ai-map-point svg");
      expect(disc).not.toBeNull();
      const style = getComputedStyle(disc as Element);
      // Absolute, inset 0 and 100% of a point that has no size of its own
      // is a 0×0 disc (measured in Chromium: every disc 0px wide).
      expect(style.position).not.toBe("absolute");
      expect(style.width).not.toBe("100%");
    } finally {
      sheet.remove();
    }
  });

  it("keeps a narrow last Part's label inside the Three Acts figure", () => {
    const words = [1000, 1000, 1000, 1000, 10];
    const beats = ["setup", "confrontation", "confrontation", "resolution"];
    render(
      <AiMapFigure
        mapped={mapped(
          "threeact",
          words.map((count, index) =>
            part({
              sourceId: `node:P${index}`,
              beat: beats[index] ?? "resolution",
              verdict: "fits",
              words: count,
            }),
          ),
        )}
        stale={false}
      />,
    );
    const labels = document.querySelectorAll(".ai-map-parts > span");
    const last = labels[labels.length - 1];
    expect(last?.textContent).toBe("05");
    // Its field starts at ~98%. A bare `left: 98%` runs "05" and its disc
    // (~28px) past the figure's right edge: in Chromium at a 300px dock the
    // label ends at 308px and the answer scrolls sideways. Whatever holds it
    // in (a shift by its own width, a right anchor, a clamped left) shows in
    // the style.
    expect(last?.getAttribute("style")).toMatch(
      /translateX\(|right:|min\(|clamp\(/,
    );
  });

  it("centres a station's discs on the station wherever they fit", () => {
    render(
      <AiMapFigure
        mapped={mapped("kishotenketsu", [
          part({ sourceId: "node:A", standsIn: "ki", verdict: "fits" }),
          part({ sourceId: "node:B", standsIn: "sho", verdict: "partly" }),
          part({ sourceId: "node:C", standsIn: "ten", verdict: "no" }),
          part({ sourceId: "node:D", standsIn: "ketsu", verdict: "fits" }),
        ])}
        stale={false}
      />,
    );
    const groups = [...document.querySelectorAll(".ai-map-marks")];
    expect(groups).toHaveLength(4);
    // The station dot is `translate(-50%, -50%)` at its x. A group shifted
    // by x% of its own width instead sits 4.5px right of Ki and 1.5px left
    // of Ten with one disc (measured in Chromium), and 20px off with four.
    // Shō and Ten (37.5%, 62.5%) have room either side at a 300px dock, so
    // nothing needs to pull them off centre.
    // Centred on its x from whichever edge is nearer: `left` and -50%, or
    // `right` and +50%, the same centre.
    expect(groups[1].getAttribute("style")).toMatch(
      /left: max\(6px, 37\.5%\).*translate\(-50%, -50%\)/,
    );
    expect(groups[2].getAttribute("style")).toMatch(
      /right: max\(6px, 37\.5%\).*translate\(50%, -50%\)/,
    );
  });

  it("draws a judged top-level Section's disc on Three Acts, as Kishōtenketsu does", () => {
    // On a named map a Section outside every Part is a unit (mapUnits): it
    // has a verdict, a beat and a row with its disc.
    const nodes = (beats: [string, string], words?: number) => [
      part({
        sourceId: "node:P1",
        beat: beats[0],
        verdict: "fits",
        ...(words ? { words } : {}),
      }),
      part({
        sourceId: "node:S0",
        kind: "section",
        beat: beats[1],
        verdict: "partly",
        ...(words ? { words } : {}),
      }),
    ];
    render(
      <AiMapFigure
        mapped={mapped("kishotenketsu", nodes(["ki", "sho"]))}
        stale={false}
      />,
    );
    expect(drawnMarks()).toHaveLength(2);
    cleanup();
    // With word counts (the fields) and without (Field's line by act).
    for (const answer of [
      mapped("threeact", nodes(["setup", "confrontation"], 500)),
      mapped("threeact", nodes(["setup", "confrontation"])),
    ]) {
      render(<AiMapFigure mapped={answer} stale={false} />);
      expect(drawnMarks()).toHaveLength(2);
      cleanup();
    }
  });
});
