// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { StorageError } from "./types";

describe("a storage failure in the app's log", () => {
  it("gives its code and its text key, never the path in its message", () => {
    const error = new StorageError(
      "Could not save my-novel/document/the-letter.md.",
      "io",
      "storage.saveFailed",
      { path: "my-novel/document/the-letter.md" },
    );
    expect(error.toLog()).toEqual({ code: "io", key: "storage.saveFailed" });
    expect(
      new StorageError("File not found: x.md", "not-found").toLog(),
    ).toEqual({ code: "not-found" });
  });
});
