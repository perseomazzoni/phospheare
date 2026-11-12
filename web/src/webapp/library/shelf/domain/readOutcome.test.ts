// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { StorageError } from "../../../../storage/types";
import { outcomeForAccess, outcomeForError } from "./readOutcome";

const describeErr = (err: StorageError) => `problem: ${err.code}`;

describe("outcomeForAccess", () => {
  it("settles gone and blocked before a read, and lets a granted folder through", () => {
    expect(outcomeForAccess("gone", null)?.state).toBe("gone");
    expect(outcomeForAccess("needs-gesture", null)?.state).toBe("blocked");
    expect(outcomeForAccess("granted", null)).toBeNull();
  });
});

describe("outcomeForError", () => {
  it("reads a permission failure as blocked", () => {
    const out = outcomeForError(
      new StorageError("no", "permission"),
      null,
      describeErr,
    );
    expect(out).toEqual({ content: null, state: "blocked", problem: null });
  });

  it("reads a missing folder as gone, in either shape", () => {
    expect(
      outcomeForError(new StorageError("no", "not-found"), null, describeErr)
        .state,
    ).toBe("gone");
    expect(
      outcomeForError(
        new DOMException("no", "NotFoundError"),
        null,
        describeErr,
      ).state,
    ).toBe("gone");
  });

  it("reads anything else as unreadable, with a reason only for a storage error", () => {
    expect(
      outcomeForError(new StorageError("no", "io"), null, describeErr),
    ).toEqual({ content: null, state: "unreadable", problem: "problem: io" });
    expect(outcomeForError(new Error("boom"), null, describeErr).problem).toBe(
      null,
    );
  });
});
