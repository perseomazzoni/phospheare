// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./session";
// The words asserted are read from the locale file, never copied into the
// spec, so a reword cannot fail this row as an import bug.
import en from "../src/locales/en.json" with { type: "json" };

// Importing a manuscript, end to end. The readers, the detection, the list's
// edits and the seed are unit-tested in jsdom; this row walks the road a
// writer takes: the creation wizard's "How do you start?", the file chosen,
// the list the detection drew, and a project written to a real folder through
// the File System Access API, behind the same OPFS-backed picker stub
// `local-shelf.spec.ts` uses, opening with the tree the list promised.
//
// The book has a contents page, which starts left out and says why, and two
// chapters sharing a title, which the project numbers.
//
// The writer is a local one (`session.ts`), on the empty shelf of a fresh
// browser context.

const ROOT = "phospheare-e2e-import";

const SENTENCE =
  "The rain had not stopped since the ferry left the harbour at dawn.";
const prose = (n: number) =>
  Array.from({ length: n }, () => SENTENCE).join(" ");

// Headings the detection cannot miss, and chapters long enough to be
// chapters: a short text with no clear division is rightly kept whole.
const MANUSCRIPT = [
  "# Contents",
  "Anna",
  "Ben",
  "Anna",
  "# Anna",
  prose(40),
  "# Ben",
  prose(40),
  "# Anna",
  prose(40),
].join("\n\n");

/** Signs in as a local writer, with an OPFS folder behind the picker. */
async function boot(page: Page): Promise<void> {
  await signIn(page);
  // The native folder picker cannot be driven, so the stub hands back an
  // OPFS folder, which has a real directory handle's semantics.
  await page.addInitScript((root) => {
    window.showDirectoryPicker = async () => {
      const base = await navigator.storage.getDirectory();
      return base.getDirectoryHandle(root, { create: true });
    };
  }, ROOT);
}

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? "");

test("a manuscript becomes a project: contents left out and said so, shared titles numbered", async ({
  page,
}) => {
  await boot(page);

  await page.goto("/app");
  // An empty folder, on the app's own origin (OPFS needs a secure one), then
  // mapped: the shelf is empty, so the welcome is where a project starts.
  await page.evaluate(async (root) => {
    const base = await navigator.storage.getDirectory();
    await base.removeEntry(root, { recursive: true }).catch(() => {});
    await base.getDirectoryHandle(root, { create: true });
  }, ROOT);
  await page.getByRole("button", { name: "Choose local folder" }).click();
  await page.getByRole("button", { name: "New project" }).click();

  // How do you start? From a manuscript.
  // The card is the target; its radio sits under it, for the keyboard.
  await page.getByText(en.create.start.manuscript).click();
  await page.getByRole("button", { name: en.create.continue }).click();

  // The import window: the file, read as soon as it is chosen.
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[type=file]").setInputFiles({
    name: "The Ember Coast.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(MANUSCRIPT, "utf8"),
  });
  await expect(dialog.getByText("The Ember Coast.md")).toBeVisible();
  await dialog.getByRole("button", { name: en.create.continue }).click();

  // The list. The contents page starts out, and says so; its title already
  // says what it is.
  const list = dialog.getByRole("list", { name: en.import.listLabel });
  const contents = list.locator(".import-row").first();
  await expect(contents).toHaveAttribute("data-included", "0");
  await expect(contents.locator(".import-row-tag")).toHaveText(
    en.import.tag.alone,
  );
  // The two chapters called Anna, told apart by number; Ben, alone, is not.
  const name = (title: string) =>
    list.getByRole("textbox", {
      name: fill(en.import.renameLabel, { title }),
    });
  await expect(name("Anna - 1")).toHaveValue("Anna - 1");
  await expect(name("Anna - 2")).toHaveValue("Anna - 2");
  await expect(name("Ben")).toHaveValue("Ben");

  // On through the creation wizard's own questions, to the last one.
  const confirm = dialog.getByRole("button", { name: en.import.confirm });
  while (!(await confirm.isVisible()))
    await dialog.getByRole("button", { name: en.create.continue }).click();
  await confirm.click();

  // The project opens once its last file is written.
  await page.waitForURL("**/app/project/**", { timeout: 20_000 });
  // The tree the list promised: numbered, and no contents page.
  const tree = page.getByRole("treegrid");
  for (const title of ["Anna - 1", "Ben", "Anna - 2"])
    await expect(tree.getByText(title, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  await expect(tree.getByText("Contents", { exact: true })).toHaveCount(0);
  // And the prose is the book's.
  await expect(page.getByText(SENTENCE).first()).toBeVisible();
});
