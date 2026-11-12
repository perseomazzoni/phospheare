// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { coalesce } from "./remoteQueue";
import type { Op } from "../../storage/mirrored";

describe("coalesce", () => {
  it("a put followed by another put on the same path collapses to one", () => {
    const pending: Op[] = [{ kind: "put", path: "/a.md" }];
    const result = coalesce(pending, { kind: "put", path: "/a.md" });

    expect(result).toEqual([{ kind: "put", path: "/a.md" }]);
  });

  it("put / rename / put on the old path does not collapse", () => {
    let pending: Op[] = [{ kind: "put", path: "/a.md" }];
    pending = coalesce(pending, {
      kind: "rename",
      path: "/a.md",
      newName: "b.md",
    });
    pending = coalesce(pending, { kind: "put", path: "/a.md" });

    expect(pending).toEqual([
      { kind: "put", path: "/a.md" },
      { kind: "rename", path: "/a.md", newName: "b.md" },
      { kind: "put", path: "/a.md" },
    ]);
  });

  it("mkdir is never reordered before its own children", () => {
    let pending: Op[] = [{ kind: "mkdir", path: "/dir" }];
    pending = coalesce(pending, { kind: "put", path: "/dir/a.md" });
    pending = coalesce(pending, { kind: "put", path: "/dir/a.md" });

    expect(pending).toEqual([
      { kind: "mkdir", path: "/dir" },
      { kind: "put", path: "/dir/a.md" },
    ]);
  });

  it("puts on different paths never merge", () => {
    const pending: Op[] = [{ kind: "put", path: "/a.md" }];
    const result = coalesce(pending, { kind: "put", path: "/b.md" });

    expect(result).toEqual([
      { kind: "put", path: "/a.md" },
      { kind: "put", path: "/b.md" },
    ]);
  });

  it("an unrelated put in between does not block merging past it", () => {
    let pending: Op[] = [{ kind: "put", path: "/a.md" }];
    pending = coalesce(pending, { kind: "put", path: "/b.md" });
    pending = coalesce(pending, { kind: "put", path: "/a.md" });

    // The second `/a.md` put merges with the first, past the unrelated `/b.md`.
    expect(pending).toEqual([
      { kind: "put", path: "/b.md" },
      { kind: "put", path: "/a.md" },
    ]);
  });

  it("a move touching the path blocks merging past it", () => {
    let pending: Op[] = [{ kind: "put", path: "/dir/a.md" }];
    pending = coalesce(pending, {
      kind: "mv",
      from: "/dir/a.md",
      toDir: "/other",
    });
    pending = coalesce(pending, { kind: "put", path: "/dir/a.md" });

    expect(pending).toEqual([
      { kind: "put", path: "/dir/a.md" },
      { kind: "mv", from: "/dir/a.md", toDir: "/other" },
      { kind: "put", path: "/dir/a.md" },
    ]);
  });

  it("a structural op on an ancestor directory blocks merging a put beneath it", () => {
    let pending: Op[] = [{ kind: "put", path: "/dir/a.md" }];
    pending = coalesce(pending, { kind: "rm", path: "/dir" });
    pending = coalesce(pending, { kind: "put", path: "/dir/a.md" });

    expect(pending).toEqual([
      { kind: "put", path: "/dir/a.md" },
      { kind: "rm", path: "/dir" },
      { kind: "put", path: "/dir/a.md" },
    ]);
  });

  it("rm, mv and rename always append, never merge with each other", () => {
    let pending: Op[] = [];
    pending = coalesce(pending, { kind: "rm", path: "/a.md" });
    pending = coalesce(pending, { kind: "rm", path: "/a.md" });

    expect(pending).toEqual([
      { kind: "rm", path: "/a.md" },
      { kind: "rm", path: "/a.md" },
    ]);
  });
  it("a burst of snapshots uploads each file before the catalogue that names it", () => {
    const catalogue: Op = { kind: "put", path: "/snapshots-catalogue.json" };
    let pending: Op[] = [];
    for (const n of ["01", "02", "03"]) {
      pending = coalesce(pending, {
        kind: "put",
        path: "/document/section--one.EL1." + n + ".md",
      });
      pending = coalesce(pending, catalogue);
    }

    expect(pending).toEqual([
      { kind: "put", path: "/document/section--one.EL1.01.md" },
      { kind: "put", path: "/document/section--one.EL1.02.md" },
      { kind: "put", path: "/document/section--one.EL1.03.md" },
      catalogue,
    ]);
  });
});
