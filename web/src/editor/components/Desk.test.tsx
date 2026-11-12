// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Desk from "./Desk";
import type {
  DocumentProperties,
  DocumentStructure,
} from "../../project/types";
import type { Paragraph } from "../engine";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${Object.values(vars).join(",")})` : key,
    // The ledger formats its own relative times through `Intl`, which needs to
    // know the language: the words are the platform's.
    i18n: { language: "en" },
  }),
}));

afterEach(() => cleanup());

// Where the editor opens. Every band is judged against re-entry, remembering
// where the writer was, and none invents an answer it does not have.

// Nodes are identified by their ids here, not their files: a rename re-stems
// the snapshot files but cannot touch the id, so the fixtures fix the ids
// (`EL1`…`EL3`) and let the files follow the titles (slug = lowercased title,
// with punctuation flattened to `_` — `the-storm` lives in `the_storm.01.md`).
const STRUCTURE: DocumentStructure = {
  version: 1,
  children: [
    {
      kind: "part",
      id: "EL1",
      title: "act-one",
      adopted: "part--act_one.EL1.00.md",
      snapshots: [
        {
          file: "part--act_one.EL1.00.md",
          title: "act-one",
          created: "2026-01-01",
        },
      ],
      children: [
        {
          kind: "section",
          id: "EL2",
          title: "opening",
          adopted: "section--opening.EL2.00.md",
          snapshots: [
            {
              file: "section--opening.EL2.00.md",
              title: "opening",
              created: "2026-01-01",
            },
          ],
        },
        {
          kind: "section",
          id: "EL3",
          title: "the-storm",
          adopted: "section--the_storm.EL3.01.md",
          snapshots: [
            {
              file: "section--the_storm.EL3.01.md",
              title: "the-storm",
              created: "2026-01-02",
            },
          ],
        },
      ],
    },
  ],
};

/** A fresh project's creation shape: Parts holding nothing yet. */
const PARTS_ONLY: DocumentStructure = {
  version: 1,
  children: [
    {
      kind: "part",
      id: "EL1",
      title: "Ki",
      adopted: "part--ki.EL1.00.md",
      snapshots: [
        { file: "part--ki.EL1.00.md", title: "Ki 1", created: "2026-01-01" },
      ],
      children: [],
    },
    {
      kind: "part",
      id: "EL2",
      title: "Sho",
      adopted: "part--sho.EL2.00.md",
      snapshots: [
        { file: "part--sho.EL2.00.md", title: "Sho 1", created: "2026-01-01" },
      ],
      children: [],
    },
  ],
};

/** The "No structure" creation shape — a project with no nodes at all. */
const EMPTY_STRUCT: DocumentStructure = { version: 1, children: [] };

/** An empty project's props, with the shape's own parts/sections counts. */
function emptyProps(parts: number, sections: number): DocumentProperties {
  return {
    ...propsWith(0),
    stats: { ...propsWith(0).stats, parts, sections, perNode: [] },
  };
}

function propsWith(words: number): DocumentProperties {
  return {
    schemaVersion: 1,
    document: {
      id: "x",
      title: "Once Dark",
      author: "",
      type: "Novel",
      structure: null,
      language: "en",
      createdAt: "",
      updatedAt: "",
      goal: null,
      genres: [],
      ageCategory: null,
      tropes: [],
    },
    sync: null,
    snapshotHashes: {},
    summaries: {},
    ui: {
      expanded: [],
      lastOpened: null,
      session: null,
      dockWidth: null,
      structureWidth: null,
      commentsHidden: null,
      snapshotSplit: null,
      proseSize: null,
      typewriter: null,
      focus: null,
      smoothCaret: null,
      autosave: null,
      autosaveDelay: null,
      henosis: null,
      henosisAfter: null,
      henosisFade: null,
      henosisPause: null,
    },
    stats: {
      words,
      parts: 1,
      sections: 2,
      countedAt: "",
      perNode: [
        {
          nodeId: "EL2",
          words: Math.floor(words / 2),
          updatedAt: "2026-01-01",
        },
        {
          nodeId: "EL3",
          words: Math.ceil(words / 2),
          updatedAt: "2026-01-02",
        },
      ],
    },
  };
}

/** A plain one-run paragraph, with overrides for the formatting cases. */
function para(text: string, over: Partial<Paragraph> = {}): Paragraph {
  return {
    runs: [{ text, format: { bold: false, italic: false, monospace: false } }],
    alignment: "left",
    blockType: "paragraph",
    ...over,
  };
}

function desk(over: Partial<Parameters<typeof Desk>[0]> = {}) {
  const onOpen = vi.fn();
  render(
    <Desk
      structure={STRUCTURE}
      props={propsWith(1200)}
      resume={{
        fileName: "section--the_storm.EL3.01.md",
        para: para("She counted the lights."),
      }}
      thread={null}
      session={{
        startedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
        words: 0,
      }}
      onOpen={onOpen}
      {...over}
    />,
  );
  return { onOpen };
}

describe("Desk", () => {
  // The band nothing else on this screen comes close to: reading your own last
  // line is how writers resume.
  it("shows the writer’s own last sentence, and where it is", () => {
    desk();
    expect(screen.getByText("She counted the lights.")).toBeTruthy();
    expect(document.querySelector(".desk-eyebrow")?.textContent).toContain(
      "act-one / the-storm",
    );
  });

  // The band quotes the writer's own formatting: a heading the writer ended on
  // comes back as a heading, and the markers that made it never reach the eye.
  it("renders an aligned heading as its formatted self, not as markers", () => {
    desk({
      resume: {
        fileName: "section--the_storm.EL3.01.md",
        para: para("Ormai siamo partiti!", {
          blockType: "h1",
          alignment: "center",
        }),
      },
    });
    const line = document.querySelector(".desk-last-line") as HTMLElement;
    expect(line.getAttribute("data-kind")).toBe("h1");
    expect(line.style.textAlign).toBe("center");
    expect(line.textContent).toContain("Ormai siamo partiti!");
    expect(line.textContent).not.toContain("{align");
    expect(line.textContent).not.toContain("#");
  });

  it("wraps runs in the formatting the writer gave them", () => {
    desk({
      resume: {
        fileName: "section--the_storm.EL3.01.md",
        para: {
          runs: [
            {
              text: "It was ",
              format: { bold: false, italic: false, monospace: false },
            },
            {
              text: "very",
              format: { bold: true, italic: false, monospace: false },
            },
            // All three at once: the band's nesting order must be the
            // renderer's (monospace innermost, then italic, then bold),
            // pinned here in full, because the two spell the order
            // independently and only the renderer's own contract test watches
            // the other copy.
            {
              text: "quiet",
              format: { bold: true, italic: true, monospace: true },
            },
            {
              text: ".",
              format: { bold: false, italic: false, monospace: false },
            },
          ],
          alignment: "left",
          blockType: "paragraph",
        },
      },
    });
    expect(document.querySelector(".desk-last strong")?.textContent).toBe(
      "very",
    );
    // <strong><em><code>quiet</code></em></strong> — the same nest
    // `htmlRenderer` produces for the editor.
    const nested = document.querySelector(".desk-last strong > em > code");
    expect(nested?.textContent).toBe("quiet");
    // The caret stays inline at the end of the line, after the runs.
    expect(document.querySelector(".desk-last-line .desk-caret")).toBeTruthy();
  });

  // The Part is the orientation a writer coming back needs — "where" is
  // "The Crossing", not "the-storm" — but a Section at the root of the project
  // has no Part above it, and its name alone is that orientation then.
  it("names a root-level Section without a part prefix", () => {
    desk({
      structure: {
        version: 1,
        children: [
          {
            kind: "section",
            id: "EL4",
            title: "the-guest",
            adopted: "section--the_guest.EL4.00.md",
            snapshots: [
              {
                file: "section--the_guest.EL4.00.md",
                title: "the-guest",
                created: "2026-01-01",
              },
            ],
          },
        ],
      },
      resume: {
        fileName: "section--the_guest.EL4.00.md",
        para: para("She counted the lights."),
      },
    });
    expect(document.querySelector(".desk-eyebrow")?.textContent).toContain(
      "guest",
    );
    expect(document.querySelector(".desk-eyebrow")?.textContent).not.toContain(
      " / ",
    );
  });

  it("continues into the Section it was reading from", () => {
    const { onOpen } = desk();
    fireEvent.click(screen.getByText(/desk.continue/));
    // Only this button asks to land at the end of the page.
    expect(onOpen).toHaveBeenCalledWith("section--the_storm.EL3.01.md", true);
  });

  it("draws the project’s shape, not a chart of it", () => {
    desk();
    // The goal drawing: one field per Part, one bar per Section. This
    // project is one Part around two Sections, so exactly three rects.
    expect(document.querySelectorAll(".desk .spine-bars rect").length).toBe(3);
  });

  it("keeps the numbers subordinate, in the evidence voice", () => {
    desk();
    const ledger = document.querySelector(".desk-ledger")?.textContent ?? "";
    expect(ledger).toContain("1,200");
    expect(ledger).toContain("desk.words");
  });

  // A total is the same sentence every morning. What a writer coming back
  // needs is what they did last time, so the delta leads and the totals give
  // it scale.
  it("leads with what has changed since the sitting began", () => {
    desk({
      session: {
        startedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
        words: 900,
      },
    });
    const ledger = document.querySelector(".desk-ledger")?.textContent ?? "";
    expect(ledger).toContain("desk.since(");
    expect(ledger).toContain("+300");
    expect(ledger).toContain("desk.total(1,200)");
  });

  // The "since" line is the anchor and always stands; the delta is the news
  // and only prints when there is some. A sitting that has not begun writes
  // "since Wednesday" without pretending a zero is worth report.
  it("keeps the since line, and drops the delta, on a fresh sitting", () => {
    desk({
      session: {
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        words: 1200,
      },
    });
    const ledger = document.querySelector(".desk-ledger")?.textContent ?? "";
    expect(ledger).toContain("desk.since(");
    expect(ledger).not.toContain("desk.words");
    expect(ledger).not.toContain("+0");
  });

  // The ledger names the day and time absolutely — "since Tuesday", "last
  // Tue 21:14" — the way the study reads. A fixed local timestamp (Tuesday,
  // 21:14) has to come out the same in every timezone the suite runs in.
  it("prints the last write as an absolute day and time", () => {
    desk({
      props: {
        ...propsWith(1200),
        stats: {
          ...propsWith(1200).stats,
          countedAt: new Date(2026, 0, 6, 21, 14).toISOString(),
        },
      },
    });
    const ledger = document.querySelector(".desk-ledger")?.textContent ?? "";
    expect(ledger).toContain("desk.lastWrite");
    expect(ledger).toMatch(/Tue 21:14/);
  });

  // Cutting is writing. A morning spent taking four hundred words out was work.
  it("signs a loss rather than reporting nothing", () => {
    desk({ session: { startedAt: new Date().toISOString(), words: 1500 } });
    expect(document.querySelector(".desk-ledger")?.textContent).toContain(
      "−300",
    );
  });

  // The spine fills at the goal; the overrun is a number in the evidence
  // voice, never a rescale of every bar.
  it("says how far past the goal the project has run", () => {
    desk({
      props: {
        ...propsWith(1200),
        document: { ...propsWith(1200).document, goal: 1000 },
      },
    });
    expect(document.querySelector(".desk-ledger")?.textContent).toContain(
      "desk.overGoal(20)",
    );
  });

  it("stays quiet about the goal at or under it", () => {
    desk({
      props: {
        ...propsWith(1200),
        document: { ...propsWith(1200).document, goal: 2000 },
      },
    });
    expect(document.querySelector(".desk-ledger")?.textContent).not.toContain(
      "desk.overGoal(",
    );
  });

  // Resuming is the common case, so this one is quiet — but it is the reason
  // the Desk exists rather than opening the last Section straight away.
  it("offers to look somewhere else, when there is somewhere to look", () => {
    const onBrowse = vi.fn();
    desk({ onBrowse });
    fireEvent.click(screen.getByText("desk.browse"));
    expect(onBrowse).toHaveBeenCalled();
  });

  it("leaves the quiet action out when the panel is already open", () => {
    desk();
    expect(document.querySelector(".desk-quiet")).toBeNull();
  });

  // An absent band is honest; an invented one would be the screen guessing.
  it("says nothing about a thread when the writer left no marker", () => {
    desk({ thread: null });
    expect(document.querySelector(".desk-thread")).toBeNull();
  });

  it("points at a marker left further back", () => {
    desk({
      thread: {
        text: "??? whose boat",
        fromEnd: 3,
        fileName: "section--the_storm.EL3.01.md",
      },
    });
    const text = document.querySelector(".desk-thread")?.textContent ?? "";
    // The whole sentence, named after its Section: "You left a marker in
    // the-storm — ??? whose boat — three paragraphs from the end."
    expect(text).toContain("desk.threadLead");
    expect(text).toContain("the-storm");
    expect(text).toContain("??? whose boat");
    expect(text).toContain("desk.threadPos(3)");
  });

  // The marker sits mid-sentence between em dashes, wherever it is in the file.
  it('says "at the end" when the marker is where they stopped', () => {
    desk({
      thread: {
        text: "??? whose boat",
        fromEnd: 0,
        fileName: "section--the_storm.EL3.01.md",
      },
    });
    const text = document.querySelector(".desk-thread")?.textContent ?? "";
    expect(text).toContain("desk.threadLead");
    expect(text).toContain("desk.threadAtEnd");
    expect(text).not.toContain("desk.threadPos(");
  });

  // A stamp is not required: without one, the band falls back to a bare lead
  // so it never says "a marker in — ???" with nothing between the "in" and
  // the dash.
  it("drops the Section name when the thread has none", () => {
    desk({ resume: null, thread: { text: "??? whose boat", fromEnd: 0 } });
    const text = document.querySelector(".desk-thread")?.textContent ?? "";
    expect(text).toContain("desk.threadLeadPlain");
    expect(text).not.toContain("desk.threadLead(");
  });

  it("leaves out the resume band when there is nothing to resume", () => {
    desk({ resume: null });
    expect(document.querySelector(".desk-last")).toBeNull();
    // The rest of the screen still stands.
    expect(document.querySelector(".desk-ledger")).toBeTruthy();
  });

  // The rows below are a project nobody has written in.

  it("offers to start rather than to resume", () => {
    const { onOpen } = desk({ props: propsWith(0), resume: null });
    expect(document.querySelector(".desk-ledger")).toBeNull();
    expect(document.querySelector(".desk-last")).toBeNull();
    fireEvent.click(screen.getByText(/desk.start/));
    expect(onOpen).toHaveBeenCalledWith("section--opening.EL2.00.md");
  });

  it("starts at the first Section in reading order, not the first node", () => {
    desk({ props: propsWith(0), resume: null });
    expect(screen.getByText(/desk.start\(opening\)/)).toBeTruthy();
  });

  it("invites the first words with the empty state's body", () => {
    desk({ props: propsWith(0), resume: null });
    expect(document.querySelector(".desk-empty")?.textContent).toContain(
      "desk.emptyBody",
    );
  });

  // A fresh project's shapes are Parts holding nothing, so the empty screen's
  // button must land on the first Part — the page a writer can start on.
  it("starts on the first Part when the shape holds no Sections", () => {
    const { onOpen } = desk({
      props: emptyProps(2, 0),
      structure: PARTS_ONLY,
      resume: null,
    });
    expect(screen.getByText(/desk.start\(Ki\)/)).toBeTruthy();
    fireEvent.click(screen.getByText(/desk.start/));
    expect(onOpen).toHaveBeenCalledWith("part--ki.EL1.00.md");
  });

  // The zero noun is omitted by the branch, never pluralized: a parts-only
  // project must not read "2 parts and 0 sections".
  it("omits the zero noun on a parts-only project", () => {
    desk({ props: emptyProps(2, 0), structure: PARTS_ONLY, resume: null });
    const body = document.querySelector(".desk-empty")?.textContent ?? "";
    expect(body).toContain("desk.emptyBodyParts");
    expect(body).not.toContain("desk.countSections");
  });

  it("says only the invite when the project has no nodes at all", () => {
    desk({ props: emptyProps(0, 0), structure: EMPTY_STRUCT, resume: null });
    const body = document.querySelector(".desk-empty")?.textContent ?? "";
    // With no nodes and no build button on a desk, the invite must name the
    // structure panel — "write the first line" points at a page that does not
    // exist and the panel is the only route.
    expect(body).toContain("desk.emptyInviteNoNodes");
    expect(body).not.toContain("desk.emptyBody");
    expect(body).not.toContain("desk.countParts");
  });

  it("keeps the first-line invite once there is a page for it", () => {
    desk({ props: emptyProps(2, 0), structure: PARTS_ONLY, resume: null });
    const body = document.querySelector(".desk-empty")?.textContent ?? "";
    expect(body).toContain("desk.emptyInvite");
    expect(body).not.toContain("desk.emptyInviteNoNodes");
  });

  // A project with no nodes has no page to open, so the button leads
  // to the structure — where the add labels live. It exists only when those
  // labels are hidden (`onBrowse`), never when the panel is already open.
  it("leads to the structure when a node-less project cannot start", () => {
    const onBrowse = vi.fn();
    const { onOpen } = desk({
      props: emptyProps(0, 0),
      structure: EMPTY_STRUCT,
      resume: null,
      onBrowse,
    });
    fireEvent.click(screen.getByText("desk.buildStructure"));
    expect(onBrowse).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows no button when the structure panel is already open", () => {
    desk({ props: emptyProps(0, 0), structure: EMPTY_STRUCT, resume: null });
    expect(screen.queryByText("desk.buildStructure")).toBeNull();
  });

  // A populated project whose sources hold no words gets a quiet lead and the
  // start button instead of a quote — never a desk with no way in.
  it("offers a place to start when nothing can be resumed", () => {
    const { onOpen } = desk({ resume: null });
    expect(screen.getByText("desk.noPlaceToReturn")).toBeTruthy();
    fireEvent.click(screen.getByText(/desk.start/));
    expect(onOpen).toHaveBeenCalledWith("section--opening.EL2.00.md");
  });

  // A theme that sets the shape as a contents page draws it as rules, one
  // column per Part, the writer's own Part marked; the place they left off
  // stands apart from the eyebrow's words, for the theme to set.
  it("draws the shape as rules where the theme asks", () => {
    desk({ spineStyle: "rules" });
    expect(document.querySelector(".spine")).toBeNull();
    const rules = screen.getByRole("img");
    expect(rules.className).toBe("spine-rules");
    expect(rules.querySelectorAll(".sr-part").length).toBeGreaterThan(0);
    expect(rules.querySelector('[data-current="1"]')).toBeTruthy();
    expect(document.querySelector(".desk-where")?.textContent).toBeTruthy();
  });

  it("draws the spine's glyph by default", () => {
    desk();
    expect(document.querySelector(".spine")).toBeTruthy();
    expect(document.querySelector(".spine-rules")).toBeNull();
  });
});
