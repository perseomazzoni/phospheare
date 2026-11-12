// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { newDraft, sectionDraft, writeReference } from "./referenceWrite";
import type { ProjectRef, StorageProvider } from "../../storage";
import { hasWriting } from "../../project/referenceAnswers";

const REF: ProjectRef = {
  providerId: "memory",
  key: "demo",
  name: "Demo",
  openedAt: "",
};

function provider(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    exists: vi.fn(async () => false),
    writeFile: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as StorageProvider;
}

// The one write seam for reference documents, pinned at its own level: the
// existence probe, the failure shape every caller reports,
// and the no-project guard.

describe("writeReference", () => {
  it("refuses a file that already exists — creation, never overwrite", async () => {
    const p = provider({ exists: vi.fn(async () => true) });
    expect(await writeReference(p, REF, "world--economy.md", "x")).toBe(false);
    expect(p.writeFile).not.toHaveBeenCalled();
  });

  it("writes the template into reference/ when the file is new", async () => {
    const p = provider();
    expect(await writeReference(p, REF, "world--economy.md", "x")).toBe(true);
    expect(p.writeFile).toHaveBeenCalledWith(
      REF,
      "/reference/world--economy.md",
      "x",
    );
  });

  it("answers false when the write throws, so the caller keeps its field open", async () => {
    const p = provider({
      writeFile: vi.fn(async () => {
        throw new Error("io");
      }),
    });
    expect(await writeReference(p, REF, "x.md", "x")).toBe(false);
  });

  it("answers false when the existence probe throws — fail closed", async () => {
    const p = provider({
      exists: vi.fn(async () => {
        throw new Error("io");
      }),
    });
    expect(await writeReference(p, REF, "x.md", "x")).toBe(false);
    expect(p.writeFile).not.toHaveBeenCalled();
  });

  it("answers false without a project ref", async () => {
    expect(await writeReference(provider(), null, "x.md", "x")).toBe(false);
  });
});

// The chat's "Write X": the document opens to be written, and a missing one
// is not created on the press, only by a save that says something
// (`hasWriting`, the shell's `worthWriting`).
describe("sectionDraft", () => {
  it("opens a missing catalogue section on its template, writing nothing", async () => {
    const p = provider();
    const draft = await sectionDraft(
      p,
      REF,
      { group: "guidebook", sectionId: "blurb" },
      "en",
    );
    expect(draft?.fileName).toBe("guidebook--blurb.md");
    expect(draft?.unborn).toBe(true);
    expect(draft?.text).toContain("#");
    expect(p.writeFile).not.toHaveBeenCalled();
  });

  it("opens one that exists on its own text, without writing over it", async () => {
    const p = provider({
      exists: vi.fn(async () => true),
      readFile: vi.fn(async () => "# Rules\n\nMagic costs blood."),
    });
    expect(
      await sectionDraft(p, REF, { group: "world", sectionId: "rules" }, null),
    ).toEqual({
      fileName: "world--rules.md",
      text: "# Rules\n\nMagic costs blood.",
      unborn: false,
    });
    expect(p.writeFile).not.toHaveBeenCalled();
  });

  it("opens nothing it could not read, rather than a template over it", async () => {
    const p = provider({
      exists: vi.fn(async () => true),
      readFile: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    expect(
      await sectionDraft(p, REF, { group: "world", sectionId: "rules" }, null),
    ).toBeNull();
  });

  it("has no one file for a shelf, and nothing without a project", async () => {
    const p = provider();
    expect(await sectionDraft(p, REF, { group: "characters" }, "en")).toBe(
      null,
    );
    expect(
      await sectionDraft(p, REF, { group: "notes", sectionId: "x" }, "en"),
    ).toBe(null);
    expect(
      await sectionDraft(
        p,
        null,
        { group: "guidebook", sectionId: "blurb" },
        "en",
      ),
    ).toBe(null);
    expect(p.writeFile).not.toHaveBeenCalled();
  });
});

// The Reference panel's add controls: a character or
// an arc opens on its template and is created only by a save that says
// something — and never over a name that is already taken.
describe("newDraft", () => {
  it("opens a new name on its template, unborn, writing nothing", async () => {
    const p = provider();
    expect(await newDraft(p, REF, "character--Maren.md", "# Maren")).toEqual({
      fileName: "character--Maren.md",
      text: "# Maren",
      unborn: true,
    });
    expect(p.writeFile).not.toHaveBeenCalled();
  });

  it("opens nothing over a taken name, a failed probe, or no project", async () => {
    expect(
      await newDraft(
        provider({ exists: vi.fn(async () => true) }),
        REF,
        "x.md",
        "x",
      ),
    ).toBeNull();
    const failing = provider({
      exists: vi.fn(async () => {
        throw new Error("io");
      }),
    });
    expect(await newDraft(failing, REF, "x.md", "x")).toBeNull();
    expect(await newDraft(provider(), null, "x.md", "x")).toBeNull();
  });
});

describe("hasWriting", () => {
  it("is the assistant's own test: a template says nothing, an answer does", () => {
    const template = [
      "# Logline",
      "",
      "<!-- Hint: one sentence. -->",
      "",
      "- **The story in a sentence:**",
      "  - **[PROTAGONIST]**, a [BRIEF DESCRIPTION], wants [DESIRE].",
    ].join("\n");
    expect(hasWriting(template)).toBe(false);
    expect(hasWriting("")).toBe(false);
    expect(hasWriting(`${template}\n  - Mara must relight the lamp.`)).toBe(
      true,
    );
  });
});
