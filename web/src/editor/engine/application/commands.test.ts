// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { Doc, Selection } from "../domain/model";
import { validateSession } from "../domain/invariants";
import {
  createCommandBus,
  validationInterceptor,
  type Command,
  type CommandContext,
} from "./commands";
import {
  insertTextCommand,
  deleteBackwardCommand,
  insertParagraphCommand,
  toggleFormatCommand,
  undoCommand,
  openCommand,
} from "./editorCommands";

// Pins the command bus: every command runs against the context the bus was
// built with, a null outcome is a no-op that skips interceptors, and the
// validation interceptor rejects outcomes that violate the session
// invariants. The editor commands themselves are covered through the session
// in `session.test.ts`; here they exercise the bus.

const PLAIN = { bold: false, italic: false, monospace: false };

function ctx(doc: Doc): CommandContext {
  return {
    doc,
    selection: {
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 0 },
    },
    codec: {
      parse: (md: string) => [
        {
          runs: md ? [{ text: md, format: PLAIN }] : [],
          alignment: "left",
          blockType: "paragraph",
        },
      ],
      serialize: () => "",
    },
    history: {
      push: () => {},
      undo: () => null,
      redo: () => null,
      peekBack: () => null,
      peekTimestamp: () => null,
      nextUndoLabel: () => null,
      nextRedoLabel: () => null,
      undoDepth: () => 0,
      redoDepth: () => 0,
      hasParkedSiblings: false,
      canUndo: false,
      canRedo: false,
      clear: () => {},
      exportJournal: () => null,
      importJournal: () => null,
    },
    search: {
      findMatches: () => [],
      searchDoc: () => [],
      buildRegex: () => null,
      findTextOccurrences: () => [],
    },
    clipboard: {
      buildPlain: () => "",
      buildHtml: () => "",
      parsePlain: () => [
        { runs: [], alignment: "left", blockType: "paragraph" },
      ],
      parseHtml: () => [
        { runs: [], alignment: "left", blockType: "paragraph" },
      ],
    },
  };
}

describe("command bus", () => {
  it("executes a command and returns its outcome", () => {
    const bus = createCommandBus(() =>
      ctx([{ runs: [], alignment: "left", blockType: "paragraph" }]),
    );
    const outcome = bus.execute(insertTextCommand("a", PLAIN));
    expect(outcome).not.toBeNull();
    if (outcome === null) throw new Error("execute returned null");
    expect(outcome.doc[0].runs[0].text).toBe("a");
  });

  it("returns null for a no-op command and skips interceptors", () => {
    const doc: Doc = [{ runs: [], alignment: "left", blockType: "paragraph" }];
    const bus = createCommandBus(() => ctx(doc));
    let interceptorCalls = 0;
    bus.addInterceptor(() => {
      interceptorCalls++;
    });
    const outcome = bus.execute(deleteBackwardCommand());
    expect(outcome).toBeNull();
    expect(interceptorCalls).toBe(0);
  });

  it("passes the current context to every command", () => {
    let docRef: Doc = [{ runs: [], alignment: "left", blockType: "paragraph" }];
    const bus = createCommandBus(() => ctx(docRef));
    const outcome = bus.execute(insertParagraphCommand());
    if (outcome === null) throw new Error("execute returned null");
    expect(outcome.doc.length).toBe(2);
    docRef = [
      {
        runs: [{ text: "x", format: PLAIN }],
        alignment: "left",
        blockType: "paragraph",
      },
    ];
    const outcome2 = bus.execute(insertParagraphCommand());
    if (outcome2 === null) throw new Error("execute returned null");
    expect(outcome2.doc).toHaveLength(2);
    expect(outcome2.doc[0].runs[0].text).toBe("");
    expect(outcome2.doc[1].runs[0].text).toBe("x");
  });

  it("addInterceptor returns a removal function", () => {
    const bus = createCommandBus(() =>
      ctx([{ runs: [], alignment: "left", blockType: "paragraph" }]),
    );
    let calls = 0;
    const remove = bus.addInterceptor(() => {
      calls++;
    });
    bus.execute(insertTextCommand("a", PLAIN));
    remove();
    bus.execute(insertTextCommand("b", PLAIN));
    expect(calls).toBe(1);
  });

  it("interceptors receive the context and the outcome", () => {
    const bus = createCommandBus(() =>
      ctx([{ runs: [], alignment: "left", blockType: "paragraph" }]),
    );
    const seen: { value: { ctxDoc: Doc; outDoc: Doc } | null } = {
      value: null,
    };
    bus.addInterceptor((ctx, outcome) => {
      seen.value = { ctxDoc: ctx.doc, outDoc: outcome.doc };
    });
    bus.execute(insertTextCommand("a", PLAIN));
    expect(seen.value).not.toBeNull();
    if (seen.value === null) throw new Error("interceptor never ran");
    expect(seen.value.ctxDoc).not.toBe(seen.value.outDoc);
    expect(seen.value.ctxDoc[0].runs).toHaveLength(0);
    expect(seen.value.outDoc[0].runs[0].text).toBe("a");
  });
});

describe("validation interceptor", () => {
  it("passes outcomes that satisfy the session invariants", () => {
    const bus = createCommandBus(() =>
      ctx([{ runs: [], alignment: "left", blockType: "paragraph" }]),
    );
    bus.addInterceptor(validationInterceptor());
    expect(() => bus.execute(insertTextCommand("a", PLAIN))).not.toThrow();
    expect(() => bus.execute(toggleFormatCommand("bold"))).not.toThrow();
  });

  it("throws on a command whose outcome violates the invariants", () => {
    const invalid: Command = {
      type: "emptyDoc",
      run: () => ({
        doc: [],
        selection: {
          anchor: { para: 0, offset: 0 },
          focus: { para: 0, offset: 0 },
        },
      }),
    };
    const bus = createCommandBus(() =>
      ctx([{ runs: [], alignment: "left", blockType: "paragraph" }]),
    );
    bus.addInterceptor(validationInterceptor());
    expect(() => bus.execute(invalid)).toThrow("invalid session state");
  });

  it("does not disturb commands whose outcome is valid", () => {
    const outcome = insertTextCommand("hi", PLAIN).run(
      ctx([{ runs: [], alignment: "left", blockType: "paragraph" }]),
    );
    if (outcome === null)
      throw new Error("insertTextCommand.run returned null");
    const selection: Selection = {
      anchor: { para: 0, offset: 2 },
      focus: { para: 0, offset: 2 },
    };
    expect(validateSession(outcome.doc, selection)).toBe(true);
    expect(() =>
      validationInterceptor()(ctx(outcome.doc), {
        doc: outcome.doc,
        selection,
      }),
    ).not.toThrow();
  });

  it("is a no-op when validation is disabled (production path)", () => {
    const interceptor = validationInterceptor(false);
    const invalid: Command = {
      type: "emptyDoc",
      run: () => ({
        doc: [],
        selection: {
          anchor: { para: 0, offset: 0 },
          focus: { para: 0, offset: 0 },
        },
      }),
    };
    const bus = createCommandBus(() =>
      ctx([{ runs: [], alignment: "left", blockType: "paragraph" }]),
    );
    bus.addInterceptor(interceptor);
    expect(() => bus.execute(invalid)).not.toThrow();
  });
});

describe("editor commands through the bus", () => {
  it("undo and open stay no-ops when history returns nothing", () => {
    const bus = createCommandBus(() =>
      ctx([{ runs: [], alignment: "left", blockType: "paragraph" }]),
    );
    expect(bus.execute(undoCommand())).toBeNull();
    expect(bus.execute(openCommand(""))).not.toBeNull();
  });
});
