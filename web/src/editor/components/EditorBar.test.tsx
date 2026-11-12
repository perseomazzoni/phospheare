// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appIcons } from "../../ui/appIcons";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import EditorBar, { barFacts, saveTipWord, type SaveFace } from "./EditorBar";
import { EditorEngine } from "../views/engine";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// Every control reaches the engine, and every one is named by its own i18n
// key so a screen reader hears the command rather than the drawing. The
// four-way choices are tracks, and the save state is a status before it is a
// button.

function bar(over: Partial<Parameters<typeof EditorBar>[0]> = {}) {
  const engine = new EditorEngine();
  engine.open("Hello world");
  const save: SaveFace = { state: "clean", detail: "14:32", onSave: vi.fn() };
  const view = render(
    <EditorBar
      engine={engine}
      find={<div data-testid="find-segment" />}
      panelOpen={false}
      findOpen={false}
      findFocused={false}
      onOpenStructure={vi.fn()}
      onOpenPalette={vi.fn()}
      charsOpen={false}
      onToggleChars={vi.fn()}
      askOpen={false}
      onToggleAsk={vi.fn()}
      snapshotOpen={false}
      onToggleSnapshot={vi.fn()}
      historyOpen={false}
      onToggleHistory={vi.fn()}
      save={save}
      {...over}
    />,
  );
  return { engine, view };
}

describe("EditorBar", () => {
  it("is a toolbar", () => {
    bar();
    expect(
      screen.getByRole("toolbar", { name: "toolbar.formatting" }),
    ).toBeTruthy();
  });

  // ── The eighteen ───────────────────────────────────────────────────────────
  // One assertion per control the bar must keep; a missing name here is a
  // control lost.

  it("draws every control the toolbar had", () => {
    bar();
    for (const name of [
      "toolbar.normalText",
      "toolbar.monospace",
      "toolbar.title",
      "toolbar.subtitle",
      "toolbar.body",
      "toolbar.pageBreak",
      "toolbar.bold",
      "toolbar.italic",
      "toolbar.toggleCase",
      "toolbar.alignLeft",
      "toolbar.alignCenter",
      "toolbar.alignRight",
      "toolbar.justify",
      "toolbar.undo",
      "toolbar.redo",
      "toolbar.specialChars",
      // The save chip's name is its state, not a fixed "Save". The
      // bar's default face here is clean with a timestamp.
      "toolbar.saved · 14:32",
    ]) {
      expect(screen.getByRole("button", { name }), name).toBeTruthy();
    }
  });

  it("leaves find to the panel that owns the query", () => {
    bar();
    expect(screen.getByTestId("find-segment")).toBeTruthy();
  });

  it("the camera toggle reports the snapshot face's state, and the press, and the shortcut", () => {
    const onToggleSnapshot = vi.fn();
    const { view } = bar({ snapshotOpen: true, onToggleSnapshot });
    const button = screen.getByRole("button", { name: "toolbar.snapshot" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    // The button's Mod+Shift+D rides on the tip, like the clock's Mod+Shift+H.
    expect(button.querySelector(".ui-kbd")?.textContent).toBe("Ctrl+Shift+D");
    fireEvent.click(button);
    expect(onToggleSnapshot).toHaveBeenCalledTimes(1);
    // Re-rendered with the face shut, the same button unpresses.
    view.rerender(
      <EditorBar
        engine={new EditorEngine()}
        find={<div data-testid="find-segment" />}
        panelOpen={false}
        findOpen={false}
        findFocused={false}
        charsOpen={false}
        onToggleChars={vi.fn()}
        onOpenStructure={vi.fn()}
        onOpenPalette={vi.fn()}
        askOpen={false}
        onToggleAsk={vi.fn()}
        snapshotOpen={false}
        onToggleSnapshot={onToggleSnapshot}
        historyOpen={false}
        onToggleHistory={vi.fn()}
        save={{ state: "clean", detail: "14:32", onSave: vi.fn() }}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "toolbar.snapshot" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("the history button reports the rail's state, and the press, and the shortcut", () => {
    const onToggleHistory = vi.fn();
    const { view } = bar({ historyOpen: true, onToggleHistory });
    const button = screen.getByRole("button", { name: "toolbar.history" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    // The button's Mod+Shift+H rides on the tip.
    expect(button.querySelector(".ui-kbd")?.textContent).toBe("Ctrl+Shift+H");
    fireEvent.click(button);
    expect(onToggleHistory).toHaveBeenCalledTimes(1);
    // Re-rendered with the rail shut, the same button unpresses.
    view.rerender(
      <EditorBar
        engine={new EditorEngine()}
        find={<div data-testid="find-segment" />}
        panelOpen={false}
        findOpen={false}
        findFocused={false}
        charsOpen={false}
        onToggleChars={vi.fn()}
        onOpenStructure={vi.fn()}
        onOpenPalette={vi.fn()}
        askOpen={false}
        onToggleAsk={vi.fn()}
        snapshotOpen={false}
        onToggleSnapshot={vi.fn()}
        historyOpen={false}
        onToggleHistory={onToggleHistory}
        save={{ state: "clean", detail: "14:32", onSave: vi.fn() }}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "toolbar.history" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("draws the Ask button after the camera when there is an Assistant", () => {
    const onToggleAsk = vi.fn();
    bar({ onToggleAsk, askOpen: true });
    const snapshot = screen.getByRole("button", { name: "toolbar.snapshot" });
    const ask = screen.getByRole("button", { name: "toolbar.assistant" });
    expect(ask.getAttribute("aria-pressed")).toBe("true");
    expect(
      snapshot.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(ask);
    expect(onToggleAsk).toHaveBeenCalledTimes(1);
  });

  // A way to put the comments away, and a walk from one comment to the next
  // either side of it.
  it("draws the comments toggle and its walk only where the shell offers them", () => {
    const onToggleComments = vi.fn();
    const onPreviousComment = vi.fn();
    const onNextComment = vi.fn();
    bar({
      commentsShown: true,
      onToggleComments,
      onPreviousComment,
      onNextComment,
    });
    const toggle = screen.getByRole("button", { name: "toolbar.comments" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(onToggleComments).toHaveBeenCalledTimes(1);

    const previous = screen.getByRole("button", {
      name: "toolbar.previousComment",
    });
    const next = screen.getByRole("button", { name: "toolbar.nextComment" });
    // To the toggle's right, Next and then Previous.
    expect(
      toggle.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      next.compareDocumentPosition(previous) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // A step leaves the caret where it was, as every control here does.
    expect(fireEvent.mouseDown(next)).toBe(false);
    fireEvent.click(previous);
    fireEvent.click(next);
    expect(onPreviousComment).toHaveBeenCalledTimes(1);
    expect(onNextComment).toHaveBeenCalledTimes(1);

    cleanup();
    bar({ commentsShown: false, onToggleComments });
    expect(
      screen
        .getByRole("button", { name: "toolbar.comments" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.queryByRole("button", { name: "toolbar.nextComment" }),
    ).toBeNull();

    cleanup();
    bar();
    expect(
      screen.queryByRole("button", { name: "toolbar.comments" }),
    ).toBeNull();
  });

  // A search waiting on the writer marks the Ask button and names why. The
  // shell passes `askWaiting` only while the face is out of view, so the mark
  // and the name arrive together.
  it("marks the Ask button and names the wait while a search waits", () => {
    bar({ askWaiting: true });
    const ask = screen.getByRole("button", {
      name: "toolbar.assistantWaiting",
    });
    expect(ask.getAttribute("data-attention")).toBe("1");
    cleanup();
    bar();
    expect(
      screen
        .getByRole("button", { name: "toolbar.assistant" })
        .hasAttribute("data-attention"),
    ).toBe(false);
  });

  // Without an Assistant the spark is not drawn at all, not drawn disabled,
  // and the timeline's two buttons keep their segment.
  it("leaves the Ask button out when there is no Assistant", () => {
    bar({ onToggleAsk: undefined, askOpen: undefined });
    expect(
      screen.queryByRole("button", { name: "toolbar.assistant" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "toolbar.history" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "toolbar.snapshot" }),
    ).toBeTruthy();
  });

  it("sits the clock left of the camera in the timeline's segment", () => {
    // The history button is the leftmost of the two, the snapshot button beside
    // it.
    bar();
    const history = screen.getByRole("button", { name: "toolbar.history" });
    const snapshot = screen.getByRole("button", { name: "toolbar.snapshot" });
    expect(
      history.compareDocumentPosition(snapshot) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("bolds at a collapsed cursor", () => {
    const { engine } = bar();
    engine.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 0 },
    });
    fireEvent.click(screen.getByRole("button", { name: "toolbar.bold" }));
    expect(engine.isBold).toBe(true);
  });

  it("sets a block type through the engine", () => {
    const { engine } = bar();
    fireEvent.click(screen.getByRole("button", { name: "toolbar.title" }));
    expect(engine.currentBlockType).toBe("h1");
  });

  it("inserts a page break rather than becoming one", () => {
    const { engine } = bar();
    const before = engine.doc.length;
    fireEvent.click(screen.getByRole("button", { name: "toolbar.pageBreak" }));
    expect(engine.doc.length).toBeGreaterThan(before);
  });

  it("aligns through the engine", () => {
    const { engine } = bar();
    fireEvent.click(
      screen.getByRole("button", { name: "toolbar.alignCenter" }),
    );
    expect(engine.currentAlignment).toBe("center");
  });

  it("switches the inline face through the engine", () => {
    const { engine } = bar();
    fireEvent.click(screen.getByRole("button", { name: "toolbar.monospace" }));
    expect(engine.isMonospaceInline).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "toolbar.normalText" }));
    expect(engine.isMonospaceInline).toBe(false);
  });

  it("disables undo and redo when there is no history", () => {
    bar();
    expect(
      (
        screen.getByRole("button", {
          name: "toolbar.undo",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "toolbar.redo",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("keeps undo and redo live in the snapshot comparison — accepts are ordinary steps", () => {
    // Each accepted hunk is a normal undoable edit, so the bar's
    // undo/redo stay enabled while the snapshot diff is up (the rail's walk
    // keeps them disabled — its wheel owns the walk).
    const { engine } = bar();
    act(() => {
      engine.type(" now");
      engine.enterDiff("now");
    });
    const undo = screen.getByRole("button", {
      name: "toolbar.undo",
    }) as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);
    expect(engine.commonmark).toBe("Hello world");
    const redo = screen.getByRole("button", {
      name: "toolbar.redo",
    }) as HTMLButtonElement;
    expect(redo.disabled).toBe(false);
  });

  it("keeps undo and redo disabled in the rail's walk", () => {
    const { engine } = bar();
    act(() => {
      engine.type(" now");
      engine.markSaved(engine.save());
      engine.enterHistoryDiff();
    });
    expect(
      (
        screen.getByRole("button", {
          name: "toolbar.undo",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "toolbar.redo",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  // ── The tracks ─────────────────────────────────────────────────────────────

  it("presses the block type the caret is in", () => {
    const { engine } = bar();
    fireEvent.click(screen.getByRole("button", { name: "toolbar.subtitle" }));
    expect(
      screen
        .getByRole("button", { name: "toolbar.subtitle" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "toolbar.body" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(engine.currentBlockType).toBe("h2");
  });

  it("moves the alignment thumb to the chosen cell", () => {
    bar();
    fireEvent.click(screen.getByRole("button", { name: "toolbar.justify" }));
    const track = screen.getByRole("group", { name: "toolbar.alignment" });
    expect(track.style.getPropertyValue("--track-at")).toBe("3");
  });

  // ── The block fold ─────────────────────────────────────────────────────────

  it("draws the resting block words the same in every language", () => {
    // `t` is mocked to return its key, so a word that still went through
    // translation would read `toolbar.*` here. The resting faces are
    // universal: the two heading marks as words, and the body as its glyph.
    bar();
    const face = () => document.querySelector(".ed-fold-face") as HTMLElement;
    // A paragraph caret rests the fold on the body glyph, not a word.
    expect(face().querySelector("svg")).toBeTruthy();
    expect(face().textContent ?? "").not.toContain("toolbar.body");
    fireEvent.click(screen.getByRole("button", { name: "toolbar.title" }));
    expect(face().textContent).toContain("Title (H1)");
    expect(face().textContent).not.toContain("toolbar.title");
    fireEvent.click(screen.getByRole("button", { name: "toolbar.subtitle" }));
    expect(face().textContent).toContain("Subtitle (H2)");
    expect(face().textContent).not.toContain("toolbar.subtitle");
  });

  it("sizes the resting fold from its measured face", () => {
    // jsdom measures every box as zero, so the measurement itself lives in the
    // browser (`e2e/block-fold.spec.ts`). This pins the wiring: the face's
    // laid-out width lands on `--ed-fold-rest`, the property the stylesheet
    // reads at rest; a fold that stopped measuring would leave the var
    // unwritten.
    const original = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth",
    );
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("ed-fold-face") ? 74 : 0;
      },
    });
    try {
      bar();
      const fold = document.querySelector(".ed-fold-block") as HTMLElement;
      expect(fold.style.getPropertyValue("--ed-fold-rest")).toBe("74px");
    } finally {
      if (original)
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", original);
    }
  });

  it("leaves the fallback resting width in place where no box has a size", () => {
    // With jsdom's real zero geometry the var is never written, so the
    // stylesheet's `92px` fallback is the story — the element must not carry a
    // broken or empty property that would override it.
    bar();
    const fold = document.querySelector(".ed-fold-block") as HTMLElement;
    expect(fold.style.getPropertyValue("--ed-fold-rest")).toBe("");
  });

  // ── The save state ─────────────────────────────────────────────────────────

  it("is a status while there is nothing to do", () => {
    bar({ save: { state: "clean", detail: "14:32", onSave: vi.fn() } });
    const button = screen.getByRole("button", {
      name: "toolbar.saved · 14:32",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("toolbar.saved");
    expect(button.textContent).toContain("14:32");
  });

  it("becomes a button once there is something to save", () => {
    const onSave = vi.fn();
    bar({ save: { state: "dirty", detail: null, onSave } });
    const button = screen.getByRole("button", {
      name: "toolbar.unsaved",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("data-state")).toBe("dirty");
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("says what went wrong when a write did not land", () => {
    bar({ save: { state: "failed", detail: "disk full", onSave: vi.fn() } });
    // The reason is the name: a reader hearing "Save" for a write that did not
    // land learns nothing, and on the phone plane there is no word beside it.
    const button = screen.getByRole("button", { name: "disk full" });
    expect(button.getAttribute("data-state")).toBe("failed");
    expect(button.textContent).toContain("disk full");
    // Still actionable: a failed save is the one a writer most wants to retry.
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  // The four glyphs.
  //
  // "Still typing", "written here but nowhere else" and "your words did not
  // land" must be told apart on every plane, including the narrow one with no
  // word beside the chip and no hover to ask. Shape carries the distinction,
  // and these rows pin that the four are four.

  it("is written here and on its way out, which is neither saved nor unsaved", () => {
    const onSave = vi.fn();
    bar({ save: { state: "cached", detail: "14:32", onSave } });
    const button = screen.getByRole("button", {
      name: "toolbar.pushing",
    }) as HTMLButtonElement;
    expect(button.getAttribute("data-state")).toBe("cached");
    // Its own word, never a variant of Saved: a shared key is how two states
    // quietly collapse into one, and this state needs a name of its own.
    expect(button.textContent).toContain("toolbar.pushing");
    expect(button.textContent).not.toContain("toolbar.saved");
    // And actionable: pressing it runs the drain. A chip that looks pressable
    // and does nothing misleads in a second way.
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("draws a different glyph for each of the four states a writer must separate", () => {
    // Colour is not the pin: a writer who cannot separate ember from crimson
    // still has to read this chip, and collapsed at 13px there is nothing else
    // to read. So the assertion is on shape — four states, four distinct
    // drawings, no two sharing one.
    const drawing = (state: SaveFace["state"]) => {
      cleanup();
      bar({ save: { state, detail: "14:32", onSave: vi.fn() } });
      return (
        document.querySelector(".ed-save .ed-save-glyph")?.innerHTML ?? null
      );
    };
    const drawn = (["dirty", "cached", "saved", "failed"] as const).map(
      drawing,
    );
    expect(drawn.every((d) => d !== null && d.length > 0)).toBe(true);
    expect(new Set(drawn).size).toBe(4);
  });

  it("draws nothing for the two states with nothing to report", () => {
    // `saving` has the dots, and `comparing` is a read-only view where there
    // is nothing to save. A glyph in either would be furniture the writer has
    // to learn to ignore.
    for (const state of ["saving", "comparing"] as const) {
      cleanup();
      bar({ save: { state, detail: "14:32", onSave: vi.fn() } });
      expect(document.querySelector(".ed-save .ed-save-glyph")).toBeNull();
    }
  });

  it("keeps a clean file's tick for the folded chip, so it is never empty", () => {
    // The stylesheet shows it only folded, where the word is gone.
    bar({ save: { state: "clean", detail: "14:32", onSave: vi.fn() } });
    expect(
      document
        .querySelector(".ed-save .ed-save-glyph")
        ?.getAttribute("data-icon"),
    ).toBe(appIcons.confirm);
  });

  it("is absent with no file open, rather than a button that does nothing", () => {
    bar({ save: { state: "absent", detail: null, onSave: vi.fn() } });
    expect(document.querySelector(".ed-save")).toBeNull();
  });

  // ── The save box ───────────────────────────────────────────────────────────
  //
  // The autosave switch is a writing preference, not part of this wrap:
  // a control revealed by a resting pointer is a control a finger
  // cannot reach on a platform that discards backgrounded tabs. Its
  // behaviour is pinned in `DocumentTree.test.tsx`;
  // this file pins that the save box is a status either way.

  it("is a status with autosave off — the file has a save time either way", () => {
    bar({ save: { state: "clean", detail: "14:32", onSave: vi.fn() } });
    const button = screen.getByRole("button", {
      name: "toolbar.saved · 14:32",
    }) as HTMLButtonElement;
    expect(button.textContent).toContain("toolbar.saved");
    expect(button.textContent).toContain("14:32");
  });

  it("carries no setting of its own any more", () => {
    bar();
    // The wrap is the save button and its tip, and nothing else. A control
    // that only a resting pointer can reach does not belong in a bar.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(document.querySelector(".ed-autosave")).toBeNull();
  });

  // ── The panels ─────────────────────────────────────────────────────────────

  it("reports the character panel open, so the keys can be found again", () => {
    const onToggleChars = vi.fn();
    bar({ charsOpen: true, onToggleChars });
    const chars = screen.getByRole("button", { name: "toolbar.specialChars" });
    expect(chars.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chars);
    expect(onToggleChars).toHaveBeenCalledOnce();
  });

  it("steps the rest of the bar back while find has the writer", () => {
    bar({ findFocused: true });
    expect(document.querySelector(".ui-bar")?.getAttribute("data-focus")).toBe(
      "find",
    );
  });

  it("quiets its dividers while a panel is open", () => {
    bar({ panelOpen: true });
    expect(document.querySelector(".ui-bar")?.getAttribute("data-open")).toBe(
      "1",
    );
  });
});

// ── The fold behaviour ───────────────────────────────────────────────────────
// The state machine itself lives in `foldBehaviour.test.tsx`; what is pinned
// here is the bar wearing its attributes — the `data-open` the stylesheet
// keys off, and the engagement report that lifts the bar over the panels.

describe("EditorBar · fold behaviour", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const uiBar = () => document.querySelector(".ui-bar") as HTMLElement;
  const fold = (name: string) =>
    document.querySelector(`[data-fold="${name}"]`) as HTMLElement;

  it("opens only the fold the pointer reaches, and reports engagement", () => {
    const onFoldEngaged = vi.fn();
    bar({ onFoldEngaged });
    expect(fold("block").getAttribute("data-open")).toBe("0");
    expect(fold("align").getAttribute("data-open")).toBe("0");
    fireEvent.pointerEnter(uiBar());
    expect(onFoldEngaged).toHaveBeenLastCalledWith(true);
    expect(fold("block").getAttribute("data-open")).toBe("0");
    fireEvent.pointerOver(fold("block"));
    void act(() => vi.advanceTimersByTime(80));
    expect(fold("block").getAttribute("data-open")).toBe("1");
    expect(fold("align").getAttribute("data-open")).toBe("0");
  });

  // Previous and Next comment fold and unfold with the comments toggle, as
  // the alignment row does.
  it("folds the comment walk around its toggle, and only when there is a walk", () => {
    bar({
      commentsShown: true,
      onToggleComments: vi.fn(),
      onPreviousComment: vi.fn(),
      onNextComment: vi.fn(),
    });
    const comments = fold("comments");
    expect(
      [...comments.querySelectorAll("button")].map((b) =>
        b.getAttribute("aria-label"),
      ),
    ).toEqual([
      "toolbar.comments",
      "toolbar.nextComment",
      "toolbar.previousComment",
    ]);
    // At rest the face answers what the toggle would: comments shown.
    expect(
      comments.querySelector(".ed-fold-face")?.getAttribute("data-pressed"),
    ).toBe("1");
    expect(comments.getAttribute("data-open")).toBe("0");
    fireEvent.pointerEnter(uiBar());
    fireEvent.pointerOver(comments);
    void act(() => vi.advanceTimersByTime(80));
    expect(comments.getAttribute("data-open")).toBe("1");

    cleanup();
    bar({ commentsShown: false, onToggleComments: vi.fn() });
    expect(fold("comments")).toBeNull();
    expect(
      screen.getByRole("button", { name: "toolbar.comments" }),
    ).toBeTruthy();
  });

  it("does not fold for find — a search field is not an answer that grows", () => {
    bar();
    // Find declares no `data-fold`: a search field does not grow on hover
    // so the fold behaviour has nothing to open for it.
    expect(fold("find")).toBeNull();
    fireEvent.pointerEnter(uiBar());
    fireEvent.pointerOver(fold("block"));
    void act(() => vi.advanceTimersByTime(80));
    expect(fold("block").getAttribute("data-open")).toBe("1");
  });

  // The save box reveals nothing: a control a pointer must rest on is a
  // control a finger never reaches, and no delay can fix that. A fold
  // on the save box would mean a setting had crept back into the bar behind
  // a hover.
  it("gives the save box no fold at all — nothing grows out of it", () => {
    bar();
    expect(fold("save")).toBeNull();
    fireEvent.pointerEnter(uiBar());
    const wrap = document.querySelector(".ed-save-wrap") as HTMLElement;
    fireEvent.pointerOver(wrap);
    void act(() => vi.advanceTimersByTime(2000));
    expect(fold("save")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("opens the block fold on the shared intent, and only the one under the pointer", () => {
    // The two answers, block type and alignment, open on the 80ms intent;
    // the contrast pinned is between the two folds themselves.
    bar();
    fireEvent.pointerEnter(uiBar());
    fireEvent.pointerOver(fold("block"));
    void act(() => vi.advanceTimersByTime(80));
    expect(fold("block").getAttribute("data-open")).toBe("1");
    expect(fold("align").getAttribute("data-open")).toBe("0");
  });

  it("expands the block fold to the H1 and H2 marks and the body glyph", () => {
    // The engaged row is universal too: the two heading marks as text and
    // the paragraph glyph for Body. The localized labels stay the
    // accessible names — a screen reader hears the writer's language.
    bar();
    fireEvent.pointerEnter(uiBar());
    fireEvent.pointerOver(fold("block"));
    void act(() => vi.advanceTimersByTime(80));
    const cells = document.querySelectorAll(
      ".ed-fold-block .ui-bar-track button",
    );
    expect(cells).toHaveLength(3);
    // The visible cell content is the mark (drawn `aria-hidden` — the tip
    // anchor, also aria-hidden, is ignored), so the marks are the cells' own
    // words, not the localized accessible names.
    const visible = (cell: Element) =>
      cell.querySelector(
        "span[aria-hidden]:not(.ui-tip-anchor)",
      ) as HTMLElement;
    expect(visible(cells[0]).textContent).toBe("H1");
    expect(visible(cells[1]).textContent).toBe("H2");
    expect(cells[2].querySelector("svg")).toBeTruthy();
  });

  it("expands the find field from the search’s own open state, not from a pointer", () => {
    // The segment's `data-open` is driven by the `findOpen` prop — the search
    // being open — never by the fold behaviour. A pointer over the segment
    // leaves it closed; opening the search expands it.
    const { view } = bar();
    const seg = view.container.querySelector(".ed-seg-find") as HTMLElement;
    expect(seg.getAttribute("data-open")).toBe("0");
    fireEvent.pointerOver(seg);
    void act(() => vi.advanceTimersByTime(80));
    expect(seg.getAttribute("data-open")).toBe("0");
    const { view: openView } = bar({ findOpen: true });
    expect(
      openView.container
        .querySelector(".ed-seg-find")
        ?.getAttribute("data-open"),
    ).toBe("1");
  });

  it("keeps the save word until the bar is about to overflow", () => {
    // jsdom measures no geometry, so the bar never overflows and the chip
    // never tightens — this pins the wiring: `data-save-tight` is driven by
    // the overflow hook and absent while the word fits.
    bar();
    expect(uiBar().getAttribute("data-save-tight")).toBeNull();
  });

  it("lifts the bar on hover, before anything has opened", () => {
    const onFoldEngaged = vi.fn();
    bar({ onFoldEngaged });
    fireEvent.pointerEnter(uiBar());
    expect(fold("block").getAttribute("data-open")).toBe("0");
    expect(onFoldEngaged).toHaveBeenLastCalledWith(true);
  });

  it("rides the bar back to rest when it collapses, and says so", () => {
    const onFoldEngaged = vi.fn();
    bar({ onFoldEngaged });
    fireEvent.pointerEnter(uiBar());
    fireEvent.pointerLeave(uiBar());
    void act(() => vi.advanceTimersByTime(200));
    expect(fold("block").getAttribute("data-open")).toBe("0");
    expect(fold("align").getAttribute("data-open")).toBe("0");
    expect(onFoldEngaged).toHaveBeenLastCalledWith(false);
  });
});

// ── The collapsed save tooltip ───────────────────────────────────────────────
// Collapsed to a dot — narrow window or overflow-tight — the save's status
// word moves into the hover tooltip. The word choice is pure (`saveTipWord`);
// the wiring is that the bar collapses the chip in both states.

describe("saveTipWord", () => {
  const t = (key: string) => key;

  it("shows the timestamp word when collapsed and there is nothing to do", () => {
    const save: SaveFace = {
      state: "clean",
      detail: "Today, 14:32",
      onSave: vi.fn(),
    };
    expect(saveTipWord(save, true, t)).toBe("toolbar.saved · Today, 14:32");
  });

  it("shows the status word in the saved and saving states too", () => {
    expect(
      saveTipWord(
        { state: "saved", detail: "14:32", onSave: vi.fn() },
        true,
        t,
      ),
    ).toBe("toolbar.saved · 14:32");
    expect(
      saveTipWord(
        { state: "saving", detail: "14:32", onSave: vi.fn() },
        true,
        t,
      ),
    ).toBe("toolbar.saved · 14:32");
  });

  it("keeps the save command when expanded", () => {
    const save: SaveFace = {
      state: "clean",
      detail: "Today, 14:32",
      onSave: vi.fn(),
    };
    expect(saveTipWord(save, false, t)).toBe("toolbar.save");
  });

  it("keeps the save command when dirty, failed or pushing — the glyph already carries that", () => {
    expect(
      saveTipWord({ state: "dirty", detail: null, onSave: vi.fn() }, true, t),
    ).toBe("toolbar.save");
    expect(
      saveTipWord(
        { state: "failed", detail: "disk full", onSave: vi.fn() },
        true,
        t,
      ),
    ).toBe("toolbar.save");
    // `cached` is actionable too — pressing the chip runs the drain — so it
    // keeps the actionable tip rather than reading its own status back.
    expect(
      saveTipWord(
        { state: "cached", detail: "14:32", onSave: vi.fn() },
        true,
        t,
      ),
    ).toBe("toolbar.save");
  });

  it("falls back to the save command when there is no timestamp yet", () => {
    const save: SaveFace = { state: "clean", detail: null, onSave: vi.fn() };
    expect(saveTipWord(save, true, t)).toBe("toolbar.save");
  });
});

describe("EditorBar · collapsed save tooltip", () => {
  afterEach(() => {
    cleanup();
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  // `useNarrow` answers through matchMedia; a stub reporting a narrow window
  // collapses the chip, and the tooltip must carry the status the dot cannot.
  const narrowWindow = () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("1015.98"),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  };

  it("carries the save status in the tooltip once the chip is a dot", () => {
    narrowWindow();
    bar();
    expect(document.querySelector(".ui-tip")?.textContent).toContain(
      "toolbar.saved",
    );
    expect(document.querySelector(".ui-tip")?.textContent).toContain("14:32");
  });

  it("keeps the save command in the tooltip when there is something to save", () => {
    narrowWindow();
    bar({ save: { state: "dirty", detail: null, onSave: vi.fn() } });
    expect(document.querySelector(".ui-tip")?.textContent).toContain(
      "toolbar.save",
    );
  });
});

// ── The phone bar ────────────────────────────────────────────────────────────
//
// Not the desk bar folded smaller. Seventeen controls at 44px each need 750px
// of a 375px screen, so the phone bar is a different bar with six slots, and
// choosing them was the design: the two that get the writer somewhere else
// (structure, commands), the two they press most while writing (bold, italic),
// undo, and save. Everything else is a press away in the palette — which is
// why the palette is one of the six rather than a nicety.

describe("EditorBar on the phone plane", () => {
  const phoneWindow = () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        // Both planes answer yes: a phone is always narrow. Keying only the
        // phone query would produce a window no real device can be.
        matches: query.includes("720") || query.includes("1015.98"),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  };

  it("draws six slots, in the order the thumb reads them", () => {
    phoneWindow();
    bar();
    const names = screen
      .getAllByRole("button")
      .map((el) => el.getAttribute("aria-label"));
    expect(names).toEqual([
      "tree.panelLabel",
      "toolbar.undo",
      "toolbar.bold",
      "toolbar.italic",
      "titlebar.palette",
      "toolbar.saved · 14:32",
    ]);
  });

  it("leaves the other eleven to the palette rather than shrinking them", () => {
    phoneWindow();
    bar();
    for (const name of [
      "toolbar.normalText",
      "toolbar.title",
      "toolbar.alignCenter",
      "toolbar.justify",
      "toolbar.toggleCase",
      "toolbar.redo",
      "toolbar.specialChars",
    ]) {
      expect(screen.queryByRole("button", { name }), name).toBeNull();
    }
  });

  it("is still a toolbar, and still says so", () => {
    phoneWindow();
    bar();
    expect(
      screen.getByRole("toolbar", { name: "toolbar.formatting" }),
    ).toBeTruthy();
  });

  it("opens the structure panel and the palette from their own slots", () => {
    phoneWindow();
    const onOpenStructure = vi.fn();
    const onOpenPalette = vi.fn();
    bar({ onOpenStructure, onOpenPalette });
    fireEvent.click(screen.getByRole("button", { name: "tree.panelLabel" }));
    fireEvent.click(screen.getByRole("button", { name: "titlebar.palette" }));
    expect(onOpenStructure).toHaveBeenCalledTimes(1);
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("still reaches the engine from the two format slots", () => {
    phoneWindow();
    const { engine } = bar();
    fireEvent.click(screen.getByRole("button", { name: "toolbar.bold" }));
    expect(engine.isBold).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "toolbar.italic" }));
    expect(engine.isItalic).toBe(true);
  });

  // The read-only bar is a real state (a snapshot being read), and the phone
  // bar has to honour it rather than offering a press that does nothing. Six
  // slots is few enough that a dead one is a third of what the writer can see.
  it("disables what cannot be done while reading a snapshot", () => {
    phoneWindow();
    const engine = new EditorEngine();
    engine.open("Hello world");
    engine.enterDiff("Hello there");
    bar({ engine });
    const disabled = (name: string) =>
      screen.getByRole("button", { name }).hasAttribute("disabled");
    expect(disabled("toolbar.bold")).toBe(true);
    expect(disabled("toolbar.italic")).toBe(true);
    // Structure and commands are navigation, not editing — they stay live, and
    // they are the only way off this screen.
    expect(disabled("tree.panelLabel")).toBe(false);
    expect(disabled("titlebar.palette")).toBe(false);
  });
});

// The bar redraws only when this answer changes: typing on inside a
// word leaves it alone, and every state the bar presses moves it.
describe("barFacts", () => {
  function typing(): EditorEngine {
    const engine = new EditorEngine();
    engine.open("Hello world");
    const end = { para: 0, offset: 11 };
    engine.updateSelection({ anchor: end, focus: end });
    engine.type("x");
    return engine;
  }

  it("stays the same while the writer types on", () => {
    const engine = typing();
    const facts = barFacts(engine);
    engine.type("yz");
    expect(barFacts(engine)).toBe(facts);
  });

  it("changes when undo first becomes possible", () => {
    const engine = new EditorEngine();
    engine.open("Hello world");
    const end = { para: 0, offset: 11 };
    engine.updateSelection({ anchor: end, focus: end });
    const fresh = barFacts(engine);
    engine.type("x");
    expect(barFacts(engine)).not.toBe(fresh);
  });

  it("changes when the caret's face or block changes", () => {
    const engine = typing();
    const plain = barFacts(engine);
    engine.toggleBold();
    const bold = barFacts(engine);
    expect(bold).not.toBe(plain);
    engine.setBlockType("h1");
    expect(barFacts(engine)).not.toBe(bold);
  });
});
