// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  NEED_COMMANDS,
  NEED_LINES,
  STOPPED_AT_MAX,
  momentumLine,
  returningTo,
  stoppedAt,
  visit,
  forLaterNote,
  needFor,
  needOfCommand,
  splitForLater,
} from "./drafting";
import { skillFor } from "./skills";
import { DRAFTING_LIMITS, DRAFTING_NEEDS, type DraftingRecord } from "./types";

describe("the drafting room's need", () => {
  it("has a line for every need, and a shipped command for each it names", () => {
    for (const need of DRAFTING_NEEDS) expect(NEED_LINES[need]).toBeTruthy();
    for (const command of Object.values(NEED_COMMANDS))
      expect(skillFor(`/${command}`)?.chats).toContain("drafting");
    expect(needOfCommand("unstick")).toBe("unstick");
    expect(needOfCommand("how-to-say")).toBe("words");
    expect(needOfCommand("verify")).toBeNull();
  });

  it("holds only for the Section it was given for", () => {
    const drafting: DraftingRecord = {
      need: { kind: "what-if", nodeId: "one", at: "t" },
    };
    expect(needFor(drafting, "one")).toBe("what-if");
    expect(needFor(drafting, "two")).toBeNull();
    expect(needFor(drafting, undefined)).toBeNull();
    expect(needFor({ need: { kind: "check", at: "t" } }, undefined)).toBe(
      "check",
    );
    expect(needFor(undefined, "one")).toBeNull();
  });
});

describe("the notes kept for later", () => {
  it("takes every block out of the answer, one note per line", () => {
    const { answer, notes } = splitForLater(
      "Here is the passage.\n\n<for-later>\n- The POV slips in line 3.\n2. Echo: *door* twice.\n\n</for-later>",
    );
    expect(answer).toBe("Here is the passage.");
    expect(notes.map((note) => note.body)).toEqual([
      "The POV slips in line 3.",
      "Echo: *door* twice.",
    ]);
    // Two blocks, any case, a double said once.
    const twice = splitForLater(
      "A <FOR-LATER>one</FOR-LATER> B <for-later>one\ntwo</for-later> C",
    );
    expect(twice.answer).toBe("A  B  C");
    expect(twice.notes.map((note) => note.body)).toEqual(["one", "two"]);
  });

  it("never shows a block still arriving, or a tag half-typed", () => {
    expect(splitForLater("Answer.\n<for-later>\n- a note sti").answer).toBe(
      "Answer.",
    );
    expect(splitForLater("Answer.\n<for-la").answer).toBe("Answer.");
    expect(splitForLater("Answer.\n<").answer).toBe("Answer.");
    // A bracket that is not the start of the tag stays.
    expect(splitForLater("x < y").answer).toBe("x < y");
    expect(splitForLater("Plain answer.")).toEqual({
      answer: "Plain answer.",
      notes: [],
    });
  });

  it("caps each note, and each passage", () => {
    const long = "n".repeat(DRAFTING_LIMITS.note + 40);
    expect(
      splitForLater(`<for-later>${long}</for-later>`).notes[0].body,
    ).toHaveLength(DRAFTING_LIMITS.note);
    const [pinned] = splitForLater(
      `<for-later>"${long}" :: ${long}</for-later>`,
    ).notes;
    expect(pinned.quote?.text).toHaveLength(DRAFTING_LIMITS.note);
    expect(pinned.body).toHaveLength(DRAFTING_LIMITS.note);
  });

  // The notes are ghost comments in the margin, which owns "once" and "the
  // cap" (`admit` in `proposals.test.ts`). Pinned here is the reading of each
  // line, which decides where a note lands.
  it("reads a passage and its note, or a note on the Section as a whole", () => {
    expect(forLaterNote('"the old gate" :: Which gate is this?')).toEqual({
      quote: { text: "the old gate" },
      body: "Which gate is this?",
      weight: "minor",
    });
    // Curly quotes and guillemets are a model's to choose.
    expect(forLaterNote("“il vecchio cancello” :: Quale?").quote?.text).toBe(
      "il vecchio cancello",
    );
    expect(forLaterNote("«porta» :: due volte").quote?.text).toBe("porta");
    // No separator, or an empty side: a note on the Section, an observation.
    expect(forLaterNote("The middle sags.")).toEqual({
      quote: null,
      body: "The middle sags.",
      weight: "observation",
    });
    // A passage with nothing said about it is still what the persona
    // noticed: the words themselves are the note.
    expect(forLaterNote('"the old gate" ::')).toEqual({
      quote: null,
      body: "the old gate",
      weight: "observation",
    });
    expect(forLaterNote(":: The middle sags.")).toEqual({
      quote: null,
      body: "The middle sags.",
      weight: "observation",
    });
    // The same passage with two notes is two notes; the same line twice, one.
    expect(
      splitForLater(
        '<for-later>"a" :: one\n"a" :: two\n"a" :: one</for-later>',
      ).notes.map((note) => note.body),
    ).toEqual(["one", "two"]);
  });
});

describe("momentum: where the writer stopped", () => {
  it("finds the last sentence of the last paragraph with prose", () => {
    expect(
      stoppedAt(
        "# One\n\nThe rain came. She waited by the door.\n\nThen he knocked! “Who is it?”\n\n---\n\n<!-- note -->\n\n",
      ),
    ).toBe("“Who is it?”");
    expect(stoppedAt("An unfinished thought with no stop")).toBe(
      "An unfinished thought with no stop",
    );
    expect(stoppedAt("# Only a heading\n\n***")).toBeNull();
    expect(stoppedAt("")).toBeNull();
  });

  it("keeps the END of a very long sentence, where the writer stopped", () => {
    const line = stoppedAt(`${"word ".repeat(200)}end.`);
    expect(line?.length).toBe(STOPPED_AT_MAX);
    expect(line?.startsWith("…")).toBe(true);
    expect(line?.endsWith("end.")).toBe(true);
  });

  it("is coming back only after drafting there, then elsewhere", () => {
    const away = visit(visit(undefined, "a"), "b");
    expect(away.visited).toEqual(["a", "b"]);
    expect(returningTo(away, "a")).toBe(true);
    // Still on it: mid-conversation, not returning.
    const back = visit(away, "a");
    expect(back.visited).toEqual(["b", "a"]);
    expect(returningTo(back, "a")).toBe(false);
    // Never drafted here.
    expect(returningTo(away, "c")).toBe(false);
    expect(returningTo(undefined, "a")).toBe(false);
    expect(returningTo(away, undefined)).toBe(false);
    // Kept to a book's worth, the most recent last.
    let many = visit(undefined, "x0");
    for (let at = 1; at <= DRAFTING_LIMITS.visited; at += 1)
      many = visit(many, `x${at}`);
    expect(many.visited).toHaveLength(DRAFTING_LIMITS.visited);
    expect(many.visited?.[0]).toBe("x1");
  });

  it("asks the first answer back to say what the scene still owes", () => {
    const line = momentumLine("She shut the door.");
    expect(line).toContain('"She shut the door."');
    expect(line).toContain("what the scene still owes");
  });
});
