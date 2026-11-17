// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { appLog } from "../log";
import { logEngineFaults } from "./engineLog";
import type { DiffFallback } from "./engine";

describe("the engine's faults in the log", () => {
  it("writes one line for each kind of fallback, by its kind only, until it stops", () => {
    let hear: (fallback: DiffFallback) => void = () => {};
    const stop = vi.fn();
    const off = logEngineFaults({
      onDiffFallback: (listener) => {
        hear = listener;
        return stop;
      },
    });
    const warn = vi.spyOn(appLog, "warn").mockImplementation(() => {});
    const word = { grain: "word", shown: "paragraph", error: "Error" } as const;
    hear(word);
    hear(word);
    hear({ ...word, shown: "none" });
    expect(warn.mock.calls.map((call) => call[1])).toEqual([
      "A comparison was shown by paragraph instead.",
      "A comparison could not be shown at any grain.",
    ]);
    expect(warn.mock.calls[0][2]).toEqual(word);
    off();
    expect(stop).toHaveBeenCalled();
    warn.mockRestore();
  });
});
