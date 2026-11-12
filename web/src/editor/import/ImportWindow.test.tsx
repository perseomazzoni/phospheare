// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import ImportWindow, { type ImportWindowProps } from "./ImportWindow";

// Pins what only the composition root does: wire the real readers and host
// behind the wizard, word the Library's job and refusals, and hand the
// Library a `ProjectSeed` it can write. Made-up titles are worded in the
// book's language through a translator fixed to it, so the mock's fixed `t`
// prefixes the language it was fixed to.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${Object.values(vars).join(",")})` : key,
    i18n: {
      language: "it-IT",
      getFixedT:
        (language: string) => (key: string, vars?: Record<string, unknown>) =>
          `${language}:${key}${vars ? `(${Object.values(vars).join(",")})` : ""}`,
    },
  }),
}));

afterEach(() => {
  cleanup();
});

const SENTENCE = "La pioggia non smetteva da quando il traghetto era partito.";
const prose = (n: number) =>
  Array.from({ length: n }, () => SENTENCE).join(" ");

function open(over: Partial<ImportWindowProps> = {}) {
  const props: ImportWindowProps = {
    driveConnected: false,
    email: "ada@example.com",
    localAvailable: true,
    localRootReady: true,
    remoteAvailable: true,
    taken: new Set(["once-dark"]),
    accountName: "Ada",
    progress: null,
    error: null,
    onImport: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<ImportWindow {...props} />);
  return props;
}

const button = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
/** On through the creation wizard's questions, to its last. */
const toLast = () => {
  while (!screen.queryByRole("button", { name: "import.confirm" }))
    fireEvent.click(button("create.continue"));
};

describe("ImportWindow", () => {
  it("reads a file with the real readers and hands the Library a seed it can write", async () => {
    const props = open({
      initialFiles: [
        new File([`${prose(30)}\n\n${prose(30)}`], "Storia.txt", {
          type: "text/plain",
        }),
      ],
    });
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    fireEvent.click(button("create.continue"));
    fireEvent.click(button("create.continue"));
    // Where: the creation wizard's own hint, with Drive not connected.
    expect(screen.getByText("create.connectDriveHint")).toBeTruthy();
    toLast();
    fireEvent.click(button("import.confirm"));
    await waitFor(() => expect(props.onImport).toHaveBeenCalledTimes(1));
    const seed = vi.mocked(props.onImport).mock.calls[0][0];
    expect(seed).toMatchObject({
      destination: "local",
      folderName: "storia",
      init: {
        document: { title: "Storia", author: "Ada", language: "it" },
        // The only chapter had no title: it is named in the book's language
        // (the stop-word vote finds Italian), through the fixed translator.
        shape: {
          structure: {
            children: [
              {
                kind: "section",
                id: "EL1",
                title: "it:import.title.untitled",
              },
            ],
          },
        },
      },
    });
    expect(seed.init.shape?.files[0].content).toContain("La pioggia");
  });

  it("refuses a title whose folder is already on the shelf, in the project's words", async () => {
    open({
      initialFiles: [
        new File([`${prose(30)}`], "Once Dark.txt", { type: "text/plain" }),
      ],
    });
    await waitFor(() => expect(screen.getByText("TXT")).toBeTruthy());
    toLast();
    expect(screen.getByText(/^name\./)).toBeTruthy();
    expect(button("import.confirm").disabled).toBe(true);
  });

  it("words the Library's job, step by step, with its count of files", () => {
    open({ progress: { index: 1, detail: { done: 3, total: 8 } } });
    expect(screen.getByText("create.progressCount(3,8)")).toBeTruthy();
    expect(screen.getByText("create.progress.documents")).toBeTruthy();
  });
});
