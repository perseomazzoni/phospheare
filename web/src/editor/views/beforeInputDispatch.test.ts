// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { EditorEngine } from "./engine";
import { dispatchBeforeInput } from "./beforeInputDispatch";

// Pins the input-routing layer: which `inputType` lands on which engine
// method, and that the composing flag freezes the reveal. The session suite
// pins the engine's own behaviour for each action.

function inputEvent(over: Partial<InputEvent>): InputEvent {
  return { inputType: "", ...over } as unknown as InputEvent;
}

function mockEngine(): EditorEngine {
  return {
    type: vi.fn(),
    backspace: vi.fn(),
    del: vi.fn(),
    deleteWordBackward: vi.fn(),
    deleteWordForward: vi.fn(),
    deleteSoftLineBackward: vi.fn(),
    enter: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    updateSelection: vi.fn(),
    replaceRange: vi.fn(() => true),
  } as unknown as EditorEngine;
}

const flags = () => ({
  composing: { current: false },
  // The fold flag cannot be derived from `composing`, which is already true
  // on the first composition event.
  composed: { current: false },
  rendering: { current: false },
});

describe("dispatchBeforeInput", () => {
  it("routes a typed character to engine.type", () => {
    const engine = mockEngine();
    dispatchBeforeInput(
      {} as HTMLElement,
      engine,
      inputEvent({ inputType: "insertText", data: "x" }),
      flags(),
      () => {},
    );
    expect(engine.type).toHaveBeenCalledWith("x");
  });

  it("does not route paste through beforeinput (the paste event owns it)", () => {
    const engine = mockEngine();
    const dt = {
      getData: vi.fn(() => "pasted"),
    } as unknown as DataTransfer;
    dispatchBeforeInput(
      {} as HTMLElement,
      engine,
      inputEvent({ inputType: "insertFromPaste", dataTransfer: dt }),
      flags(),
      () => {},
    );
    expect(engine.type).not.toHaveBeenCalled();
  });

  it("routes the delete and enter families", () => {
    const engine = mockEngine();
    const f = flags();
    dispatchBeforeInput(
      {} as HTMLElement,
      engine,
      inputEvent({ inputType: "deleteContentBackward" }),
      f,
      () => {},
    );
    dispatchBeforeInput(
      {} as HTMLElement,
      engine,
      inputEvent({ inputType: "deleteContentForward" }),
      f,
      () => {},
    );
    dispatchBeforeInput(
      {} as HTMLElement,
      engine,
      inputEvent({ inputType: "insertParagraph" }),
      f,
      () => {},
    );
    dispatchBeforeInput(
      {} as HTMLElement,
      engine,
      inputEvent({ inputType: "insertLineBreak" }),
      f,
      () => {},
    );
    dispatchBeforeInput(
      {} as HTMLElement,
      engine,
      inputEvent({ inputType: "historyUndo" }),
      f,
      () => {},
    );
    dispatchBeforeInput(
      {} as HTMLElement,
      engine,
      inputEvent({ inputType: "historyRedo" }),
      f,
      () => {},
    );
    expect(engine.backspace).toHaveBeenCalledTimes(1);
    expect(engine.del).toHaveBeenCalledTimes(1);
    expect(engine.enter).toHaveBeenCalledTimes(2);
    expect(engine.undo).toHaveBeenCalledTimes(1);
    expect(engine.redo).toHaveBeenCalledTimes(1);
  });

  it("reveals a hidden caret before the engine commits", () => {
    const engine = mockEngine();
    const reveal = vi.fn();
    dispatchBeforeInput(
      {} as HTMLElement,
      engine,
      inputEvent({ inputType: "insertText", data: "x" }),
      flags(),
      reveal,
    );
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("does not reveal while composing (the IME freeze)", () => {
    const engine = mockEngine();
    const reveal = vi.fn();
    dispatchBeforeInput(
      {} as HTMLElement,
      engine,
      inputEvent({ inputType: "insertText", data: "x" }),
      { ...flags(), composing: { current: true } },
      reveal,
    );
    expect(reveal).not.toHaveBeenCalled();
  });
});

// ── Word, line and spellcheck input ──────────────────────────────────────────

describe("audit findings", () => {
  it("— Ctrl+Backspace, Ctrl+Delete, Cmd+Backspace and a spellcheck correction are routed, not dropped", () => {
    // `EditorCore.tsx` calls `preventDefault()` on every beforeinput event
    // before this dispatch runs, so an unrouted `inputType` does nothing at
    // all. Word and soft-line deletion route to their own engine methods,
    // each one undo step never coalesced with a plain backspace. A
    // spellcheck correction routes to the ordinary `type`, since the browser
    // has moved the selection to the misspelled word's range by then.
    const engine = mockEngine();
    const dispatch = (inputType: string, data?: string) =>
      dispatchBeforeInput(
        {} as HTMLElement,
        engine,
        inputEvent({ inputType, data }),
        flags(),
        () => {},
      );

    dispatch("deleteWordBackward");
    expect(engine.deleteWordBackward).toHaveBeenCalledTimes(1);

    dispatch("deleteWordForward");
    expect(engine.deleteWordForward).toHaveBeenCalledTimes(1);

    dispatch("deleteSoftLineBackward");
    expect(engine.deleteSoftLineBackward).toHaveBeenCalledTimes(1);

    dispatch("insertReplacementText", "corrected");
    expect(engine.type).toHaveBeenCalledWith("corrected");
  });
});

// ── The composition family ───────────────────────────────────────────────────
//
// Routing only. What a real browser emits (the non-cancelable events, the
// whole-composition `data`, the target range that covers the previous step)
// is measured in `e2e/ime-trace.spec.ts`, because jsdom has no IME.

/** A one-paragraph editable, so a target range can be mapped to the model. */
function editable(text: string): { el: HTMLElement; node: Text } {
  const el = document.createElement("div");
  const p = document.createElement("p");
  const node = document.createTextNode(text);
  p.append(node);
  el.append(p);
  document.body.append(el);
  return { el, node };
}

/** An `InputEvent` that states its target range, as composition ones do. */
function rangedEvent(
  inputType: string,
  data: string | null,
  node: Text,
  start: number,
  end: number,
): InputEvent {
  return {
    inputType,
    data,
    getTargetRanges: () => [
      {
        startContainer: node,
        startOffset: start,
        endContainer: node,
        endOffset: end,
      },
    ],
  } as unknown as InputEvent;
}

describe("— composed text reaches the model", () => {
  it("routes a composition step to the span the browser named", () => {
    const engine = mockEngine();
    const { el, node } = editable("The brown dog");
    dispatchBeforeInput(
      el,
      engine,
      rangedEvent("insertCompositionText", "black", node, 4, 9),
      flags(),
      () => {},
    );
    expect(engine.replaceRange).toHaveBeenCalledWith(
      { anchor: { para: 0, offset: 4 }, focus: { para: 0, offset: 9 } },
      "black",
      { fold: false },
    );
  });

  it("folds every step after the first into one undo", () => {
    const engine = mockEngine();
    const { el, node } = editable("hello");
    const f = flags();
    f.composing.current = true;

    dispatchBeforeInput(
      el,
      engine,
      rangedEvent("insertCompositionText", "h", node, 0, 0),
      f,
      () => {},
    );
    dispatchBeforeInput(
      el,
      engine,
      rangedEvent("insertCompositionText", "he", node, 0, 1),
      f,
      () => {},
    );

    // The first opens the step and the rest join it. Folding the first would
    // swallow whatever the writer did before the composition into it.
    const folds = vi
      .mocked(engine.replaceRange)
      .mock.calls.map((c) => c[2]?.fold);
    expect(folds).toEqual([false, true]);
  });

  it("routes a composition deletion the same way", () => {
    const engine = mockEngine();
    const { el, node } = editable("hello");
    dispatchBeforeInput(
      el,
      engine,
      rangedEvent("deleteCompositionText", null, node, 0, 5),
      flags(),
      () => {},
    );
    expect(engine.replaceRange).toHaveBeenCalledWith(
      { anchor: { para: 0, offset: 0 }, focus: { para: 0, offset: 5 } },
      "",
      { fold: false },
    );
  });

  it("inserts Safari's committed composition at the span it names, in the same undo step", () => {
    const engine = mockEngine();
    const { el, node } = editable("ab");
    const f = flags();
    f.composed.current = true;
    dispatchBeforeInput(
      el,
      engine,
      rangedEvent("insertFromComposition", "日本", node, 1, 1),
      f,
      () => {},
    );
    expect(engine.replaceRange).toHaveBeenCalledWith(
      { anchor: { para: 0, offset: 1 }, focus: { para: 0, offset: 1 } },
      "日本",
      { fold: true },
    );
  });

  it("inserts Safari's committed composition at the caret when it names no span", () => {
    const engine = mockEngine();
    const { el } = editable("ab");
    dispatchBeforeInput(
      el,
      engine,
      inputEvent({ inputType: "insertFromComposition", data: "日本" }),
      flags(),
      () => {},
    );
    expect(engine.type).toHaveBeenCalledWith("日本");
  });

  it("does nothing when the browser names no range — never guesses a span", () => {
    const engine = mockEngine();
    const { el } = editable("hello");
    dispatchBeforeInput(
      el,
      engine,
      inputEvent({ inputType: "insertCompositionText", data: "x" }),
      flags(),
      () => {},
    );
    expect(engine.replaceRange).not.toHaveBeenCalled();
    expect(engine.type).not.toHaveBeenCalled();
  });

  it("does not sync the selection from the DOM while composing", () => {
    // The DOM holds characters the model does not until the composition's
    // range lands them, so a DOM offset is not a model offset; feeding one in
    // shifts the cursor by the composition's length.
    const engine = mockEngine();
    const { el, node } = editable("hello");
    const f = flags();
    f.composing.current = true;
    dispatchBeforeInput(
      el,
      engine,
      rangedEvent("insertCompositionText", "h", node, 0, 0),
      f,
      () => {},
    );
    expect(engine.updateSelection).not.toHaveBeenCalled();
  });

  it("refuses a drop on purpose, and reports nothing for it", () => {
    // `insertFromDrop` is never routed: it would carry arbitrary HTML past
    // `parseHtmlAllowlist`, the one hardened HTML-to-model boundary.
    const engine = mockEngine();
    const { el } = editable("hello");
    const report = vi.fn();
    dispatchBeforeInput(
      el,
      engine,
      inputEvent({ inputType: "insertFromDrop", data: "<b>x</b>" }),
      flags(),
      () => {},
      report,
    );
    expect(engine.type).not.toHaveBeenCalled();
    expect(engine.replaceRange).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("reports an input it does not handle by its type, and does nothing", () => {
    const engine = mockEngine();
    const { el } = editable("hello");
    const report = vi.fn();
    dispatchBeforeInput(
      el,
      engine,
      inputEvent({
        inputType: "insertFromYank",
        data: "private words",
        cancelable: false,
      }),
      flags(),
      () => {},
      report,
    );
    expect(engine.type).not.toHaveBeenCalled();
    expect(engine.replaceRange).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith("insertFromYank", false);
  });
});
