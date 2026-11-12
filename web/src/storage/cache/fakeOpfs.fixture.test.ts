// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { fakeOpfs, type FakeOpfs } from "./fakeOpfs.fixture";

// The shared filesystem double must model closed writers and stale handles;
// otherwise recovery tests could pass on operations the browser refuses.
let fs: FakeOpfs;
beforeEach(() => {
  fs = fakeOpfs();
  fs.install();
});
afterEach(() => fs.uninstall());
it("enumerates immediate children and refuses reusing a closed writer", async () => {
  const root = await navigator.storage.getDirectory();
  await root.getDirectoryHandle("folder", { create: true });
  const file = await root.getFileHandle("book.md", { create: true });
  const writer = await file.createWritable();
  await writer.write("only copy");
  await writer.close();
  await expect(writer.write("late")).rejects.toMatchObject({
    name: "InvalidStateError",
  });
  await expect(writer.close()).rejects.toMatchObject({
    name: "InvalidStateError",
  });
  const names: string[] = [];
  for await (const name of root.keys()) names.push(name);
  expect(names.sort()).toEqual(["book.md", "folder"]);
  expect(fs.files.get("book.md")).toBe("only copy");
});
it("refuses a stale file or directory handle and a directory over an existing file", async () => {
  const root = await navigator.storage.getDirectory();
  const file = await root.getFileHandle("book.md", { create: true });
  await expect(
    root.getDirectoryHandle("book.md", { create: true }),
  ).rejects.toMatchObject({ name: "TypeMismatchError" });
  fs.files.delete("book.md");
  await expect(file.createWritable()).rejects.toMatchObject({
    name: "NotFoundError",
  });
  const folder = await root.getDirectoryHandle("folder", { create: true });
  fs.dirs.delete("folder");
  await expect(
    folder.getFileHandle("chapter.md", { create: true }),
  ).rejects.toMatchObject({ name: "NotFoundError" });
});
