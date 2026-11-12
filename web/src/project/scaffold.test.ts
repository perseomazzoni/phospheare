// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ProjectRef, StorageProvider } from "../storage";
import { scaffoldProject } from "./scaffold";
import { startingShape } from "./startingShape";
import { PROPERTIES_FILE, commentsFilePath, filePath } from "./naming";
import { parseProperties } from "./properties";

// The scaffold writes straight to the bare provider, so a map is the whole
// fake: what was written, and in which order the writes started.
function fakeProvider(failOn?: string) {
  const files = new Map<string, string>();
  const order: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const provider = {
    createDir: async () => undefined,
    writeFile: async (_ref: ProjectRef, path: string, content: string) => {
      order.push(path);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      if (path === failOn) throw new Error("write failed");
      files.set(path, content);
    },
  } as unknown as StorageProvider;
  return { provider, files, order, peak: () => peak };
}

const ref: ProjectRef = {
  providerId: "local",
  key: "once-dark",
  name: "once-dark",
  openedAt: "2026-10-04T00:00:00.000Z",
};

describe("scaffoldProject", () => {
  // The ref's name is the folder (`once-dark`), never the source of the
  // book's title.
  it("titles the book with the title it was given, not its folder", async () => {
    const { provider, files } = fakeProvider();
    await scaffoldProject(provider, ref, {
      document: { title: "Once Dark", author: "Ada Byron" },
    });
    const props = parseProperties(files.get(PROPERTIES_FILE) ?? "", "x");
    expect(props.document.title).toBe("Once Dark");
    expect(props.document.author).toBe("Ada Byron");
  });

  it("falls back to the folder's name when no title is given", async () => {
    const { provider, files } = fakeProvider();
    await scaffoldProject(provider, ref);
    expect(
      parseProperties(files.get(PROPERTIES_FILE) ?? "", "x").document.title,
    ).toBe("once-dark");
  });

  it("records the per-node counts a shape arrives with", async () => {
    const { provider, files } = fakeProvider();
    const shape = startingShape(["One", "Two"]);
    await scaffoldProject(provider, ref, {
      shape,
      stats: [
        { nodeId: "EL1", words: 1200 },
        { nodeId: "EL2", words: 300 },
        // A count for a node the shape does not hold is not the book's.
        { nodeId: "EL9", words: 99 },
      ],
    });
    const stats = parseProperties(files.get(PROPERTIES_FILE) ?? "", "x").stats;
    expect(stats.words).toBe(1500);
    expect(stats.perNode.map((one) => one.nodeId)).toEqual(["EL1", "EL2"]);
  });

  it("writes the documents a few at a time and counts each one", async () => {
    const { provider, files, peak } = fakeProvider();
    const shape = startingShape(
      Array.from({ length: 10 }, (_, i) => `Part ${i + 1}`),
    );
    const counted: [number, number][] = [];
    await scaffoldProject(provider, ref, { shape }, undefined, (done, total) =>
      counted.push([done, total]),
    );
    for (const file of shape.files) {
      expect(files.has(filePath(file.fileName))).toBe(true);
    }
    expect(peak()).toBeGreaterThan(1);
    expect(peak()).toBeLessThanOrEqual(4);
    expect(counted[counted.length - 1]).toEqual([10, 10]);
    expect(counted).toHaveLength(10);
  });

  it("writes the comments files it is handed, before the manifest", async () => {
    const { provider, files, order } = fakeProvider();
    const content = '{"threads":[],"dismissed":[]}\n';
    await scaffoldProject(provider, ref, {
      comments: [{ nodeId: "EL2", content }],
    });
    expect(files.get(commentsFilePath("EL2"))).toBe(content);
    const at = order.indexOf(commentsFilePath("EL2"));
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(order.indexOf(PROPERTIES_FILE));
  });

  it("stops before the manifest when a document write fails", async () => {
    const shape = startingShape(["One", "Two", "Three"]);
    const { provider, files } = fakeProvider(filePath(shape.files[1].fileName));
    await expect(scaffoldProject(provider, ref, { shape })).rejects.toThrow(
      "write failed",
    );
    // The properties name the files, so a folder missing one is never
    // described as complete.
    expect(files.has(PROPERTIES_FILE)).toBe(false);
  });
});
