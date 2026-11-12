// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import SpineGlyph, { formatCount } from "./SpineGlyph";
import {
  STRUCTURE_VERSION,
  type DocumentStats,
  type DocumentStructure,
} from "../project/types";

afterEach(() => cleanup());

// Pins what is true of the spine only once it is drawn; the geometry is
// settled and tested in `spineLayout.ts`. A project's spine is scaled against
// the projects beside it on the shelf, and a project with nothing in it yet
// still occupies its slot instead of leaving a hole in the row.

const AT = "2026-07-28T10:00:00.000Z";

const withSections: DocumentStructure = {
  version: STRUCTURE_VERSION,
  children: [
    {
      kind: "part",
      id: "EL1",
      title: "one",
      adopted: "part--one.EL1.00.md",
      snapshots: [{ file: "part--one.EL1.00.md", title: "one 1", created: AT }],
      children: [
        {
          kind: "section",
          id: "EL2",
          title: "a",
          adopted: "section--a.EL2.00.md",
          snapshots: [
            { file: "section--a.EL2.00.md", title: "a 1", created: AT },
          ],
        },
      ],
    },
  ],
};

/** Legal: a project just after its Parts are outlined, with no Sections. */
const noSections: DocumentStructure = {
  version: STRUCTURE_VERSION,
  children: [
    {
      kind: "part",
      id: "EL1",
      title: "one",
      adopted: "part--one.EL1.00.md",
      snapshots: [{ file: "part--one.EL1.00.md", title: "one 1", created: AT }],
      children: [],
    },
  ],
};

const stats: DocumentStats = {
  words: 1000,
  parts: 1,
  sections: 1,
  countedAt: AT,
  perNode: [{ nodeId: "EL2", words: 1000, updatedAt: AT }],
};

describe("SpineGlyph", () => {
  it("takes the whole width when no shelf scale is given", () => {
    render(<SpineGlyph structure={withSections} stats={stats} goal={null} />);
    expect(screen.getByRole("img").style.width).toBe("100%");
  });

  it("takes only its share of the width when a shelf scales it", () => {
    render(
      <SpineGlyph
        structure={withSections}
        stats={stats}
        fill={0.25}
        goal={null}
      />,
    );
    expect(screen.getByRole("img").style.width).toBe("25%");
  });

  it("clamps a fill outside 0…1 rather than drawing past the card", () => {
    render(
      <SpineGlyph
        structure={withSections}
        stats={stats}
        fill={4}
        goal={null}
      />,
    );
    expect(screen.getByRole("img").style.width).toBe("100%");
  });

  it("a Part with no Sections yet draws its own field — the goal model's slot is the Part", () => {
    const { container } = render(
      <SpineGlyph
        structure={noSections}
        stats={{ ...stats, sections: 0, perNode: [] }}
        goal={5000}
      />,
    );
    // Present, described and holding the same height, not absent: the Part's
    // own field is the empty project's track.
    expect(screen.getByRole("img")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelector(".spine-empty")).toBeNull();
  });

  it("a structure with no Parts at all still keeps its slot as an empty track", () => {
    const { container } = render(
      <SpineGlyph
        structure={{ version: STRUCTURE_VERSION, children: [] }}
        stats={{ ...stats, parts: 0, sections: 0, perNode: [] }}
        goal={5000}
      />,
    );
    expect(screen.getByRole("img")).toBeTruthy();
    expect(container.querySelector(".spine-empty")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });

  // The empty branch carries the width style too. Without it an empty
  // project draws at full width while one short Section draws at `MIN_FILL`,
  // so the emptiest projects on a shelf carry its longest bars.
  it("scales its empty track to the shelf like any other spine", () => {
    render(
      <SpineGlyph
        structure={noSections}
        stats={{ ...stats, sections: 0, perNode: [] }}
        fill={0.08}
        goal={null}
      />,
    );
    expect(screen.getByRole("img").style.width).toBe("8%");
  });

  it("still names the project for a screen reader when it has nothing to draw", () => {
    render(
      <SpineGlyph
        structure={noSections}
        stats={{ ...stats, sections: 0, perNode: [] }}
        title="Once Dark"
        goal={null}
      />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "Once Dark",
    );
  });
});

// The goal-anchored drawing, used by the Desk's hero and the panel's header.
describe("SpineGlyph — the goal layout", () => {
  const withDelta: DocumentStats = {
    ...stats,
    perNode: [{ nodeId: "EL2", words: 1000, lastDelta: 500, updatedAt: AT }],
  };

  it("nests each Section's bar inside its Part's field", () => {
    const { container } = render(
      <SpineGlyph structure={withSections} stats={stats} goal={5000} />,
    );
    const groups = container.querySelectorAll("svg g");
    expect(groups.length).toBeGreaterThan(0);
    const part = container.querySelector(".spine-field") as SVGRectElement;
    expect(part.style.fill).toBe(
      "color-mix(in srgb, var(--spine-hue) var(--spine-ground-mix), var(--spine-plan))",
    );
    expect(
      container.querySelector(".spine-bar")?.closest(".spine-bars > g"),
    ).toBe(part.parentElement);
  });

  it("hatches the capacity the Sections have not consumed", () => {
    const { container } = render(
      <SpineGlyph structure={withSections} stats={stats} goal={5000} />,
    );
    // One Part of 5000 capacity, 1000 words written: 80% of the field is
    // the hatched empty region, trailing the Section.
    const hatch = container.querySelector(".spine-room") as SVGRectElement;
    expect(hatch).toBeTruthy();
    expect(Number(hatch.getAttribute("width"))).toBeGreaterThan(600);
  });

  it("shows a hollow Part at its full equal share when nothing is written", () => {
    const { container } = render(
      <SpineGlyph
        structure={noSections}
        stats={{ ...stats, sections: 0, perNode: [] }}
        goal={5000}
      />,
    );
    const part = container.querySelector('rect[stroke-dasharray="3 3"]');
    expect(part).toBeTruthy();
  });

  it("caps the Section's trailing end in leaf for written words", () => {
    const { container } = render(
      <SpineGlyph
        structure={withSections}
        stats={withDelta}
        goal={5000}
        deltas
      />,
    );
    // The overlay is the one rect at full leaf; the bar beneath is 0.85.
    const overlay = container.querySelector(
      'rect[fill="var(--leaf)"]',
    ) as SVGRectElement;
    const bar = container.querySelector(
      '.spine-bar[data-kind="section"]',
    ) as SVGRectElement;
    expect(overlay).toBeTruthy();
    expect(bar).toBeTruthy();
    // The delta is 500 of 1000 words — half the Section's bar, and it
    // caps the trailing end: added words extend the frontier.
    expect(Number(overlay.getAttribute("width"))).toBeCloseTo(
      Number(bar.getAttribute("width")) / 2,
      5,
    );
    expect(Number(overlay.getAttribute("x"))).toBeCloseTo(
      Number(bar.getAttribute("x")) + Number(bar.getAttribute("width")) / 2,
      5,
    );
  });

  it("a null goal draws the goal shape against the project's own total", () => {
    const { container } = render(
      <SpineGlyph structure={withSections} stats={withDelta} goal={null} />,
    );
    // A project with no goal draws the goal shape's part fields against its
    // own total, never the flat self-relative model.
    expect(container.querySelector("svg g")).toBeTruthy();
  });

  it("burns ember for cut words, denting the Section's leading edge", () => {
    const cut: DocumentStats = {
      ...stats,
      perNode: [{ nodeId: "EL2", words: 1000, lastDelta: -400, updatedAt: AT }],
    };
    const { container } = render(
      <SpineGlyph structure={withSections} stats={cut} goal={5000} deltas />,
    );
    const overlay = container.querySelector(
      'rect[fill="var(--attention)"][fill-opacity="1"]',
    ) as SVGRectElement;
    const bar = container.querySelector(
      '.spine-bar[data-kind="section"]',
    ) as SVGRectElement;
    expect(overlay).toBeTruthy();
    expect(Number(overlay.getAttribute("width"))).toBeCloseTo(
      Number(bar.getAttribute("width")) * 0.4,
      5,
    );
    // Cut words stay at the leading edge — a mark, not a shorter bar.
    expect(Number(overlay.getAttribute("x"))).toBeCloseTo(
      Number(bar.getAttribute("x")),
      5,
    );
  });

  it("colours the Part's border leaf when its own text grew last session", () => {
    const partText: DocumentStats = {
      ...stats,
      perNode: [
        { nodeId: "EL1", words: 200, lastDelta: 200, updatedAt: AT },
        { nodeId: "EL2", words: 1000, updatedAt: AT },
      ],
    };
    const { container } = render(
      <SpineGlyph
        structure={withSections}
        stats={partText}
        goal={5000}
        deltas
      />,
    );
    // The Part field's stroke is leaf for its own +200, the one colour for
    // additions on the border and the Sections' caps, never the hair.
    const field = container.querySelector(".spine-field") as SVGRectElement;
    expect(field.style.stroke).toBe("var(--leaf)");
    // The border's tooltip carries the delta it stands for.
    const title = field?.querySelector("title");
    expect(title?.textContent).toContain("+200 words last session");
  });

  // One Part, two Sections: the second written or not.
  const withEmptySection: DocumentStructure = {
    version: STRUCTURE_VERSION,
    children: [
      {
        kind: "part",
        id: "EL1",
        title: "one",
        adopted: "part--one.EL1.00.md",
        snapshots: [
          { file: "part--one.EL1.00.md", title: "one 1", created: AT },
        ],
        children: [
          {
            kind: "section",
            id: "EL2",
            title: "a",
            adopted: "section--a.EL2.00.md",
            snapshots: [
              { file: "section--a.EL2.00.md", title: "a 1", created: AT },
            ],
          },
          {
            kind: "section",
            id: "EL3",
            title: "b",
            adopted: "section--b.EL3.00.md",
            snapshots: [
              { file: "section--b.EL3.00.md", title: "b 1", created: AT },
            ],
          },
        ],
      },
    ],
  };

  it("omits an empty Section whose Part has no hatch left to hold it", () => {
    // Goal 100, one Part of 100 capacity, Section a holding all of it: the
    // empty Section b's slot is the hatch, and the hatch is gone. A
    // zero-width rect with a dashed stroke still paints a dotted hairline,
    // so the collapsed Section must not render at all.
    const { container } = render(
      <SpineGlyph
        structure={withEmptySection}
        stats={{
          words: 100,
          parts: 1,
          sections: 2,
          countedAt: AT,
          perNode: [{ nodeId: "EL2", words: 100, updatedAt: AT }],
        }}
        goal={100}
      />,
    );
    expect(container.querySelector('rect[stroke-dasharray="3 3"]')).toBeNull();
    const bar = container.querySelector('.spine-bar[data-kind="section"]');
    expect(bar).toBeTruthy();
  });

  it("keeps an empty Section's hollow minimum while the hatch can hold it", () => {
    // 1000 of a 5000 share: the empty Section rides the hatch at MIN_BAR.
    const { container } = render(
      <SpineGlyph
        structure={withEmptySection}
        stats={{
          words: 1000,
          parts: 1,
          sections: 2,
          countedAt: AT,
          perNode: [{ nodeId: "EL2", words: 1000, updatedAt: AT }],
        }}
        goal={5000}
      />,
    );
    const empty = container.querySelector(
      'rect[stroke-dasharray="3 3"]',
    ) as SVGRectElement;
    expect(empty).toBeTruthy();
    expect(Number(empty.getAttribute("width"))).toBe(2);
  });

  it("— the dense book's rendered SVG stays inside the field", () => {
    // The arithmetic rows settle the geometry; this row proves the rendered
    // SVG carries it. One Part with 60 Sections plus eleven single-Section
    // Parts is a shape that can overrun the viewBox, so every rect (fields,
    // hatches, bars) must sit in [0, 1000].
    const dense: DocumentStructure = {
      version: STRUCTURE_VERSION,
      children: [
        {
          kind: "part",
          id: "D0",
          title: "dense",
          adopted: "part--dense.00.md",
          snapshots: [
            { file: "part--dense.00.md", title: "dense", created: AT },
          ],
          children: Array.from({ length: 60 }, (_, i) => ({
            kind: "section" as const,
            id: `D0S${i}`,
            title: String(i),
            adopted: `section--d0s${i}.00.md`,
            snapshots: [
              {
                file: `section--d0s${i}.00.md`,
                title: String(i),
                created: AT,
              },
            ],
          })),
        },
        ...Array.from({ length: 11 }, (_, p) => ({
          kind: "part" as const,
          id: `D${p + 1}`,
          title: String(p + 1),
          adopted: `part--d${p + 1}.00.md`,
          snapshots: [
            {
              file: `part--d${p + 1}.00.md`,
              title: String(p + 1),
              created: AT,
            },
          ],
          children: [
            {
              kind: "section" as const,
              id: `D${p + 1}S0`,
              title: "s",
              adopted: `section--d${p + 1}s0.00.md`,
              snapshots: [
                {
                  file: `section--d${p + 1}s0.00.md`,
                  title: "s",
                  created: AT,
                },
              ],
            },
          ],
        })),
      ],
    };
    const { container } = render(
      <SpineGlyph
        structure={dense}
        stats={{
          words: 0,
          parts: 12,
          sections: 71,
          countedAt: AT,
          perNode: [],
        }}
        height={54}
        goal={100_000}
      />,
    );
    const rects = Array.from(container.querySelectorAll("svg rect"));
    expect(rects.length).toBeGreaterThan(0);
    for (const rect of rects) {
      const x = Number(rect.getAttribute("x") ?? "0");
      const width = Number(rect.getAttribute("width") ?? "0");
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(width)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x + width).toBeLessThanOrEqual(1000 + 1e-9);
    }
  });
});

describe("formatCount — the counts row's voice", () => {
  it("prints full numbers below a thousand", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(249)).toBe("249");
    expect(formatCount(999)).toBe("999");
  });

  it("uses k shorthand from a thousand up", () => {
    expect(formatCount(1000)).toBe("1.0k");
    expect(formatCount(60000)).toBe("60.0k");
    expect(formatCount(523400)).toBe("523.4k");
  });
});
