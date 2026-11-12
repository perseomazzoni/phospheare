// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { SourceDescriptor } from "../../ai";
import type { DocumentStructure } from "../../project/types";
import { commonmarkCodec } from "../engine";
import {
  evidenceOrdinal,
  evidencePassage,
  marksFor,
  type EvidenceContext,
  type SearchArrival,
} from "../searchArrival";
import { createEvidenceOpener } from "./evidenceOpener";

const stamp = "2026-01-01T00:00:00.000Z";

const structure: DocumentStructure = {
  version: 1,
  children: [
    {
      kind: "part",
      id: "P1",
      title: "Part one",
      adopted: "part--one.EL1.00.md",
      snapshots: [
        { file: "part--one.EL1.00.md", title: "Part one", created: stamp },
      ],
      children: [
        {
          kind: "section",
          id: "S1",
          title: "Opening",
          adopted: "section--opening.EL2.00.md",
          snapshots: [
            {
              file: "section--opening.EL2.00.md",
              title: "Opening",
              created: stamp,
            },
          ],
        },
      ],
    },
  ],
};

const sources: SourceDescriptor[] = [
  {
    id: "node:S1",
    kind: "manuscript",
    title: "Opening",
    path: "/document/section--opening.EL2.00.md",
    nodeId: "S1",
    nodeKind: "section",
    authority: "manuscript",
  },
  {
    id: "reference:character--maren.md",
    kind: "reference",
    title: "Maren",
    path: "/reference/character--maren.md",
    authority: "reference",
  },
];

const closedBar = {
  open: false,
  query: null,
  currentIndex: 0,
  caseSensitive: false,
  wholeWord: false,
  hyphensJoinWords: false,
};

function opener(
  passage: (quote: string) => string | null = (q) => q,
  watch: () => () => boolean = () => () => true,
  ordinal: (passage: string, context: EvidenceContext) => number = () => 0,
  buffer: { activeFile?: string | null; unsaved?: boolean } = {},
) {
  let arrival: SearchArrival | null = null;
  const openFile = vi.fn().mockResolvedValue(undefined);
  const openDocument = vi.fn();
  const evidence = createEvidenceOpener({
    list: async () => sources,
    structure: () => structure,
    activeFile: () => buffer.activeFile ?? null,
    unsaved: () => buffer.unsaved ?? false,
    openFile,
    passage,
    ordinal,
    targets: () => ({
      arrive: (file, query) => {
        arrival = { kind: "evidence", file, query };
      },
      openDocument,
    }),
    watch,
  });
  return { evidence, openFile, openDocument, arrival: () => arrival };
}

describe("the evidence opener", () => {
  // The arrival names the bare adopted file name, which the surface compares
  // against; a `document/<file>` arrival opens the file and marks nothing.
  // Asserted through `marksFor`, the one function that decides
  // what paints, so a spelling that cannot mark fails here.
  it("arrives in the open file under the name the surface marks by", async () => {
    const { evidence, openFile, arrival } = opener();
    const outcome = await evidence.reveal({
      sourceId: "node:S1",
      quote: "An elephant mourns its dead.",
    });
    expect(outcome).toBe("selected");
    expect(openFile).toHaveBeenCalledWith("section--opening.EL2.00.md");
    const marks = marksFor(closedBar, arrival(), "section--opening.EL2.00.md");
    expect(marks.query).toBe("An elephant mourns its dead.");
    expect(marks.mark).toBe("evidence");
  });

  // The whole quote or nothing: a fragment is a search hit, not a citation.
  it("arrives with the whole passage as the open document shows it", async () => {
    const { evidence, arrival } = opener(() => "An elephant never forgets.");
    await evidence.reveal({
      sourceId: "node:S1",
      quote: "An elephant *never* forgets.",
    });
    expect(arrival()?.query).toBe("An elephant never forgets.");
  });

  it("opens the Section but marks nothing when the passage cannot be shown", async () => {
    const { evidence, openFile, arrival } = opener(() => null);
    expect(
      await evidence.reveal({ sourceId: "node:S1", quote: "across\n\nparas" }),
    ).toBe("unavailable");
    expect(openFile).toHaveBeenCalledWith("section--opening.EL2.00.md");
    expect(arrival()).toBeNull();
  });

  it("opens a manuscript source without arriving anywhere when no quote is given", async () => {
    const { evidence, openFile, arrival } = opener();
    expect(await evidence.open("node:S1")).toBe("selected");
    expect(openFile).toHaveBeenCalledWith("section--opening.EL2.00.md");
    expect(arrival()).toBeNull();
  });

  it("opens a reference source on its own face", async () => {
    const { evidence, openDocument } = opener();
    expect(await evidence.open("reference:character--maren.md")).toBe(
      "selected",
    );
    expect(openDocument).toHaveBeenCalledWith("character--maren.md");
  });

  it("opens nothing for an id the live catalogue does not name", async () => {
    const { evidence, openFile, openDocument } = opener();
    expect(
      await evidence.reveal({ sourceId: "node:GONE", quote: "anything" }),
    ).toBe("unavailable");
    expect(openFile).not.toHaveBeenCalled();
    expect(openDocument).not.toHaveBeenCalled();
  });

  // A `/where` answer lands by itself only while the writer has neither
  // edited nor switched file since asking. The opener checks after its
  // own await and before it opens anything, because opening the Section is
  // the opener's own switch and must not count against the writer.
  it("withholds a landing the writer's own moves have overtaken", async () => {
    const { evidence, openFile, arrival } = opener();
    expect(
      await evidence.reveal(
        { sourceId: "node:S1", quote: "An elephant mourns its dead." },
        { onlyIf: () => false },
      ),
    ).toBe("withheld");
    expect(openFile).not.toHaveBeenCalled();
    expect(arrival()).toBeNull();
  });

  it("asks the predicate once, before the Section opens", async () => {
    const asked: string[] = [];
    const { evidence, openFile } = opener();
    openFile.mockImplementation(async () => {
      asked.push("open");
    });
    expect(
      await evidence.reveal(
        { sourceId: "node:S1", quote: "An elephant mourns its dead." },
        {
          onlyIf: () => {
            asked.push("check");
            return true;
          },
        },
      ),
    ).toBe("selected");
    expect(asked).toEqual(["check", "open"]);
  });

  // Opening another Section over unsaved prose asks the writer first, and the
  // open returns before they answer, with the old document still in the
  // engine. Nothing lands under the question.
  it("lands nothing when the Section cannot open over unsaved prose", async () => {
    const { evidence, openFile, arrival } = opener(
      undefined,
      undefined,
      undefined,
      {
        activeFile: "section--elsewhere.md",
        unsaved: true,
      },
    );
    expect(
      await evidence.reveal({
        sourceId: "node:S1",
        quote: "An elephant mourns its dead.",
      }),
    ).toBe("held");
    // A click is the writer going there, so they are asked.
    expect(openFile).toHaveBeenCalledWith("section--opening.EL2.00.md");
    expect(arrival()).toBeNull();
  });

  // A landing nobody clicked for never puts the discard question in front of
  // the writer: the prose they have not saved stays where it is.
  it("never asks to discard for a landing nobody clicked for", async () => {
    const { evidence, openFile, arrival } = opener(
      undefined,
      undefined,
      undefined,
      {
        activeFile: "section--elsewhere.md",
        unsaved: true,
      },
    );
    expect(
      await evidence.reveal(
        { sourceId: "node:S1", quote: "An elephant mourns its dead." },
        { onlyIf: () => true },
      ),
    ).toBe("unavailable");
    expect(openFile).not.toHaveBeenCalled();
    expect(arrival()).toBeNull();
  });

  it("lands in the open Section whether or not its prose is saved", async () => {
    const { evidence, arrival } = opener(undefined, undefined, undefined, {
      activeFile: "section--opening.EL2.00.md",
      unsaved: true,
    });
    expect(
      await evidence.reveal(
        { sourceId: "node:S1", quote: "An elephant mourns its dead." },
        { onlyIf: () => true },
      ),
    ).toBe("selected");
    expect(arrival()?.query).toBe("An elephant mourns its dead.");
  });

  it("hands the ordinal the anchor's own context, and a finding's click too", async () => {
    const asked: EvidenceContext[] = [];
    const { evidence } = opener(undefined, undefined, (_passage, context) => {
      asked.push(context);
      return 0;
    });
    await evidence.reveal({
      sourceId: "node:S1",
      quote: "No.",
      prefix: "She ran to the door. ",
      suffix: " The end.",
    });
    await evidence.reveal({ sourceId: "node:S1", quote: "No." });
    expect(asked).toEqual([
      { prefix: "She ran to the door. ", suffix: " The end." },
      { prefix: undefined, suffix: undefined },
    ]);
  });

  it("forwards the host's watch untouched", () => {
    const watch = () => () => true;
    expect(opener(undefined, watch).evidence.watch).toBe(watch);
  });

  it("hands focus back after a landing nobody clicked for", async () => {
    // The composer the writer asked from keeps the caret; the prose takes it
    // as the Section opens, and gives it back a frame later.
    const composer = document.createElement("textarea");
    const prose = document.createElement("div");
    prose.tabIndex = 0;
    document.body.append(composer, prose);
    composer.focus();
    const { evidence, openFile } = opener();
    openFile.mockImplementation(async () => prose.focus());
    await evidence.reveal(
      { sourceId: "node:S1", quote: "An elephant mourns its dead." },
      { onlyIf: () => true },
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(composer);

    // A click is the writer going there: the prose keeps it.
    await evidence.reveal({
      sourceId: "node:S1",
      quote: "An elephant mourns its dead.",
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(prose);
    composer.remove();
    prose.remove();
  });

  // A quote that repeats in its Section keeps its prefix and suffix so the
  // landing can tell the occurrences apart (`locateInBook`'s `kept`). The
  // opener passes that context through to the ordinal; a bare passage arrives
  // at occurrence 0, and the evidence mark (`highlights.ts`) paints the
  // wrong one.
  it("lands on the occurrence the anchor's context names, not the first", async () => {
    const doc = commonmarkCodec.parse(
      "No.\n\nShe ran to the door. No.\n\nThe end.",
    );
    const arrived: unknown[][] = [];
    const evidence = createEvidenceOpener({
      list: async () => sources,
      structure: () => structure,
      activeFile: () => null,
      unsaved: () => false,
      openFile: async () => undefined,
      passage: (quote) => evidencePassage(doc, quote),
      ordinal: (passage, context) => evidenceOrdinal(doc, passage, context),
      targets: () => ({
        arrive: (...args: unknown[]) => {
          arrived.push(args);
        },
        openDocument: vi.fn(),
      }),
      watch: () => () => true,
    });
    expect(
      await evidence.reveal({
        sourceId: "node:S1",
        quote: "No.",
        prefix: "She ran to the door. ",
      }),
    ).toBe("selected");
    // The surface learns which "No.": the second of two. The fact pinned is
    // the ordinal, not the argument's shape.
    expect(arrived).toEqual([["section--opening.EL2.00.md", "No.", 1]]);
  });

  // The hand-back runs on the unmarked path too. A `/where` landing whose
  // quote cannot be shown as one passage has already opened the Section,
  // which focuses the prose, so without it the writer's next key lands in the
  // manuscript.
  it("hands focus back after an automatic landing that could not mark", async () => {
    const composer = document.createElement("textarea");
    const prose = document.createElement("div");
    prose.tabIndex = 0;
    document.body.append(composer, prose);
    composer.focus();
    const { evidence, openFile } = opener(() => null);
    openFile.mockImplementation(async () => prose.focus());
    expect(
      await evidence.reveal(
        { sourceId: "node:S1", quote: "*She ran" },
        { onlyIf: () => true },
      ),
    ).toBe("unavailable");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(composer);
    composer.remove();
    prose.remove();
  });
});
