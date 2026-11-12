// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReaderLoader } from "../../ports";

// Chooses the reader for a format, mirroring the export's
// `loadWriter`: one dynamic import per format, so the zip library and the
// docx reader arrive with the first docx and never with the Library. A new
// format is a reader file and one case here.

export const loadReader: ReaderLoader = async (format) => {
  switch (format) {
    case "txt":
      return (await import("./txt")).txtReader;
    case "html":
      return (await import("./html")).htmlReader;
    case "md":
      return (await import("./markdown")).markdownReader;
    case "docx":
      return (await import("./docx")).docxReader;
    case "odt":
      return (await import("./odt")).odtReader;
    case "rtf":
      return (await import("./rtf")).rtfReader;
    case "epub":
      return (await import("./epub")).epubReader;
  }
};
