// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import { appLog } from "../../../log";
import { StorageError } from "../../../storage/types";
import { actionFailure } from "./shelfActions";

const t = ((key: string) => key) as unknown as TFunction;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a Library action's failure", () => {
  it("is logged by its action and code, and the project stays unnamed", () => {
    const error = vi.spyOn(appLog, "error");
    const failure = new StorageError(
      "Could not save My Secret Novel/document/one.md.",
      "io",
    );
    expect(actionFailure(failure, t, "duplicate-copy")).toEqual(
      expect.any(String),
    );
    expect(error).toHaveBeenCalledOnce();
    const [area, , fields] = error.mock.calls[0];
    expect(area).toBe("library");
    expect(fields).toMatchObject({
      action: "duplicate-copy",
      error: "StorageError",
      code: "io",
    });
    expect(JSON.stringify(fields)).not.toContain("Secret");
  });
});
