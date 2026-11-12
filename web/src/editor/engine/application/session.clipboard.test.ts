// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { Session, type SessionDeps, type SessionEvents } from "./session";
import { SnapshotHistory } from "../adapters/snapshot";
import { regexSearch } from "../adapters/regex";
import { commonmarkCodec } from "../adapters/commonmark";
import { browserClipboardCodec } from "../adapters/browserHtml";
import { Emitter } from "../adapters/emitter";
import type { EventBus } from "../ports/events";
import {
  MAX_PASTE_CHARS,
  MAX_PASTE_HTML_CHARS,
  MAX_PASTE_PARAGRAPHS,
} from "../domain/limits";

// Cut/copy/paste/select-all, pinned at the session boundary: history grouping,
// notifications and the dirty flag behave the way the views depend on.

const deps = (over: Partial<SessionDeps> = {}): SessionDeps => ({
  codec: over.codec ?? commonmarkCodec,
  history: over.history ?? new SnapshotHistory(),
  search: over.search ?? regexSearch,
  events: over.events ?? new Emitter<SessionEvents>(),
  clipboard: over.clipboard ?? browserClipboardCodec,
});

function spyEvents(): { bus: EventBus<SessionEvents>; reasons: string[] } {
  const bus = new Emitter<SessionEvents>();
  const reasons: string[] = [];
  bus.on("doc", () => reasons.push("doc"));
  bus.on("selection", () => reasons.push("selection"));
  bus.on("saved", () => reasons.push("saved"));
  return { bus, reasons };
}

const select = (
  session: Session,
  anchor: [number, number],
  focus: [number, number],
) =>
  session.updateSelection({
    anchor: { para: anchor[0], offset: anchor[1] },
    focus: { para: focus[0], offset: focus[1] },
  });

describe("copy", () => {
  it("returns both flavors without changing the document", () => {
    const session = new Session(deps());
    session.open("hello **world**");
    select(session, [0, 6], [0, 11]);
    const payload = session.copy();
    expect(payload?.plain).toBe("world");
    expect(payload?.html).toContain("<strong>world</strong>");
    expect(session.commonmark).toBe("hello **world**");
    expect(session.hasChanges).toBe(false);
    expect(session.canUndo).toBe(false);
  });

  it("returns null on a collapsed selection", () => {
    const session = new Session(deps());
    session.open("hello world");
    expect(session.copy()).toBeNull();
  });

  it("notifies nothing", () => {
    const { bus, reasons } = spyEvents();
    const session = new Session(deps({ events: bus }));
    session.open("hello world");
    select(session, [0, 0], [0, 5]);
    reasons.length = 0;
    session.copy();
    expect(reasons).toEqual([]);
  });
});

describe("cut", () => {
  it("removes the selection and returns its payload", () => {
    const session = new Session(deps());
    session.open("one two three");
    select(session, [0, 4], [0, 7]);
    const payload = session.cut();
    expect(payload?.plain).toBe("two");
    expect(session.commonmark).toBe("one  three");
    expect(session.hasChanges).toBe(true);
  });

  it("is one undo step", () => {
    const session = new Session(deps());
    session.open("one two three");
    select(session, [0, 4], [0, 7]);
    session.cut();
    session.undo();
    expect(session.commonmark).toBe("one two three");
    expect(session.canRedo).toBe(true);
  });

  it("is a no-op on a collapsed selection", () => {
    const { bus, reasons } = spyEvents();
    const session = new Session(deps({ events: bus }));
    session.open("hello");
    reasons.length = 0;
    expect(session.cut()).toBeNull();
    expect(session.canUndo).toBe(false);
    expect(reasons).toEqual([]);
  });

  it("emits doc", () => {
    const { bus, reasons } = spyEvents();
    const session = new Session(deps({ events: bus }));
    session.open("hello world");
    select(session, [0, 0], [0, 5]);
    reasons.length = 0;
    session.cut();
    expect(reasons).toEqual(["doc"]);
  });
});

describe("paste", () => {
  it("inserts plain text at a collapsed caret", () => {
    const session = new Session(deps());
    session.open("ab");
    select(session, [0, 1], [0, 1]);
    session.paste("", "X");
    expect(session.commonmark).toBe("aXb");
  });

  it("replaces a selection", () => {
    const session = new Session(deps());
    session.open("one two three");
    select(session, [0, 4], [0, 7]);
    session.paste("", "X");
    expect(session.commonmark).toBe("one X three");
  });

  it("prefers the rich flavor and preserves format", () => {
    const session = new Session(deps());
    session.open("");
    session.paste("<p>a <strong>b</strong></p>", "a b");
    expect(session.commonmark).toBe("a **b**");
  });

  it("is one undo step across paragraphs", () => {
    const session = new Session(deps());
    session.open("");
    session.paste("", "a\nb");
    expect(session.commonmark).toBe("a\n\nb");
    session.undo();
    expect(session.commonmark).toBe("");
  });

  it("does not coalesce with adjacent typing", () => {
    const session = new Session(deps());
    session.open("");
    session.type("a");
    session.paste("", "b");
    session.type("c");
    expect(session.commonmark).toBe("abc");
    session.undo();
    expect(session.commonmark).toBe("ab");
    session.undo();
    expect(session.commonmark).toBe("a");
    session.undo();
    expect(session.commonmark).toBe("");
  });

  it("an empty paste is a no-op", () => {
    const { bus, reasons } = spyEvents();
    const session = new Session(deps({ events: bus }));
    session.open("abc");
    reasons.length = 0;
    expect(session.paste("", "")).toBe(false);
    expect(session.commonmark).toBe("abc");
    expect(session.canUndo).toBe(false);
    expect(reasons).toEqual([]);
  });

  // A paste over its budget is refused whole: not parsed, not inserted in
  // part, no history step, and the only event is the refusal the surface
  // turns into a sentence.
  describe("budgets", () => {
    const refusing = () => {
      const { bus, reasons } = spyEvents();
      const refusals: string[] = [];
      let parsed = 0;
      const clipboard = {
        ...browserClipboardCodec,
        parsePlain: (text: string) => {
          parsed++;
          return browserClipboardCodec.parsePlain(text);
        },
      };
      const session = new Session(deps({ events: bus, clipboard }));
      session.onRefused((why) => refusals.push(why));
      session.open("abc");
      reasons.length = 0;
      return { session, reasons, refusals, parsed: () => parsed };
    };

    it("refuses a plain flavor over its characters, unparsed", () => {
      const { session, reasons, refusals, parsed } = refusing();
      const text = "x".repeat(MAX_PASTE_CHARS + 1);
      expect(session.paste("", text)).toBe(false);
      expect(session.pastePlain(text)).toBe(false);
      expect(parsed()).toBe(0);
      expect(session.commonmark).toBe("abc");
      expect(session.canUndo).toBe(false);
      expect(reasons).toEqual([]);
      expect(refusals).toEqual(["pasteTooLong", "pasteTooLong"]);
    });

    it("refuses a rich flavor over its characters, whatever the plain one holds", () => {
      const { session, refusals } = refusing();
      const html = `<p>${"x".repeat(MAX_PASTE_HTML_CHARS)}</p>`;
      expect(session.paste(html, "short")).toBe(false);
      expect(session.commonmark).toBe("abc");
      expect(refusals).toEqual(["pasteTooLong"]);
    });

    it("admits a rich flavor within its budget whose plain one is not", () => {
      const { session, refusals } = refusing();
      expect(session.paste("<p>x</p>", "y".repeat(MAX_PASTE_CHARS + 1))).toBe(
        true,
      );
      expect(session.commonmark).toBe("xabc");
      expect(refusals).toEqual([]);
    });

    it("refuses a paste of more paragraphs than the cap, after the parse", () => {
      const { session, reasons, refusals } = refusing();
      expect(session.pastePlain("x\n".repeat(MAX_PASTE_PARAGRAPHS + 1))).toBe(
        false,
      );
      expect(session.doc).toHaveLength(1);
      expect(reasons).toEqual([]);
      expect(refusals).toEqual(["pasteTooLong"]);
    });

    it("admits a paste at the caps", () => {
      const { session, refusals } = refusing();
      expect(session.pastePlain("x".repeat(MAX_PASTE_CHARS))).toBe(true);
      session.open("");
      expect(session.pastePlain("x\n".repeat(MAX_PASTE_PARAGRAPHS))).toBe(true);
      expect(session.doc).toHaveLength(MAX_PASTE_PARAGRAPHS);
      expect(refusals).toEqual([]);
    });
  });
});

describe("pastePlain", () => {
  it("strips formatting to plain text", () => {
    const session = new Session(deps());
    session.open("");
    session.pastePlain("a **b**");
    expect(session.doc[0].runs.map((r) => r.text).join("")).toBe("a **b**");
    expect(session.doc[0].runs.every((r) => !r.format.bold)).toBe(true);
  });

  it("splits on newlines", () => {
    const session = new Session(deps());
    session.open("");
    session.pastePlain("a\nb");
    expect(session.commonmark).toBe("a\n\nb");
  });
});

describe("selectAll", () => {
  it("selects the whole document", () => {
    const session = new Session(deps());
    session.open("one\n\ntwo");
    session.selectAll();
    expect(session.selection).toEqual({
      anchor: { para: 0, offset: 0 },
      focus: { para: 1, offset: 3 },
    });
  });

  it("emits only selection — no doc, no history, no dirty", () => {
    const { bus, reasons } = spyEvents();
    const session = new Session(deps({ events: bus }));
    session.open("hello");
    reasons.length = 0;
    session.selectAll();
    expect(reasons).toEqual(["selection"]);
    expect(session.canUndo).toBe(false);
    expect(session.hasChanges).toBe(false);
  });
});
