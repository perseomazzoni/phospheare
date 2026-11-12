// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newWriter, newWriterId } from "../domain/writer";
import {
  findWriter,
  resetRegistryForTests,
  writerRegistry,
  saveWriter,
} from "../registry";
import { markWelcomed } from "./welcome";

// The login splash plays once per account: the record keeps the first time.

beforeEach(() => {
  localStorage.clear();
  resetRegistryForTests();
});
afterEach(() => localStorage.clear());

describe("markWelcomed", () => {
  it("records the first welcome and keeps it", () => {
    const writer = newWriter(newWriterId(), null, new Date());
    saveWriter(writer);
    markWelcomed(writerRegistry, writer.id, new Date("2026-10-29T09:00:00Z"));
    markWelcomed(writerRegistry, writer.id, new Date("2026-10-30T09:00:00Z"));
    expect(findWriter(writer.id)?.welcomedAt).toBe("2026-10-29T09:00:00.000Z");
  });

  it("leaves an account no longer stored alone", () => {
    expect(() =>
      markWelcomed(writerRegistry, newWriterId(), new Date()),
    ).not.toThrow();
  });
});
