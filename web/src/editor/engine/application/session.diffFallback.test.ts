// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { Session, type SessionDeps, type SessionEvents } from "./session";
import * as diffModule from "./diff";
import { SnapshotHistory } from "../adapters/snapshot";
import { regexSearch } from "../adapters/regex";
import { commonmarkCodec } from "../adapters/commonmark";
import { browserClipboardCodec } from "../adapters/browserHtml";
import { Emitter } from "../adapters/emitter";

// Pins that `recomputeDiff` retries once at paragraph grain before giving up.
// A throw at the caller's grain that empties the decorations
// and hunks would read to the shell as a clean comparison, a false "no
// changes". Paragraph grain never runs the token-level LCS
// (`buildParagraphMergedDoc` makes an edited pair a whole-paragraph
// replace), so it is the right last resort.
//
// The size guards (the cell cap in `merge.ts`) make an
// oversized pair degrade instead of throwing, so no ordinary input reaches
// this path. The module is mocked to force the throw.
//
// A separate file from `session.test.ts`, like `session.clipboard.test.ts`,
// so the module mock never shadows `buildMergedDoc` for the main suite's
// diff-mode rows.
vi.mock("./diff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./diff")>();
  return {
    ...actual,
    // The default for both tests. Vitest consumes queued
    // `mockImplementationOnce` overrides before this one, so the first test
    // relies on the default and the second overrides the two calls one
    // `recomputeDiff` makes.
    buildMergedDoc: vi.fn((left, right, grain) => {
      if (grain !== "paragraph") throw new Error("forced diff failure");
      return actual.buildMergedDoc(left, right, "paragraph");
    }),
  };
});

const deps = (): SessionDeps => ({
  codec: commonmarkCodec,
  history: new SnapshotHistory(),
  search: regexSearch,
  events: new Emitter<SessionEvents>(),
  clipboard: browserClipboardCodec,
});

describe("— recomputeDiff retries at paragraph grain before giving up", () => {
  it("recovers a real comparison when the caller's own grain throws", () => {
    const session = new Session(deps());
    const heard = vi.fn();
    session.onDiffFallback(heard);
    // Two of three words shared clears paragraph grain's 0.5 similarity bar,
    // so the blocks pair as an edited pair. Only an edited pair reaches
    // `wholeParagraphReplace`'s block-replace shape, which shows paragraph
    // grain ran.
    session.open("one\n\ntwo three four");
    session.enterDiff("one\n\ntwo three five");
    // The forced throw at word grain does not read as "nothing changed": the
    // block-level whole-paragraph replace is the paragraph retry's
    // signature.
    expect(session.diffHunks.length).toBeGreaterThan(0);
    expect(session.diffHunks[0].block).toBe(true);
    expect(session.diffHunks[0].kind).toBe("replace");
    // The view hears the fallback, by the error's kind only.
    expect(heard).toHaveBeenCalledWith({
      grain: "word",
      shown: "paragraph",
      error: "Error",
    });
  });

  it("still falls back to an honest empty comparison when the retry also fails", () => {
    const mocked = vi.mocked(diffModule.buildMergedDoc);
    // When both attempts fail `recomputeDiff` makes two calls, the caller's
    // grain then the paragraph retry, and these overrides cover them in
    // order.
    mocked.mockImplementationOnce(() => {
      throw new Error("forced word failure");
    });
    mocked.mockImplementationOnce(() => {
      throw new Error("forced paragraph failure too");
    });
    const session = new Session(deps());
    const heard = vi.fn();
    session.onDiffFallback(heard);
    session.open("one\n\ntwo");
    session.enterDiff("one\n\nTWO");
    // No comparison, but no crash and no stale or half-built one.
    expect(session.diffHunks).toEqual([]);
    expect(session.diffDecorations).toEqual([]);
    // The real buffer is untouched by the failed comparison attempt.
    expect(session.commonmark).toBe("one\n\ntwo");
    expect(heard).toHaveBeenLastCalledWith({
      grain: "word",
      shown: "none",
      error: "Error",
    });
  });
});
