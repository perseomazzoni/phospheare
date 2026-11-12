// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Removing the settings and Library while a profile upload is under way:
// the real merge, the real copy deletion and the real disconnect order,
// against a Drive that answers from a set of files. The upload is held at
// its PATCH while the disconnect starts.

let connected = true;
vi.mock("../../storage/driveToken", () => ({
  driveAccessToken: async () => "test-token",
  forgetDriveToken: () => {},
}));
vi.mock("../../writers/registry", () => ({
  findWriter: () =>
    connected ? { drive: { connectionId: "connection" } } : { drive: null },
}));

import { setCurrentUserId } from "../../auth/currentUser";
import { mergeWithDrive } from "../../profile/profileStore";
import { disconnectRemote } from "./disconnectRemote";

const files = new Set<string>();
const methods: string[] = [];
let releasePatch: () => void = () => {};
let patchStarted: () => void = () => {};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("installation", "aaaaaaaa");
  setCurrentUserId("writer-a");
  connected = true;
  files.clear();
  files.add("old");
  methods.length = 0;
  const patchGate = new Promise<void>((resolve) => (releasePatch = resolve));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      methods.push(method);
      const url = new URL(input);
      if (method === "GET" && url.searchParams.has("spaces"))
        return json({
          files: [...files].map((id) => ({
            id,
            name: "profile-aaaaaaaa.json",
          })),
        });
      if (method === "GET" && url.searchParams.get("alt") === "media")
        return json({ v: 1, installation: "aaaaaaaa", prefs: {}, library: {} });
      if (method === "PATCH") {
        patchStarted();
        await patchGate;
        return files.has("old")
          ? json({ id: "old", trashed: false })
          : json({ error: {} }, 404);
      }
      if (method === "DELETE") {
        files.delete(url.pathname.split("/").pop() ?? "");
        return new Response(null, { status: 204 });
      }
      if (
        method === "POST" &&
        url.searchParams.get("uploadType") === "multipart"
      ) {
        files.add("recreated");
        return json({ id: "recreated" });
      }
      throw new Error(`Unexpected ${method} ${input}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentUserId(null);
});

it("lets an upload under way finish before the copies go, and none comes back", async () => {
  const patched = new Promise<void>((resolve) => (patchStarted = resolve));
  const merge = mergeWithDrive("writer-a");
  await patched;
  const disconnect = vi.fn(async () => {
    connected = false;
  });
  const disconnected = disconnectRemote(
    { disconnect },
    { everywhere: true, keptCopies: false },
  );
  // Every step of a deletion is a promise step against the stubbed fetch, so
  // one turn of the task queue runs an unheld deletion to its end. Held, it
  // has not listed or deleted.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(methods.filter((m) => m === "DELETE")).toEqual([]);
  releasePatch();
  await Promise.all([merge, disconnected]);
  expect([...files]).toEqual([]);
  expect(methods).not.toContain("POST");
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it("lets a merge that waited out the deletion find Drive disconnected", async () => {
  releasePatch();
  let finishDisconnect: () => void = () => {};
  let asked = false;
  const disconnected = disconnectRemote(
    {
      disconnect: () =>
        new Promise<void>((resolve) => {
          asked = true;
          finishDisconnect = () => {
            connected = false;
            resolve();
          };
        }),
    },
    { everywhere: true, keptCopies: false },
  );
  // The copies are gone once the disconnect itself is asked for.
  await vi.waitFor(() => expect(asked).toBe(true));
  const merge = mergeWithDrive("writer-a");
  const before = methods.length;
  finishDisconnect();
  await disconnected;
  expect(await merge).toBe("off");
  expect(methods.length).toBe(before);
  expect([...files]).toEqual([]);
});
