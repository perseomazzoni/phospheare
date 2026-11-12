// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { place } from "../../comments/domain/anchor";
import { readComments } from "../../comments/domain/codec";
import { manuscriptText } from "../adapters/manuscriptText";
import { docxReader } from "../adapters/readers/docx";
import { docxOf, wp, wr } from "../adapters/readers/packages.fixture";
import { detect } from "../application/detect";
import { buildDraft } from "../application/draft";
import { prepare } from "../application/prepare";
import { DEFAULT_OPTIONS } from "../domain/plan";
import type { TitleWords } from "../ports";
import { projectRules } from "./projectRules";
import { seedFrom } from "./seed";

// Pins an imported editor's comment from the file to the margin, with nothing
// stubbed between: a .docx read, prepared, detected and drafted as the window
// does it, then seeded. The margin looks for the chapter's text as the editor
// shows it, so the anchor is found in that text.

const words: TitleWords = {
  untitled: "Untitled",
  matter: (kind) => `[${kind}]`,
  scene: (chapter, n) => `${chapter}, scene ${n}`,
  split: (row, n) => `${row} split ${n}`,
  shared: (title, n) => `${title} - ${n}`,
};

const facts = {
  title: "Once Dark",
  author: "Ada",
  language: "en",
  type: "Novel",
  goal: 90_000,
  genres: [],
  ageCategory: null,
  tropes: [],
};

describe("an imported editor's comment", () => {
  it("lands in its chapter's comments file, anchored where the margin will look", async () => {
    const doc = await docxReader.read(
      docxOf({
        body:
          wp(wr("Before the weather turned, the town was quiet.")) +
          wp(
            wr("Then the ") +
              '<w:commentRangeStart w:id="1"/>' +
              wr("storm") +
              '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>' +
              wr(" came, and the storm stayed."),
          ),
        comments:
          '<w:comment w:id="1" w:author="Ed" w:date="2026-01-01T00:00:00Z"><w:p w14:paraId="AA"><w:r><w:t>Which storm?</w:t></w:r></w:p></w:comment>' +
          '<w:comment w:id="5" w:author="Ada"><w:p w14:paraId="BB"><w:r><w:t>The first.</w:t></w:r></w:p></w:comment>',
        commentsExtended:
          '<w15:commentEx w15:paraId="AA"/><w15:commentEx w15:paraId="BB" w15:paraIdParent="AA"/>',
      }),
      "book.docx",
      { yield: async () => undefined },
    );
    const prepared = prepare(doc, manuscriptText, projectRules);
    const { plan } = detect(prepared, "auto", DEFAULT_OPTIONS, words);
    const draft = buildDraft(prepared, plan, words);
    const seed = await seedFrom(
      draft,
      facts,
      "local",
      "once-dark",
      manuscriptText,
      projectRules,
    );

    const [one] = seed.init.comments ?? [];
    expect(one).toBeDefined();
    const read = readComments(one.content);
    if (!read.ok) throw new Error("damaged");
    const [thread] = read.file.threads;
    expect(thread.entries.map((e) => [e.author, e.body])).toEqual([
      [{ kind: "editor", name: "Ed" }, "Which storm?"],
      [{ kind: "editor", name: "Ada" }, "The first."],
    ]);

    // Found in the chapter as the editor shows it: the first "storm", the one
    // the editor marked, not the second.
    const file = seed.init.shape?.files.find((f) =>
      f.fileName.includes(`.${one.nodeId}.`),
    );
    if (!file || !thread.anchor) throw new Error("no chapter or no anchor");
    const paragraphs = manuscriptText.visibleParagraphs(file.content);
    const at = place(thread.anchor, paragraphs);
    if (!at) throw new Error("not placed");
    const text = paragraphs[at.para];
    expect(text.slice(at.start, at.end)).toBe("storm");
    expect(text.slice(0, at.start)).toBe("Then the ");
  });
});
