// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleIdentity } from "../platform/types";
import { newWriter, newWriterId, type WriterRecord } from "./domain/writer";
import {
  accountWithoutGoogle,
  findWriter,
  findWriterBySub,
  removeWriter,
  resetRegistryForTests,
  saveWriter,
  setSignedIn,
  signedInWriter,
  subscribeWriters,
  updateWriter,
} from "./registry";

// The accounts of this browser and the signed-in mark, in localStorage,
// falling back to memory when the browser refuses writes.

const identity = (sub: string): GoogleIdentity => ({
  iss: "https://accounts.google.com",
  sub,
  email: `${sub}@example.test`,
  emailVerified: true,
  name: sub,
  picture: null,
});

const account = (sub: string): WriterRecord =>
  newWriter(newWriterId(), identity(sub), new Date("2026-10-28T10:00:00Z"));

beforeEach(() => {
  localStorage.clear();
  resetRegistryForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the accounts", () => {
  it("are kept one per Google account and read back", () => {
    const ada = account("g-ada");
    const bea = account("g-bea");
    saveWriter(ada);
    saveWriter(bea);
    resetRegistryForTests();
    expect(findWriter(ada.id)?.google?.sub).toBe("g-ada");
    expect(findWriterBySub("g-bea")?.id).toBe(bea.id);
    expect(findWriter("someone-else")).toBeNull();
    expect(findWriterBySub("g-cid")).toBeNull();
  });

  it("ignores a stored record that is not an account", () => {
    localStorage.setItem(
      "accounts",
      JSON.stringify([{ id: "x".repeat(22), google: { email: "x" } }]),
    );
    expect(findWriter("x".repeat(22))).toBeNull();
  });

  it("stores a change the domain allows and refuses one it does not", () => {
    const ada = account("g-ada");
    saveWriter(ada);
    updateWriter(ada.id, (w) => ({ ...w, createdAt: "2026-10-29T10:00:00Z" }));
    expect(findWriter(ada.id)?.createdAt).toBe("2026-10-29T10:00:00Z");
    expect(() =>
      updateWriter(ada.id, (w) => ({ ...w, google: identity("g-bea") })),
    ).toThrow("An account's Google identity cannot change.");
    expect(findWriter(ada.id)?.google?.sub).toBe("g-ada");
    expect(() => updateWriter("missing", (w) => w)).toThrow("No such account.");
  });
});

describe("the account without Google", () => {
  it("is found apart from the Google accounts, and never by a subject", () => {
    const ada = account("g-ada");
    const local = newWriter(newWriterId(), null, new Date());
    saveWriter(ada);
    saveWriter(local);
    expect(accountWithoutGoogle()?.id).toBe(local.id);
    expect(findWriterBySub("g-ada")?.id).toBe(ada.id);
  });

  it("is removed with its signed-in mark, leaving the others", () => {
    const ada = account("g-ada");
    const local = newWriter(newWriterId(), null, new Date());
    saveWriter(ada);
    saveWriter(local);
    setSignedIn(local.id);
    removeWriter(local.id);
    expect(accountWithoutGoogle()).toBeNull();
    expect(signedInWriter()).toBeNull();
    expect(findWriter(ada.id)?.id).toBe(ada.id);
  });
});

describe("the signed-in mark", () => {
  it("names one account, or no one", () => {
    const ada = account("g-ada");
    saveWriter(ada);
    expect(signedInWriter()).toBeNull();
    setSignedIn(ada.id);
    resetRegistryForTests();
    expect(signedInWriter()?.id).toBe(ada.id);
    setSignedIn(null);
    expect(signedInWriter()).toBeNull();
    expect(findWriter(ada.id)).not.toBeNull();
  });

  it("names no one when its account is not stored", () => {
    setSignedIn("x".repeat(22));
    expect(signedInWriter()).toBeNull();
  });
});

describe("listening", () => {
  it("hears changes here and in another tab", () => {
    const heard = vi.fn();
    const stop = subscribeWriters(heard);
    saveWriter(account("g-ada"));
    expect(heard).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "signedIn" }));
    expect(heard).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    setSignedIn(null);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("keeps the accounts in memory for the tab when storage refuses writes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    const ada = account("g-ada");
    saveWriter(ada);
    setSignedIn(ada.id);
    expect(signedInWriter()?.id).toBe(ada.id);
    expect(localStorage.getItem("accounts")).toBeNull();
  });
});
