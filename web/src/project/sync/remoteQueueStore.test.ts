// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { RemoteQueueRecord } from "./remoteQueueStore";

const P = (key: string) => ({ id: `book-${key}`, providerId: "local", key });

/** Every op in this file is a `put`; this narrows the type for TypeScript. */
function putPath(record: RemoteQueueRecord): string {
  return record.op.kind === "put" ? record.op.path : "";
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const { setCurrentUserId } = await import("../../auth/currentUser");
  setCurrentUserId("test-user");
});

afterEach(() => vi.unstubAllGlobals());

describe("remoteQueueStore", () => {
  it("returns nothing for a project with no ops", async () => {
    const { opsFor } = await import("./remoteQueueStore");
    expect(await opsFor(P("project-a"))).toEqual([]);
  });

  it("stops an op without destroying it, and lets it go again", async () => {
    // A stopped op is still a row, in its place in the FIFO, and still
    // counted as work owed, because the bytes it names may exist nowhere else.
    const { appendOp, clearStopped, markStopped, opsFor } =
      await import("./remoteQueueStore");
    const id = await appendOp(P("project-a"), { kind: "put", path: "/a.md" });
    await appendOp(P("project-a"), { kind: "put", path: "/b.md" });

    await markStopped(id, "too-large");
    const stopped = await opsFor(P("project-a"));
    expect(stopped).toHaveLength(2);
    expect(stopped[0].stopped).toEqual({ code: "too-large" });
    expect(stopped[1].stopped).toBeUndefined();

    await clearStopped(P("project-a"));
    const cleared = await opsFor(P("project-a"));
    expect(cleared).toHaveLength(2);
    expect(cleared.every((r) => r.stopped === undefined)).toBe(true);
    // Order survives the round trip: a stop that reordered the queue would
    // apply a later state over an earlier one on the next drain.
    expect(cleared.map(putPath)).toEqual(["/a.md", "/b.md"]);
  });

  it("does not resurrect an op that landed while it was being stopped", async () => {
    // The race the drain can produce: the push succeeded and removed the row,
    // and the stop call arrives after. Writing the record back would re-queue
    // an op that already reached the remote, a duplicate write on the next
    // drain.
    const { appendOp, markStopped, opsFor, removeOp } =
      await import("./remoteQueueStore");
    const id = await appendOp(P("project-a"), { kind: "put", path: "/a.md" });
    await removeOp(id);

    await expect(markStopped(id, "permission")).resolves.toBeUndefined();
    expect(await opsFor(P("project-a"))).toEqual([]);
  });

  it("refuses to append with nobody signed in", async () => {
    // Every row carries the `userId` that scopes the drain to one account, so
    // a row without one would be unreachable by any per-user read and
    // uncleared by any per-user purge. It throws, as the cache refuses to open
    // without a resolved user.
    const { setCurrentUserId } = await import("../../auth/currentUser");
    const { appendOp } = await import("./remoteQueueStore");
    setCurrentUserId(null);
    await expect(
      appendOp(P("project-a"), { kind: "put", path: "/a.md" }),
    ).rejects.toThrow(/no signed-in user/);
    setCurrentUserId("test-user");
  });

  it("drops only the named project's ops, and is safe to repeat", async () => {
    // Scoping and idempotence are the two ways a drop can be wrong at a
    // writer's cost.
    const { appendOp, dropOps, opsFor } = await import("./remoteQueueStore");
    await appendOp(P("project-a"), { kind: "put", path: "/a.md" });
    await appendOp(P("project-a"), { kind: "put", path: "/b.md" });
    await appendOp(P("project-b"), { kind: "put", path: "/c.md" });

    await dropOps(P("project-a"));
    expect(await opsFor(P("project-a"))).toEqual([]);
    // The neighbour is untouched.
    expect(await opsFor(P("project-b"))).toHaveLength(1);

    // Again on an empty queue: dropping nothing is not an error.
    await dropOps(P("project-a"));
    expect(await opsFor(P("project-a"))).toEqual([]);

    await dropOps(P("project-b"));
    expect(await opsFor(P("project-b"))).toEqual([]);
  });

  it("appends and lists ops in insertion order", async () => {
    const { appendOp, opsFor } = await import("./remoteQueueStore");
    await appendOp(P("project-a"), { kind: "put", path: "/a.md" });
    await appendOp(P("project-a"), { kind: "put", path: "/b.md" });

    const ops = await opsFor(P("project-a"));
    expect(ops.map((r) => putPath(r))).toEqual(["/a.md", "/b.md"]);
  });

  it("keeps different projects apart", async () => {
    const { appendOp, opsFor } = await import("./remoteQueueStore");
    await appendOp(P("project-a"), { kind: "put", path: "/a.md" });
    await appendOp(P("project-b"), { kind: "put", path: "/b.md" });

    expect((await opsFor(P("project-a"))).map((r) => putPath(r))).toEqual([
      "/a.md",
    ]);
    expect((await opsFor(P("project-b"))).map((r) => putPath(r))).toEqual([
      "/b.md",
    ]);
  });

  it("removeOp drops exactly the named row", async () => {
    const { appendOp, opsFor, removeOp } = await import("./remoteQueueStore");
    const first = await appendOp(P("project-a"), {
      kind: "put",
      path: "/a.md",
    });
    await appendOp(P("project-a"), { kind: "put", path: "/b.md" });

    await removeOp(first);

    expect((await opsFor(P("project-a"))).map((r) => putPath(r))).toEqual([
      "/b.md",
    ]);
  });

  it("does not throw removing an id that was never there", async () => {
    const { removeOp } = await import("./remoteQueueStore");
    await expect(removeOp(999)).resolves.toBeUndefined();
  });

  it("pendingProjects lists every project with at least one op, once each", async () => {
    const { appendOp, pendingProjects } = await import("./remoteQueueStore");
    await appendOp(P("project-a"), { kind: "put", path: "/a.md" });
    await appendOp(P("project-a"), { kind: "put", path: "/a2.md" });
    await appendOp(P("project-b"), { kind: "put", path: "/b.md" });

    expect((await pendingProjects()).map((r) => r.key).sort()).toEqual([
      "project-a",
      "project-b",
    ]);
  });

  it("pendingProjects is empty when the queue is empty", async () => {
    const { pendingProjects } = await import("./remoteQueueStore");
    expect(await pendingProjects()).toEqual([]);
  });

  it("dropOps clears every op for one project, leaving others untouched", async () => {
    const { appendOp, dropOps, opsFor } = await import("./remoteQueueStore");
    await appendOp(P("project-a"), { kind: "put", path: "/a.md" });
    await appendOp(P("project-a"), { kind: "put", path: "/a2.md" });
    await appendOp(P("project-b"), { kind: "put", path: "/b.md" });

    await dropOps(P("project-a"));

    expect(await opsFor(P("project-a"))).toEqual([]);
    expect(await opsFor(P("project-b"))).toHaveLength(1);
  });

  it("keeps different users apart, even under the same local key", async () => {
    const { setCurrentUserId } = await import("../../auth/currentUser");
    const { appendOp, opsFor, pendingProjects } =
      await import("./remoteQueueStore");

    setCurrentUserId("user-a");
    await appendOp(P("shared-key"), { kind: "put", path: "/a.md" });

    setCurrentUserId("user-b");
    expect(await opsFor(P("shared-key"))).toEqual([]);
    expect(await pendingProjects()).toEqual([]);
    await appendOp(P("shared-key"), { kind: "put", path: "/b.md" });

    setCurrentUserId("user-a");
    expect((await opsFor(P("shared-key"))).map((r) => putPath(r))).toEqual([
      "/a.md",
    ]);
  });
});
