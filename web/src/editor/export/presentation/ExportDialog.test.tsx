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
import type { ExportRequest } from "../application/assemble";
import type { BookFacts, ManuscriptNode, ReferenceEntry } from "../domain/book";
import ExportDialog, { type ExportDialogProps } from "./ExportDialog";

// The key with its variables, so a test can see both what was said and
// what was put into it.
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

const BOOK: BookFacts = {
  id: "b",
  title: "Once Dark",
  author: "",
  type: "Novel",
  language: "en",
  languageLabel: "English",
  genres: [],
  ageCategory: null,
  tropes: [],
  structure: null,
  createdAt: "",
  updatedAt: "",
};

const TREE: ManuscriptNode[] = [
  {
    id: "p1",
    kind: "part",
    title: "One",
    children: [
      { id: "s1", kind: "section", title: "The Dark", children: [] },
      { id: "s2", kind: "section", title: "The Light", children: [] },
    ],
  },
];

const ENTRIES: ReferenceEntry[] = [
  { fileName: "character--ada.md", group: "characters", title: "Ada" },
  { fileName: "note--idea.md", group: "notes", title: "Idea" },
];

const AT = new Date(2026, 9, 1, 9, 5, 7, 42);
const STAMP = "2026-10-01 09-05-07";

function open(over: Partial<ExportDialogProps> = {}) {
  const props: ExportDialogProps = {
    book: BOOK,
    manuscript: TREE,
    loadReferences: async () => ENTRIES,
    accountName: "Ada Lovelace",
    locale: "en-GB",
    now: () => AT,
    onExport: vi.fn(async (_request: ExportRequest, name: string) => ({
      fileName: `${name}.docx`,
      homes: [],
    })),
    onAuthor: vi.fn(),
    onDone: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<ExportDialog {...props} />);
  return props;
}

type Step = "format" | "contents" | "pages" | "finish";

const heading = () => screen.getByRole("heading").textContent;
const continueButton = () =>
  screen.getByRole("button", { name: "create.continue" }) as HTMLButtonElement;
const exportButton = () =>
  screen.getByRole("button", { name: "export.confirm" }) as HTMLButtonElement;
const backButton = () =>
  screen.getByRole("button", { name: "create.back" }) as HTMLButtonElement;
const next = () => fireEvent.click(continueButton());
const back = () => fireEvent.click(backButton());

const nameField = () =>
  screen.getByLabelText("export.nameLabel") as HTMLInputElement;
const area = (name: string) =>
  screen.getByRole("checkbox", { name: new RegExp(`^${name}`) });
/** A pick card's radio, found by the card's name: the card is its label. */
const choose = (name: string) => {
  const radio = screen.getByText(name).closest("label")?.querySelector("input");
  if (!radio) throw new Error(`no pick named ${name}`);
  fireEvent.click(radio);
};

/** The shelf is read after the first paint; wait for it before ticking it. */
const settled = () =>
  waitFor(() =>
    expect(
      (area("export.include.references") as HTMLButtonElement).disabled,
    ).toBe(false),
  );

/** Continue from wherever the wizard is until it asks this step's question. */
async function at(step: Step) {
  for (let i = 0; i < 4 && heading() !== `export.step.${step}`; i += 1) next();
  expect(heading()).toBe(`export.step.${step}`);
  if (step === "contents") await settled();
}

describe("the wizard's steps", () => {
  it("asks one question a step, in order, and exports on the last", async () => {
    open();
    expect(heading()).toBe("export.step.format");
    next();
    expect(heading()).toBe("export.step.contents");
    next();
    expect(heading()).toBe("export.step.pages");
    next();
    expect(heading()).toBe("export.step.finish");
    expect(exportButton()).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "create.continue" }),
    ).toBeNull();
  });

  // A step whose every choice would do nothing is not a step.
  it("has no pages step for a format without pages", async () => {
    open();
    choose("export.format.html.name");
    next();
    next();
    expect(heading()).toBe("export.step.finish");
  });

  it("steps back one question at a time, and leaves only from the first", async () => {
    const props = open();
    await at("pages");
    back();
    expect(heading()).toBe("export.step.contents");
    // Escape is the same Back.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(heading()).toBe("export.step.format"));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "confirm.cancel" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("forgets nothing on the way back", async () => {
    open();
    choose("export.format.pdf.name");
    await at("contents");
    fireEvent.click(area("export.include.notes"));
    back();
    next();
    expect(area("export.include.notes").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("lands the keyboard on the question it arrives at", async () => {
    open();
    await at("finish");
    expect(document.activeElement).toBe(
      screen.getByLabelText("export.authorLabel"),
    );
  });

  it("goes on with Enter, through the same gate as the button", async () => {
    open();
    await at("finish");
    fireEvent.change(nameField(), { target: { value: "///" } });
    fireEvent.submit(nameField().closest("form") as HTMLFormElement);
    expect(heading()).toBe("export.step.finish");
  });
});

describe("the export window's file name", () => {
  it("proposes the title and the moment the window opened, to the second", async () => {
    open();
    await at("finish");
    expect(nameField().value).toBe(`Once Dark ${STAMP}`);
    expect(screen.getByText(`export/Once Dark ${STAMP}.docx`)).toBeTruthy();
  });

  it("follows the ticks until the writer types, then keeps what they typed", async () => {
    open();
    await at("contents");
    fireEvent.click(area("export.include.references"));
    await at("finish");
    expect(nameField().value).toBe(
      `Once Dark export.include.references ${STAMP}`,
    );
    back();
    back();
    fireEvent.click(area("export.include.notes"));
    await at("finish");
    expect(nameField().value).toBe(
      `Once Dark export.include.references export.include.notes ${STAMP}`,
    );
    fireEvent.change(nameField(), { target: { value: "For my agent" } });
    back();
    back();
    fireEvent.click(area("export.include.notes"));
    await at("finish");
    expect(nameField().value).toBe("For my agent");
  });

  it("shows the file it will write, with the format's own extension", async () => {
    open();
    choose("export.format.epub.name");
    await at("finish");
    expect(screen.getByText(`export/Once Dark ${STAMP}.epub`)).toBeTruthy();
  });

  it("refuses a name with nothing usable in it", async () => {
    open();
    await at("finish");
    fireEvent.change(nameField(), { target: { value: "///" } });
    expect(screen.getByText("export.nameEmpty")).toBeTruthy();
    expect(exportButton().disabled).toBe(true);
  });

  it("restates the choices made on the way, at the moment of export", async () => {
    open();
    choose("export.format.pdf.name");
    await at("pages");
    choose("export.layout.review.name");
    await at("finish");
    expect(
      screen.getByText(
        "export.format.pdf.name · export.layout.review.name · export.page.a4",
      ),
    ).toBeTruthy();
  });
});

describe("what goes in", () => {
  it("starts with the manuscript whole, the shelf out and the tech page off", async () => {
    open();
    await at("contents");
    expect(area("export.include.manuscript").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(area("export.include.references").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(
      screen
        .getByRole("checkbox", { name: /export\.techPage/ })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("shows a partial pick as mixed, with how much of it is in", async () => {
    open();
    await at("contents");
    fireEvent.click(screen.getByRole("checkbox", { name: "The Dark" }));
    const manuscript = area("export.include.manuscript");
    expect(manuscript.getAttribute("aria-checked")).toBe("mixed");
    expect(within(manuscript).getByText("export.pick.count(2,3)")).toBeTruthy();
    expect(
      screen
        .getByRole("checkbox", { name: "One" })
        .getAttribute("aria-checked"),
    ).toBe("mixed");
  });

  it("cannot export nothing", async () => {
    open();
    await at("contents");
    fireEvent.click(area("export.include.manuscript"));
    expect(screen.getByText("export.nothing")).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
  });

  it("says so when the project has nothing to tick at all", async () => {
    open({ manuscript: [], loadReferences: async () => [] });
    next();
    await waitFor(() =>
      expect(screen.getByText("export.emptyBook")).toBeTruthy(),
    );
    expect(screen.queryByText("export.nothing")).toBeNull();
    expect(continueButton().disabled).toBe(true);
  });

  it("treats a shelf it cannot read as an empty one, and still exports the text", async () => {
    open({ loadReferences: async () => Promise.reject(new Error("offline")) });
    next();
    await waitFor(() =>
      expect(
        within(area("export.include.references")).getByText("export.pick.none"),
      ).toBeTruthy(),
    );
    expect(
      (area("export.include.references") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(continueButton().disabled).toBe(false);
  });
});

describe("the page", () => {
  it("is asked about only for a format that has pages", async () => {
    open();
    await at("pages");
    expect(screen.getByLabelText("export.pageLabel")).toBeTruthy();
    back();
    back();
    choose("export.format.html.name");
    await at("finish");
    expect(screen.queryByLabelText("export.pageLabel")).toBeNull();
  });

  it("starts on the writer's likely paper", async () => {
    open({ locale: "en-US" });
    await at("pages");
    expect(
      (screen.getByLabelText("export.pageLabel") as HTMLSelectElement).value,
    ).toBe("letter");
  });

  it("asks for the manuscript's furniture only under a manuscript layout", async () => {
    open();
    await at("pages");
    expect(screen.queryByLabelText("export.contactLabel")).toBeNull();
    choose("export.layout.manuscriptModern.name");
    expect(screen.getByLabelText("export.contactLabel")).toBeTruthy();
    expect(
      (screen.getByLabelText("export.headerLabel") as HTMLInputElement).value,
    ).toBe("Lovelace / Once Dark");
    // A novel's shape is a fact under the choice, and it has no separator.
    expect(screen.getByText("export.variant.novel(Novel)")).toBeTruthy();
    expect(screen.queryByText("export.separatorLabel")).toBeNull();
  });

  it("offers a story the choice between # and a new page", async () => {
    const props = open({
      book: { ...BOOK, type: "Short Story" },
    });
    await at("pages");
    choose("export.layout.manuscriptClassic.name");
    expect(screen.getByText("export.variant.story(Short Story)")).toBeTruthy();
    // Shunn's own # is where it starts.
    const shunn = screen.getByRole("button", {
      name: "export.separator.shunn",
    });
    expect(shunn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: "export.separator.pageBreak" }),
    );
    await at("finish");
    await act(async () => fireEvent.click(exportButton()));
    const [request] = (props.onExport as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(request.storySeparator).toBe("pageBreak");
  });

  it("follows the author in the running header until the writer edits it", async () => {
    const props = open();
    await at("pages");
    choose("export.layout.manuscriptModern.name");
    await at("finish");
    fireEvent.change(screen.getByLabelText("export.authorLabel"), {
      target: { value: "Ada King" },
    });
    await act(async () => fireEvent.click(exportButton()));
    const [request] = (props.onExport as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(request.runningHeader).toBe("King / Once Dark");
  });
});

describe("the contents tick", () => {
  it("is locked on for an EPUB, and says why", async () => {
    open();
    choose("export.format.epub.name");
    await at("contents");
    const toc = screen.getByRole("checkbox", { name: /export\.tocTick/ });
    expect(toc.getAttribute("aria-checked")).toBe("true");
    expect(toc.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(toc);
    expect(toc.getAttribute("aria-checked")).toBe("true");
    expect(within(toc).getByText("export.tocLocked")).toBeTruthy();
  });
});

describe("exporting", () => {
  it("hands over one request with everything the window decided", async () => {
    const props = open();
    choose("export.format.pdf.name");
    await at("contents");
    fireEvent.click(area("export.include.notes"));
    fireEvent.click(screen.getByRole("checkbox", { name: /export\.techPage/ }));
    await at("pages");
    choose("export.layout.manuscriptModern.name");
    fireEvent.change(screen.getByLabelText("export.contactLabel"), {
      target: { value: "Ada\n1 Street" },
    });
    await at("finish");
    await act(async () => fireEvent.click(exportButton()));

    expect(props.onExport).toHaveBeenCalledTimes(1);
    const [request, name] = (props.onExport as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(name).toBe(`Once Dark export.include.notes ${STAMP}`);
    expect(request).toMatchObject({
      format: "pdf",
      layout: "manuscriptModern",
      page: "a4",
      techPage: true,
      toc: false,
      author: "Ada Lovelace",
      contact: "Ada\n1 Street",
      runningHeader: "Lovelace / Once Dark",
      storySeparator: "shunn",
    });
    expect([...request.selection.manuscript].sort()).toEqual([
      "p1",
      "s1",
      "s2",
    ]);
    expect([...request.selection.notes]).toEqual(["note--idea.md"]);
    expect(request.selection.references.size).toBe(0);
    expect(props.onDone).toHaveBeenCalledWith({
      fileName: `${name}.docx`,
      homes: [],
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("saves the author on the book when it changed, and only then", async () => {
    const props = open({ book: { ...BOOK, author: "Ada Lovelace" } });
    await at("finish");
    await act(async () => fireEvent.click(exportButton()));
    expect(props.onAuthor).not.toHaveBeenCalled();

    cleanup();
    const second = open();
    await at("finish");
    // Prefilled from the account, which the book does not have yet.
    expect(
      (screen.getByLabelText("export.authorLabel") as HTMLInputElement).value,
    ).toBe("Ada Lovelace");
    await act(async () => fireEvent.click(exportButton()));
    expect(second.onAuthor).toHaveBeenCalledWith("Ada Lovelace");
  });

  // An export that failed went out under no name at all.
  it("does not save the author when the export failed", async () => {
    const props = open({
      onExport: vi.fn(async () => Promise.reject(new Error("boom"))),
    });
    await at("finish");
    await act(async () => fireEvent.click(exportButton()));
    expect(props.onAuthor).not.toHaveBeenCalled();
  });

  it("says plainly when there was nothing to export, and stays open", async () => {
    const props = open({
      onExport: vi.fn(async () => Promise.reject(new Error("export-empty"))),
    });
    await at("finish");
    await act(async () => fireEvent.click(exportButton()));
    expect(screen.getByRole("alert").textContent).toBe("export.error.empty");
    expect(props.onClose).not.toHaveBeenCalled();
    expect(exportButton().disabled).toBe(false);
  });

  it("asks for another name when every numbered one is taken", async () => {
    open({
      onExport: vi.fn(async () =>
        Promise.reject(new Error("export-name-exhausted")),
      ),
    });
    await at("finish");
    await act(async () => fireEvent.click(exportButton()));
    expect(screen.getByRole("alert").textContent).toBe(
      "export.error.nameTaken",
    );
  });

  it("says it failed for any other reason, until something is changed", async () => {
    open({ onExport: vi.fn(async () => Promise.reject(new Error("boom"))) });
    await at("finish");
    await act(async () => fireEvent.click(exportButton()));
    expect(screen.getByRole("alert").textContent).toBe("export.error.failed");
    fireEvent.change(nameField(), { target: { value: "Another" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The homes are already being written: a window that vanished mid-write
  // would leave the writer not knowing whether a file landed.
  it("lets nothing close or step back while the file is being written", async () => {
    let finish: (value: { fileName: string; homes: [] }) => void = () => {};
    const props = open({
      onExport: vi.fn(
        () =>
          new Promise<{ fileName: string; homes: [] }>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    await at("finish");
    await act(async () => fireEvent.click(exportButton()));
    expect(backButton().disabled).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(heading()).toBe("export.step.finish");
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => finish({ fileName: "a.docx", homes: [] }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
