// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./session";
import {
  docxOf,
  wp,
  wr,
} from "../src/editor/import/adapters/readers/packages.fixture";
// The words asserted are read from the locale file, never copied into the
// spec, so a reword cannot fail this row as a comments bug.
import en from "../src/locales/en.json" with { type: "json" };

// An editor's comments, from a .docx to the margin. The comments domain, the
// store, the margin and the import's seed are unit-tested in jsdom; this row
// walks the whole road: a .docx with an editor's comment imported through the
// creation wizard, its comments file written to a real folder beside the
// chapters, and the project opening with the comment in the margin beside its
// words and counted in the structure panel.
//
// The writer is a local one (`session.ts`), on the empty shelf of a fresh
// browser context.

const ROOT = "phospheare-e2e-comments";

const SENTENCE =
  "The rain had not stopped since the ferry left the harbour at dawn.";
const prose = (n: number) =>
  Array.from({ length: n }, () => SENTENCE).join(" ");

const STYLES =
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>';
const heading = (title: string) =>
  wp(wr(title), '<w:pStyle w:val="Heading1"/>');

// Two chapters long enough to be chapters; the editor's comment sits on
// "lighthouse" in the first, with a reply folded into its thread.
const DOCX = docxOf({
  styles: STYLES,
  body:
    heading("Anna") +
    wp(
      wr("She watched the ") +
        '<w:commentRangeStart w:id="1"/>' +
        wr("lighthouse") +
        '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>' +
        wr(" go dark over the water."),
    ) +
    wp(wr(prose(40))) +
    heading("Ben") +
    wp(wr(prose(40))),
  comments:
    '<w:comment w:id="1" w:author="Edith" w:date="2026-01-01T00:00:00Z"><w:p w14:paraId="AA"><w:r><w:t>Which lighthouse?</w:t></w:r></w:p></w:comment>' +
    '<w:comment w:id="2" w:author="Ada"><w:p w14:paraId="BB"><w:r><w:t>The old one.</w:t></w:r></w:p></w:comment>',
  commentsExtended:
    '<w15:commentEx w15:paraId="AA"/><w15:commentEx w15:paraId="BB" w15:paraIdParent="AA"/>',
});

/** Signs in as a local writer, with an OPFS folder behind the picker. */
async function boot(page: Page): Promise<void> {
  await signIn(page);
  await page.addInitScript((root) => {
    window.showDirectoryPicker = async () => {
      const base = await navigator.storage.getDirectory();
      return base.getDirectoryHandle(root, { create: true });
    };
  }, ROOT);
}

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? "");

test("an imported editor's comment opens in the margin beside its words, and is counted", async ({
  page,
}) => {
  // Wide enough for the margin's cards beside the prose.
  await page.setViewportSize({ width: 1600, height: 900 });
  await boot(page);

  await page.goto("/app");
  await page.evaluate(async (root) => {
    const base = await navigator.storage.getDirectory();
    await base.removeEntry(root, { recursive: true }).catch(() => {});
    await base.getDirectoryHandle(root, { create: true });
  }, ROOT);
  await page.getByRole("button", { name: "Choose local folder" }).click();
  await page.getByRole("button", { name: "New project" }).click();

  await page.getByText(en.create.start.manuscript).click();
  await page.getByRole("button", { name: en.create.continue }).click();

  const dialog = page.getByRole("dialog");
  await dialog.locator("input[type=file]").setInputFiles({
    name: "The Lighthouse.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(DOCX),
  });
  await expect(dialog.getByText("The Lighthouse.docx")).toBeVisible();
  // The Chapters step offers the comments, ticked, with the file's count: the
  // comment and its reply.
  await dialog.getByRole("button", { name: en.create.continue }).click();
  const keep = dialog.getByRole("checkbox", { name: en.import.comments });
  await expect(keep).toHaveAttribute("aria-checked", "true");
  await expect(keep).toContainText("2");
  const confirm = dialog.getByRole("button", { name: en.import.confirm });
  while (!(await confirm.isVisible()))
    await dialog.getByRole("button", { name: en.create.continue }).click();
  await confirm.click();

  await page.waitForURL("**/app/project/**", { timeout: 20_000 });
  const tree = page.getByRole("treegrid");
  await expect(tree.getByText("Anna", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  // Counted in the structure panel: one thread, the reply inside it.
  await expect(
    tree.getByRole("img", {
      name: fill(en.comments.countLabel, {
        list: fill(en.comments.countOthers_one, { count: "1" }),
      }),
    }),
  ).toBeVisible();

  // In the margin of the chapter, beside its words, with the reply.
  await tree.getByText("Anna", { exact: true }).click();
  await expect(page.getByText("She watched the lighthouse")).toBeVisible();
  const card = page.getByRole("article", { name: en.comments.threadLabel });
  await expect(card).toContainText("Which lighthouse?");
  await expect(card).toContainText("Edith");
  await card.click();
  await expect(card).toContainText("The old one.");

  // The comments file is beside the chapters, in the writer's own folder.
  const files = await page.evaluate(async (root) => {
    const base = await navigator.storage.getDirectory();
    const folder = await base.getDirectoryHandle(root);
    const names: string[] = [];
    for await (const [project, handle] of folder.entries()) {
      if (handle.kind !== "directory") continue;
      const projectDir = await folder.getDirectoryHandle(project);
      const comments = await projectDir
        .getDirectoryHandle("comments")
        .catch(() => null);
      if (!comments) continue;
      for await (const name of comments.keys()) names.push(name);
    }
    return names;
  }, ROOT);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/\.json$/);
});
