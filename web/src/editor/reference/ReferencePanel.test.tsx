// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { useCallback, useState } from "react";
import type { SetStateAction } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ReferencePanel from "./ReferencePanel";
import type { ReferenceGroupId } from "../../project/reference";
import type { DirEntry, ProjectRef, StorageProvider } from "../../storage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
});

const REF: ProjectRef = {
  providerId: "memory",
  key: "demo",
  name: "Demo",
  openedAt: "",
};

function providerWith(names: string[], binned: string[] = []) {
  const writeFile = vi.fn(async () => undefined);
  const removeFile = vi.fn(async () => undefined);
  const moveFile = vi.fn(async () => undefined);
  const renameFile = vi.fn(async () => undefined);
  // Dir-aware, because the shelf and its bin read two folders and the one
  // recycle bin holds the manuscript's removed files beside the reference
  // ones. A listing that answered the same rows for every path would put every
  // document in the bin as well as on the shelf.
  const entries = (dir: string, of: string[]): DirEntry[] =>
    of.map((name) => ({ path: dir + "/" + name, name, kind: "file" as const }));
  const provider = {
    listDir: async (_ref: ProjectRef, dir: string): Promise<DirEntry[]> =>
      dir === "/recyclebin"
        ? entries("/recyclebin", binned)
        : entries("/reference", names),
    readFile: async () => "# test\n",
    // The write seam probes before it creates, so the fake must
    // answer the listing's own truth — a name that exists is refused.
    exists: async (_ref: ProjectRef, path: string) =>
      names.includes(path.slice("/reference/".length)),
    writeFile,
    removeFile,
    moveFile,
    renameFile,
  } as unknown as StorageProvider;
  return { provider, writeFile, removeFile, moveFile, renameFile };
}

type PanelOverrides = Partial<Parameters<typeof ReferencePanel>[0]>;

/**
 * The panel's fold is controlled by the shell (it must survive the dock's
 * face switches), so the suite holds it the way the shell does: state above
 * the panel, or a seeded set for the "renders what the shell holds" rows.
 */
function Harness({
  provider,
  initialCards = [],
  ...rest
}: {
  provider: StorageProvider;
  initialCards?: Iterable<ReferenceGroupId>;
} & Omit<PanelOverrides, "expandedCards" | "onExpandedCardsChange">) {
  const [cards, setCards] = useState<ReadonlySet<ReferenceGroupId>>(
    () => new Set(initialCards),
  );
  // Stable, exactly as the shell's own handler is: the panel's auto-expand
  // effect depends on these callbacks' identity, and a fresh one per render
  // would make the effect re-run (and fight a collapse) in the suite too.
  const handleCards = useCallback(
    (next: SetStateAction<ReadonlySet<ReferenceGroupId>>) =>
      setCards(
        (prev) => new Set(typeof next === "function" ? next(prev) : next),
      ),
    [],
  );
  return (
    <ReferencePanel
      provider={provider}
      projectRef={REF}
      structure={null}
      language={null}
      reference={null}
      editing={null}
      onStartEdit={vi.fn()}
      onDraft={vi.fn()}
      onCancelEdit={vi.fn()}
      onSaveEdit={vi.fn(async () => true)}
      onOpen={vi.fn()}
      onWrite={vi.fn()}
      {...rest}
      expandedCards={cards}
      onExpandedCardsChange={handleCards}
    />
  );
}

function renderPanel(provider: StorageProvider, props: PanelOverrides = {}) {
  const {
    expandedCards: _cards,
    onExpandedCardsChange: _change,
    ...rest
  } = props;
  return render(<Harness provider={provider} {...rest} />);
}

function cardFor(labelKey: string): HTMLElement {
  const el = screen.getByText(labelKey).closest("section");
  if (!el) throw new Error(`card ${labelKey} not found`);
  return el as HTMLElement;
}

function buttonFor(text: string): HTMLElement {
  const el = screen.getByText(text).closest("button");
  if (!el) throw new Error(`button ${text} not found`);
  return el as HTMLElement;
}

describe("ReferencePanel", () => {
  it("rests the divider at the faces' shared rest, and lets it go to their cap", async () => {
    renderPanel(providerWith([]).provider);
    const top = document.querySelector(".ref-top") as HTMLElement;
    expect(top.style.height).toBe("38%");
    fireEvent.keyDown(screen.getByRole("separator"), { key: "End" });
    expect(top.style.height).toBe("60%");
  });

  it("gives each shelf a leader, hidden from the reader", async () => {
    renderPanel(providerWith([]).provider);
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card-lead").length).toBe(4),
    );
    for (const lead of document.querySelectorAll(".ref-card-lead"))
      expect(lead.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders 4 cards", async () => {
    renderPanel(providerWith([]).provider);
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
  });

  it("keeps the cards in the row-major grid, not column stacks", async () => {
    // The row below may move when a card expands, but the sibling must not
    // stretch. That is the grid's `align-items: start` (pinned in
    // `editorCss.test.ts`); the DOM order stays row-major, which is also the
    // tab order.
    renderPanel(providerWith([]).provider);
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    const labels = [...document.querySelectorAll(".ref-card-label")].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual([
      "reference.group.guidebook",
      "reference.group.world",
      "reference.group.characters",
      "reference.group.summaries",
    ]);
    expect(document.querySelectorAll(".ref-card-col")).toHaveLength(0);
  });

  it("renders the folds the shell holds and reports a toggle up", async () => {
    render(
      <Harness provider={providerWith([]).provider} initialCards={["world"]} />,
    );
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    const world = cardFor("reference.group.world");
    const guidebook = cardFor("reference.group.guidebook");
    expect(world.getAttribute("data-open")).toBe("1");
    expect(guidebook.getAttribute("data-open")).toBe("0");
    fireEvent.click(guidebook.querySelector(".ref-card-head") as HTMLElement);
    expect(guidebook.getAttribute("data-open")).toBe("1");
  });

  // The auto-expand effect must not fight a deliberate collapse: the card
  // that owns the open document stays closed once the writer folds it.
  it("lets the writer collapse the card that owns the open document", async () => {
    renderPanel(providerWith(["world--economy.md"]).provider, {
      reference: "world--economy.md",
    });
    await waitFor(() =>
      expect(cardFor("reference.group.world").getAttribute("data-open")).toBe(
        "1",
      ),
    );
    fireEvent.click(screen.getByText("reference.group.world"));
    expect(cardFor("reference.group.world").getAttribute("data-open")).toBe(
      "0",
    );
    // It stays collapsed after the listing settles, too.
    await waitFor(() =>
      expect(cardFor("reference.group.world").getAttribute("data-open")).toBe(
        "0",
      ),
    );
  });

  it("expands each card independently", async () => {
    renderPanel(
      providerWith(["guidebook--logline.md", "world--economy.md"]).provider,
    );
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.guidebook"));
    fireEvent.click(screen.getByText("reference.group.world"));
    await waitFor(() =>
      expect(document.querySelectorAll('.ref-card[data-open="1"]').length).toBe(
        2,
      ),
    );

    // Closing one leaves the other where it was.
    fireEvent.click(screen.getByText("reference.group.guidebook"));
    await waitFor(() => {
      const open = document.querySelectorAll('.ref-card[data-open="1"]');
      expect(open.length).toBe(1);
      expect(open[0].textContent).toContain("reference.group.world");
    });
  });

  it("expands a compiled card and shows its catalogue sections", async () => {
    const onOpen = vi.fn();
    renderPanel(providerWith(["guidebook--logline.md"]).provider, { onOpen });
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.guidebook"));
    await waitFor(() =>
      expect(
        screen.getByText("reference.section.guidebook.logline"),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("reference.section.guidebook.logline"));
    expect(onOpen).toHaveBeenCalledWith("guidebook--logline.md");
  });

  // The compiled spaces are catalog-only: a hand-made file with a valid prefix
  // stays on disk but is not drawn.
  it("does not draw a freeform file in a compiled group", async () => {
    renderPanel(providerWith(["world--nordkapp.md"]).provider);
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.world"));
    expect(screen.queryByText("nordkapp")).toBeNull();
  });

  // A document is opened to be written and created only by a save that says
  // something, so the rows pin the opening, unborn, and that nothing
  // reaches the disk.
  it("opens the picker and opens the chosen section to be written, creating nothing", async () => {
    const { provider, writeFile } = providerWith([]);
    const onWrite = vi.fn();
    renderPanel(provider, { onWrite });
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    const world = cardFor("reference.group.world");
    fireEvent.click(world.querySelector(".ref-card-add") as HTMLElement);
    await waitFor(() =>
      expect(document.querySelector(".ref-picker")).toBeTruthy(),
    );
    fireEvent.click(buttonFor("reference.section.world.economy"));
    await waitFor(() =>
      expect(onWrite).toHaveBeenCalledWith(
        "world--economy.md",
        expect.stringContaining("# Economy"),
        true,
      ),
    );
    expect(writeFile).not.toHaveBeenCalled();
    expect(document.querySelector(".ref-picker")).toBeNull();
  });

  // The language seam reaches the bytes, not just the type checker.
  // Italian ships its own set, so an Italian project is seeded in
  // Italian; a language with no folder — and a project with no language at all
  // — still falls back to English rather than to an empty file.
  it("seeds a new section from the PROJECT's language, falling back to English", async () => {
    const expectedH1: Record<string, string> = {
      en: "# Economy",
      it: "# Economia",
      fr: "# Economy",
    };
    for (const language of ["en", "it", "fr", null]) {
      const { provider } = providerWith([]);
      const onWrite = vi.fn();
      renderPanel(provider, { language, onWrite });
      await waitFor(() =>
        expect(document.querySelectorAll(".ref-card").length).toBe(4),
      );
      const world = cardFor("reference.group.world");
      fireEvent.click(world.querySelector(".ref-card-add") as HTMLElement);
      await waitFor(() =>
        expect(document.querySelector(".ref-picker")).toBeTruthy(),
      );
      fireEvent.click(buttonFor("reference.section.world.economy"));
      // Never an empty file: a blank document reads to a writer as a broken
      // app, not as a missing translation. Matching on the template's own H1
      // is what proves a real asset was chosen and not "".
      await waitFor(() =>
        expect(onWrite, `language ${language}`).toHaveBeenCalledWith(
          "world--economy.md",
          expect.stringContaining(expectedH1[language ?? "en"]),
          true,
        ),
      );
      cleanup();
    }
  });

  it("does not offer a compiled section in the picker", async () => {
    renderPanel(providerWith(["world--economy.md"]).provider);
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(
      cardFor("reference.group.world").querySelector(
        ".ref-card-add",
      ) as HTMLElement,
    );
    await waitFor(() =>
      expect(document.querySelector(".ref-picker")).toBeTruthy(),
    );
    const picker = document.querySelector(".ref-picker") as HTMLElement;
    expect(
      within(picker).queryByText("reference.section.world.economy"),
    ).toBeNull();
    expect(
      within(picker).getByText("reference.section.world.factions"),
    ).toBeTruthy();
  });

  it("adds a character through the named field, substituting the title", async () => {
    const { provider, writeFile } = providerWith([]);
    const onWrite = vi.fn();
    renderPanel(provider, { onWrite });
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.addCharacter"));
    const input = screen.getByLabelText("reference.namePlaceholder");
    fireEvent.change(input, { target: { value: "Maren" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(onWrite).toHaveBeenCalledWith(
        "character--Maren.md",
        expect.stringContaining("# Maren"),
        true,
      ),
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("shows validation error for a duplicate character name", async () => {
    renderPanel(providerWith(["character--alpha.md"]).provider);
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.addCharacter"));
    const input = screen.getByLabelText("reference.namePlaceholder");
    fireEvent.change(input, { target: { value: "alpha" } });
    await waitFor(() =>
      expect(document.querySelector(".dt-name-error")).toBeTruthy(),
    );
  });

  it("auto-expands the card owning the open doc", async () => {
    renderPanel(providerWith(["character--maren.md"]).provider, {
      reference: "character--maren.md",
    });
    await waitFor(() => {
      const openCard = document.querySelector('.ref-card[data-open="1"]');
      expect(openCard?.textContent).toContain("reference.group.characters");
    });
  });

  it("expands the characters card for an open arc", async () => {
    renderPanel(
      providerWith(["character--maren.md", "arc--maren.md"]).provider,
      {
        reference: "arc--maren.md",
      },
    );
    await waitFor(() => {
      const openCard = document.querySelector('.ref-card[data-open="1"]');
      expect(openCard?.textContent).toContain("reference.group.characters");
    });
    expect(screen.getByText("reference.arc")).toBeTruthy();
  });

  it("opens a character's arc to be written from the character row", async () => {
    const { provider, writeFile } = providerWith(["character--maren.md"]);
    const onWrite = vi.fn();
    renderPanel(provider, { onWrite });
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.characters"));
    await waitFor(() =>
      expect(screen.getByText("reference.addArc")).toBeTruthy(),
    );
    // Named by its words, as the other buttons are, so a theme may set them.
    expect(
      screen.getByRole("button", { name: "reference.addArc" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("reference.addArc"));
    await waitFor(() =>
      expect(onWrite).toHaveBeenCalledWith(
        "arc--maren.md",
        expect.stringContaining("# maren — Character arc"),
        true,
      ),
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("renames a character and her arc together", async () => {
    // `arc--maren.md` is Maren's arc because the stems agree — a file-name
    // binding, not a record. Renaming the character alone would orphan it,
    // and an arc whose character is gone is drawn for nobody.
    const { provider, renameFile } = providerWith([
      "character--maren.md",
      "arc--maren.md",
    ]);
    renderPanel(provider, {});
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.characters"));
    await waitFor(() =>
      expect(document.querySelector(".ref-row-ren")).toBeTruthy(),
    );
    fireEvent.click(document.querySelector(".ref-row-ren") as HTMLElement);
    const field = await screen.findByLabelText("reference.namePlaceholder");
    expect((field as HTMLInputElement).value).toBe("maren");
    fireEvent.change(field, { target: { value: "vess" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(renameFile).toHaveBeenCalledTimes(2));
    expect(renameFile).toHaveBeenCalledWith(
      REF,
      "/reference/character--maren.md",
      "character--vess.md",
    );
    expect(renameFile).toHaveBeenCalledWith(
      REF,
      "/reference/arc--maren.md",
      "arc--vess.md",
    );
  });

  it("offers no rename on a catalogue section — its name is the catalogue's", async () => {
    // A `guidebook--`/`world--` file is named by its catalogue id and shows a
    // localized label. Renaming it would break the id or leave a file the
    // catalogue does not claim, so the control is not there.
    renderPanel(providerWith(["world--economy.md"]).provider, {});
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.world"));
    await waitFor(() =>
      expect(document.querySelector(".ref-row-del")).toBeTruthy(),
    );
    expect(document.querySelector(".ref-row-ren")).toBeNull();
  });

  it("deletes a section after the confirm and reports it up", async () => {
    const { provider, moveFile } = providerWith(["world--economy.md"]);
    const onDeleted = vi.fn();
    renderPanel(provider, { onDeleted });
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.world"));
    await waitFor(() =>
      expect(document.querySelector(".ref-row-del")).toBeTruthy(),
    );
    fireEvent.click(document.querySelector(".ref-row-del") as HTMLElement);
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByText("bin.moveTo"));
    // Binned, not removed: a section the writer compiled is their own work,
    // and the confirm does not claim it cannot be undone.
    await waitFor(() =>
      expect(moveFile).toHaveBeenCalledWith(
        REF,
        "/reference/world--economy.md",
        "/recyclebin",
      ),
    );
    expect(onDeleted).toHaveBeenCalledWith("world--economy.md");
  });

  it("deletes a character and her arc in one confirm", async () => {
    const { provider, moveFile } = providerWith([
      "character--maren.md",
      "arc--maren.md",
    ]);
    const onDeleted = vi.fn();
    renderPanel(provider, { onDeleted });
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.characters"));
    await waitFor(() =>
      expect(document.querySelector(".ref-row-del")).toBeTruthy(),
    );
    fireEvent.click(document.querySelector(".ref-row-del") as HTMLElement);
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByText("bin.moveTo"));
    await waitFor(() => expect(moveFile).toHaveBeenCalledTimes(2));
    expect(moveFile).toHaveBeenCalledWith(
      REF,
      "/reference/character--maren.md",
      "/recyclebin",
    );
    expect(moveFile).toHaveBeenCalledWith(
      REF,
      "/reference/arc--maren.md",
      "/recyclebin",
    );
    expect(onDeleted).toHaveBeenCalledTimes(2);
  });

  it("removes a generated summary outright rather than binning it", async () => {
    // Authored material is binned; derived material is removed. A summary is
    // something the assistant remakes on demand, so keeping a copy would fill
    // the bin with the one thing nobody restores.
    const { provider, removeFile, moveFile } = providerWith([
      "summary--EL1.md",
    ]);
    renderPanel(provider, {});
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.summaries"));
    await waitFor(() =>
      expect(document.querySelector(".ref-row-del")).toBeTruthy(),
    );
    fireEvent.click(document.querySelector(".ref-row-del") as HTMLElement);
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByText("reference.delete"));

    await waitFor(() =>
      expect(removeFile).toHaveBeenCalledWith(
        REF,
        "/reference/summary--EL1.md",
      ),
    );
    expect(moveFile).not.toHaveBeenCalled();
  });

  it("bars a document from the assistant and lets it back in", async () => {
    // The control the writer presses, and it is a project rule: the panel
    // reports the toggle up and the project writes it, so a chat opened
    // tomorrow inherits it. A per-chat rule fails open, every new chat
    // re-exposing the document silently.
    const onBarSource = vi.fn();
    renderPanel(providerWith(["world--economy.md"]).provider, {
      barredSourceIds: [],
      onBarSource,
    });
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.world"));
    const toggle = await waitFor(() => {
      const found = document.querySelector(".ref-row-ai");
      if (!found) throw new Error("no toggle");
      return found as HTMLElement;
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(onBarSource).toHaveBeenCalledWith(
      "reference:world--economy.md",
      true,
    );
    // The hover explanation rides the house tip contract, not a `title`.
    expect(toggle.querySelector(".ui-tip")?.textContent).toBe(
      "reference.aiAllowedTip",
    );
  });

  it("shows a barred document as barred without needing a hover", async () => {
    // A privacy rule the writer cannot see at rest is one they cannot trust,
    // so the barred state is lit rather than revealed on hover — and pressing
    // the same control is what undoes it.
    const onBarSource = vi.fn();
    renderPanel(providerWith(["world--economy.md"]).provider, {
      barredSourceIds: ["reference:world--economy.md"],
      onBarSource,
    });
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.world"));
    const toggle = await waitFor(() => {
      const found = document.querySelector(".ref-row-ai");
      if (!found) throw new Error("no toggle");
      return found as HTMLElement;
    });
    expect(toggle.classList.contains("barred")).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(onBarSource).toHaveBeenCalledWith(
      "reference:world--economy.md",
      false,
    );
  });

  it("offers no bar toggle at all when the project cannot take one", async () => {
    // The panel is rendered bare by harnesses, where there is no project to
    // write to. A control that silently did nothing would be worse than none.
    renderPanel(providerWith(["world--economy.md"]).provider, {});
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.world"));
    await waitFor(() =>
      expect(document.querySelector(".ref-row-del")).toBeTruthy(),
    );
    expect(document.querySelector(".ref-row-ai")).toBeNull();
  });

  it("draws no bin of its own — there is one recycle bin and it is the tree's", async () => {
    // A binned reference document is listed in the structure region's
    // recycle bin, beside the removed chapters, because `recyclebin/` is one
    // folder and a second view of it, missing half of what the writer
    // deleted, is the thing nobody can hold in their head. That bin is pinned
    // in `DocumentTree.test.tsx`.
    const { provider } = providerWith(
      ["world--economy.md"],
      ["character--maren.md"],
    );
    renderPanel(provider, {});
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    expect(document.querySelector(".ref-bin")).toBeNull();
    expect(screen.queryByText("reference.bin")).toBeNull();
    expect(screen.queryByText("maren")).toBeNull();
  });

  it("says so when a delete is refused, instead of swallowing it", async () => {
    const { provider } = providerWith(["world--economy.md"]);
    (provider as { moveFile: unknown }).moveFile = vi.fn(async () => {
      throw new Error("offline");
    });
    renderPanel(provider, {});
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.world"));
    await waitFor(() =>
      expect(document.querySelector(".ref-row-del")).toBeTruthy(),
    );
    fireEvent.click(document.querySelector(".ref-row-del") as HTMLElement);
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByText("bin.moveTo"));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "reference.deleteFailed",
      ),
    );
  });

  it("does not offer to delete the file being edited", async () => {
    renderPanel(providerWith(["world--economy.md"]).provider, {
      reference: "world--economy.md",
      editing: {
        fileName: "world--economy.md",
        savedText: "a",
        draft: "b",
      },
    });
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.world"));
    expect(document.querySelector(".ref-row-del")).toBeNull();
  });

  // The rename and delete move the arc with the character; a session on the
  // arc would go on saving under the old arc name.
  it.each([
    ["written", ["character--maren.md", "arc--maren.md"]],
    ["not yet on disk", ["character--maren.md"]],
  ])(
    "offers no rename or delete on a character whose arc (%s) is being edited",
    async (_label, names) => {
      renderPanel(providerWith(names).provider, {
        reference: "arc--maren.md",
        editing: { fileName: "arc--maren.md", savedText: "a", draft: "b" },
      });
      await waitFor(() =>
        expect(document.querySelectorAll(".ref-card").length).toBe(4),
      );
      await waitFor(() =>
        expect(screen.getAllByText("maren").length).toBeGreaterThan(0),
      );
      expect(document.querySelector(".ref-row-ren")).toBeNull();
      expect(document.querySelector(".ref-row-del")).toBeNull();
    },
  );

  it("divider handles keyboard", async () => {
    renderPanel(providerWith([]).provider);
    await waitFor(() =>
      expect(document.querySelector(".ref-divider")).toBeTruthy(),
    );
    const divider = document.querySelector(".ref-divider") as HTMLElement;
    fireEvent.keyDown(divider, { key: "ArrowDown" });
    fireEvent.keyDown(divider, { key: "ArrowUp" });
    fireEvent.keyDown(divider, { key: "Home" });
    fireEvent.keyDown(divider, { key: "End" });
  });

  it("shows editing session in bottom", async () => {
    renderPanel(providerWith(["character--maren.md"]).provider, {
      reference: "character--maren.md",
      editing: {
        fileName: "character--maren.md",
        savedText: "a",
        draft: "b",
      },
    });
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy());
  });

  // Summaries are not a compiled section group, so nothing re-offers them in
  // the picker: the Section's "It will be offered in the picker again" would
  // be a false promise on a destructive action, and the title names the kind
  // the writer is deleting.
  it("uses the summary's own confirm copy, with no false picker promise", async () => {
    const { provider, removeFile } = providerWith(["summary--EL1.md"]);
    renderPanel(provider);
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.group.summaries"));
    await waitFor(() =>
      expect(document.querySelector(".ref-row-del")).toBeTruthy(),
    );
    fireEvent.click(document.querySelector(".ref-row-del") as HTMLElement);
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toContain("reference.deleteSummaryTitle");
    expect(confirm.textContent).toContain("reference.deleteSummaryBody");
    expect(confirm.textContent).not.toContain("reference.deleteSectionBody");
    fireEvent.click(within(confirm).getByText("reference.delete"));
    await waitFor(() =>
      expect(removeFile).toHaveBeenCalledWith(
        REF,
        "/reference/summary--EL1.md",
      ),
    );
  });

  // A creation that does not land keeps the picker open for the retry and
  // speaks the failure. The press writes nothing, so
  // what can fail is the existence probe that decides what opens.
  it("keeps the picker open and says so when a section cannot be opened", async () => {
    const { provider } = providerWith([]);
    Object.assign(provider, {
      exists: vi.fn(async () => {
        throw new Error("io");
      }),
    });
    renderPanel(provider);
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    const world = cardFor("reference.group.world");
    fireEvent.click(world.querySelector(".ref-card-add") as HTMLElement);
    await waitFor(() =>
      expect(document.querySelector(".ref-picker")).toBeTruthy(),
    );
    fireEvent.click(buttonFor("reference.section.world.economy"));
    await waitFor(() =>
      expect(screen.getByText("reference.createFailed")).toBeTruthy(),
    );
    expect(document.querySelector(".ref-picker")).toBeTruthy();
    // Dismissing the picker takes the failure with it — it must not outlive
    // the field it belongs to.
    fireEvent.click(document.querySelector(".ref-picker-close") as HTMLElement);
    expect(screen.queryByText("reference.createFailed")).toBeNull();
    expect(document.querySelector(".ref-picker")).toBeNull();
  });

  // On the field rather than the picker: the shared
  // component's re-arm is what makes a retry possible at all, so this row
  // fails if `settled` is never cleared after a false answer.
  it("re-arms the character field and lands the retry", async () => {
    const { provider } = providerWith([]);
    const exists = vi
      .fn()
      .mockRejectedValueOnce(new Error("io"))
      .mockResolvedValueOnce(false);
    Object.assign(provider, { exists });
    const onWrite = vi.fn();
    renderPanel(provider, { onWrite });
    await waitFor(() =>
      expect(document.querySelectorAll(".ref-card").length).toBe(4),
    );
    fireEvent.click(screen.getByText("reference.addCharacter"));
    const input = screen.getByLabelText("reference.namePlaceholder");
    fireEvent.change(input, { target: { value: "Maren" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByText("reference.createFailed")).toBeTruthy(),
    );
    // The field re-armed: the same Enter retries and lands.
    fireEvent.keyDown(screen.getByLabelText("reference.namePlaceholder"), {
      key: "Enter",
    });
    await waitFor(() => expect(exists).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(onWrite).toHaveBeenCalledWith(
        "character--Maren.md",
        expect.stringContaining("# Maren"),
        true,
      ),
    );
  });
});
