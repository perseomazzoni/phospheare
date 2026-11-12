// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import Input, { AreaInput, WrapInput } from "./Input";

// ── Field frame and controls ─────────────────────────────────────────────────
//
// The kit's field frame and its two controls.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Input's frame", () => {
  it("draws the label, and keeps it for a screen reader when hidden", () => {
    render(<Input label="Search the web for" labelHidden defaultValue="x" />);
    const field = screen.getByLabelText("Search the web for");
    const label = document.querySelector("label") as HTMLLabelElement;
    expect(label.htmlFor).toBe(field.id);
    expect(label.className).toBe("ui-input-label ui-visually-hidden");
  });

  it("draws a flag between the field and the note, never live", () => {
    render(
      <Input
        label="Query"
        flag="Holds words from your book."
        evidence="Goes to Wikipedia."
        defaultValue="x"
      />,
    );
    const flag = screen.getByText("Holds words from your book.");
    const note = screen.getByText("Goes to Wikipedia.");
    expect(flag.className).toBe("ui-input-note ui-input-note-flag");
    expect(flag.hasAttribute("aria-live")).toBe(false);
    expect(
      flag.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("merges the caller's description with the flag's and the note's", () => {
    render(
      <Input
        id="q"
        label="Query"
        aria-describedby="count"
        flag="Flag."
        evidence="Note."
        defaultValue="x"
      />,
    );
    expect(
      screen.getByLabelText("Query").getAttribute("aria-describedby"),
    ).toBe("count q-flag q-note");
  });

  it("is described by nothing when there is nothing to describe it", () => {
    render(<Input label="Query" defaultValue="x" />);
    expect(
      screen.getByLabelText("Query").hasAttribute("aria-describedby"),
    ).toBe(false);
  });

  it("still marks a refusal invalid and announces it", () => {
    render(<Input label="Name" problem="Taken." defaultValue="x" />);
    const field = screen.getByLabelText("Name");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.className).toContain("ui-input-bad");
    expect(screen.getByText("Taken.").getAttribute("aria-live")).toBe("polite");
  });
});

describe("WrapInput, one line that wraps", () => {
  /** A controlled field, as every caller holds it. */
  function Controlled({
    initial = "",
    onKeyDown,
  }: {
    initial?: string;
    onKeyDown?: (event: React.KeyboardEvent) => void;
  }) {
    const [value, setValue] = useState(initial);
    return (
      <WrapInput
        label="Query"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />
    );
  }
  const field = () => screen.getByLabelText("Query") as HTMLTextAreaElement;

  it("is a one-row textarea carrying the kit's field and its wrap", () => {
    render(<Controlled initial="Porta Pia" />);
    expect(field().tagName).toBe("TEXTAREA");
    expect(field().className).toBe("ui-input ui-input-wrap");
    expect(field().rows).toBe(1);
  });

  it("adds no newline on Enter, and the caller still hears it", () => {
    const heard = vi.fn();
    render(<Controlled initial="Porta Pia" onKeyDown={heard} />);
    const enter = fireEvent.keyDown(field(), { key: "Enter" });
    expect(enter).toBe(false); // default prevented
    expect(heard).toHaveBeenCalledTimes(1);
    expect(fireEvent.keyDown(field(), { key: "a" })).toBe(true);
  });

  it("leaves an IME's composing Enter to the IME", () => {
    render(<Controlled initial="Porta Pia" />);
    expect(
      fireEvent.keyDown(field(), { key: "Enter", isComposing: true }),
    ).toBe(true);
  });

  // The caret stays where the paste left it.
  it("keeps the caret where a paste left it", () => {
    render(<Controlled />);
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set as (this: HTMLTextAreaElement, value: string) => void;
    setValue.call(field(), "ax\nyb");
    field().setSelectionRange(4, 4);
    fireEvent.input(field());
    expect(field().value).toBe("ax yb");
    expect(field().selectionStart).toBe(4);
  });

  // A shortened value gives the height back.
  it("gives the height back when the value shortens", () => {
    let content = 24;
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
      "get",
    ).mockImplementation(function (this: HTMLTextAreaElement) {
      // As a browser does: never less than an explicit height allows.
      const explicit = parseFloat(this.style.height) - 2;
      return Math.max(content, Number.isFinite(explicit) ? explicit : 0);
    });
    render(<Controlled initial="short" />);
    content = 60;
    fireEvent.change(field(), { target: { value: "much longer" } });
    expect(field().style.height).toBe("62px");
    content = 24;
    fireEvent.change(field(), { target: { value: "short" } });
    expect(field().style.height).toBe("26px");
  });

  // The textarea, like jsdom, normalises CR and CRLF to LF before the
  // handler, so this pins the outcome for every break a paste can carry,
  // whichever layer converts it.
  it("turns every line break a paste brings into a space", () => {
    render(<Controlled />);
    // Built from code points, so no raw separator sits in this file.
    const [LS, PS] = [0x2028, 0x2029].map((one) => String.fromCharCode(one));
    fireEvent.change(field(), {
      target: { value: `one\ntwo\r\nthree\rfour${LS}five${PS}six` },
    });
    expect(field().value).toBe("one two three four five six");
  });

  it("grows to its content, borders included, and shrinks back", () => {
    let content = 24;
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
      "get",
    ).mockImplementation(() => content);
    render(<Controlled initial="short" />);
    expect(field().style.height).toBe("26px");
    content = 60;
    fireEvent.change(field(), { target: { value: "much longer" } });
    expect(field().style.height).toBe("62px");
    content = 24;
    fireEvent.change(field(), { target: { value: "short" } });
    expect(field().style.height).toBe("26px");
  });

  it("measures again when its width changes, and not on its own growth", () => {
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: () => void) {
          observers.push(() => this.callback());
        }
        observe() {}
        disconnect() {}
      },
    );
    let content = 24;
    let width = 280;
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
      "get",
    ).mockImplementation(() => content);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      () => width,
    );
    render(<Controlled initial="Porta Pia 1870" />);
    content = 60;
    observers.forEach((notify) => notify());
    expect(field().style.height).toBe("26px");
    width = 200;
    observers.forEach((notify) => notify());
    expect(field().style.height).toBe("62px");
  });

  // `scrollHeight` counts an empty field's placeholder, and a placeholder can
  // change with neither the value nor the width, as a language switch does.
  // A measure that ignores it keeps the old height, and `overflow: hidden`
  // clips the new text.
  it("measures again when an empty field's placeholder changes", () => {
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
      "get",
    ).mockImplementation(function (this: HTMLTextAreaElement) {
      return this.value === "" && this.placeholder.length > 20 ? 60 : 24;
    });
    const { rerender } = render(
      <WrapInput
        label="Query"
        value=""
        placeholder="Short."
        onChange={() => {}}
      />,
    );
    expect(field().style.height).toBe("26px");
    rerender(
      <WrapInput
        label="Query"
        value=""
        placeholder="A placeholder long enough to wrap twice."
        onChange={() => {}}
      />,
    );
    expect(field().style.height).toBe("62px");
  });
});

// ── Area input ───────────────────────────────────────────────────────────────
//
// A field whose line breaks carry meaning, so it keeps them.

describe("AreaInput", () => {
  it("keeps the writer's line breaks, which WrapInput would turn into spaces", () => {
    const seen: string[] = [];
    render(
      <AreaInput
        label="Contact details"
        defaultValue=""
        onChange={(event) => seen.push(event.target.value)}
      />,
    );
    const field = screen.getByLabelText(
      "Contact details",
    ) as HTMLTextAreaElement;
    expect(field.tagName).toBe("TEXTAREA");
    fireEvent.change(field, { target: { value: "Ada\n1 Street" } });
    expect(seen).toEqual(["Ada\n1 Street"]);
  });

  it("wears the same frame: the note describes it, a problem marks it invalid", () => {
    render(<AreaInput label="Contact" problem="Too long." defaultValue="x" />);
    const field = screen.getByLabelText("Contact");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const note = screen.getByText("Too long.");
    expect(field.getAttribute("aria-describedby")).toContain(note.id);
  });
});
