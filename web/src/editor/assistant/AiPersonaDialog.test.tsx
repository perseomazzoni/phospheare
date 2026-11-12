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
  within,
} from "@testing-library/react";
import { useState } from "react";
import AiPersonaDialog from "./AiPersonaDialog";
import type { PersonaDefinition, PersonaPreset } from "../../ai/domain/types";
import { __resetOverlays } from "../../ui/overlay/useOverlay";

// The key, or — as i18next does for a key the locale lacks — the default the
// caller passed: a persona's description is the locale's words when it has
// them and the file's otherwise, and these personas are the file's.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

afterEach(() => {
  cleanup();
  __resetOverlays();
});

// Invented voices, not ones the application ships. This dialog is a picker
// over whatever list it is handed and cannot reach the model, the disk or the
// account, so the real folder would only tie the assertions to descriptions
// that are free to be reworded; the personas' names belong to their files.
// Three is the smallest list that tells apart "selected", "hovered" and
// "focused".
//
// The face is a URL and nothing else: whatever the bundler hands back for the
// `.png` beside the persona's markdown. Three distinct ones, because the
// portrait shows which voice is under the pointer, and one shared value would
// let a card that never changes its face pass.

const personas: PersonaDefinition[] = [
  {
    id: "1",
    name: "First Voice",
    description: "What the first one is for",
    compatibleWith: ["general"],
    instructions: "Answer plainly.",
    presets: [],
    ignores: [],
    avatar: "/assets/voice-1.png",
    color: "#336699",
  },
  {
    id: "2",
    name: "Second Voice",
    description: "What the second one is for",
    compatibleWith: ["general"],
    instructions: "Answer plainly.",
    presets: [],
    ignores: [],
    avatar: "/assets/voice-2.png",
    color: "#336699",
  },
  {
    id: "3",
    name: "Third Voice",
    description: "What the third one is for",
    compatibleWith: ["general"],
    instructions: "Answer plainly.",
    presets: [],
    ignores: [],
    avatar: "/assets/voice-3.png",
    color: "#336699",
  },
];
const [SELECTED, HOVERED, FOCUSED] = personas;

const note = () => document.querySelector(".ai-persona-description");
const portrait = () =>
  document.querySelector<HTMLImageElement>(".ai-persona-portrait");
/** The overlay moves focus in on a `setTimeout(0)`, after the layer paints. */
const settled = () => act(() => new Promise((r) => setTimeout(r, 0)));

/** The row a persona's name sits in. The name is a `<span>` inside it. */
function row(name: string): HTMLElement {
  const found = screen.getByText(name).closest("button");
  if (!found) throw new Error(`no row for ${name}`);
  return found;
}

function mount(onSelect = vi.fn(), onClose = vi.fn()) {
  render(
    <AiPersonaDialog
      open
      onClose={onClose}
      personas={personas}
      selectedId={SELECTED.id}
      onSelect={onSelect}
    />,
  );
  return { onSelect, onClose };
}

describe("AiPersonaDialog", () => {
  // A pick does not always close the dialog, so its foot has one button, OK,
  // which closes it and commits nothing; Escape closes it without choosing.
  it("has one OK in its foot, and Escape is still a way out without choosing", async () => {
    const { onSelect, onClose } = mount();
    await settled();
    const foot = document.querySelector(".ui-dialog-foot") as HTMLElement;
    expect(foot.querySelectorAll("button")).toHaveLength(1);
    fireEvent.click(within(foot).getByText("dock.personaOk"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // The face is the card's, not the row's. Asserted as a sequence rather than
  // as two presence checks, because both elements would still be in the row
  // with the tick leading it, and a leading mark is a column of glyphs empty
  // in every line but one, which the eye reads as the list.
  it("leaves the rows to the names and closes each one with the state", () => {
    mount();
    const parts = [...row(SELECTED.name).children].map((one) => one.className);
    // The kit row's own parts, each keeping the dialog's hook beside the kit
    // class.
    expect(parts).toEqual([
      "ui-row-text ai-persona-name",
      "ui-row-tick ai-persona-mark",
    ]);
    // No per-row art: four faces at row scale are four coloured dots beside
    // words; the portrait carries the face.
    expect(row(SELECTED.name).querySelector("img")).toBeNull();
  });

  // Pinned at both ends: the overlay moves focus inside on open, the rows
  // drive the card from `onFocus`, and the default landing place is the first
  // focusable thing. Landing there, the card would show whichever voice sorts
  // first while the tick sits on the writer's own voice.
  it("opens on the selected row, so the card describes the voice in use", async () => {
    // Not the first row, or landing on the first row would pass.
    render(
      <AiPersonaDialog
        open
        onClose={vi.fn()}
        personas={personas}
        selectedId={FOCUSED.id}
        onSelect={vi.fn()}
      />,
    );
    await settled();
    expect(document.activeElement).toBe(row(FOCUSED.name));
    expect(portrait()?.getAttribute("src")).toBe(FOCUSED.avatar);
    expect(note()?.textContent).toBe(FOCUSED.description);
  });

  it("carries one portrait, at a size a face can be read at", () => {
    mount();
    const face = portrait();
    expect(face?.getAttribute("src")).toBe(SELECTED.avatar);
    // Decorative: the name it depicts is in the list beside it. An empty alt
    // already takes an image out of the accessibility tree, and `aria-hidden`
    // on top of that would be two mechanisms for one fact.
    expect(face?.getAttribute("alt")).toBe("");
    expect(face?.getAttribute("aria-hidden")).toBeNull();
    // Sized on the element, so the card does not reflow once it decodes.
    expect(face?.getAttribute("width")).toBe("128");
    expect(document.querySelectorAll(".ai-persona-portrait").length).toBe(1);
  });

  // The portrait and the paragraph are one record of one voice, so they must
  // never disagree about which voice that is. Same state, checked through the
  // same three gestures the description's own suites use.
  it("moves the portrait with the description, and rests on the selection", () => {
    mount();
    expect(portrait()?.getAttribute("src")).toBe(SELECTED.avatar);

    fireEvent.mouseEnter(row(HOVERED.name));
    expect(portrait()?.getAttribute("src")).toBe(HOVERED.avatar);
    expect(note()?.textContent).toBe(HOVERED.description);
    fireEvent.mouseLeave(row(HOVERED.name));
    expect(portrait()?.getAttribute("src")).toBe(SELECTED.avatar);

    fireEvent.focus(row(FOCUSED.name));
    expect(portrait()?.getAttribute("src")).toBe(FOCUSED.avatar);
    fireEvent.blur(row(FOCUSED.name));
    expect(portrait()?.getAttribute("src")).toBe(SELECTED.avatar);
  });

  it("keeps the face steady in the gap between two rows", () => {
    // Only leaving the list hands the card back. A row that handed it back
    // as the pointer left would flash the selected face in the gap before
    // the next row, a moment with nothing hovered.
    mount();
    const list = document.querySelector(".ai-persona-list") as HTMLElement;
    fireEvent.mouseEnter(row(HOVERED.name));
    fireEvent.mouseOut(row(HOVERED.name), { relatedTarget: list });
    expect(portrait()?.getAttribute("src")).toBe(HOVERED.avatar);
    fireEvent.mouseOut(list, { relatedTarget: document.body });
    expect(portrait()?.getAttribute("src")).toBe(SELECTED.avatar);
  });

  it("lays the card out in two columns, and in one with no face to show", () => {
    mount();
    const card = document.querySelector(".ai-persona-card");
    // The card is the dialog body, one element with both class names, so no
    // second body rule wins the gap by being written later.
    expect(card?.classList.contains("ui-dialog-body")).toBe(true);
    expect(card?.getAttribute("data-faced")).toBe("1");
    // The description is a child of the card and not of a column, because it
    // spans both: inside the right column its hairline would begin aligned
    // to nothing and leave dead space under the portrait.
    expect(note()?.parentElement).toBe(card);
    expect(document.querySelector(".ai-persona-list")?.parentElement).toBe(
      card,
    );
  });

  it("draws no portrait when the folder holds no voice", () => {
    // An `<img>` with no `src` is a broken-image glyph, and this is the one
    // state that can reach it. The list says the same thing in words.
    render(
      <AiPersonaDialog
        open
        onClose={vi.fn()}
        personas={[]}
        selectedId=""
        onSelect={vi.fn()}
      />,
    );
    expect(portrait()).toBeNull();
    expect(screen.getByText("dock.noPersona")).toBeTruthy();
    // And the card says so, so the hint is not indented past a face that is
    // not there.
    expect(
      document.querySelector(".ai-persona-card")?.getAttribute("data-faced"),
    ).toBe("0");
  });

  it("holds the tick's seat in every row, selected or not", () => {
    mount();
    // Held, so the name's box is the same width in both states and choosing a
    // row cannot re-measure a name that was fitting exactly. The tick itself
    // is in one row only.
    for (const one of personas)
      expect(row(one.name).querySelector(".ai-persona-mark")).toBeTruthy();
    expect(document.querySelectorAll(".ai-persona-mark svg").length).toBe(1);
    expect(
      row(SELECTED.name).querySelector(".ai-persona-mark svg"),
    ).toBeTruthy();
  });

  it("describes the selected persona at rest, not an empty box", () => {
    mount();
    // One row is selected and nothing is hovered or focused: the writer
    // arrives reading what the voice they are already using does.
    expect(note()?.textContent).toBe(SELECTED.description);
    expect(row(SELECTED.name).getAttribute("aria-pressed")).toBe("true");
  });

  it("follows the pointer and hands the box back on the way out", () => {
    mount();
    const other = row(HOVERED.name);
    fireEvent.mouseEnter(other);
    expect(note()?.textContent).toBe(HOVERED.description);
    fireEvent.mouseLeave(other);
    expect(note()?.textContent).toBe(SELECTED.description);
  });

  it("follows the keyboard too, so tabbing narrates what hovering shows", () => {
    mount();
    // The description is a live region rather than an `aria-describedby` on
    // each row because it tracks focus: describedby would make a
    // reader announce the same words twice in a row.
    const other = row(FOCUSED.name);
    fireEvent.focus(other);
    expect(note()?.textContent).toBe(FOCUSED.description);
    expect(note()?.getAttribute("aria-live")).toBe("polite");
    fireEvent.blur(other);
    expect(note()?.textContent).toBe(SELECTED.description);
  });

  // A pick closes the dialog once the chat reflects the voice, and only when
  // that voice has no focus to choose; `the focus` pins the other half. The
  // harness reflects the pick the way the chat does.
  it("commits the choice and closes in one gesture, for a voice with no focus to choose", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    function Chat() {
      const [id, setId] = useState(SELECTED.id);
      return (
        <AiPersonaDialog
          open
          onClose={onClose}
          personas={personas}
          selectedId={id}
          onSelect={(next) => {
            onSelect(next);
            setId(next);
          }}
        />
      );
    }
    render(<Chat />);
    fireEvent.click(screen.getByText(HOVERED.name));
    expect(onSelect).toHaveBeenCalledWith(HOVERED.id);
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open on a pick the chat has not taken yet", () => {
    const { onSelect, onClose } = mount();
    fireEvent.click(screen.getByText(HOVERED.name));
    expect(onSelect).toHaveBeenCalledWith(HOVERED.id);
    // `selectedId` never caught up: the save did not land, so the dialog
    // stays on the voice still in force rather than closing on nothing.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    render(
      <AiPersonaDialog
        open={false}
        onClose={vi.fn()}
        personas={personas}
        selectedId={SELECTED.id}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText(SELECTED.name)).toBeNull();
  });

  it("says so rather than drawing an empty list when there are no personas", () => {
    render(
      <AiPersonaDialog
        open
        onClose={vi.fn()}
        personas={[]}
        selectedId={SELECTED.id}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("dock.noPersona")).toBeTruthy();
    expect(note()?.textContent).toBe("");
  });

  describe("a voice this chat cannot use", () => {
    // Listed, dimmed and inert, never left out: a missing voice reads as a
    // bug, and the shared menu's own rule is "dimmed and inert rather than
    // removed".
    const why = "Not in this kind of chat. Third Voice is for: Alpha reader.";
    function mountWithUnavailable(onSelect = vi.fn(), onClose = vi.fn()) {
      render(
        <AiPersonaDialog
          open
          onClose={onClose}
          personas={personas}
          selectedId={SELECTED.id}
          onSelect={onSelect}
          unavailable={new Map([[FOCUSED.id, why]])}
        />,
      );
      return { onSelect, onClose };
    }

    it("is listed and says it is unavailable", () => {
      mountWithUnavailable();
      expect(row(FOCUSED.name).getAttribute("aria-disabled")).toBe("true");
      expect(row(FOCUSED.name).textContent).toContain(
        "dock.personaUnavailable",
      );
      // The others are untouched.
      expect(row(HOVERED.name).getAttribute("aria-disabled")).toBeNull();
    });

    it("cannot be chosen", () => {
      const { onSelect, onClose } = mountWithUnavailable();
      fireEvent.click(row(FOCUSED.name));
      expect(onSelect).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("gives its reason, and a black-and-white face, when pointed at or focused", () => {
      mountWithUnavailable();
      expect(note()?.textContent).not.toContain(why);
      expect(portrait()?.dataset.unavailable).toBeUndefined();

      fireEvent.mouseEnter(row(FOCUSED.name));
      expect(note()?.textContent).toContain(FOCUSED.description);
      expect(note()?.textContent).toContain(why);
      expect(portrait()?.dataset.unavailable).toBe("1");

      fireEvent.mouseLeave(row(FOCUSED.name));
      fireEvent.focus(row(FOCUSED.name));
      expect(note()?.textContent).toContain(why);
    });

    it("holds room for a reason, so the centred card never grows under the pointer", () => {
      mountWithUnavailable();
      expect(
        document
          .querySelector(".ai-persona-card")
          ?.getAttribute("data-reasons"),
      ).toBe("1");
    });
  });
});

describe("the focus", () => {
  const preset = (id: string) => ({
    id,
    chats: ["general" as const],
    obsessions: [],
    reads: [],
  });
  const mount = (presets = [preset("a"), preset("b")]) => {
    const onSelectPreset = vi.fn();
    const onClose = vi.fn();
    render(
      <AiPersonaDialog
        open
        onClose={onClose}
        personas={personas}
        selectedId="1"
        onSelect={vi.fn()}
        presets={presets}
        selectedPresetId="b"
        onSelectPreset={onSelectPreset}
      />,
    );
    return { onSelectPreset, onClose };
  };

  it("lists the selected voice's focuses, ticks the one in force, and lands a pick", () => {
    const { onSelectPreset, onClose } = mount();
    const group = screen.getByRole("group", { name: "dock.focus" });
    const a = screen.getByRole("button", { name: /dock\.preset\.a\.name/ });
    const b = screen.getByRole("button", { name: /dock\.preset\.b\.name/ });
    expect(group.contains(a)).toBe(true);
    expect(b.textContent).toContain("dock.preset.b.hint");
    expect(a.getAttribute("aria-pressed")).toBe("false");
    expect(b.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(a);
    expect(onSelectPreset).toHaveBeenCalledWith("a");
    // A focus picked on its own lands and leaves the dialog open for OK;
    // only a voice-then-focus visit closes by itself.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the dialog open after a voice pick while that voice has a focus to choose", () => {
    // Voice and focus in one visit.
    const onClose = vi.fn();
    const onSelectPreset = vi.fn();
    const focusesOf = (id: string): PersonaPreset[] =>
      id === HOVERED.id ? [preset("x"), preset("y")] : [];
    function Chat() {
      const [id, setId] = useState(SELECTED.id);
      const offered = focusesOf(id);
      return (
        <AiPersonaDialog
          open
          onClose={onClose}
          personas={personas}
          selectedId={id}
          onSelect={setId}
          presets={offered}
          selectedPresetId={offered[0]?.id}
          onSelectPreset={onSelectPreset}
        />
      );
    }
    render(<Chat />);
    fireEvent.click(screen.getByText(HOVERED.name));
    expect(onClose).not.toHaveBeenCalled();
    // The keyboard lands on the focus in force, the next thing to choose.
    const x = screen.getByRole("button", { name: /dock\.preset\.x\.name/ });
    expect(document.activeElement).toBe(x);
    fireEvent.click(
      screen.getByRole("button", { name: /dock\.preset\.y\.name/ }),
    );
    expect(onSelectPreset).toHaveBeenCalledWith("y");
    expect(onClose).toHaveBeenCalled();
  });

  it("draws no choice where there is only one focus", () => {
    mount([preset("a")]);
    expect(screen.queryByRole("group", { name: "dock.focus" })).toBeNull();
  });
});
