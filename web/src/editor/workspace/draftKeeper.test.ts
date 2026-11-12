// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import type { ProjectRef, StorageProvider } from "../../storage";
import {
  createDraftKeeper,
  type DraftKeeper,
  type DraftTarget,
  type KeptDraft,
} from "./draftKeeper";
import type { EditSession } from "./domain/referenceGuard";

const REF: ProjectRef = {
  providerId: "local",
  key: "p1",
  name: "Demo",
  openedAt: "",
};
const FILE = "character--maren.md";
const PATH = `/reference/${FILE}`;

/** A reference folder in memory, with a switch to fail the next writes. */
function disk(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  let failing = false;
  const provider = {
    exists: vi.fn(async (_ref: ProjectRef, path: string) => files.has(path)),
    writeFile: vi.fn(async (_ref: ProjectRef, path: string, text: string) => {
      if (failing) throw new Error("io");
      files.set(path, text);
    }),
    removeFile: vi.fn(async (_ref: ProjectRef, path: string) => {
      files.delete(path);
    }),
  } as unknown as StorageProvider;
  const target: DraftTarget = { provider, projectRef: REF };
  return {
    files,
    target,
    fail: (on: boolean) => {
      failing = on;
    },
  };
}

/** The kept draft, which the test expects to be there. */
function taken(keeper: DraftKeeper): KeptDraft {
  const kept = keeper.takeUnless(null);
  if (!kept) throw new Error("no kept draft");
  return kept;
}

const edit = (over: Partial<EditSession> = {}): EditSession => ({
  fileName: FILE,
  savedText: "# Maren\n",
  draft: "# Maren\n\nShe keeps the light.",
  ...over,
});

describe("the draft an exit writes", () => {
  it("writes the draft and gives the file back its text on restore", async () => {
    const d = disk({ [PATH]: "# Maren\n" });
    const changed = vi.fn();
    const keeper = createDraftKeeper(changed);
    expect(await keeper.persist(d.target, edit())).toBe(true);
    expect(d.files.get(PATH)).toBe("# Maren\n\nShe keeps the light.");

    await keeper.restore(d.target, taken(keeper));
    expect(d.files.get(PATH)).toBe("# Maren\n");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("creates a new document once and removes it on restore", async () => {
    const d = disk();
    const changed = vi.fn();
    const keeper = createDraftKeeper(changed);
    expect(await keeper.persist(d.target, edit({ unborn: true }))).toBe(true);
    expect(
      await keeper.persist(
        d.target,
        edit({ unborn: true, draft: "# Maren\n\nLater." }),
      ),
    ).toBe(true);
    // The second write overwrites the file the first made, with no probe.
    expect(d.files.get(PATH)).toBe("# Maren\n\nLater.");
    expect(d.target.provider.exists).toHaveBeenCalledTimes(1);

    await keeper.restore(d.target, taken(keeper));
    expect(d.files.has(PATH)).toBe(false);
  });

  it("never overwrites a new document another tab made first", async () => {
    const d = disk({ [PATH]: "theirs" });
    const keeper = createDraftKeeper(() => {});
    expect(await keeper.persist(d.target, edit({ unborn: true }))).toBe(false);
    expect(d.files.get(PATH)).toBe("theirs");
    // Nothing of this session landed, so a restore must not remove theirs.
    await keeper.restore(d.target, taken(keeper));
    expect(d.files.get(PATH)).toBe("theirs");
  });

  it("answers false for a failed write but still undoes an earlier one", async () => {
    const d = disk({ [PATH]: "# Maren\n" });
    const keeper = createDraftKeeper(() => {});
    expect(await keeper.persist(d.target, edit())).toBe(true);
    d.fail(true);
    expect(await keeper.persist(d.target, edit({ draft: "newer" }))).toBe(
      false,
    );
    d.fail(false);
    await keeper.restore(d.target, taken(keeper));
    expect(d.files.get(PATH)).toBe("# Maren\n");
  });
});

describe("the writer's save", () => {
  it("overwrites a new document an exit already created", async () => {
    const d = disk();
    const keeper = createDraftKeeper(() => {});
    await keeper.persist(d.target, edit({ unborn: true }));
    expect(
      await keeper.save(d.target, edit({ unborn: true, draft: "final" })),
    ).toBe(true);
    expect(d.files.get(PATH)).toBe("final");
    // A landed save leaves nothing for the session's end to restore.
    expect(keeper.takeUnless(null)).toBeNull();
  });

  it("refuses to create over a file another tab made", async () => {
    const d = disk({ [PATH]: "theirs" });
    const keeper = createDraftKeeper(() => {});
    expect(await keeper.save(d.target, edit({ unborn: true }))).toBe(false);
    expect(d.files.get(PATH)).toBe("theirs");
  });

  it("keeps the kept draft when the save fails", async () => {
    const d = disk({ [PATH]: "# Maren\n" });
    const keeper = createDraftKeeper(() => {});
    await keeper.persist(d.target, edit());
    d.fail(true);
    expect(await keeper.save(d.target, edit({ draft: "final" }))).toBe(false);
    expect(keeper.takeUnless(null)?.fileName).toBe(FILE);
  });

  it("says the folder changed only when a save creates a file", async () => {
    const changed = vi.fn();
    const keeper = createDraftKeeper(changed);
    await keeper.save(disk({ [PATH]: "x" }).target, edit());
    expect(changed).not.toHaveBeenCalled();
    await keeper.save(disk().target, edit({ unborn: true }));
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe("the kept draft's slot", () => {
  it("is not handed over while its own session is open", async () => {
    const d = disk({ [PATH]: "# Maren\n" });
    const keeper = createDraftKeeper(() => {});
    await keeper.persist(d.target, edit());
    expect(keeper.takeUnless(FILE)).toBeNull();
    expect(keeper.takeUnless("character--tobias.md")?.fileName).toBe(FILE);
    expect(keeper.takeUnless(null)).toBeNull();
  });

  it("forgets the draft of a deleted file and no other", async () => {
    const d = disk({ [PATH]: "# Maren\n" });
    const keeper = createDraftKeeper(() => {});
    await keeper.persist(d.target, edit());
    keeper.forget("character--tobias.md");
    expect(keeper.takeUnless(null)).not.toBeNull();
    await keeper.persist(d.target, edit());
    keeper.forget(FILE);
    expect(keeper.takeUnless(null)).toBeNull();
  });
});
