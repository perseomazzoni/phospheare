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
  waitFor,
  within,
} from "@testing-library/react";
import { countWords } from "../../project/stats";
import { titleProblem } from "../../project/naming";
import type { ProjectSeed } from "../../project/scaffold";
import {
  TYPE_GOAL_DEFAULTS,
  typeForWords,
  type DocNode,
} from "../../project/types";
import { commonmarkCodec } from "../engine/adapters/commonmark";
import { manuscriptText } from "./adapters/manuscriptText";
import { loadReader } from "./adapters/readers";
import { epubOf } from "./adapters/readers/packages.fixture";
import { probeZip } from "./adapters/zip";
import { readFile } from "./application/readFiles";
import type { TitleWords } from "./ports";
import { ImportWizard, type ImportWindowProps } from "./ImportWindow";
import type { ImportServices } from "./presentation/useImportSteps";

// Pins the import window as the writer meets it: the creation wizard, handed
// the import's two questions first (`useImportSteps`), with a test's
// services in place of the real wiring. The mock `t` returns the key with
// its variables, so a test sees both what was said and what was put into it,
// as in the export dialog's tests.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${Object.values(vars).join(",")})` : key,
    i18n: { language: "en" },
  }),
}));

afterEach(() => {
  cleanup();
});

const words: TitleWords = {
  untitled: "Untitled",
  matter: (kind) => `[${kind}]`,
  scene: (chapter, n) => `${chapter}, scene ${n}`,
  split: (row, n) => `${row} split ${n}`,
  shared: (title, n) => `${title} - ${n}`,
};

const SENTENCE =
  "The rain had not stopped since the ferry left the harbour at dawn.";
const prose = (n: number) =>
  Array.from({ length: n }, () => SENTENCE).join(" ");

const MANUSCRIPT = [
  "CHAPTER ONE",
  prose(20),
  prose(20),
  "CHAPTER TWO",
  prose(20),
  "* * *",
  prose(20),
  "CHAPTER THREE",
  prose(20),
].join("\n\n");

const fileOf = (name: string, text: string) =>
  new File([new TextEncoder().encode(text)], name, { type: "text/plain" });

type Props = ImportWindowProps & { services: ImportServices };

function open(over: Partial<Props> = {}) {
  const props: Props = {
    services: {
      read: (file) =>
        readFile(
          file,
          { load: loadReader, probe: probeZip },
          { yield: async () => undefined },
        ),
      writer: manuscriptText,
      rules: {
        countWords,
        titleProblem: (title) => titleProblem(title)?.code ?? null,
        typeForWords,
        typeGoal: (type) => TYPE_GOAL_DEFAULTS[type],
      },
      titleWords: (language) =>
        language === "it" ? { ...words, untitled: "Senza titolo" } : words,
    },
    driveConnected: false,
    email: "ada@example.com",
    localAvailable: true,
    localRootReady: true,
    remoteAvailable: true,
    taken: new Set(),
    accountName: "Ada Lovelace",
    progress: null,
    error: null,
    onImport: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const view = render(<ImportWizard {...props} />);
  return { props, view };
}

const heading = () => screen.getByRole("heading").textContent;
const button = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
const choose = (...files: File[]) => {
  const input = document.querySelector<HTMLInputElement>("input[type=file]");
  if (!input) throw new Error("no file input");
  fireEvent.change(input, { target: { files } });
};
/** The rows' names: a field for a row with a name to change, else text. */
const rowTitles = () =>
  [...document.querySelectorAll<HTMLElement>(".import-row-title")].map((n) =>
    n instanceof HTMLInputElement ? n.value : n.textContent,
  );
/** On through the creation wizard's own questions, to its last. */
const toLast = () => {
  while (!screen.queryByRole("button", { name: "import.confirm" }))
    fireEvent.click(button("create.continue"));
};
/** The seed the window handed the Library. */
const seedOf = async (props: Props): Promise<ProjectSeed> => {
  await waitFor(() => expect(props.onImport).toHaveBeenCalledTimes(1));
  return vi.mocked(props.onImport).mock.calls[0][0];
};
/** The seed's nodes in pre-order, as the project's tree holds them. */
const nodesOf = (seed: ProjectSeed): DocNode[] => {
  const walk = (nodes: readonly DocNode[]): DocNode[] =>
    nodes.flatMap((n) => [n, ...(n.kind === "part" ? walk(n.children) : [])]);
  return walk(seed.init.shape?.structure.children ?? []);
};
/** A node's paragraphs as text, read back with the project's own codec. */
const textOf = (seed: ProjectSeed, node: DocNode) =>
  commonmarkCodec
    .parse(
      seed.init.shape?.files.find((f) => f.fileName === node.adopted)
        ?.content ?? "",
    )
    .map((p) => p.runs.map((r) => r.text).join(""));

describe("the import window", () => {
  it("stops the read in progress when the window closes", async () => {
    const signals: AbortSignal[] = [];
    const { props, view } = open();
    props.services.read = (_file, signal) => {
      signals.push(signal);
      return new Promise(() => undefined);
    };
    view.rerender(<ImportWizard {...props} />);
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0].aborted).toBe(false);
    view.unmount();
    expect(signals[0].aborted).toBe(true);
  });

  it("steps in only the chapters a Part will hold", async () => {
    // Each row stands at its depth in the tree it will become: its item's.
    const inPart = () =>
      [...document.querySelectorAll<HTMLElement>(".import-row")].map(
        (row) =>
          row
            .closest<HTMLElement>(".import-group")
            ?.style.getPropertyValue("--depth") ?? "",
      );
    const kinds = () =>
      [...document.querySelectorAll<HTMLElement>(".import-row")].map(
        (row) => row.dataset.kind,
      );
    open();
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    // No Parts: every chapter at the margin.
    expect(inPart()).toEqual(["0", "0", "0"]);
    cleanup();

    open();
    const parted = [
      "PART ONE",
      "CHAPTER ONE",
      prose(20),
      "CHAPTER TWO",
      prose(20),
      "PART TWO",
      "CHAPTER THREE",
      prose(20),
      "EPILOGUE",
      prose(10),
    ].join("\n\n");
    choose(fileOf("Parted.txt", parted));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    // The Epilogue stands beside the Parts, as the draft puts it: a Part of
    // its own, drawn as one.
    expect(inPart()).toEqual(["0", "1", "1", "0", "1", "0"]);
    expect(kinds()).toEqual([
      "part",
      "section",
      "section",
      "part",
      "section",
      "part",
    ]);
  });

  it("reads a chosen file at once, and goes on only once it is read", async () => {
    open();
    expect(heading()).toBe("import.step.choose");
    expect(button("create.continue").disabled).toBe(true);
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    expect(button("create.continue").disabled).toBe(false);
  });

  it("says why a file was refused, and lets the writer remove it", async () => {
    open();
    choose(fileOf("book.pdf", "%PDF-1.7 not a manuscript"));
    await waitFor(() =>
      expect(screen.getByText(/import\.refused\.pdf/)).toBeTruthy(),
    );
    expect(button("create.continue").disabled).toBe(true);
    fireEvent.click(button("import.remove(book.pdf)"));
    expect(document.querySelector(".import-file")).toBeNull();
  });

  it("orders several files naturally, and lets the writer move them", async () => {
    open();
    choose(
      fileOf("chapter 10.txt", prose(30)),
      fileOf("chapter 2.txt", prose(30)),
    );
    await waitFor(() => expect(screen.getAllByText("TXT")).toHaveLength(2));
    const names = () =>
      [...document.querySelectorAll(".import-file-name")].map(
        (n) => n.textContent,
      );
    expect(names()).toEqual(["chapter 2.txt", "chapter 10.txt"]);
    fireEvent.click(button("import.later(chapter 2.txt)"));
    expect(names()).toEqual(["chapter 10.txt", "chapter 2.txt"]);
    // Each card carries its place in the book, so the order is visible.
    const places = () =>
      [...document.querySelectorAll(".import-file-place")].map(
        (n) => n.textContent,
      );
    expect(places()).toEqual(["1", "2"]);
    // The first has no way earlier, the last none later.
    expect(
      screen.queryByRole("button", { name: "import.earlier(chapter 10.txt)" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "import.later(chapter 2.txt)" }),
    ).toBeNull();
  });

  it("shows the chapters it found, ticked, and joins one to the chapter above with its own button", async () => {
    const { props } = open();
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));

    expect(heading()).toBe("import.step.chapters");
    expect(rowTitles()).toEqual([
      "CHAPTER ONE",
      "CHAPTER TWO",
      "CHAPTER THREE",
    ]);
    // Nothing the writer has to read before going on: no options, no report.
    expect(document.querySelector(".import-warning")).toBeNull();

    // "CHAPTER THREE" is no chapter start: joined, it stays listed, since it
    // is imported, as a line of the Section above, which has the group's one
    // bead and one count. The first row has nothing to join.
    const rows = () => [
      ...document.querySelectorAll<HTMLElement>(".import-row"),
    ];
    expect(
      screen.queryByRole("button", { name: "import.joinLabel(CHAPTER ONE)" }),
    ).toBeNull();
    const counts = () =>
      rows().map((row) => row.querySelectorAll(".import-row-words").length);
    expect(counts()).toEqual([1, 1, 1]);
    fireEvent.click(button("import.joinLabel(CHAPTER THREE)"));
    // A joined line has no seam above it: it is separated from itself.
    expect(
      screen.queryByRole("button", { name: "import.joinLabel(CHAPTER THREE)" }),
    ).toBeNull();
    expect(button("import.separateLabel(CHAPTER THREE)")).toBeTruthy();
    // One Section, one item of the list, two lines of it.
    const groups = document.querySelectorAll<HTMLElement>(".import-group");
    expect(groups).toHaveLength(2);
    expect(groups[1].dataset.joined).toBe("1");
    expect(groups[1].style.getPropertyValue("--lines")).toBe("2");
    expect(rows().map((row) => row.dataset.joined)).toEqual(["0", "0", "1"]);
    // One bead: the group's, ticked; the joined line has none.
    expect(within(rows()[2]).queryByRole("checkbox")).toBeNull();
    expect(
      within(rows()[1]).getByRole("checkbox").getAttribute("aria-checked"),
    ).toBe("true");
    expect(counts()).toEqual([1, 1, 0]);

    toLast();
    expect(heading()).toBe("create.nameLabel");
    // The title is proposed from the file's name; the author is the writer.
    expect(
      (
        screen.getByLabelText("create.nameLabel", {
          selector: "input",
        }) as HTMLInputElement
      ).value,
    ).toBe("Once Dark");
    expect(
      (screen.getByLabelText("create.authorLabel") as HTMLInputElement).value,
    ).toBe("Ada Lovelace");

    fireEvent.click(button("import.confirm"));
    const seed = await seedOf(props);
    const nodes = nodesOf(seed);
    expect(nodes.map((n) => n.title)).toEqual(["CHAPTER ONE", "CHAPTER TWO"]);
    const two = textOf(seed, nodes[1]);
    // The scene break is kept inside the chapter, and the joined title is text.
    expect(two).toContain("* * *");
    expect(two).toContain("CHAPTER THREE");
    expect(seed).toMatchObject({
      destination: "local",
      folderName: "once-dark",
      init: {
        document: {
          title: "Once Dark",
          author: "Ada Lovelace",
          language: "en",
        },
      },
    });
  });

  it("asks the creation wizard's own questions after its two, with no structure to choose", async () => {
    open();
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    const asked: string[] = [];
    while (!screen.queryByRole("button", { name: "import.confirm" })) {
      asked.push(heading() ?? "");
      fireEvent.click(button("create.continue"));
    }
    asked.push(heading() ?? "");
    expect(asked).toEqual([
      "import.step.choose",
      "import.step.chapters",
      "create.whereLabel",
      "create.stepLanguage",
      "create.stepKind",
      "create.stepGenre",
      "create.nameLabel",
    ]);
    // One rail for all seven, and no structure field anywhere on the way.
    expect(document.querySelectorAll(".ui-step-dot")).toHaveLength(7);
    expect(screen.queryByLabelText("create.structureLabel")).toBeNull();
  });

  it("opens a row whole in a modal of its own, and closes back to the list", async () => {
    open();
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    const peek = (title: string) => button(`import.openLabel(${title})`);
    const shown = () =>
      [...document.querySelectorAll(".import-peek p")].map(
        (p) => p.textContent,
      );
    const titles = () =>
      screen.getAllByRole("heading").map((h) => h.textContent);
    fireEvent.click(peek("CHAPTER TWO"));
    // Over the window, named for its row: the Section's text as it will be,
    // its title line first and its scene break included.
    expect(titles()).toEqual(["import.step.chapters", "CHAPTER TWO"]);
    expect(shown()).toEqual(["CHAPTER TWO", prose(20), "* * *", prose(20)]);
    fireEvent.click(button("confirm.done"));
    expect(document.querySelector(".import-peek")).toBeNull();
    expect(titles()).toEqual(["import.step.chapters"]);
    // Joined, a row shows the text it gives to the one above, title and all;
    // Escape closes the preview alone.
    fireEvent.click(button("import.joinLabel(CHAPTER THREE)"));
    fireEvent.click(peek("CHAPTER THREE"));
    expect(shown()[0]).toBe("CHAPTER THREE");
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(document.querySelector(".import-peek")).toBeNull();
    expect(titles()).toEqual(["import.step.chapters"]);
  });

  it("names an untitled chapter in the language the writer says the book is in", async () => {
    const { props } = open();
    choose(fileOf("story.txt", `${prose(30)}\n\n${prose(30)}`));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    while (heading() !== "create.stepLanguage")
      fireEvent.click(button("create.continue"));
    fireEvent.change(screen.getByLabelText("create.languageLabel"), {
      target: { value: "it" },
    });
    toLast();
    fireEvent.click(button("import.confirm"));
    const seed = await seedOf(props);
    expect(seed.init.document?.language).toBe("it");
    expect(nodesOf(seed)[0].title).toBe("Senza titolo");
  });

  it("steps back a question at a time, and leaves only from the first", async () => {
    const { props } = open();
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    fireEvent.click(button("create.continue"));
    expect(heading()).toBe("create.whereLabel");
    fireEvent.click(button("create.back"));
    expect(heading()).toBe("import.step.chapters");
    fireEvent.click(button("create.back"));
    expect(heading()).toBe("import.step.choose");
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("shows the job while the project is made, and cannot be left", () => {
    const { props } = open({
      progress: { index: 1, detail: { done: 3, total: 8 } },
    });
    expect(heading()).toBe("import.making");
    expect(screen.getByText("create.progressCount(3,8)")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("states the last attempt's failure inside the window", () => {
    open({ error: "The project could not be created." });
    expect(screen.getByRole("alert").textContent).toBe(
      "The project could not be created.",
    );
  });

  it("takes files dropped on the well, and refuses an ebook among other files", async () => {
    open();
    const well = document.querySelector(".import-drop");
    if (!well) throw new Error("no drop well");
    fireEvent.dragOver(well);
    expect(well.getAttribute("data-over")).toBe("1");
    fireEvent.dragLeave(well);
    expect(well.getAttribute("data-over")).toBe("0");
    fireEvent.drop(well, {
      dataTransfer: {
        files: [fileOf("a.txt", prose(30)), fileOf("b.epub", "not a zip")],
      },
    });
    await waitFor(() =>
      expect(document.querySelectorAll(".import-file")).toHaveLength(2),
    );
    await waitFor(() =>
      expect(document.querySelector(".import-file-why")).toBeTruthy(),
    );
    // The ebook is left out, and its card says so: no place, no arrows —
    // and with one file left to read there is no order to set at all.
    const [text, ebook] =
      document.querySelectorAll<HTMLElement>(".import-file");
    expect(ebook.dataset.refused).toBe("1");
    expect(ebook.querySelector(".import-file-meta")?.textContent).toBe(
      "import.leftOut",
    );
    expect(document.querySelector(".import-file-place")).toBeNull();
    expect(document.querySelector(".import-file-actions")).toBeNull();
    expect(text.dataset.refused).toBe("0");
    // Remove it: the first stays and can go on.
    fireEvent.click(button("import.remove(b.epub)"));
    expect(button("create.continue").disabled).toBe(false);
  });

  it("slides two beads into one on a join, and parts them on a separation", async () => {
    // jsdom lays nothing out: each row stands 30px below the one before, so
    // a bead that changes rows has somewhere to slide from.
    const rows = () => [
      ...document.querySelectorAll<HTMLElement>(".import-row"),
    ];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const row = this.closest<HTMLElement>(".import-row");
        const top = row ? rows().indexOf(row) * 30 : 0;
        return new DOMRect(0, top, 100, 20);
      },
    );
    open();
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    expect(screen.getByText("import.beadsHelp")).toBeTruthy();

    const moves = new MutationObserver(() => {});
    moves.observe(document.querySelector(".import-outline") as HTMLElement, {
      attributes: true,
      attributeFilter: ["style"],
      attributeOldValue: true,
      subtree: true,
      childList: true,
    });
    // Joined: the joined row's bead is gone from the list, so a stand-in
    // for it sets out from where it stood, a row below the group's bead.
    fireEvent.click(button("import.joinLabel(CHAPTER THREE)"));
    const set = moves.takeRecords().map((record) => record.oldValue ?? "");
    expect(set.some((style) => style.includes("translate(0px, 30px)"))).toBe(
      true,
    );
    // It rides in the group's own tick, set off by as far as the two beads
    // stood apart, so it lands on the bead wherever the bead lands.
    const ghost = document.querySelector(".import-bead-ghost");
    expect(ghost?.parentElement).toBe(
      rows()[1].querySelector(":scope > .ui-tick"),
    );
    // Where they meet, the stand-in goes: one bead is left. (jsdom ends no
    // transition: the fallback takes it away.)
    await waitFor(
      () => expect(document.querySelector(".import-bead-ghost")).toBeNull(),
      { timeout: 1500 },
    );
    expect(rows()[1].querySelectorAll(".ui-tick-bead")).toHaveLength(1);
    expect(rows()[2].querySelectorAll(".ui-tick-bead")).toHaveLength(0);

    // Separated, the row grows back to a row, and its bead parts from the
    // group's: it sets out from where the group's stood, a row above.
    fireEvent.click(button("import.separateLabel(CHAPTER THREE)"));
    expect(rows()[2].dataset.unjoined).toBe("1");
    const parted = moves.takeRecords().map((record) => record.oldValue ?? "");
    expect(
      parted.some((style) => style.includes("translate(0px, -30px)")),
    ).toBe(true);
    expect(document.querySelector(".import-bead-ghost")).toBeNull();
    // jsdom has no `AnimationEvent`, so React listens there for the prefixed
    // name, and reads the animation's name off the event as from a real one.
    const ended = (row: HTMLElement, name: string) => {
      const event = new Event("webkitAnimationEnd", { bubbles: true });
      Object.defineProperty(event, "animationName", { value: name });
      act(() => {
        row.dispatchEvent(event);
      });
    };
    ended(rows()[2], "import-other");
    expect(rows()[2].dataset.unjoined).toBe("1");
    ended(rows()[2], "import-untuck");
    expect(rows()[2].dataset.unjoined).toBeUndefined();
    moves.disconnect();
    vi.restoreAllMocks();
  });

  it("stretches each seam from the bead above to its own, wherever they stand", async () => {
    // jsdom lays nothing out: each item stands 40px below the one before,
    // a row's bead 20px down it, and a joined group's lower, at its middle.
    const items = () => [
      ...document.querySelectorAll<HTMLElement>(".import-outline > li"),
    ];
    let groupBead = 13;
    // jsdom has no ResizeObserver: this one is told by hand when an item
    // changes height, as the browser tells the real one while a line tucks.
    const resized: (() => void)[] = [];
    let unwatched = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized.push(callback);
        }
        observe() {}
        disconnect() {
          unwatched += 1;
        }
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
      function (this: HTMLElement) {
        if (this.matches(".import-outline > li"))
          return items().indexOf(this) * 40;
        const group = this.closest<HTMLElement>(".import-group");
        if (this.matches(".ui-tick") && group)
          return group.dataset.joined === "1" ? groupBead : 3;
        return 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        if (this.matches(".ui-tick")) return 34;
        if (this.matches(".ui-tick-bead")) return 14;
        return 0;
      },
    );
    open();
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    const seam = () =>
      button("import.joinLabel(CHAPTER THREE)").parentElement as HTMLElement;
    // The seam holds one control, its word beside its glyph.
    expect(button("import.joinLabel(CHAPTER THREE)").textContent).toContain(
      "import.merge",
    );
    // Row to row: from the bead above's lower edge (20 + 7, an item up) to
    // its own upper edge (20 - 7).
    expect(seam().style.top).toBe("-13px");
    expect(seam().style.height).toBe("26px");
    // Under a group, whose bead is lower, the seam is shorter and still
    // touches it.
    fireEvent.click(button("import.joinLabel(CHAPTER TWO)"));
    expect(seam().style.top).toBe("-3px");
    expect(seam().style.height).toBe("16px");
    // The render that drew the group let go of the watcher before it.
    expect(unwatched).toBeGreaterThan(0);
    // As the joined line tucks up, the group's bead rises, and the seam
    // under it follows when the item says it has changed height.
    groupBead = 9;
    act(() => resized[resized.length - 1]());
    expect(seam().style.top).toBe("-7px");
    expect(seam().style.height).toBe("20px");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("splits another way, by a line the writer names, undoing their ticks", async () => {
    const { props } = open();
    choose(
      fileOf(
        "Once Dark.txt",
        [
          "CHAPTER ONE",
          prose(20),
          "~~~",
          prose(20),
          "CHAPTER TWO",
          prose(20),
        ].join("\n\n"),
      ),
    );
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    // A join, then a change of rule, which starts the list again.
    fireEvent.click(button("import.joinLabel(CHAPTER TWO)"));
    const split = screen.getByLabelText("import.splitLabel");
    // Under the dropdown, what the chosen way does; it follows the choice.
    const note = () =>
      document.getElementById(split.getAttribute("aria-describedby") ?? "")
        ?.textContent;
    expect(note()).toBe("import.ruleNote.patterns");
    fireEvent.change(split, {
      target: { value: "separator" },
    });
    expect(note()).toBe("import.ruleNote.separator");
    // The field says what to type, takes the caret, and the list's place
    // waits for it rather than vanishing.
    const field = screen.getByLabelText("import.separatorLabel");
    expect(document.activeElement).toBe(field);
    const empty = () =>
      document.querySelector(".import-outline-empty")?.textContent;
    expect(empty()).toBe("import.outlineEmpty.type");
    fireEvent.change(field, { target: { value: "@@@" } });
    expect(empty()).toBe("import.outlineEmpty.noMatch(@@@)");
    fireEvent.change(screen.getByLabelText("import.separatorLabel"), {
      target: { value: "~~~" },
    });
    expect(rowTitles()).toHaveLength(2);
    // Every row joined is still a book: the whole text, as one chapter.
    for (const join of document.querySelectorAll<HTMLElement>(".import-join"))
      fireEvent.click(join);
    expect(button("create.continue").disabled).toBe(false);
    toLast();
    fireEvent.click(button("import.confirm"));
    const seed = await seedOf(props);
    expect(nodesOf(seed).map((n) => n.title)).toEqual(["Untitled"]);
  });

  it("leaves out an unticked row, text and all, and reports nothing for it", async () => {
    const { props } = open();
    choose(
      fileOf(
        "Once Dark.txt",
        // `CHAPTER TWO\n\n\n\n`: one paragraph break and two blank lines.
        `CHAPTER ONE\n\n${prose(20)}\n\nCHAPTER TWO\n\n\n\n${prose(20)}\n\nCHAPTER THREE\n\n${prose(20)}`,
      ),
    );
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    const two = document.querySelectorAll<HTMLElement>(".import-row")[1];
    fireEvent.click(within(two).getByRole("checkbox"));
    expect(two.dataset.included).toBe("0");
    // It says so, and needs no reason given: the choice was the writer's.
    // It offers nothing else: no kind to change, no text to split.
    expect(two.querySelector(".import-row-tag")?.textContent).toBe(
      "import.tag.alone",
    );
    expect(
      within(two).queryByRole("button", { name: /import\.open/ }),
    ).toBeNull();
    expect(
      within(two).queryByRole("button", { name: /import\.make/ }),
    ).toBeNull();
    // A row left out cannot join, and nothing joins onto it.
    expect(
      screen.queryByRole("button", { name: "import.joinLabel(CHAPTER TWO)" }),
    ).toBeNull();
    // The writer left it out, in the list, so the window says nothing more:
    // a count of the blank lines it took would read as a fault.
    expect(document.querySelector(".import-warning")).toBeNull();
    toLast();
    fireEvent.click(button("import.confirm"));
    const seed = await seedOf(props);
    expect(nodesOf(seed).map((n) => n.title)).toEqual([
      "CHAPTER ONE",
      "CHAPTER THREE",
    ]);
  });

  it("goes on only while something comes in, and offers scenes only where there are some", async () => {
    open();
    choose(
      fileOf(
        "Once Dark.txt",
        `CHAPTER ONE

${prose(20)}

CHAPTER TWO

${prose(20)}

CHAPTER THREE

${prose(20)}`,
      ),
    );
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    // No scene break anywhere: there is nothing for the scenes tick to cut,
    // so the list stands under "Split by" alone.
    expect(
      screen.queryByRole("checkbox", { name: /import.scenes/ }),
    ).toBeNull();
    // Every row left out is a project of nothing, so the step cannot be
    // passed until one comes back in.
    const beads = () =>
      [...document.querySelectorAll<HTMLElement>(".import-row")].map((row) =>
        within(row).getByRole("checkbox"),
      );
    for (const bead of beads()) fireEvent.click(bead);
    expect(button("create.continue").disabled).toBe(true);
    fireEvent.click(beads()[0]);
    expect(button("create.continue").disabled).toBe(false);
  });

  it("says why a row starts left out, while it stays out", async () => {
    open();
    choose(
      fileOf(
        "Once Dark.txt",
        [
          "CONTENTS",
          "Chapter One",
          "Chapter Two",
          "Chapter Three",
          "CHAPTER ONE",
          prose(20),
          "CHAPTER TWO",
          prose(20),
          "CHAPTER THREE",
          prose(20),
        ].join("\n\n"),
      ),
    );
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    const contents = document.querySelectorAll<HTMLElement>(".import-row")[0];
    expect(contents.dataset.included).toBe("0");
    // Its made-up title is its kind already, in the book's language, which
    // need not be the window's: the tag does not say it twice.
    expect(contents.querySelector(".import-row-title")?.textContent).toBe(
      "[toc]",
    );
    expect(contents.querySelector(".import-row-tag")?.textContent).toBe(
      "import.tag.alone",
    );
    // The chapters, which come in, say nothing.
    expect(document.querySelectorAll(".import-row-tag")).toHaveLength(1);
    // Ticked in, it is a row like any other.
    fireEvent.click(within(contents).getByRole("checkbox"));
    expect(document.querySelector(".import-row-tag")).toBeNull();
  });

  it("names what a page left out is when its title does not", async () => {
    open();
    // Titled by the ebook's headings, none of them numbered, so the way it
    // divides is the one its files give.
    const chapter = (title: string) => ({
      file: `${title.toLowerCase()}.xhtml`,
      body: `<h1>${title}</h1><p>${prose(20)}</p>`,
      navTitle: title,
    });
    const epub = epubOf({
      chapters: [
        chapter("Arrival"),
        // An extra the ebook keeps off its reading order.
        {
          file: "map.xhtml",
          body: `<h1>The Map</h1><p>${SENTENCE}</p>`,
          navTitle: "The Map",
          linear: false,
        },
        chapter("Departure"),
      ],
    });
    choose(
      new File([epub as BlobPart], "Once Dark.epub", {
        type: "application/epub+zip",
      }),
    );
    await waitFor(() => expect(screen.getByText("EPUB")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    const map = [...document.querySelectorAll<HTMLElement>(".import-row")].find(
      (row) => row.textContent?.includes("The Map"),
    );
    expect(map?.dataset.included).toBe("0");
    expect(map?.querySelector(".import-row-tag")?.textContent).toBe(
      "import.tag.kind(import.tag.offSpine)",
    );
  });

  it("warns of what the project cannot hold, and of nothing else", async () => {
    open();
    choose(
      fileOf(
        "story.md",
        [
          `${prose(30)}[^1]`,
          `<u>${SENTENCE}</u>`,
          prose(30),
          "[^1]: Where it began.",
        ].join("\n\n"),
      ),
    );
    await waitFor(() => expect(screen.getByText("MD")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    // The underline is no loss, since it comes across as italic and a tick
    // of its own says so; the footnote is.
    expect(document.querySelector(".import-warning")?.textContent).toBe(
      "import.losses(import.loss.footnotes(1))",
    );
  });

  it("renames a row where it stands, and Enter ends the naming without going on", async () => {
    const { props } = open();
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    const field = screen.getByLabelText("import.renameLabel(CHAPTER TWO)");
    field.focus();
    fireEvent.change(field, { target: { value: "The Harbour" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(heading()).toBe("import.step.chapters");
    expect(rowTitles()).toEqual([
      "CHAPTER ONE",
      "The Harbour",
      "CHAPTER THREE",
    ]);
    // Nothing typed keeps the name.
    const again = screen.getByLabelText("import.renameLabel(The Harbour)");
    again.focus();
    fireEvent.change(again, { target: { value: "   " } });
    act(() => again.blur());
    expect(rowTitles()[1]).toBe("The Harbour");
    // A joined row is a line of the text above: no name to change.
    fireEvent.click(button("import.joinLabel(CHAPTER THREE)"));
    expect(
      screen.queryByLabelText("import.renameLabel(CHAPTER THREE)"),
    ).toBeNull();
    toLast();
    fireEvent.click(button("import.confirm"));
    const seed = await seedOf(props);
    expect(nodesOf(seed).map((n) => n.title)).toEqual([
      "CHAPTER ONE",
      "The Harbour",
    ]);
  });

  it("makes a row a Part from the row itself, offering only what the tree allows", async () => {
    const { props } = open();
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    const kinds = () =>
      [...document.querySelectorAll<HTMLElement>(".import-row")].map(
        (row) => row.dataset.kind,
      );
    expect(kinds()).toEqual(["section", "section", "section"]);
    // Any of them can be a Part, holding the rows after it; none can be a
    // Section, which each already is.
    expect(button("import.makeLabel.part(CHAPTER ONE)")).toBeTruthy();
    expect(document.querySelectorAll(".import-kind")).toHaveLength(3);
    const make = button("import.makeLabel.part(CHAPTER TWO)");
    expect(make.textContent).toBe("import.make.part");

    // A Part: it takes the chapter after it, and the one before it stands
    // as a Part of its own.
    fireEvent.click(make);
    expect(kinds()).toEqual(["part", "part", "section"]);
    // The way back is on the row now; the first row, a Part because the
    // root holds Parts, has nothing it could be instead.
    expect(button("import.makeLabel.section(CHAPTER TWO)")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "import.makeLabel.section(CHAPTER ONE)",
      }),
    ).toBeNull();
    toLast();
    fireEvent.click(button("import.confirm"));
    const seed = await seedOf(props);
    expect(nodesOf(seed).map((n) => [n.kind, n.title])).toEqual([
      ["part", "CHAPTER ONE"],
      ["part", "CHAPTER TWO"],
      ["section", "CHAPTER THREE"],
    ]);
  });

  it("opens a row with its scissors to split it where a new row starts, named after it", async () => {
    const { props } = open();
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    fireEvent.click(button("import.openLabel(CHAPTER ONE)"));
    // It says what can be done in it, since a gap shows nothing at rest.
    expect(screen.getByText("import.splitLead")).toBeTruthy();
    const gaps = document.querySelectorAll<HTMLElement>(".import-cut");
    // One gap between each two of its three paragraphs.
    expect(gaps).toHaveLength(2);
    expect(gaps[1].getAttribute("aria-label")).toMatch(
      /^import\.splitHereLabel\(/,
    );
    expect(gaps[1].textContent).toBe("import.splitHere");
    fireEvent.click(gaps[1]);
    expect(rowTitles()).toEqual([
      "CHAPTER ONE",
      "CHAPTER ONE split 1",
      "CHAPTER TWO",
      "CHAPTER THREE",
    ]);
    // The split is drawn in the open row, solid, with the new row's name,
    // and the paragraph it starts keeps its indent: only the row's own
    // opening is set flush.
    const cut = button("import.uncutLabel(CHAPTER ONE split 1)");
    expect(cut.dataset.cut).toBe("1");
    const flush = document.querySelectorAll(".import-peek p[data-first]");
    expect(flush).toHaveLength(1);
    // A second split, above the first, takes the first number.
    fireEvent.click(document.querySelectorAll<HTMLElement>(".import-cut")[0]);
    expect(rowTitles().slice(0, 3)).toEqual([
      "CHAPTER ONE",
      "CHAPTER ONE split 1",
      "CHAPTER ONE split 2",
    ]);
    fireEvent.click(button("confirm.done"));
    toLast();
    fireEvent.click(button("import.confirm"));
    const seed = await seedOf(props);
    expect(nodesOf(seed).map((n) => n.title)).toEqual([
      "CHAPTER ONE",
      "CHAPTER ONE split 1",
      "CHAPTER ONE split 2",
      "CHAPTER TWO",
      "CHAPTER THREE",
    ]);
  });

  it("joins a cut back from the open row, and the row it made is gone", async () => {
    open();
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    fireEvent.click(button("import.openLabel(CHAPTER ONE)"));
    fireEvent.click(document.querySelectorAll<HTMLElement>(".import-cut")[1]);
    expect(rowTitles()).toHaveLength(4);
    fireEvent.click(button("import.uncutLabel(CHAPTER ONE split 1)"));
    expect(rowTitles()).toEqual([
      "CHAPTER ONE",
      "CHAPTER TWO",
      "CHAPTER THREE",
    ]);
    // A cut row joined in the list goes too.
    fireEvent.click(document.querySelectorAll<HTMLElement>(".import-cut")[1]);
    fireEvent.click(button("confirm.done"));
    fireEvent.click(button("import.joinLabel(CHAPTER ONE split 1)"));
    expect(rowTitles()).toEqual([
      "CHAPTER ONE",
      "CHAPTER TWO",
      "CHAPTER THREE",
    ]);
  });

  it("makes each scene its own Section from the tick above the list, and gives the chapters back unticked", async () => {
    const { props } = open();
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    const scenes = () =>
      screen
        .getAllByRole("checkbox")
        .find((tick) => tick.textContent?.startsWith("import.scenes"));
    expect(scenes()?.textContent).toBe(
      "import.scenesimport.scenesByMark(2,* * *)",
    );
    fireEvent.click(scenes() as HTMLElement);
    expect(rowTitles()).toEqual([
      "CHAPTER ONE",
      "CHAPTER TWO",
      "CHAPTER TWO, scene 1",
      "CHAPTER TWO, scene 2",
      "CHAPTER THREE",
    ]);
    // The scenes step in under their chapter.
    const depths = [
      ...document.querySelectorAll<HTMLElement>(".import-row"),
    ].map(
      (row) =>
        row
          .closest<HTMLElement>(".import-group")
          ?.style.getPropertyValue("--depth") ?? "",
    );
    expect(depths).toEqual(["0", "0", "1", "1", "0"]);
    fireEvent.click(scenes() as HTMLElement);
    expect(rowTitles()).toEqual([
      "CHAPTER ONE",
      "CHAPTER TWO",
      "CHAPTER THREE",
    ]);
    fireEvent.click(scenes() as HTMLElement);
    toLast();
    fireEvent.click(button("import.confirm"));
    const seed = await seedOf(props);
    expect(nodesOf(seed).map((n) => [n.kind, n.title])).toEqual([
      ["part", "CHAPTER ONE"],
      ["part", "CHAPTER TWO"],
      ["section", "CHAPTER TWO, scene 1"],
      ["section", "CHAPTER TWO, scene 2"],
      ["part", "CHAPTER THREE"],
    ]);
  });

  it("offers underlining as italic, and brings it in plain when unticked", async () => {
    const { props } = open();
    choose(
      fileOf(
        "story.md",
        [prose(30), `She said <u>never</u> again.`, prose(30)].join("\n\n"),
      ),
    );
    await waitFor(() => expect(screen.getByText("MD")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    const tick = screen
      .getAllByRole("checkbox")
      .find((t) => t.textContent?.startsWith("import.underline"));
    expect(tick?.textContent).toBe("import.underline1");
    expect(tick?.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(tick as HTMLElement);
    toLast();
    fireEvent.click(button("import.confirm"));
    const seed = await seedOf(props);
    const content =
      seed.init.shape?.files.find(
        (f) => f.fileName === nodesOf(seed)[0].adopted,
      )?.content ?? "";
    const italic = commonmarkCodec
      .parse(content)
      .flatMap((p) => p.runs)
      .some((r) => r.format.italic);
    expect(italic).toBe(false);
  });

  it.each([
    [true, 1],
    [false, 0],
  ])(
    "offers the file's comments for the margin, ticked, and leaves them out when unticked (keep %s)",
    async (keep, files) => {
      const { props } = open();
      choose(
        fileOf(
          "page.html",
          `<body><h1>One</h1><p><span>The storm came at dawn.</span><a href="#cmnt1" id="cmnt_ref1">[a]</a></p><p>${prose(30)}</p><div><p><a href="#cmnt_ref1" id="cmnt1">[a]</a><span>Too early?</span></p></div></body>`,
        ),
      );
      await waitFor(() => expect(screen.getByText("HTML")).toBeTruthy());
      fireEvent.click(button("create.continue"));
      const tick = screen
        .getAllByRole("checkbox")
        .find((t) => t.textContent?.startsWith("import.comments"));
      expect(tick?.textContent).toBe("import.comments1");
      expect(tick?.getAttribute("aria-checked")).toBe("true");
      if (!keep) fireEvent.click(tick as HTMLElement);
      toLast();
      fireEvent.click(button("import.confirm"));
      const seed = await seedOf(props);
      expect(seed.init.comments ?? []).toHaveLength(files);
    },
  );

  it("says what a change of way undid, and gives it back", async () => {
    open();
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    // Nothing to undo before a change.
    fireEvent.change(screen.getByLabelText("import.splitLabel"), {
      target: { value: "none" },
    });
    expect(document.querySelector(".import-undone")).toBeNull();
    fireEvent.change(screen.getByLabelText("import.splitLabel"), {
      target: { value: "patterns" },
    });
    fireEvent.click(button("import.joinLabel(CHAPTER THREE)"));
    fireEvent.change(screen.getByLabelText("import.splitLabel"), {
      target: { value: "none" },
    });
    expect(document.querySelector(".import-undone")?.textContent).toBe(
      "import.undone(1) import.undo",
    );
    fireEvent.click(button("import.undo"));
    expect(document.querySelector(".import-undone")).toBeNull();
    expect(button("import.separateLabel(CHAPTER THREE)")).toBeTruthy();
    // Going back to the way by hand brings the changes back as well.
    fireEvent.change(screen.getByLabelText("import.splitLabel"), {
      target: { value: "none" },
    });
    fireEvent.change(screen.getByLabelText("import.splitLabel"), {
      target: { value: "patterns" },
    });
    expect(document.querySelector(".import-undone")).toBeNull();
    expect(button("import.separateLabel(CHAPTER THREE)")).toBeTruthy();
  });

  it("keeps a blank line between paragraphs as a blank line, and offers it as a scene break without making it one", async () => {
    const { props } = open();
    choose(
      fileOf(
        "story.txt",
        // One empty line parts two paragraphs of plain text; a second one
        // is the writer's blank line.
        `${prose(30)}\n\n${prose(30)}\n\n\n${prose(30)}\n\n${prose(30)}`,
      ),
    );
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    // The one choice is the scenes tick, offered because a blank line wider
    // than the text's spacing may mark a scene, and left off.
    const ticks = screen.queryAllByRole("checkbox");
    expect(ticks).toHaveLength(1);
    expect(ticks[0].textContent).toBe("import.scenesimport.scenesByBlank(2)");
    expect(ticks[0].getAttribute("aria-checked")).toBe("false");
    toLast();
    fireEvent.click(button("import.confirm"));
    const seed = await seedOf(props);
    // Read back with the project's own codec: the empty paragraph survives
    // the file, and nothing was rewritten as a scene break.
    expect(textOf(seed, nodesOf(seed)[0])).toEqual([
      prose(30),
      prose(30),
      "",
      prose(30),
      prose(30),
    ]);
  });

  it("lets the writer change every fact before importing, and refuses a title the project refuses", async () => {
    const { props } = open({
      driveConnected: true,
      taken: new Set(["the-harbour"]),
    });
    choose(fileOf("Once Dark.txt", MANUSCRIPT));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    fireEvent.click(button("create.continue"));
    // Where: the second place, Drive.
    const places = document.querySelectorAll<HTMLInputElement>(".pick input");
    expect(places).toHaveLength(2);
    fireEvent.click(places[1]);
    fireEvent.click(button("create.continue"));
    fireEvent.click(button("create.continue"));
    // Type and goal: the type proposes its goal, never below the length;
    // the writer's own goal wins.
    fireEvent.change(screen.getByLabelText("create.typeLabel"), {
      target: { value: "Novella" },
    });
    const goal = screen.getByLabelText("create.goalLabel");
    expect((goal as HTMLInputElement).value).toBe(
      String(TYPE_GOAL_DEFAULTS.Novella),
    );
    fireEvent.change(goal, { target: { value: "40000" } });
    fireEvent.click(button("create.continue"));
    // Genre: answered as for a blank project.
    fireEvent.change(screen.getByLabelText("genre.label"), {
      target: { value: "mystery" },
    });
    fireEvent.click(button("create.continue"));
    // What is it called: a folder already on the shelf is refused.
    const title = screen.getByLabelText("create.nameLabel", {
      selector: "input",
    });
    fireEvent.change(title, { target: { value: "The Harbour" } });
    expect(screen.getByText(/^name\.folderTaken/)).toBeTruthy();
    expect(button("import.confirm").disabled).toBe(true);
    fireEvent.change(title, { target: { value: "The Harbour Road" } });
    fireEvent.change(screen.getByLabelText("create.authorLabel"), {
      target: { value: "Ann Writer" },
    });
    fireEvent.click(button("import.confirm"));
    expect(await seedOf(props)).toMatchObject({
      destination: "drive",
      folderName: "the-harbour-road",
      init: {
        document: {
          title: "The Harbour Road",
          author: "Ann Writer",
          type: "Novella",
          goal: 40000,
          genres: ["mystery"],
        },
      },
    });
  });
});

describe("the import window", () => {
  it("the words the window shows are the words the project will count", async () => {
    const { props } = open();
    // No scene break: the counts compared are the prose alone.
    const plain = [
      "CHAPTER ONE",
      prose(20),
      "CHAPTER TWO",
      prose(20),
      "CHAPTER THREE",
      prose(20),
    ].join("\n\n");
    choose(fileOf("Once Dark.txt", plain));
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    // Each row's count: "import.words(<n>,<n>)", summed.
    const shown = [...document.querySelectorAll(".import-row-words")].reduce(
      (sum, row) =>
        sum + Number(/import\.words\((\d+),/.exec(row.textContent ?? "")?.[1]),
      0,
    );
    toLast();
    fireEvent.click(button("import.confirm"));
    const seed = await seedOf(props);
    // What the seed stores per node (`host/seed.ts`), summed.
    const counted = (seed.init.stats ?? []).reduce(
      (sum, stat) => sum + stat.words,
      0,
    );
    expect(shown).toBe(counted);
  });
});
