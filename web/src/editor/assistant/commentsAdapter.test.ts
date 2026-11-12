// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  CommentsService,
  type CommentStore,
  type StoredComments,
} from "../comments/application/comments";
import { writeComments } from "../comments/domain/codec";
import type { CommentsFile } from "../comments/domain/model";
import { commentsPort } from "./commentsAdapter";

function store(files: Record<string, string>): CommentStore & {
  reads: string[];
} {
  const reads: string[] = [];
  return {
    reads,
    async read(nodeId): Promise<StoredComments> {
      reads.push(nodeId);
      const text = files[nodeId];
      return text === undefined ? { kind: "missing" } : { kind: "text", text };
    },
    async write(nodeId, text) {
      files[nodeId] = text;
    },
  };
}

const FILE: CommentsFile = {
  threads: [
    {
      id: "t1",
      state: "open",
      anchor: { quote: "storm", prefix: "The ", suffix: " came" },
      entries: [
        {
          id: "e1",
          author: { kind: "editor", name: "M. Rossi" },
          at: "2026-01-01T00:00:00Z",
          body: "Which storm?",
        },
      ],
    },
    {
      id: "t2",
      state: "proposed",
      anchor: null,
      entries: [
        {
          id: "e2",
          author: { kind: "persona", id: "wren" },
          at: "2026-01-02T00:00:00Z",
          body: "The ending is quick.",
        },
      ],
    },
  ],
  dismissed: [],
};

const noText = async () => null;

function service(files: Record<string, string>) {
  const backing = store(files);
  return {
    backing,
    comments: new CommentsService({
      store: backing,
      now: () => "2026-10-05T00:00:00Z",
      newId: () => "new",
    }),
  };
}

describe("commentsPort", () => {
  it("gives the assistant each thread's passage, voices and state — nothing of the file", async () => {
    const { comments } = service({ EL2: writeComments(FILE) });
    const chapters = await commentsPort(comments, noText).threadsOf([
      "EL2",
      "EL3",
    ]);
    expect(chapters).toEqual([
      {
        nodeId: "EL2",
        threads: [
          {
            id: "t1",
            state: "open",
            passage: "storm",
            entries: [
              {
                by: { kind: "editor", name: "M. Rossi" },
                body: "Which storm?",
              },
            ],
          },
          {
            id: "t2",
            state: "proposed",
            passage: null,
            entries: [
              {
                by: { kind: "persona", id: "wren" },
                body: "The ending is quick.",
              },
            ],
          },
        ],
      },
      // A chapter with no file has an empty margin, not a missing one.
      { nodeId: "EL3", threads: [] },
    ]);
  });

  it("reads a chapter the margin already holds without asking storage again", async () => {
    const { comments, backing } = service({ EL2: writeComments(FILE) });
    await comments.load(["EL2"]);
    backing.reads.length = 0;
    await commentsPort(comments, noText).threadsOf(["EL2"]);
    expect(backing.reads).toEqual([]);
  });

  it("writes a persona's answer into the thread as that persona's entry", async () => {
    const { comments } = service({ EL2: writeComments(FILE) });
    await commentsPort(comments, noText).reply(
      "EL2",
      "t1",
      "wren",
      "The first one.",
    );
    const entries = comments.fileOf("EL2")?.threads[0].entries ?? [];
    const last = entries[entries.length - 1];
    expect(last?.author).toEqual({ kind: "persona", id: "wren" });
    expect(last?.body).toBe("The first one.");
  });

  it("places a model's quote of the file on the writer's visible words", async () => {
    const { comments } = service({});
    const text =
      "The storm came.\n\nThen the *storm* stayed, and the storm grew.";
    const port = commentsPort(comments, async () => text);
    const outcomes = await port.propose("EL2", "wren", [
      {
        // The file's spelling, emphasis and all; the context picks the
        // second "storm" of the paragraph, not the first in the chapter.
        quote: { text: "*storm*", prefix: "Then the ", suffix: " stayed" },
        body: "Which storm?",
        weight: "minor",
      },
      { quote: null, body: "The chapter ends fast.", weight: "observation" },
      {
        quote: { text: "a lighthouse" },
        body: "Not here.",
        weight: "major",
      },
    ]);
    expect(outcomes).toEqual(["placed", "placed", "unplaceable"]);
    const [onPassage, onChapter] = comments.fileOf("EL2")?.threads ?? [];
    expect(onPassage.state).toBe("proposed");
    expect(onPassage.anchor).toEqual({
      quote: "storm",
      prefix: "The storm came.\nThen the ",
      suffix: " stayed, and the storm grew.",
    });
    expect(onPassage.entries[0].author).toEqual({
      kind: "persona",
      id: "wren",
    });
    expect(onChapter.anchor).toBeNull();
  });

  // A model joins a passage across paragraphs with a blank line, a break or
  // a bare space; each is the same passage, and a repeat is told apart by
  // its surroundings.
  it("places a quote that runs across paragraphs, however the join is written", async () => {
    const text =
      "It ended.\n\nThe door shut. It ended.\n\nThe door shut again.";
    for (const written of [
      "ended.\n\nThe door",
      "ended.\nThe door",
      "ended. The door",
    ]) {
      const { comments } = service({});
      const port = commentsPort(comments, async () => text);
      expect(
        await port.propose("EL2", "wren", [
          {
            quote: {
              text: written,
              prefix: "shut. It ",
              suffix: " shut again",
            },
            body: "Twice.",
            weight: "minor",
          },
        ]),
      ).toEqual(["placed"]);
      expect(comments.fileOf("EL2")?.threads[0].anchor).toEqual({
        quote: "ended.\nThe door",
        prefix: "It ended.\nThe door shut. It ",
        suffix: " shut again.",
      });
    }
  });

  it("refuses a quote across paragraphs the chapter does not hold", async () => {
    const { comments } = service({});
    const port = commentsPort(
      comments,
      async () => "It ended.\n\nThe door shut.",
    );
    expect(
      await port.propose("EL2", "wren", [
        { quote: { text: "ended.\n\nThe gate" }, body: "x", weight: "minor" },
      ]),
    ).toEqual(["unplaceable"]);
  });

  it("answers each proposal with the margin's own verdict", async () => {
    const { comments } = service({});
    const port = commentsPort(comments, async () => "The storm came.");
    const quote = { text: "storm" };
    await port.propose("EL2", "wren", [
      { quote, body: "First.", weight: "minor" },
    ]);
    const threadId = comments.fileOf("EL2")?.threads[0].id ?? "";
    await comments.remove("EL2", threadId);
    expect(
      await port.propose("EL2", "wren", [
        { quote, body: "Again.", weight: "minor" },
      ]),
    ).toEqual(["dismissed"]);
  });

  it("refuses every quote when the chapter cannot be read", async () => {
    const { comments } = service({});
    expect(
      await commentsPort(comments, noText).propose("EL2", "wren", [
        { quote: { text: "storm" }, body: "x", weight: "minor" },
      ]),
    ).toEqual(["unplaceable"]);
  });

  it("leaves out a chapter whose file cannot be read", async () => {
    const { comments } = service({ EL2: "{ not json" });
    expect(await commentsPort(comments, noText).threadsOf(["EL2"])).toEqual([]);
  });
});
