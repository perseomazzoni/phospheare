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
import CommentComposer from "./CommentComposer";
import type { PersonaFace } from "./faces";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

// Invented voices: the composer offers whatever faces it is handed.
const PERSONAS: PersonaFace[] = [
  { id: "wren", name: "Wren", color: "#155393" },
  { id: "ash", name: "Ash", color: "#C34127" },
  { id: "willow", name: "Willow", color: "#3B5842" },
];

function setup() {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <CommentComposer
      personas={PERSONAS}
      placeholder="Comment"
      submitLabel="Send"
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  );
  const area = screen.getByRole("combobox") as HTMLTextAreaElement;
  // jsdom puts the caret at the end of a value set by change, as typing does.
  const type = (value: string) => fireEvent.change(area, { target: { value } });
  return { area, type, onSubmit, onCancel };
}

describe("CommentComposer", () => {
  it("offers the personas whose names start with what follows an @", () => {
    const { area, type } = setup();
    type("Is this right, @W");
    expect(area.getAttribute("aria-expanded")).toBe("true");
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["Wren", "Willow"]);
  });

  it("offers nothing for an @ inside a word, like an address", () => {
    const { area, type } = setup();
    type("write to anna@W");
    expect(area.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("writes the picked name into the text as @Name, which is all a tag is", () => {
    const { area, type } = setup();
    type("Ask @W");
    fireEvent.keyDown(area, { key: "ArrowDown" });
    fireEvent.keyDown(area, { key: "Enter" });
    expect(area.value).toBe("Ask @Willow ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("picks with the pointer too", () => {
    const { area, type } = setup();
    type("@A");
    fireEvent.pointerDown(screen.getByRole("option", { name: "Ash" }));
    expect(area.value).toBe("@Ash ");
  });

  it("sends the trimmed text on Ctrl+Enter, and Enter alone is a new line", () => {
    const { area, type, onSubmit } = setup();
    type("  Two sentences.  ");
    fireEvent.keyDown(area, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledWith("Two sentences.");
    expect(area.value).toBe("");
  });

  it("sends nothing empty, and lets go on Escape", () => {
    const { area, type, onSubmit, onCancel } = setup();
    type("   ");
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.keyDown(area, { key: "Enter", metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(area, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps the words while a send is in flight and when it is refused", async () => {
    const { area, type, onSubmit } = setup();
    let refuse: (why: Error) => void = () => undefined;
    onSubmit.mockReturnValue(
      new Promise((_, reject) => {
        refuse = reject;
      }),
    );
    type("Too quick.");
    fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });
    // A second press while the first is writing sends nothing more.
    fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(async () => refuse(new Error("offline")));
    expect(area.value).toBe("Too quick.");
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
