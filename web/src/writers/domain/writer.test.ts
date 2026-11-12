// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { GoogleIdentity } from "../../platform/types";
import {
  asWriter,
  changeRefusal,
  newWriter,
  newWriterId,
  type WriterRecord,
} from "./writer";

// An account of this browser: a random id, the Google account it belongs
// to (none for the account without Google), and a Drive grant that must be
// that account's own.

const identity = (sub: string): GoogleIdentity => ({
  iss: "https://accounts.google.com",
  sub,
  email: `${sub}@example.test`,
  emailVerified: true,
  name: sub,
  picture: null,
});

const drive = (sub: string) => ({
  connectionId: "conn-1",
  sub,
  email: `${sub}@example.test`,
  scopes: [],
  connectedAt: "",
});

const fresh = (sub = "g-ada"): WriterRecord =>
  newWriter(newWriterId(), identity(sub), new Date("2026-10-28T10:00:00Z"));

describe("a new account", () => {
  it("starts with its Google identity and without Drive", () => {
    const writer = fresh();
    expect(writer).toEqual({
      id: writer.id,
      createdAt: "2026-10-28T10:00:00.000Z",
      google: identity("g-ada"),
      drive: null,
      welcomedAt: null,
      remoteCopiesKept: false,
    });
  });

  it("gets a random id that every store accepts", () => {
    const ids = new Set(Array.from({ length: 20 }, newWriterId));
    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("a stored record", () => {
  it("reads back what was written", () => {
    const writer = { ...fresh(), drive: drive("g-ada") };
    expect(asWriter(JSON.parse(JSON.stringify(writer)))).toEqual(writer);
  });

  it("is refused with a bad id, or with a malformed or missing identity", () => {
    expect(asWriter({ ...fresh(), id: "short" })).toBeNull();
    expect(asWriter({ ...fresh(), google: { email: "x" } })).toBeNull();
    expect(asWriter({ ...fresh(), google: undefined })).toBeNull();
    expect(asWriter("writer")).toBeNull();
  });

  it("reads back the account without Google", () => {
    const writer = newWriter(newWriterId(), null, new Date());
    expect(asWriter(JSON.parse(JSON.stringify(writer)))).toEqual(writer);
  });

  it("reads back when it was welcomed, and a record without it as not yet", () => {
    const writer = { ...fresh(), welcomedAt: "2026-10-29T09:00:00.000Z" };
    expect(asWriter(JSON.parse(JSON.stringify(writer)))?.welcomedAt).toBe(
      "2026-10-29T09:00:00.000Z",
    );
    const { welcomedAt: _, ...older } = fresh();
    expect(asWriter(older)?.welcomedAt).toBeNull();
  });

  it("drops a field an older record carried", () => {
    const read = asWriter({ ...fresh(), settingsSync: true, termsVersion: 3 });
    expect(read && "settingsSync" in read).toBe(false);
    expect(read && "termsVersion" in read).toBe(false);
  });
});

describe("changing an account", () => {
  it("keeps its Google account", () => {
    const writer = fresh();
    expect(
      changeRefusal(writer, {
        ...writer,
        google: { ...identity("g-ada"), name: "Ada" },
      }),
    ).toBeNull();
    expect(
      changeRefusal(writer, { ...writer, google: identity("g-bea") }),
    ).toBe("An account's Google identity cannot change.");
  });

  it("never gains or loses a Google account", () => {
    const local = newWriter(newWriterId(), null, new Date());
    expect(changeRefusal(local, { ...local, google: identity("g-ada") })).toBe(
      "An account's Google identity cannot change.",
    );
    const writer = fresh();
    expect(changeRefusal(writer, { ...writer, google: null })).toBe(
      "An account's Google identity cannot change.",
    );
  });

  it("takes no Drive grant without a Google account", () => {
    const local = newWriter(newWriterId(), null, new Date());
    expect(changeRefusal(local, { ...local, drive: drive("g-ada") })).toBe(
      "The Drive account must be the account's own.",
    );
  });

  it("never changes the id", () => {
    const writer = fresh();
    expect(changeRefusal(writer, { ...writer, id: newWriterId() })).toBe(
      "An account's id cannot change.",
    );
  });

  it("takes a Drive grant only for its own Google account", () => {
    const writer = fresh();
    expect(
      changeRefusal(writer, { ...writer, drive: drive("g-ada") }),
    ).toBeNull();
    expect(changeRefusal(writer, { ...writer, drive: drive("g-bea") })).toBe(
      "The Drive account must be the account's own.",
    );
  });
});
