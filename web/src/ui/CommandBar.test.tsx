// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  CommandBar,
  CommandBarFind,
  CommandBarSegment,
  CommandBarToggle,
  CommandBarTrack,
  Tip,
} from "./CommandBar";

afterEach(() => cleanup());

// The bar's shape and motion are CSS, which jsdom does not run. These rows pin
// the React contract the stylesheet is written against: the attributes its
// selectors key off, and what a screen reader is told.

describe("CommandBarToggle", () => {
  it("says whether it is engaged, so the fill has something to key off", () => {
    render(
      <CommandBarToggle label="Bold" text="B" pressed onClick={() => {}} />,
    );
    expect(
      screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("reports itself off just as loudly", () => {
    render(
      <CommandBarToggle
        label="Bold"
        text="B"
        pressed={false}
        onClick={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  // A formatting control acts on the current selection. A toolbar button that
  // took focus would collapse the caret before its click handler ran.
  it("refuses the caret", () => {
    render(
      <CommandBarToggle
        label="Bold"
        text="B"
        pressed={false}
        onClick={() => {}}
      />,
    );
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    screen.getByRole("button", { name: "Bold" }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("draws the shortcut as a key rather than as parenthetical text", () => {
    render(
      <CommandBarToggle
        label="Bold"
        text="B"
        pressed={false}
        shortcut="Ctrl+B"
        onClick={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: "Bold" });
    // The accessible name stays the command's own word; the key is beside it.
    expect(button.getAttribute("title")).toBeNull();
    expect(button.querySelector(".ui-kbd")?.textContent).toBe("Ctrl+B");
  });

  it("fires", () => {
    const onClick = vi.fn();
    render(
      <CommandBarToggle
        label="Bold"
        text="B"
        pressed={false}
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("goes quiet when disabled", () => {
    const onClick = vi.fn();
    render(
      <CommandBarToggle
        label="Redo"
        text="R"
        pressed={false}
        disabled
        onClick={onClick}
      />,
    );
    const button = screen.getByRole("button", {
      name: "Redo",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("attention on a toggle", () => {
  // The mark says something waits behind an unpressed toggle, and is gone once
  // the toggle is pressed.
  it("marks a shut toggle, and never a pressed one", () => {
    const { rerender } = render(
      <CommandBarToggle
        label="Assistant"
        text="A"
        pressed={false}
        attention
        onClick={() => {}}
      />,
    );
    const control = screen.getByRole("button", { name: "Assistant" });
    expect(control.getAttribute("data-attention")).toBe("1");
    rerender(
      <CommandBarToggle
        label="Assistant"
        text="A"
        pressed
        attention
        onClick={() => {}}
      />,
    );
    expect(control.hasAttribute("data-attention")).toBe(false);
    rerender(
      <CommandBarToggle
        label="Assistant"
        text="A"
        pressed={false}
        onClick={() => {}}
      />,
    );
    expect(control.hasAttribute("data-attention")).toBe(false);
  });

  it("marks a track's cell only while another is chosen", () => {
    const options = [
      { value: "ask", text: "Ask", label: "Ask", attention: true },
      { value: "notes", text: "Notes", label: "Notes" },
    ] as const;
    const { rerender } = render(
      <CommandBarTrack
        label="Faces"
        options={[...options]}
        value="notes"
        onChange={() => {}}
      />,
    );
    const ask = screen.getByRole("button", { name: "Ask" });
    const notes = screen.getByRole("button", { name: "Notes" });
    expect(ask.getAttribute("data-attention")).toBe("1");
    expect(notes.hasAttribute("data-attention")).toBe(false);
    rerender(
      <CommandBarTrack
        label="Faces"
        options={[...options]}
        value="ask"
        onChange={() => {}}
      />,
    );
    expect(ask.hasAttribute("data-attention")).toBe(false);
  });

  it("marks a busy cell only while another is chosen", () => {
    // The Ask tab's spark shows a chat answering while another face is open,
    // and only then: on the Ask face the Stop button already says so.
    const options = [
      { value: "ask", text: "Ask", label: "Ask", busy: true },
      { value: "notes", text: "Notes", label: "Notes" },
    ] as const;
    const { rerender } = render(
      <CommandBarTrack
        label="Faces"
        options={[...options]}
        value="notes"
        onChange={() => {}}
      />,
    );
    const ask = screen.getByRole("button", { name: "Ask" });
    expect(ask.getAttribute("data-busy")).toBe("1");
    expect(
      screen.getByRole("button", { name: "Notes" }).hasAttribute("data-busy"),
    ).toBe(false);
    rerender(
      <CommandBarTrack
        label="Faces"
        options={[...options]}
        value="ask"
        onChange={() => {}}
      />,
    );
    expect(ask.hasAttribute("data-busy")).toBe(false);
  });
});

describe("CommandBarTrack", () => {
  const OPTIONS = [
    { value: "left", text: "L", label: "Align left" },
    { value: "center", text: "C", label: "Align centre" },
    { value: "right", text: "R", label: "Align right" },
    { value: "justify", text: "J", label: "Justify" },
  ] as const;

  const track = () => document.querySelector(".ui-bar-track") as HTMLElement;

  // An index rather than a value name, so the stylesheet multiplies instead of
  // needing a rule per position, and tracks of any cell count share one rule.
  it("carries the chosen index for the thumb to travel by", () => {
    render(
      <CommandBarTrack
        label="Alignment"
        options={[...OPTIONS]}
        value="right"
        onChange={() => {}}
      />,
    );
    expect(track().style.getPropertyValue("--track-at")).toBe("2");
  });

  it("takes its cell width from the caller", () => {
    render(
      <CommandBarTrack
        label="Alignment"
        options={[...OPTIONS]}
        value="left"
        cell={30}
        onChange={() => {}}
      />,
    );
    expect(track().style.getPropertyValue("--track-w")).toBe("30px");
  });

  it("presses exactly one cell", () => {
    render(
      <CommandBarTrack
        label="Alignment"
        options={[...OPTIONS]}
        value="center"
        onChange={() => {}}
      />,
    );
    const pressed = [...track().querySelectorAll("button")].filter(
      (b) => b.getAttribute("aria-pressed") === "true",
    );
    expect(pressed).toHaveLength(1);
    expect(pressed[0].getAttribute("aria-label")).toBe("Align centre");
  });

  it("reports the value that was chosen", () => {
    const onChange = vi.fn();
    render(
      <CommandBarTrack
        label="Alignment"
        options={[...OPTIONS]}
        value="left"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Justify" }));
    expect(onChange).toHaveBeenCalledWith("justify");
  });

  // An unknown value still draws: an index of -1 would put the thumb outside
  // the control.
  it("parks the thumb at the start for a value it does not hold", () => {
    render(
      <CommandBarTrack
        label="Alignment"
        options={[...OPTIONS]}
        value={"nowhere" as "left"}
        onChange={() => {}}
      />,
    );
    expect(track().style.getPropertyValue("--track-at")).toBe("0");
  });

  it("is a group, so the four cells are announced as one choice", () => {
    render(
      <CommandBarTrack
        label="Alignment"
        options={[...OPTIONS]}
        value="left"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("group", { name: "Alignment" })).toBeTruthy();
  });

  // A fitted track's cells are as wide as their words, so the thumb is
  // measured, not multiplied. jsdom lays nothing out, so the cells'
  // rectangles are stated here, at fractional widths, because rounding them
  // is the half-pixel drift the measurement exists to avoid.

  /** Lays the fitted track out as a browser would: 2px trough, then cells. */
  function layOut(widths: readonly number[]) {
    const row = track();
    const box = (left: number, width: number) =>
      ({
        left,
        width,
        right: left + width,
        top: 0,
        bottom: 26,
        height: 26,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const total = widths.reduce((sum, w) => sum + w, 4);
    row.getBoundingClientRect = () => box(100, total);
    Object.defineProperty(row, "offsetWidth", {
      configurable: true,
      value: total,
    });
    let left = 102;
    for (const [i, cell] of [...row.querySelectorAll("button")].entries()) {
      const at = left;
      cell.getBoundingClientRect = () => box(at, widths[i] ?? 0);
      left += widths[i] ?? 0;
    }
  }

  function Fitted({ value }: { value: (typeof OPTIONS)[number]["value"] }) {
    return (
      <CommandBarTrack
        label="Alignment"
        options={[...OPTIONS]}
        value={value}
        fit
        onChange={() => {}}
      />
    );
  }

  it("puts a fitted thumb under the chosen cell, to the fraction of a pixel", () => {
    const view = render(<Fitted value="left" />);
    layOut([92.1, 74.6, 51.4, 71.1]);
    view.rerender(<Fitted value="right" />);
    expect(track().dataset.fit).toBe("1");
    // 2px of trough, then 92.1 + 74.6 of the first two cells.
    expect(parseFloat(track().style.getPropertyValue("--thumb-x"))).toBeCloseTo(
      168.7,
      5,
    );
    expect(parseFloat(track().style.getPropertyValue("--thumb-w"))).toBeCloseTo(
      51.4,
      5,
    );
  });

  it("divides a scaled entrance back out of the measurement", () => {
    // The dock can be measured part-way through an entrance drawn at a scale:
    // the rectangles are scaled, while the thumb's pixels are layout pixels.
    const view = render(<Fitted value="left" />);
    layOut([80, 60, 40, 60]);
    const row = track();
    Object.defineProperty(row, "offsetWidth", {
      configurable: true,
      value: 488,
    });
    view.rerender(<Fitted value="center" />);
    expect(parseFloat(row.style.getPropertyValue("--thumb-x"))).toBeCloseTo(
      164,
      5,
    );
    expect(parseFloat(row.style.getPropertyValue("--thumb-w"))).toBeCloseTo(
      120,
      5,
    );
  });

  it("glides only once it has been placed", async () => {
    render(<Fitted value="left" />);
    // Not on the first placement: it would grow from nothing on every mount.
    expect(track().dataset.placed).toBeUndefined();
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(track().dataset.placed).toBe("1");
  });

  it("leaves an unfitted track to the stylesheet's arithmetic", () => {
    render(
      <CommandBarTrack
        label="Alignment"
        options={[...OPTIONS]}
        value="right"
        onChange={() => {}}
      />,
    );
    expect(track().dataset.fit).toBeUndefined();
    expect(track().style.getPropertyValue("--thumb-x")).toBe("");
  });

  it("lays a glyph and a word in one cell", () => {
    render(
      <CommandBarTrack
        label="Faces"
        options={[
          {
            value: "ask",
            icon: "spark",
            text: "Enlighten!",
            label: "Enlighten!",
          },
          { value: "notes", text: "Notes", label: "Notes" },
        ]}
        value="ask"
        fit
        onChange={() => {}}
      />,
    );
    const cell = screen.getByRole("button", { name: "Enlighten!" });
    // Glyph first, then the word: the spark names the feature before the word.
    expect(cell.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(cell.textContent).toContain("Enlighten!");
  });
});

describe("CommandBarFind", () => {
  it("refuses the browser's own list of past searches", () => {
    // A `type=search` input offers a dropdown of past entries, drawn over the
    // list this control filters and possibly from another project. That
    // history outlives sign-out, and the app can neither manage nor clear it.
    render(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("searchbox").getAttribute("autocomplete")).toBe(
      "off",
    );
  });

  it("folds an empty field on Escape, and holds a field with a query in it", () => {
    // Escape is the keyboard's way out of the find: blur from an empty field
    // closes the structure panel's face. With a query set the field does not
    // fold; `data-query` pins the box open, and Escape mid-search dismisses a
    // menu or a selection, not the query.
    const { rerender } = render(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value=""
        onChange={() => {}}
      />,
    );
    const field = screen.getByRole("searchbox");
    field.focus();
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(document.activeElement).not.toBe(field);

    rerender(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value="storm"
        onChange={() => {}}
      />,
    );
    field.focus();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(document.activeElement).toBe(field);
  });

  it("hands Escape with a query set to the caller that opted in", () => {
    // With a query typed, the key goes to a caller that asks for it; the
    // structure panel's find runs its back control's act, as the in-document
    // find does. Without `onEscape` the field does nothing, because the
    // browser's own Escape on a search field differs by engine.
    const onEscape = vi.fn();
    render(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value="storm"
        onChange={() => {}}
        onEscape={onEscape}
      />,
    );
    const field = screen.getByRole("searchbox");
    field.focus();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(field);
  });

  it("never hands the query to the browser spellchecker", () => {
    render(
      <CommandBarFind
        label="Find"
        placeholder="Find in this text..."
        value=""
        onChange={() => {}}
      />,
    );
    expect(
      document.querySelector(".ui-bar-find-input")?.getAttribute("spellcheck"),
    ).toBe("false");
  });

  it("draws no clear command until something has been typed", () => {
    render(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value=""
        onChange={() => {}}
        clearLabel="Clear search"
      />,
    );
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    render(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value="the"
        onChange={() => {}}
        clearLabel="Clear search"
      />,
    );
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();
  });

  it("gives the trailing slot to the caller's waiting figure instead of the clear command", () => {
    // The trailing edge holds one occupant. Two would overlap or widen the
    // field when a caller starts working. The clear command is the one that
    // yields, because the keyboard still empties the field without it.
    render(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value="the"
        onChange={() => {}}
        clearLabel="Clear search"
        busy={<span data-testid="waiting" />}
      />,
    );
    expect(screen.getByTestId("waiting")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("stands open with nothing typed when the caller says so", () => {
    // The structure panel's find replaces the panel's body, so it opens on an
    // empty query with a face under it and a sweep running. The shape and the
    // waiting figure follow `open`; the clear command and the count follow a
    // query, since an empty field has nothing to clear or count.
    render(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value=""
        onChange={() => {}}
        clearLabel="Clear search"
        count={<span>3 matches</span>}
        busy={<span data-testid="waiting" />}
        open
      />,
    );
    expect(
      document.querySelector(".ui-bar-find")?.getAttribute("data-query"),
    ).toBe("1");
    expect(screen.getByTestId("waiting")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(screen.queryByText("3 matches")).toBeNull();
    // The live region stands empty, ready to announce.
    expect(document.querySelector(".ui-bar-find-live")).toBeTruthy();
  });

  it("shows no waiting figure in an empty field nobody opened", () => {
    // Nothing has been asked yet, and a field that looks busy before the first
    // keystroke reads as broken. Only the caller's `open` changes that.
    render(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value=""
        onChange={() => {}}
        clearLabel="Clear search"
        busy={<span data-testid="waiting" />}
      />,
    );
    expect(screen.queryByTestId("waiting")).toBeNull();
  });

  it("— keeps the live region standing before there is a count", () => {
    // A live region inserted together with its first content has no change to
    // announce, so the first count would go unannounced. The container stands
    // first, empty.
    render(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value=""
        onChange={() => {}}
        count="12 results"
        clearLabel="Clear search"
      />,
    );
    const live = document.querySelector(".ui-bar-find-live");
    expect(live).toBeTruthy();
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.textContent).toBe("");
    // The count's own element mounts only with a count, because its entrance
    // fade runs on mount: mounted empty, the fade would run on nothing and the
    // number would arrive as a cut.
    expect(document.querySelector(".ui-bar-find-count")).toBeNull();
  });

  it("— announces the count through that same standing region", () => {
    // Re-rendered rather than mounted fresh: the same region node must survive
    // the change from empty to content, because a region replaced along with
    // its content announces nothing.
    const { rerender } = render(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value=""
        onChange={() => {}}
        count="12 results"
        clearLabel="Clear search"
      />,
    );
    const atRest = document.querySelector(".ui-bar-find-live");
    rerender(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value="the"
        onChange={() => {}}
        count="12 results"
        clearLabel="Clear search"
      />,
    );
    expect(document.querySelector(".ui-bar-find-live")).toBe(atRest);
    const live = document.querySelector(".ui-bar-find-live");
    expect(live?.textContent).toBe("12 results");
    expect(live?.querySelector(".ui-bar-find-count")?.textContent).toBe(
      "12 results",
    );
  });

  it("takes a scoping class without losing its own", () => {
    // The caller's class carries a token override and nothing else; the rail
    // rule and one e2e locator both aim at it.
    render(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value=""
        onChange={() => {}}
        className="dt-find"
      />,
    );
    const field = document.querySelector(".ui-bar-find");
    expect(field?.classList.contains("dt-find")).toBe(true);
  });

  it("clears the field from the clear command, without asking the writer to type it away", () => {
    const onChange = vi.fn();
    render(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value="the"
        onChange={onChange}
        clearLabel="Clear search"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("keeps the caret in the field when the clear command is pressed", () => {
    // The mousedown is cancelled so the button never takes focus, and the
    // caret stays in the field.
    render(
      <CommandBarFind
        label="Find"
        placeholder="Find"
        value="the"
        onChange={() => {}}
        clearLabel="Clear search"
      />,
    );
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    screen.getByRole("button", { name: "Clear search" }).dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });
});

describe("Tip", () => {
  it("is a tooltip, and says the shortcut when it has one", () => {
    render(<Tip label="Save" shortcut="Ctrl+S" />);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("SaveCtrl+S");
    expect(tip.querySelector(".ui-kbd")).toBeTruthy();
  });

  it("drops the key when there is none, rather than drawing an empty one", () => {
    render(<Tip label="Special characters" />);
    expect(screen.getByRole("tooltip").querySelector(".ui-kbd")).toBeNull();
  });
});

describe("Tip · inside the editor’s scrollport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function inBar() {
    render(
      <div className="bar-stack">
        <div className="ui-bar" data-tips="warm">
          <button type="button" data-tip="">
            Bold
            <Tip label="Bold" shortcut="Ctrl+B" />
          </button>
        </div>
      </div>,
    );
    return screen.getByRole("button", { name: "Bold" });
  }

  it("leaves the bar and renders at the body, so the scrollport cannot clip it", () => {
    const button = inBar();
    // No inline tip as a child: it renders outside the bar.
    expect(button.querySelector(".ui-tip")).toBeNull();
    fireEvent.pointerEnter(button);
    const tip = screen.getByRole("tooltip");
    expect(tip.classList.contains("ui-tip-portal")).toBe(true);
    expect(document.body.contains(tip)).toBe(true);
    expect(tip.textContent).toBe("BoldCtrl+B");
    expect(tip.querySelector(".ui-kbd")).toBeTruthy();
  });

  it("reveals after the warm delay and follows its trigger", () => {
    const button = inBar();
    fireEvent.pointerEnter(button);
    const tip = screen.getByRole("tooltip");
    expect(tip.getAttribute("data-open")).toBe("0");
    void act(() => vi.advanceTimersByTime(0));
    expect(tip.getAttribute("data-open")).toBe("1");
    expect(tip.style.left).toBe("0px");
  });

  it("hides again once the pointer leaves", () => {
    const button = inBar();
    fireEvent.pointerEnter(button);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.pointerLeave(button);
    void act(() => vi.advanceTimersByTime(130));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("CommandBar", () => {
  it("tells the stylesheet when a segment is showing a panel", () => {
    const { rerender } = render(
      <CommandBar>
        <CommandBarSegment>x</CommandBarSegment>
      </CommandBar>,
    );
    expect(document.querySelector(".ui-bar")?.getAttribute("data-open")).toBe(
      "0",
    );
    rerender(
      <CommandBar open>
        <CommandBarSegment>x</CommandBarSegment>
      </CommandBar>,
    );
    expect(document.querySelector(".ui-bar")?.getAttribute("data-open")).toBe(
      "1",
    );
  });
});
