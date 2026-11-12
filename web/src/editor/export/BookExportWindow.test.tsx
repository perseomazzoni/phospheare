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
} from "@testing-library/react";
import type { ProjectRef } from "../../storage/types";
import type { ExportRequest } from "./application/assemble";
import type { BookFacts } from "./domain/book";

// Pins the export window a Library card opens, in what the composition root
// decides itself: it opens the book before it shows anything, it gives up
// with one line when the book will not open, the file speaks the book's
// language while the window speaks the app's, the author goes out and
// is saved as one normalised string, and the working copy outlives the
// author's save. Opening and the export's internals are mocked; their own
// suites pin them.

const getFixedT = vi.fn<(language: string) => (key: string) => string>(
  () => (key) => key,
);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: "it",
      options: { resources: { en: {}, it: {} } },
      getFixedT,
    },
  }),
}));

const dispose = vi.fn();
const openExportBook = vi.fn();
vi.mock("./host/openBook", () => ({
  openExportBook: (...args: unknown[]) => openExportBook(...args),
}));

const setProjectAuthor = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {},
);
vi.mock("../../project/author", () => ({
  setProjectAuthor: (...args: unknown[]) => setProjectAuthor(...args),
}));

const run = vi.fn(async (_request: ExportRequest, name: string) => ({
  fileName: `${name}.docx`,
  homes: [{ home: "device" as const, ok: true }],
}));
const bookExport = vi.fn();
vi.mock("./host/bookExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./host/bookExport")>()),
  bookExport: (options: unknown) => bookExport(options),
}));

const { default: BookExportWindow } = await import("./BookExportWindow");

afterEach(async () => {
  cleanup();
  // An unmounted window releases its working copy a turn later, after the
  // author's save; that lands before the counts are cleared, or it counts
  // against the next row.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.clearAllMocks();
  setProjectAuthor.mockResolvedValue(undefined);
});

const project: ProjectRef = {
  providerId: "local",
  key: "once-dark",
  name: "Once Dark",
  openedAt: "",
};

const FACTS: BookFacts = {
  id: "book-1",
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

function book(language: string, author = "") {
  const opened = {
    storage: { id: "local" },
    structure: { version: 1, children: [] },
    properties: { document: { language, author } },
    dispose,
  };
  openExportBook.mockResolvedValue(opened);
  bookExport.mockReturnValue({
    source: {
      book: () => ({ ...FACTS, language, author }),
      manuscript: () => [
        { id: "s1", kind: "section", title: "One", children: [] },
      ],
      references: async () => [],
    },
    run,
  });
  return opened;
}

function mount() {
  const props = {
    project,
    projectId: "book-1",
    accountName: "  Ada\n  Lovelace  ",
    onMessage: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<BookExportWindow {...props} />);
  return { props, view };
}

const heading = () => screen.getByRole("heading").textContent;

async function exportNow() {
  await waitFor(() => expect(heading()).toBe("export.step.format"));
  for (let i = 0; i < 3; i += 1)
    fireEvent.click(screen.getByRole("button", { name: "create.continue" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "export.confirm" })),
  );
}

describe("BookExportWindow", () => {
  it("opens the book before it asks anything, and says it is opening", async () => {
    book("en");
    let release: (value: unknown) => void = () => {};
    openExportBook.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    mount();
    expect(screen.getByRole("status", { name: "export.opening" })).toBeTruthy();
    expect(openExportBook).toHaveBeenCalledWith(project, "book-1");
    await act(async () => release(book("en")));
    await waitFor(() => expect(heading()).toBe("export.step.format"));
  });

  it("says it could not open the book, and closes", async () => {
    openExportBook.mockRejectedValue(new Error("export-unopenable"));
    const { props } = mount();
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(props.onMessage).toHaveBeenCalledWith("export.openFailed");
  });

  // An English novel exported by a writer using the app in Italian.
  it("writes the file in the book's language, while the window speaks the app's", async () => {
    book("en");
    mount();
    await waitFor(() => expect(bookExport).toHaveBeenCalled());
    expect(getFixedT).toHaveBeenCalledWith("en");
    expect(bookExport.mock.calls[0][0]).toMatchObject({ language: "en" });
  });

  it("writes in English a book in a language the app has no words in", async () => {
    book("fr");
    mount();
    await waitFor(() => expect(bookExport).toHaveBeenCalled());
    expect(bookExport.mock.calls[0][0]).toMatchObject({ language: "en" });
  });

  it("sends and saves the author as one normalised line, then posts how it went", async () => {
    const opened = book("en");
    const { props } = mount();
    await exportNow();
    expect(run.mock.calls[0][0].author).toBe("Ada Lovelace");
    expect(setProjectAuthor).toHaveBeenCalledWith(
      opened.storage,
      project,
      "Ada Lovelace",
    );
    expect(props.onMessage).toHaveBeenCalledWith("export.done.all");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("does not rewrite an author the book already has", async () => {
    book("en", "Ada Lovelace");
    mount();
    await exportNow();
    expect(setProjectAuthor).not.toHaveBeenCalled();
  });

  // The window closes as the author is saved; the save goes through the
  // working copy, which is still there when it lands.
  it("lets go of the working copy only once the author's save has settled", async () => {
    book("en");
    let saved: () => void = () => {};
    setProjectAuthor.mockReturnValue(
      new Promise<void>((resolve) => {
        saved = resolve;
      }),
    );
    const { view } = mount();
    await exportNow();
    view.unmount();
    await act(async () => {});
    expect(dispose).not.toHaveBeenCalled();
    await act(async () => saved());
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
