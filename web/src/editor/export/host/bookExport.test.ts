// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";
import type { HomeReport } from "../ports";
import { doneMessageKey, exportLabels, fileLanguage } from "./bookExport";

// `bookExport` only wires; what it decides itself is what the toast says
// about the homes, and how a date and a count print inside the file. The
// toast is the one place the writer learns a copy did not land, so each of
// its four answers is pinned. The file goes to an agent, so a stored date
// that does not parse never prints as "Invalid Date".

const outcome = (homes: HomeReport[]) => ({ fileName: "a.pdf", homes });

describe("doneMessageKey — what the toast says about the homes", () => {
  it("says all is well when every home kept a copy", () => {
    expect(doneMessageKey(outcome([{ home: "device", ok: true }]))).toBe(
      "export.done.all",
    );
    expect(
      doneMessageKey(
        outcome([
          { home: "device", ok: true },
          { home: "remote", ok: true },
        ]),
      ),
    ).toBe("export.done.all");
  });

  it("names the remote when only the remote missed", () => {
    expect(
      doneMessageKey(
        outcome([
          { home: "device", ok: true },
          { home: "remote", ok: false },
        ]),
      ),
    ).toBe("export.done.remoteSkipped");
  });

  it("names the device when only the device missed", () => {
    expect(
      doneMessageKey(
        outcome([
          { home: "device", ok: false },
          { home: "remote", ok: true },
        ]),
      ),
    ).toBe("export.done.deviceSkipped");
  });

  // A remote-only book whose one home missed: the download is the only copy,
  // and the toast says so with its reason, since "not saved" alone hides
  // that the remote was out of reach.
  it("names the one home a book has when it missed, with its reason", () => {
    expect(doneMessageKey(outcome([{ home: "remote", ok: false }]))).toBe(
      "export.done.remoteSkipped",
    );
    expect(doneMessageKey(outcome([{ home: "device", ok: false }]))).toBe(
      "export.done.deviceSkipped",
    );
  });

  it("says nothing was kept when two homes missed", () => {
    expect(
      doneMessageKey(
        outcome([
          { home: "device", ok: false },
          { home: "remote", ok: false },
        ]),
      ),
    ).toBe("export.done.noneSaved");
  });
});

describe("fileLanguage — one file, one language", () => {
  it("is the book's language when the app has words in it", () => {
    expect(fileLanguage("it", ["en", "it"])).toBe("it");
    expect(fileLanguage("en", ["en", "it"])).toBe("en");
  });

  // English, because the manuscript format is an English-language standard.
  it("is English for a book in a language the app does not speak", () => {
    expect(fileLanguage("fr", ["en", "it"])).toBe("en");
  });
});

describe("exportLabels — dates and counts the way the file's readers read them", () => {
  const t = vi.fn((key: string) => `<${key}>`) as unknown as TFunction;

  // Midday in the machine's own time zone, so the day printed is the day
  // meant wherever the test runs; midday UTC is already 2 October east of
  // UTC+12.
  const ISO = new Date(2026, 9, 1, 12).toISOString();

  it("prints a date in the writer's locale", () => {
    expect(exportLabels(t, "en").date(ISO)).toBe("October 1, 2026");
    expect(exportLabels(t, "it").date(ISO)).toBe("1 ottobre 2026");
  });

  it("prints a count in the writer's locale", () => {
    expect(exportLabels(t, "en").number(12345.5)).toBe("12,345.5");
    expect(exportLabels(t, "it").number(12345.5)).toBe("12.345,5");
  });

  it("prints a stored date that does not parse exactly as it was stored", () => {
    const labels = exportLabels(t, "en");
    expect(labels.date("sometime in spring")).toBe("sometime in spring");
    expect(labels.date("")).toBe("");
  });

  it("passes the words through the locale with their variables", () => {
    const labels = exportLabels(t, "en");
    expect(labels.t("export.pick.arcOf", { name: "Maren" })).toBe(
      "<export.pick.arcOf>",
    );
    expect(t).toHaveBeenCalledWith("export.pick.arcOf", { name: "Maren" });
  });
});
