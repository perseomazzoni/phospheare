// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Pins one seam to OPFS. No browser reports an eviction, so the only way a
// test can produce the case that finds real bugs (a mid-session drop between
// two awaits inside one operation) is a fake that evicts on command, and a
// fake needs one seam to replace. A second file calling
// `navigator.storage.getDirectory()` makes the layer above it untestable,
// and nothing else fails.
//
// Like `editor/engine/boundaries.test.ts`, it walks the source and asserts
// the rule. When it fails, the fix is to go through
// `storage/cache/cacheRoot.ts`, never to weaken the rule.
//
// Glob keys are relative to this file, so the one legal caller, its
// neighbour, resolves as `./cacheRoot.ts` rather than a `src/`-rooted path.

import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * The storage manager, however its members are spelled.
 *
 * `getDirectory` is the seam itself. `persist` and `estimate` fall under the
 * same rule for another reason: no code may branch on the persistence
 * verdict, because all script-writable storage is evictable on every browser
 * and `persist()` may be refused with no recourse. A quota question asked
 * anywhere but here is one nobody reviewed. Neither is called.
 */
const OPFS_CALL =
  /navigator\s*\.\s*storage\s*\??\.\s*(getDirectory|persist|estimate)/;

/**
 * Drop whole-line comments before matching.
 *
 * The files under this rule mention these names in prose: `fakeOpfs.fixture.ts`
 * explains why `navigator.storage.persist()` cannot be branched on. A rule
 * that fires on prose is a rule people learn to word around.
 *
 * Whole lines only, never a trailing `//`: a line holding
 * `https://drive.google.com/...` would have its tail eaten, and a real call
 * sharing that line would go unseen. A call never sits on a line that starts
 * with `//` or `*`.
 */
function code(src: string): string {
  return src
    .split("\n")
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("the OPFS seam", () => {
  it("is opened from exactly one file, and that file is cacheRoot", () => {
    const callers = Object.entries(sources)
      .filter(([path]) => !path.includes(".test."))
      .filter(([, src]) => OPFS_CALL.test(code(src)))
      .map(([path]) => path);

    expect(callers).toEqual(["./cacheRoot.ts"]);
  });

  it("would still catch a real call hiding under a comment-heavy file", () => {
    // The negative control for `code()`: stripping must not disable the rule.
    // A commented mention is ignored; a real call on a code line is not, even
    // in a file that is mostly prose.
    expect(OPFS_CALL.test(code("// navigator.storage.persist()"))).toBe(false);
    expect(OPFS_CALL.test(code(" * navigator.storage.getDirectory()"))).toBe(
      false,
    );
    expect(
      OPFS_CALL.test(code("const d = await navigator.storage.getDirectory();")),
    ).toBe(true);
    expect(
      OPFS_CALL.test(code("// prose\nawait navigator.storage.estimate();")),
    ).toBe(true);
  });

  it("scanned a real tree, so a passing result means something", () => {
    // A glob that matched nothing would make the rule vacuous, green over an
    // empty set. Two anchors: the walk is large, and it sees the file it
    // names.
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(sources["./cacheRoot.ts"]).toBeTruthy();
    // The walk also sees the adapter that sits on the seam without being it,
    // the file most likely to grow a second call.
    expect(sources["./opfsCacheStore.ts"]).toBeTruthy();
  });
});
