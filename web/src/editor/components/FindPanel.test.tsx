// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createRef } from "react";
import FindPanel, {
  fieldToQuery,
  pastedToField,
  queryToField,
  type FindHandle,
} from "./FindPanel";
import { EditorEngine } from "../views/engine";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// Eleven controls over one search. The field lives in the bar, so opening
// find draws no second surface.

function find(text = "the cat and the dog and the bird") {
  const engine = new EditorEngine();
  engine.open(text);
  const ref = createRef<FindHandle>();
  const onOpenChange = vi.fn();
  const onQueryChange = vi.fn();
  render(
    <FindPanel
      engine={engine}
      ref={ref}
      onQueryChange={onQueryChange}
      onResult={vi.fn()}
      onOptionsChange={vi.fn()}
      onOpenChange={onOpenChange}
      onFocusChange={vi.fn()}
    >
      {/* The real shell renders the segment and the panel inside a bar-stack;
          the outside-click contract keys off that container, so the harness
          mirrors it. */}
      {({ segment, panel }) => (
        <div className="bar-stack">
          {segment}
          {panel}
        </div>
      )}
    </FindPanel>,
  );
  return { engine, ref, onOpenChange, onQueryChange };
}

const replaceField = () =>
  screen.getByLabelText("search.replacePlaceholder") as HTMLInputElement;

/** Waits out the frame the caret is put back in. */
const frame = () =>
  act(() => new Promise((resolve) => requestAnimationFrame(resolve)));

const field = () =>
  document.querySelector(".ui-bar-find-input") as HTMLInputElement;
const count = () => document.querySelector(".find-count")?.textContent;

describe("FindPanel", () => {
  it("draws every control", () => {
    find();
    expect(field()).toBeTruthy();
    for (const name of [
      "search.caseSensitive",
      "search.wholeWord",
      "search.hyphensJoinWords",
      "search.prev",
      "search.next",
      "search.close",
      "search.clearFormatting",
      "search.replacePlaceholder",
    ]) {
      expect(screen.getByLabelText(name), name).toBeTruthy();
    }
    expect(screen.getByText("search.replace")).toBeTruthy();
    expect(screen.getByText("search.replaceAll")).toBeTruthy();
    expect(document.querySelector(".find-count")).toBeTruthy();
  });

  // A query and a replacement are fragments to act on, not prose to judge.
  it("keeps both fields out of the browser spellchecker", () => {
    find();
    expect(field().getAttribute("spellcheck")).toBe("false");
    expect(
      (
        screen.getByLabelText("search.replacePlaceholder") as HTMLInputElement
      ).getAttribute("spellcheck"),
    ).toBe("false");
  });

  it("counts matches and walks them with the buttons", () => {
    find();
    fireEvent.change(field(), { target: { value: "the" } });
    expect(count()).toBe("1/3");
    fireEvent.click(screen.getByLabelText("search.next"));
    expect(count()).toBe("2/3");
    fireEvent.click(screen.getByLabelText("search.prev"));
    expect(count()).toBe("1/3");
  });

  it("wraps at the ends rather than stopping", () => {
    find();
    fireEvent.change(field(), { target: { value: "the" } });
    fireEvent.click(screen.getByLabelText("search.prev"));
    expect(count()).toBe("3/3");
  });

  it("says 0 when nothing matches", () => {
    find();
    fireEvent.change(field(), { target: { value: "zebra" } });
    expect(count()).toBe("0/0");
  });

  // No key walks the matches; the buttons do.
  it("walks matches with its buttons only, never a key", () => {
    find();
    fireEvent.change(field(), { target: { value: "the" } });
    for (const key of [
      { key: "Enter" },
      { key: "Enter", shiftKey: true },
      { key: "F3" },
      { key: "F3", shiftKey: true },
    ]) {
      fireEvent.keyDown(window, key);
      expect(count()).toBe("1/3");
    }
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(count()).toBe("1/3");
  });

  // Replace advances, as a word processor's does: the writer is walking the
  // document making the same change, and stopping on the one just made would
  // mean pressing next after every replace.
  it("replaces the current match, re-scans, and moves on", () => {
    const { engine } = find();
    fireEvent.change(field(), { target: { value: "the" } });
    fireEvent.change(screen.getByLabelText("search.replacePlaceholder"), {
      target: { value: "a" },
    });
    fireEvent.click(screen.getByText("search.replace"));
    expect(engine.commonmark).toContain("a cat");
    expect(count()).toBe("2/2");
  });

  it("finds again when the document changes, so a replace never lands on stale offsets", () => {
    const { engine } = find("the cat");
    fireEvent.change(field(), { target: { value: "cat" } });
    fireEvent.change(replaceField(), { target: { value: "dog" } });
    act(() => engine.open("a bird and a cat"));
    expect(count()).toBe("1/1");
    fireEvent.click(screen.getByText("search.replace"));
    expect(engine.commonmark).toBe("a bird and a dog");
  });

  it("replaces every match at once", () => {
    const { engine } = find();
    fireEvent.change(field(), { target: { value: "the" } });
    fireEvent.change(screen.getByLabelText("search.replacePlaceholder"), {
      target: { value: "a" },
    });
    fireEvent.click(screen.getByText("search.replaceAll"));
    expect(engine.commonmark).not.toContain("the");
    expect(count()).toBe("0/0");
  });

  it("holds the replace controls shut until there is something to replace", () => {
    find();
    expect(
      (screen.getByLabelText("search.replacePlaceholder") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(field(), { target: { value: "the" } });
    expect(
      (screen.getByLabelText("search.replacePlaceholder") as HTMLInputElement)
        .disabled,
    ).toBe(false);
  });

  it("narrows by case when asked", () => {
    find("The the THE");
    fireEvent.change(field(), { target: { value: "the" } });
    expect(count()).toBe("1/3");
    fireEvent.click(screen.getByLabelText("search.caseSensitive"));
    expect(count()).toBe("1/1");
  });

  it("narrows to whole words when asked", () => {
    find("cat cats catalogue");
    fireEvent.change(field(), { target: { value: "cat" } });
    expect(count()).toBe("1/3");
    fireEvent.click(screen.getByLabelText("search.wholeWord"));
    expect(count()).toBe("1/1");
  });

  it("joins hyphenated words when asked", () => {
    find("e-mail mail");
    fireEvent.change(field(), { target: { value: "mail" } });
    fireEvent.click(screen.getByLabelText("search.wholeWord"));
    expect(count()).toBe("1/2");
    fireEvent.click(screen.getByLabelText("search.hyphensJoinWords"));
    expect(count()).toBe("1/1");
  });

  it("reports the toggles as pressed, so the state is visible", () => {
    find();
    const caseTog = screen.getByLabelText("search.caseSensitive");
    expect(caseTog.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(caseTog);
    expect(caseTog.getAttribute("aria-pressed")).toBe("true");
  });

  // ── Opening and closing ────────────────────────────────────────────────────

  it("opens from the shell and reports it, so the panel can grow", () => {
    const { ref, onOpenChange } = find();
    expect(ref.current?.isOpen()).toBe(false);
    act(() => ref.current?.open());
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(ref.current?.isOpen()).toBe(true);
  });

  it("closes on Escape and forgets the query", () => {
    const { ref } = find();
    act(() => ref.current?.open());
    fireEvent.change(field(), { target: { value: "the" } });
    expect(count()).toBe("1/3");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(field().value).toBe("");
  });

  // The field is the bar's own trailing segment: typing widens it in place
  // rather than opening a second card below the toolbar.
  it("pins the field open while a query is narrowing the document", () => {
    find();
    const box = document.querySelector(".ui-bar-find") as HTMLElement;
    expect(box.getAttribute("data-query")).toBe("0");
    fireEvent.change(field(), { target: { value: "the" } });
    expect(box.getAttribute("data-query")).toBe("1");
  });

  it("closes the panel from its close icon, and forgets the query", () => {
    const { ref, onOpenChange } = find();
    act(() => ref.current?.open());
    fireEvent.change(field(), { target: { value: "the" } });
    fireEvent.click(screen.getByLabelText("search.close"));
    expect(ref.current?.isOpen()).toBe(false);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(field().value).toBe("");
  });

  it("clears the field from the clear command without closing the search", () => {
    const { ref } = find();
    act(() => ref.current?.open());
    fireEvent.change(field(), { target: { value: "the" } });
    expect(count()).toBe("1/3");
    fireEvent.click(screen.getByLabelText("search.clear"));
    expect(field().value).toBe("");
    expect(count()).toBeFalsy();
    // The writer is still mid-search — clearing is a retype, not a goodbye.
    expect(ref.current?.isOpen()).toBe(true);
  });

  // ── Collapsing from the writing surface ────────────────────────────────────

  it("collapses the whole search on a click outside the bar when the field is empty", () => {
    const { ref, onOpenChange } = find();
    act(() => ref.current?.open());
    fireEvent.pointerDown(document.body);
    expect(ref.current?.isOpen()).toBe(false);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps the search open on an outside click while a query is in the field", () => {
    const { ref } = find();
    act(() => ref.current?.open());
    fireEvent.change(field(), { target: { value: "the" } });
    fireEvent.pointerDown(document.body);
    expect(ref.current?.isOpen()).toBe(true);
    expect(field().value).toBe("the");
  });

  it("does not collapse when the click lands inside the bar itself", () => {
    const { ref } = find();
    act(() => ref.current?.open());
    fireEvent.pointerDown(field());
    expect(ref.current?.isOpen()).toBe(true);
  });

  // A query may hold a paragraph break.
  describe("paragraph breaks", () => {
    const BOOK = "It ended.\n\nThe door shut.\n\nIt ended.\n\nThe gate.\n";

    it("puts a break in the field on Shift+Enter, shown as ¶, and finds across paragraphs", async () => {
      const { onQueryChange } = find(BOOK);
      fireEvent.change(field(), { target: { value: "ended." } });
      field().setSelectionRange(6, 6);
      fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
      await frame();
      expect(field().value).toBe("ended.¶");
      expect(field().selectionStart).toBe(7);
      fireEvent.change(field(), { target: { value: "ended.¶The" } });
      expect(count()).toBe("1/2");
      expect(onQueryChange).toHaveBeenLastCalledWith("ended.\nThe");
    });

    it("keeps a pasted line break as a paragraph break, a blank line as one", async () => {
      find(BOOK);
      fireEvent.paste(field(), {
        clipboardData: { getData: () => "ended.\r\n\r\nThe door" },
      });
      await frame();
      expect(field().value).toBe("ended.¶The door");
      expect(count()).toBe("1/1");
      // A paste with no break is the field's own.
      const plain = fireEvent.paste(field(), {
        clipboardData: { getData: () => "door" },
      });
      expect(plain).toBe(true);
    });

    it("seeds a query with breaks as glyphs", () => {
      const { ref } = find(BOOK);
      act(() => ref.current?.open("ended.\nThe door"));
      expect(field().value).toBe("ended.¶The door");
      expect(count()).toBe("1/1");
    });

    it("replaces across a break, merging the paragraphs, and a ¶ in the replacement splits one", async () => {
      const { engine } = find(BOOK);
      fireEvent.change(field(), { target: { value: "ended.¶The" } });
      fireEvent.change(replaceField(), { target: { value: "ended. The" } });
      fireEvent.click(screen.getByText("search.replaceAll"));
      expect(engine.doc.map((p) => p.runs.map((r) => r.text).join(""))).toEqual(
        ["It ended. The door shut.", "It ended. The gate."],
      );
      fireEvent.change(field(), { target: { value: "door shut." } });
      fireEvent.change(replaceField(), { target: { value: "door" } });
      replaceField().setSelectionRange(4, 4);
      fireEvent.keyDown(replaceField(), { key: "Enter", shiftKey: true });
      await frame();
      expect(replaceField().value).toBe("door¶");
      fireEvent.change(replaceField(), { target: { value: "door¶Shut." } });
      // Enter in the replace field replaces.
      fireEvent.keyDown(replaceField(), { key: "Enter" });
      expect(engine.doc.map((p) => p.runs.map((r) => r.text).join(""))).toEqual(
        ["It ended. The door", "Shut.", "It ended. The gate."],
      );
    });

    it("keeps a pasted line break in the replacement too", async () => {
      find(BOOK);
      fireEvent.change(field(), { target: { value: "gate" } });
      fireEvent.paste(replaceField(), {
        clipboardData: { getData: () => "a\nb" },
      });
      await frame();
      expect(replaceField().value).toBe("a¶b");
    });
  });
});

describe("the field's glyphs", () => {
  it("reads each ¶ as a break and writes each break as one", () => {
    expect(fieldToQuery("a¶b¶")).toBe("a\nb\n");
    expect(queryToField("a\nb")).toBe("a¶b");
    expect(pastedToField("a\r\n \r\n\nb\rc")).toBe("a¶b¶c");
  });
});
