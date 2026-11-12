// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pins the profile copies' Drive requests: the listing carries each copy's
// checksum, and a write to a copy that is gone or in the bin creates a new
// one. A delete Drive refuses rejects, so no dialog reports a deletion that
// did not happen. `fetch` is stubbed, and the token at `driveToken`.

vi.mock("../storage/driveToken", () => ({
  driveAccessToken: () => Promise.resolve("test-token"),
  forgetDriveToken: () => {},
}));

const {
  deleteAllProfileCopies,
  deleteProfileCopy,
  listProfileCopies,
  writeProfileCopy,
} = await import("./portableDrive");

interface Sent {
  method: string;
  url: string;
}

let sent: Sent[];

function answer(...responses: Response[]): void {
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      sent.push({ method: init.method ?? "GET", url });
      const next = queue.shift();
      if (!next) throw new Error(`no answer for ${url}`);
      return next;
    }),
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  sent = [];
});

afterEach(() => vi.unstubAllGlobals());

describe("listProfileCopies", () => {
  it("names each copy's installation and carries its checksum", async () => {
    answer(
      json({
        files: [
          {
            id: "f1",
            name: "profile-aaaaaaaa.json",
            modifiedTime: "2026-10-01T10:00:00.000Z",
            md5Checksum: "m1",
          },
          { id: "f2", name: "profile-bbbbbbbb.json" },
          { id: "f3", name: "notes.json" },
        ],
      }),
    );
    expect(await listProfileCopies()).toEqual([
      {
        fileId: "f1",
        installation: "aaaaaaaa",
        modifiedTime: "2026-10-01T10:00:00.000Z",
        md5: "m1",
      },
      { fileId: "f2", installation: "bbbbbbbb", modifiedTime: null, md5: null },
    ]);
    expect(sent[0].url).toContain("md5Checksum");
  });
});

describe("writeProfileCopy", () => {
  it("updates the copy in place", async () => {
    answer(json({ id: "own", trashed: false }));
    expect(await writeProfileCopy("aaaaaaaa", "{}", "own")).toBe("own");
    expect(sent.map((s) => s.method)).toEqual(["PATCH"]);
  });

  it("creates a new copy when the one written is in the bin", async () => {
    answer(json({ id: "own", trashed: true }), json({ id: "fresh" }));
    expect(await writeProfileCopy("aaaaaaaa", "{}", "own")).toBe("fresh");
    expect(sent.map((s) => s.method)).toEqual(["PATCH", "POST"]);
    expect(sent[1].url).toContain("uploadType=multipart");
  });

  it("creates a new copy when the one remembered is gone", async () => {
    answer(json({ error: {} }, 404), json({ id: "fresh" }));
    expect(await writeProfileCopy("aaaaaaaa", "{}", "own")).toBe("fresh");
  });

  it("creates the copy when none is remembered", async () => {
    answer(json({ id: "fresh" }));
    expect(await writeProfileCopy("aaaaaaaa", "{}", null)).toBe("fresh");
    expect(sent.map((s) => s.method)).toEqual(["POST"]);
  });

  it("rejects any other refusal", async () => {
    answer(json({ error: {} }, 500));
    await expect(writeProfileCopy("aaaaaaaa", "{}", "own")).rejects.toThrow();
  });
});

describe("deleting profile copies", () => {
  it("rejects a delete Drive refuses", async () => {
    answer(new Response("", { status: 500 }));
    await expect(deleteProfileCopy("f1")).rejects.toThrow();
  });

  it("takes a copy already gone as deleted", async () => {
    answer(new Response("", { status: 404 }));
    await expect(deleteProfileCopy("f1")).resolves.toBeUndefined();
  });

  it("tries every copy before rejecting for the one refused", async () => {
    answer(
      json({
        files: [
          { id: "f1", name: "profile-aaaaaaaa.json" },
          { id: "f2", name: "profile-bbbbbbbb.json" },
        ],
      }),
      new Response("", { status: 500 }),
      new Response(null, { status: 204 }),
    );
    await expect(deleteAllProfileCopies()).rejects.toThrow();
    expect(sent.filter((s) => s.method === "DELETE")).toHaveLength(2);
  });
});
