// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  NAMED_REFERENCE_CLAUSE,
  PROSE_BOUNDARY,
  REQUEST_LANGUAGE,
  workflowInstructions,
} from "../domain/policy";
import {
  requestMessage,
  turnInstructions,
  type RequestParts,
} from "./turnPrompt";

// The request is ordered by rate of change, stable first and volatile last:
// a block out of its place costs the prompt cache, not correctness, so only
// these tests see it.

/** Every text block of the message, named by itself. */
const PARTS: RequestParts = {
  references: "REFERENCES",
  missing: "MISSING",
  readerMemory: "READER-MEMORY",
  need: "NEED",
  momentum: "MOMENTUM",
  chatNames: "CHAT-NAMES",
  letter: "LETTER",
  briefing: "BRIEFING",
  facts: "FACTS",
  manifest: "MANIFEST",
  sources: "SOURCES",
  margin: "MARGIN",
  request: "the question",
  command: false,
};

/** Whether each text stands in `text` after the one before it. */
const inOrder = (text: string, blocks: readonly string[]) =>
  blocks.every(
    (block, at) =>
      text.includes(block) &&
      (at === 0 || text.indexOf(block) > text.indexOf(blocks[at - 1])),
  );

describe("a turn's final user message", () => {
  it("keeps the references first and the question last", () => {
    const message = requestMessage(PARTS);
    expect(
      inOrder(message, [
        "REFERENCES",
        "MISSING",
        "READER-MEMORY",
        "NEED",
        "MOMENTUM",
        "CHAT-NAMES",
        "LETTER",
        "BRIEFING",
        "FACTS",
        "MANIFEST",
        "SOURCES",
        "MARGIN",
        "Writer request:\nthe question",
        REQUEST_LANGUAGE,
      ]),
    ).toBe(true);
  });

  it("leaves an empty block out, and the language line under a command", () => {
    const message = requestMessage({
      ...PARTS,
      references: "",
      missing: "",
      readerMemory: "",
      need: "",
      momentum: "",
      chatNames: "",
      letter: "",
      briefing: "",
      facts: "",
      manifest: "",
      sources: "",
      margin: "",
      command: true,
    });
    expect(message).toBe("Writer request:\nthe question");
  });
});

describe("a turn's system instructions", () => {
  it("keep the boundary first and the persona last", () => {
    const instructions = turnInstructions({
      facts: null,
      kind: "editorial",
      reviewTask: undefined,
      named: true,
      referenceClause: "HOW-TO-READ",
      persona: "PERSONA",
    });
    expect(instructions.startsWith(PROSE_BOUNDARY)).toBe(true);
    expect(instructions.endsWith("PERSONA")).toBe(true);
    expect(
      inOrder(instructions, [
        PROSE_BOUNDARY,
        workflowInstructions("editorial", undefined),
        NAMED_REFERENCE_CLAUSE,
        "HOW-TO-READ",
        "PERSONA",
      ]),
    ).toBe(true);
  });

  it("say the named clause only when a name narrowed the review", () => {
    const instructions = turnInstructions({
      facts: null,
      kind: "editorial",
      reviewTask: undefined,
      named: false,
      referenceClause: "",
      persona: "PERSONA",
    });
    expect(instructions).not.toContain(NAMED_REFERENCE_CLAUSE);
    expect(instructions).toBe(
      [PROSE_BOUNDARY, workflowInstructions("editorial", undefined), "PERSONA"]
        .filter(Boolean)
        .join("\n\n"),
    );
  });
});
