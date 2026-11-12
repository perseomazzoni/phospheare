// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Chooses the writer for a format: the export assembles one document and a
// writer per format renders it. Each writer is its own dynamic
// import, so the zip library arrives with the first DOCX, ODT or EPUB, and the
// PDF engine and its font fetches with the first PDF, never with the editor.

import type { FormatId } from "../../domain/formats";
import type { FormatWriter } from "../../ports";

export async function loadWriter(
  format: FormatId,
  loadFont: (file: string) => Promise<Uint8Array>,
): Promise<FormatWriter> {
  switch (format) {
    case "md":
      return (await import("./commonmark")).commonmarkWriter;
    case "txt":
      return (await import("./txt")).textWriter;
    case "html":
      return (await import("./html")).htmlWriter;
    case "epub":
      return (await import("./epub")).epubWriter;
    case "docx":
      return (await import("./docx")).docxWriter;
    case "odt":
      return (await import("./odt")).odtWriter;
    case "rtf":
      return (await import("./rtf")).rtfWriter;
    case "pdf":
      return (await import("./pdf")).createPdfWriter(loadFont);
  }
}
