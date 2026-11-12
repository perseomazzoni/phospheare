// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformError, type GoogleIdentity } from "../../platform/types";
import {
  findWriter,
  findWriterBySub,
  resetRegistryForTests,
  writerRegistry,
} from "../registry";
import { enterWithoutGoogle, signInWithGoogle } from "./signIn";

// Signing in with Google: a new Google account gets its record, a known one
// takes its own id back, and a sign-in that does not finish stores nothing.

const identity = (sub: string, name = sub): GoogleIdentity => ({
  iss: "https://accounts.google.com",
  sub,
  email: `${sub}@example.test`,
  emailVerified: true,
  name,
  picture: null,
});

const platform = (answer: () => Promise<GoogleIdentity>) => ({
  signInWithGoogle: vi.fn(answer),
  openSession: vi.fn(async () => {}),
});

beforeEach(() => {
  localStorage.clear();
  resetRegistryForTests();
});

describe("signing in with Google", () => {
  it("makes a record for a Google account new to this browser", async () => {
    const google = platform(async () => identity("g-ada"));
    const writer = await signInWithGoogle(google, writerRegistry);
    expect(writer.google?.sub).toBe("g-ada");
    expect(findWriter(writer.id)?.id).toBe(writer.id);
    expect(google.signInWithGoogle).toHaveBeenCalledWith({
      writerId: writer.id,
    });
    expect(google.openSession).not.toHaveBeenCalled();
  });

  it("gives a known account its own id back, with Google's new labels", async () => {
    const first = await signInWithGoogle(
      platform(async () => identity("g-ada")),
      writerRegistry,
    );
    const again = platform(async () => identity("g-ada", "Ada L."));
    const writer = await signInWithGoogle(again, writerRegistry, {
      loginHint: "ada",
    });
    expect(writer.id).toBe(first.id);
    expect(writer.google?.name).toBe("Ada L.");
    expect(again.signInWithGoogle).toHaveBeenCalledWith(
      expect.objectContaining({ loginHint: "ada" }),
    );
    // The flow ran under a fresh id; the service's session moves to the
    // account's own.
    expect(again.openSession).toHaveBeenCalledWith(first.id);
  });

  it("stores nothing when the sign-in does not finish", async () => {
    const cancelled = platform(async () => {
      throw new PlatformError("flow-cancelled");
    });
    await expect(signInWithGoogle(cancelled, writerRegistry)).rejects.toThrow(
      "flow-cancelled",
    );
    expect(findWriterBySub("g-ada")).toBeNull();
  });
});

describe("entering without Google", () => {
  it("makes the one account without Google, then finds it again", () => {
    const first = enterWithoutGoogle(writerRegistry);
    expect(first.google).toBeNull();
    expect(findWriter(first.id)?.id).toBe(first.id);
    expect(enterWithoutGoogle(writerRegistry).id).toBe(first.id);
  });
});
