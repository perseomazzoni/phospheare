// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { registerView, viewFor } from "./registry";

/** A stand-in view: the registry only stores and returns, never renders. */
const standIn = (() => null) as never;

// The registry is module-level, registered at import like
// `storage/index.ts`, so each test claims its own name rather than assuming
// test order.

describe("the view registry", () => {
  it("answers what was registered under a name", () => {
    registerView("contract-a", standIn);
    expect(viewFor("contract-a")).toBe(standIn);
  });

  it("lets a later registration replace an earlier one — same name, newer adapter", () => {
    const newer = (() => null) as never;
    registerView("contract-b", standIn);
    registerView("contract-b", newer);
    expect(viewFor("contract-b")).toBe(newer);
  });

  it("throws on a name nothing registered — a silent fallback would hide the mistake", () => {
    expect(() => viewFor("contract-never-registered")).toThrow(
      /contract-never-registered/,
    );
  });
});
