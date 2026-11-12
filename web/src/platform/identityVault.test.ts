// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dropSessionCredentials,
  identityVault,
  type SealedCredentials,
} from "./identityVault";
import { PlatformError } from "./types";

// Pins the sealed vault: a remembered value is sealed by the
// identity service and asked of it again, so another tab's change reaches
// this one; a value not remembered lives in this tab only; nothing goes to
// the origin's storage; and no writer's vault reaches another's.

const KEY = "openrouter.key";

function service() {
  const cookies = new Map<string, string>();
  let writer = "writer-a";
  const sealed = {
    keep: vi.fn(async (name: string, value: string) => {
      cookies.set(`${writer}/${name}`, value);
    }),
    open: vi.fn(
      async (name: string) => cookies.get(`${writer}/${name}`) ?? null,
    ),
    forget: vi.fn(async (writerId: string, name: string) => {
      cookies.delete(`${writerId}/${name}`);
    }),
  } satisfies SealedCredentials;
  return {
    sealed,
    cookies,
    as: (id: string) => {
      writer = id;
    },
  };
}

let writer: string | null;
let s: ReturnType<typeof service>;
const vault = () => identityVault(() => writer, s.sealed);

beforeEach(() => {
  for (const id of ["writer-a", "writer-b"]) dropSessionCredentials(id);
  writer = "writer-a";
  s = service();
});

describe("identityVault", () => {
  it("seals a remembered value and asks the service for it again", async () => {
    await expect(vault().set(KEY, "sk-a", { remember: true })).resolves.toEqual(
      { remembered: true },
    );
    expect(s.cookies.get(`writer-a/${KEY}`)).toBe("sk-a");
    dropSessionCredentials("writer-a");
    await expect(vault().get(KEY)).resolves.toBe("sk-a");
    expect(s.sealed.open).toHaveBeenCalledOnce();
  });

  it("sees a key another tab replaced or forgot", async () => {
    await vault().set(KEY, "sk-a", { remember: true });
    s.cookies.set(`writer-a/${KEY}`, "sk-new");
    await expect(vault().get(KEY)).resolves.toBe("sk-new");
    s.cookies.clear();
    await expect(vault().get(KEY)).resolves.toBeNull();
  });

  it("answers the tab's copy while the service cannot be reached", async () => {
    await vault().set(KEY, "sk-a", { remember: true });
    s.sealed.open.mockRejectedValueOnce(new PlatformError("unavailable"));
    await expect(vault().get(KEY)).resolves.toBe("sk-a");
  });

  it("keeps a value it was not asked to remember in this tab only", async () => {
    await vault().set(KEY, "sk-a", { remember: true });
    await expect(
      vault().set(KEY, "sk-b", { remember: false }),
    ).resolves.toEqual({ remembered: false });
    expect(s.cookies.size).toBe(0);
    await expect(vault().get(KEY)).resolves.toBe("sk-b");
    expect(s.sealed.open).not.toHaveBeenCalled();
    dropSessionCredentials("writer-a");
    await expect(vault().get(KEY)).resolves.toBeNull();
  });

  it("says a value was not remembered when sealing fails", async () => {
    s.sealed.keep.mockRejectedValueOnce(new PlatformError("unavailable"));
    await expect(vault().set(KEY, "sk-a", { remember: true })).resolves.toEqual(
      { remembered: false },
    );
    await expect(vault().get(KEY)).resolves.toBe("sk-a");
  });

  it("keeps a tab-only value when the service is gone, but not when it refuses", async () => {
    s.sealed.forget.mockRejectedValueOnce(new PlatformError("unavailable"));
    await expect(
      vault().set(KEY, "sk-a", { remember: false }),
    ).resolves.toEqual({ remembered: false });
    s.sealed.forget.mockRejectedValueOnce(new PlatformError("flow-failed"));
    await expect(
      vault().set(KEY, "sk-b", { remember: false }),
    ).rejects.toThrow();
  });

  it("forgets both copies, and rejects when the service does not clear", async () => {
    await vault().set(KEY, "sk-a", { remember: true });
    await vault().delete(KEY);
    expect(s.cookies.size).toBe(0);
    await expect(vault().get(KEY)).resolves.toBeNull();
    s.sealed.forget.mockRejectedValueOnce(new PlatformError("unavailable"));
    await expect(vault().delete(KEY)).rejects.toThrow();
  });

  it("sets and deletes a tab-only value where no Google client is set up", async () => {
    s.sealed.forget.mockRejectedValue(
      new PlatformError("google-not-configured"),
    );
    await expect(
      vault().set(KEY, "sk-a", { remember: false }),
    ).resolves.toEqual({ remembered: false });
    s.sealed.open.mockRejectedValueOnce(
      new PlatformError("google-not-configured"),
    );
    await expect(vault().get(KEY)).resolves.toBe("sk-a");
    await expect(vault().delete(KEY)).resolves.toBeUndefined();
    s.sealed.open.mockRejectedValueOnce(
      new PlatformError("google-not-configured"),
    );
    await expect(vault().get(KEY)).resolves.toBeNull();
  });

  it("asks the service once for callers that ask together", async () => {
    await vault().set(KEY, "sk-a", { remember: true });
    dropSessionCredentials("writer-a");
    s.sealed.open.mockClear();
    const v = vault();
    await Promise.all([v.get(KEY), v.get(KEY), v.get(KEY)]);
    expect(s.sealed.open).toHaveBeenCalledOnce();
  });

  it("never lets an older opening bring back a value set after it", async () => {
    await vault().set(KEY, "sk-old", { remember: true });
    let answer!: (value: string | null) => void;
    s.sealed.open.mockReturnValueOnce(
      new Promise((resolve) => (answer = resolve)),
    );
    const v = vault();
    const reading = v.get(KEY);
    await v.set(KEY, "sk-new", { remember: false });
    answer("sk-old");
    await expect(reading).resolves.toBe("sk-new");
    await expect(v.get(KEY)).resolves.toBe("sk-new");
  });

  it("never reaches another writer's value", async () => {
    await vault().set(KEY, "sk-a", { remember: false });
    writer = "writer-b";
    s.as("writer-b");
    await expect(vault().get(KEY)).resolves.toBeNull();
    await vault().delete(KEY);
    expect(s.sealed.forget).toHaveBeenLastCalledWith("writer-b", KEY);
  });

  it("refuses without a writer, a malformed name or an oversized value", async () => {
    writer = null;
    await expect(vault().get(KEY)).rejects.toThrow();
    writer = "writer-a";
    await expect(vault().get("Bad Name")).rejects.toThrow();
    await expect(
      vault().set(KEY, "k".repeat(513), { remember: true }),
    ).rejects.toThrow();
  });
});
