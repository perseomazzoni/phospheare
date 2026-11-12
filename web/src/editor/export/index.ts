// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The export module's public entry point: what the Library may reach for
// through the lazy loader in `editorChunk.ts`, the window that opens a book and
// wires everything behind it. The assembler, the parsers, the eight writers
// and the host stay behind this file, and `boundaries.test.ts` holds the
// layers apart.

export {
  default as BookExportWindow,
  type BookExportWindowProps,
} from "./BookExportWindow";
