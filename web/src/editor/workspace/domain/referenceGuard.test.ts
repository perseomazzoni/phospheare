// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  editAsks,
  faceOf,
  isDirty,
  isReaderFace,
  openAsks,
  worthWriting,
  type EditSession,
} from "./referenceGuard";

const MAREN = "character--maren.md";
const OTHER = "character--tobias.md";
const NOTE = "notes--harbour.md";

const edit = (over: Partial<EditSession> = {}): EditSession => ({
  fileName: MAREN,
  savedText: "# Maren\n",
  draft: "# Maren\n\nChanged.",
  ...over,
});

describe("a reference edit session at stake", () => {
  it("is dirty when the draft differs from the saved text", () => {
    expect(isDirty(edit())).toBe(true);
    expect(isDirty(edit({ draft: "# Maren\n" }))).toBe(false);
    expect(isDirty(null)).toBe(false);
  });

  it("holds a new document at stake only once it carries writing", () => {
    const template = edit({
      unborn: true,
      savedText: "# Maren\n",
      draft: "# Maren\n\n",
    });
    expect(worthWriting(template)).toBe(false);
    expect(isDirty(template)).toBe(false);
    const written = edit({
      unborn: true,
      draft: "# Maren\n\nShe keeps the light.",
    });
    expect(worthWriting(written)).toBe(true);
    expect(isDirty(written)).toBe(true);
  });

  it("always lets a save write a document already on disk", () => {
    expect(worthWriting(edit({ draft: "" }))).toBe(true);
  });
});

describe("the exits that ask before dropping a draft", () => {
  it("asks before another document of the same face opens", () => {
    expect(openAsks(edit(), OTHER)).toBe(true);
    expect(openAsks(edit(), MAREN)).toBe(false);
  });

  it("does not ask when a document of the other face opens", () => {
    expect(openAsks(edit(), NOTE)).toBe(false);
  });

  it("asks before editing another file, on either face", () => {
    expect(editAsks(edit(), NOTE)).toBe(true);
    expect(editAsks(edit(), OTHER)).toBe(true);
    expect(editAsks(edit(), MAREN)).toBe(false);
  });

  it("tells the reader faces from the faces a draft cannot stay on", () => {
    expect(isReaderFace("reference")).toBe(true);
    expect(isReaderFace("notes")).toBe(true);
    expect(isReaderFace("ask")).toBe(false);
    expect(isReaderFace("snapshot")).toBe(false);
  });

  it("never asks when nothing is at stake", () => {
    const clean = edit({ draft: "# Maren\n" });
    expect(openAsks(clean, OTHER)).toBe(false);
    expect(editAsks(clean, OTHER)).toBe(false);
    expect(openAsks(null, OTHER)).toBe(false);
  });

  it("opens a notes file on the notes face and every other on reference", () => {
    expect(faceOf(NOTE)).toBe("notes");
    expect(faceOf(MAREN)).toBe("reference");
  });
});
