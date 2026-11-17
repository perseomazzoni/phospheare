// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { appLog } from "../log";
import { unhandledInput } from "./viewHost";

describe("an input the writing view does not handle", () => {
  it("writes one log line for each kind, by its type only", () => {
    const warn = vi.spyOn(appLog, "warn").mockImplementation(() => {});
    unhandledInput("insertFromYank", false);
    unhandledInput("insertFromYank", false);
    unhandledInput("insertFromYank", true);
    expect(warn.mock.calls.map((call) => call[2])).toEqual([
      { inputType: "insertFromYank", cancelable: false },
      { inputType: "insertFromYank", cancelable: true },
    ]);
    warn.mockRestore();
  });
});
