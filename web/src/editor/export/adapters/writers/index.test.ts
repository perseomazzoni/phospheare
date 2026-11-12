// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FORMAT_IDS } from "../../domain/formats";
import { loadWriter } from "./index";

// Pins the export's one swap: one document, a writer chosen by format. A case
// returning the wrong module would type-check, since every writer is a
// `FormatWriter`, and write RTF into a `.docx`.

describe("loadWriter", () => {
  it.each(FORMAT_IDS)("returns the %s writer", async (format) => {
    const writer = await loadWriter(format, async () => new Uint8Array());
    expect(writer.format).toBe(format);
  });
});
