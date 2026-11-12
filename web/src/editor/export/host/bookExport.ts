// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Wires one export: the book's source, the sink over its homes, the
// two parsers, the lazily loaded writers and the file's words, put together
// once per opening of `BookExportWindow`.

import type { TFunction } from "i18next";
import { downloadFile } from "../adapters/download";
import { fetchExportFont } from "../adapters/fonts";
import { manuscriptParser } from "../adapters/manuscriptBlocks";
import { markdownParser } from "../adapters/markdownBlocks";
import { loadWriter } from "../adapters/writers";
import type { ExportRequest } from "../application/assemble";
import { runExport, type ExportOutcome } from "../application/runExport";
import type { ExportLabels, ExportSource } from "../ports";
import { projectExportSink } from "./projectSink";
import {
  projectExportSource,
  type ProjectSourceOptions,
} from "./projectSource";

export interface BookExport {
  source: ExportSource;
  run(request: ExportRequest, name: string): Promise<ExportOutcome>;
}

export interface BookExportOptions extends ProjectSourceOptions {
  /**
   * The language the file speaks (`fileLanguage`): its dates and counts are
   * printed in it, as its words are through `t`.
   */
  language: string;
}

/**
 * The language an export's own words are printed in: the book's, when the app
 * has words in it, and English otherwise.
 *
 * Not the app's. A writer using the app in Italian who exports an English
 * novel as a manuscript for an American agent would get "circa 80.000 parole",
 * "FINE" and "Indice" inside a file that declares itself English: a submission
 * in the wrong language, and a screen reader pronouncing "FINE" as an English
 * word. One file, one language. English is the fallback because the
 * manuscript format is an English-language standard.
 */
export function fileLanguage(
  bookLanguage: string,
  shipped: readonly string[],
): string {
  return shipped.includes(bookLanguage) ? bookLanguage : "en";
}

/** Dates and numbers the way the file's readers read them. */
export function exportLabels(t: TFunction, language: string): ExportLabels {
  const dates = new Intl.DateTimeFormat(language, { dateStyle: "long" });
  const numbers = new Intl.NumberFormat(language);
  return {
    t: (key, vars) => t(key, vars),
    date: (iso) => {
      const at = new Date(iso);
      // A stored date that does not parse prints as it was stored, rather
      // than "Invalid Date" on a page someone will send to an agent.
      return Number.isNaN(at.getTime()) ? iso : dates.format(at);
    },
    number: (value) => numbers.format(value),
  };
}

export function bookExport(options: BookExportOptions): BookExport {
  const source = projectExportSource(options);
  const sink = projectExportSink({
    storage: options.storage,
    ref: options.ref,
    download: downloadFile,
  });
  const labels = exportLabels(options.t, options.language);
  return {
    source,
    run: (request, name) =>
      runExport(
        {
          source,
          parsers: { manuscript: manuscriptParser, markdown: markdownParser },
          sink,
          labels,
          loadWriter: (format) => loadWriter(format, fetchExportFont),
          now: () => new Date(),
        },
        request,
        name,
      ),
  };
}

/**
 * The toast's key for how the homes went; the download happened either way.
 * One home that missed is named with its reason, even when it is the book's
 * only home, where "not saved" alone would hide why (Remote Storage out of reach, or
 * the folder on this device refusing). Only when two missed is there no single
 * reason to give.
 */
export function doneMessageKey(outcome: ExportOutcome): string {
  const failed = outcome.homes.filter((home) => !home.ok);
  if (failed.length === 0) return "export.done.all";
  if (failed.length > 1) return "export.done.noneSaved";
  return failed[0].home === "remote"
    ? "export.done.remoteSkipped"
    : "export.done.deviceSkipped";
}
