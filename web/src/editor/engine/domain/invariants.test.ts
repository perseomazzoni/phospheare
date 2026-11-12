// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  paraTextLength,
  validateDoc,
  isValidDoc,
  validateSelection,
  isValidSelection,
  validateSession,
} from "../index";
import type { Cursor, Doc, Paragraph, Run, Selection } from "../index";
import {
  insertText,
  insertParagraph,
  insertPageBreak,
  toggleFormat,
  toggleCase,
  clearFormatOnSelection,
  setAlignment,
  deleteBackward,
  deleteForward,
  replaceMatches,
} from "../index";

// The invariant checker is the engine's oracle: every rule in `model.ts` is a
// predicate here. The bad documents are built with `as unknown` casts because
// the model's types forbid them; the checks exist for a plugin or a corrupted
// adapter that hands the engine something the compiler could not see.

const PLAIN = { bold: false, italic: false, monospace: false };

function para(
  runs: Run[],
  blockType: Paragraph["blockType"] = "paragraph",
  alignment: Paragraph["alignment"] = "left",
): Paragraph {
  return { runs, blockType, alignment };
}

const kinds = (violations: readonly { kind: string }[]) =>
  violations.map((v) => v.kind);

describe("validateDoc", () => {
  it("accepts an engine-produced document", () => {
    const doc: Doc = [
      para([{ text: "hello", format: PLAIN }]),
      para(
        [
          {
            text: "title",
            format: { bold: true, italic: false, monospace: false },
          },
        ],
        "h1",
        "center",
      ),
      para([], "pagebreak"),
      para([{ text: "", format: PLAIN }]),
    ];
    expect(validateDoc(doc)).toEqual([]);
    expect(isValidDoc(doc)).toBe(true);
  });

  it("rejects the empty document", () => {
    expect(kinds(validateDoc([]))).toEqual(["empty-doc"]);
    expect(isValidDoc([])).toBe(false);
  });

  it("rejects an unknown blockType", () => {
    const doc = [
      para([{ text: "x", format: PLAIN }], "table" as Paragraph["blockType"]),
    ];
    const violations = validateDoc(doc);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      kind: "bad-block-type",
      para: 0,
      blockType: "table",
    });
  });

  it("rejects an unknown alignment", () => {
    const doc = [
      para(
        [{ text: "x", format: PLAIN }],
        "paragraph",
        "flush" as Paragraph["alignment"],
      ),
    ];
    const violations = validateDoc(doc);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      kind: "bad-alignment",
      para: 0,
      alignment: "flush",
    });
  });

  it("rejects a page break that carries runs", () => {
    const doc = [para([{ text: "x", format: PLAIN }], "pagebreak")];
    expect(kinds(validateDoc(doc))).toEqual(["pagebreak-with-runs"]);
  });

  it("rejects a text block with no runs", () => {
    const doc = [para([], "paragraph")];
    expect(kinds(validateDoc(doc))).toEqual(["empty-runs"]);
  });

  it("rejects a paragraph whose runs are not an array", () => {
    const doc = [para(null as unknown as Run[])];
    expect(kinds(validateDoc(doc))).toEqual(["empty-runs"]);
  });

  it("rejects a run whose text is not a string", () => {
    const doc = [para([{ text: 42 as unknown as string, format: PLAIN }])];
    expect(kinds(validateDoc(doc))).toEqual(["bad-run-text"]);
  });

  it("rejects a run whose format is missing a property", () => {
    const doc = [
      para([{ text: "x", format: { bold: true } as unknown as Run["format"] }]),
    ];
    expect(kinds(validateDoc(doc))).toEqual(["bad-run-format"]);
  });

  it("rejects a run whose format is not a boolean", () => {
    const doc = [
      para([
        {
          text: "x",
          format: {
            bold: "yes",
            italic: false,
            monospace: false,
          } as unknown as Run["format"],
        },
      ]),
    ];
    expect(kinds(validateDoc(doc))).toEqual(["bad-run-format"]);
  });

  it("rejects a run whose format is null", () => {
    const doc = [
      para([{ text: "x", format: null as unknown as Run["format"] }]),
    ];
    expect(kinds(validateDoc(doc))).toEqual(["bad-run-format"]);
  });

  it("collects a violation for every paragraph, in order", () => {
    const doc: Doc = [
      para([{ text: "x", format: PLAIN }], "nope" as Paragraph["blockType"]),
      para([{ text: "y", format: PLAIN }], "pagebreak"),
    ];
    const violations = validateDoc(doc);
    expect(
      violations.map((v) => (v.kind === "empty-doc" ? -1 : v.para)),
    ).toEqual([0, 1]);
  });
});

describe("paraTextLength", () => {
  it("counts visible text across runs", () => {
    const doc: Doc = [
      para([
        { text: "ab", format: PLAIN },
        { text: "cde", format: PLAIN },
      ]),
    ];
    expect(paraTextLength(doc[0])).toBe(5);
  });

  it("is zero for an empty and a page-break paragraph", () => {
    expect(paraTextLength(para([]))).toBe(0);
    expect(paraTextLength(para([], "pagebreak"))).toBe(0);
  });
});

describe("validateSelection", () => {
  const doc: Doc = [
    para([{ text: "hello", format: PLAIN }]),
    para([{ text: "world", format: PLAIN }], "h2"),
  ];
  const sel = (
    anchor: { para: number; offset: number },
    focus: { para: number; offset: number },
  ): Selection => ({
    anchor: { para: anchor.para, offset: anchor.offset },
    focus: { para: focus.para, offset: focus.offset },
  });

  it("accepts in-bounds selections, including the end of a paragraph", () => {
    expect(
      validateSelection(
        doc,
        sel({ para: 0, offset: 5 }, { para: 0, offset: 5 }),
      ),
    ).toEqual([]);
    expect(
      validateSelection(
        doc,
        sel({ para: 1, offset: 0 }, { para: 1, offset: 5 }),
      ),
    ).toEqual([]);
    expect(
      isValidSelection(
        doc,
        sel({ para: 1, offset: 0 }, { para: 1, offset: 5 }),
      ),
    ).toBe(true);
  });

  it("rejects a paragraph out of range", () => {
    const violations = validateSelection(
      doc,
      sel({ para: 2, offset: 0 }, { para: 0, offset: 0 }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: "para-out-of-range", para: 2 });
  });

  it("rejects a negative paragraph", () => {
    const violations = validateSelection(
      doc,
      sel({ para: -1, offset: 0 }, { para: 0, offset: 0 }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      kind: "para-out-of-range",
      para: -1,
    });
  });

  it("rejects an offset past the end of the paragraph", () => {
    const violations = validateSelection(
      doc,
      sel({ para: 0, offset: 6 }, { para: 0, offset: 6 }),
    );
    expect(violations).toHaveLength(2); // the cursor appears once per endpoint
    expect(violations[0]).toMatchObject({
      kind: "offset-out-of-range",
      para: 0,
      offset: 6,
    });
  });

  it("rejects a negative offset", () => {
    expect(
      kinds(
        validateSelection(
          doc,
          sel({ para: 0, offset: -1 }, { para: 0, offset: -1 }),
        ),
      ),
    ).toEqual(["offset-out-of-range", "offset-out-of-range"]);
  });
});

describe("validateSession", () => {
  it("accepts a valid doc and selection", () => {
    const doc: Doc = [para([{ text: "x", format: PLAIN }])];
    const selection: Selection = {
      anchor: { para: 0, offset: 1 },
      focus: { para: 0, offset: 1 },
    };
    expect(validateSession(doc, selection)).toBe(true);
  });

  it("fails when either half is invalid", () => {
    const good: Doc = [para([{ text: "x", format: PLAIN }])];
    const goodSel: Selection = {
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 0 },
    };
    expect(validateSession([], goodSel)).toBe(false);
    expect(
      validateSession(good, {
        anchor: { para: 0, offset: 9 },
        focus: { para: 0, offset: 9 },
      }),
    ).toBe(false);
  });
});

describe("operation-produced state always validates", () => {
  // The engine composes nothing but these operations, so checking the
  // domain's mutation surface checks every document the engine can hold.
  it("holds across a scripted editing sequence", () => {
    const empty = (): Paragraph => ({
      runs: [{ text: "", format: PLAIN }],
      alignment: "left",
      blockType: "paragraph",
    });
    let doc: Doc = [empty()];
    let sel: Selection = {
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 0 },
    };
    const step = (result: { doc: Doc; cursor: Cursor }) => {
      doc = result.doc;
      sel = { anchor: result.cursor, focus: result.cursor };
      expect(validateSession(doc, sel)).toBe(true);
    };

    step(insertText(doc, sel, "hello world", PLAIN));
    step(insertParagraph(doc, sel));
    step(insertText(doc, sel, "bold", PLAIN));
    step({ doc: toggleFormat(doc, sel, "bold"), cursor: sel.anchor });
    step({ doc: setAlignment(doc, 0, "center"), cursor: sel.anchor });
    step(insertPageBreak(doc, sel));
    step(deleteBackward(doc, sel));
    step(deleteForward(doc, sel));
    step(
      replaceMatches(
        doc,
        [{ para: 1, startOffset: 0, endPara: 1, endOffset: 4 }],
        "x",
        false,
      ),
    );
  });

  it("forward delete before a character outside the BMP removes both code units", () => {
    const doc: Doc = [para([{ text: "a😀b", format: PLAIN }])];
    const at: Selection = {
      anchor: { para: 0, offset: 1 },
      focus: { para: 0, offset: 1 },
    };
    const result = deleteForward(doc, at);
    expect(result.doc[0].runs.map((r) => r.text).join("")).toBe("ab");
    expect(result.cursor).toEqual({ para: 0, offset: 1 });
  });

  it("leaves a selected page break without runs when formatting", () => {
    const pagebreak: Paragraph = {
      runs: [],
      alignment: "left",
      blockType: "pagebreak",
    };
    const doc: Doc = [
      para([{ text: "ab", format: PLAIN }]),
      pagebreak,
      para([{ text: "cd", format: PLAIN }]),
    ];
    const sel: Selection = {
      anchor: { para: 0, offset: 0 },
      focus: { para: 2, offset: 2 },
    };
    for (const next of [
      toggleFormat(doc, sel, "bold"),
      toggleCase(doc, sel),
      clearFormatOnSelection(doc, sel, "italic"),
    ]) {
      expect(validateDoc(next)).toEqual([]);
      expect(next[1]).toBe(pagebreak);
    }
  });
});
