// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import type {
  DocumentProperties,
  DocumentStructure,
  SnapshotCatalogue,
} from "../../../project/types";
import type { MetadataStore, ProjectId } from "./stores";
import { MetadataLanes, sameProject } from "./metadataLanes";

// The lanes see a structure or a properties block only as a value to write
// and hand on, so a tagged stand-in is enough.
const shape = (tag: string) => ({ tag }) as unknown as DocumentStructure;
const props = (tag: string, extra: Record<string, unknown> = {}) =>
  ({ tag, ...extra }) as unknown as DocumentProperties;
const cat = (tag: string, extra: Record<string, unknown> = {}) =>
  ({ tag, ...extra }) as unknown as SnapshotCatalogue;
const tagOf = (value: unknown) => (value as { tag: string } | null)?.tag;

const A: ProjectId = { providerId: "fake", key: "a" };
const B: ProjectId = { providerId: "fake", key: "b" };

/** A store that records each write by project and file, and can hold one. */
function fakeStore() {
  const written: string[] = [];
  let hold: Promise<void> | null = null;
  const store: MetadataStore<ProjectId> = {
    writeStructure: vi.fn(async (project, structure) => {
      if (hold) await hold;
      written.push(`${project.key}:yaml:${tagOf(structure)}`);
    }),
    writeProperties: vi.fn(async (project, properties) => {
      if (hold) await hold;
      written.push(`${project.key}:json:${tagOf(properties)}`);
    }),
    writeCatalogue: vi.fn(async (project, catalogue) => {
      if (hold) await hold;
      written.push(`${project.key}:catalogue:${tagOf(catalogue)}`);
    }),
  };
  const holdNext = () => {
    let release!: () => void;
    hold = new Promise<void>((resolve) => {
      release = () => {
        hold = null;
        resolve();
      };
    });
    return release;
  };
  return { store, written, holdNext };
}

function lanesWithView() {
  const shown = {
    structure: [] as unknown[],
    properties: [] as unknown[],
    catalogue: [] as unknown[],
  };
  const lanes = new MetadataLanes<ProjectId>({
    structure: (s) => shown.structure.push(tagOf(s) ?? null),
    properties: (p) => shown.properties.push(tagOf(p)),
    catalogue: (c) => shown.catalogue.push(tagOf(c)),
  });
  return { lanes, shown };
}

describe("sameProject", () => {
  it("matches on the provider and the key, and never on no owner", () => {
    expect(sameProject(A, { ...A })).toBe(true);
    expect(sameProject(A, B)).toBe(false);
    expect(sameProject({ providerId: "other", key: "a" }, A)).toBe(false);
    expect(sameProject(null, A)).toBe(false);
  });
});

describe("the structure lane", () => {
  it("writes in the order the changes were queued, and shows the last", async () => {
    const { store, written, holdNext } = fakeStore();
    const { lanes, shown } = lanesWithView();
    lanes.open(A, shape("s0"), props("p0"), cat("c0"));
    const release = holdNext();
    const first = lanes.writeStructure(store, A, shape("s1"));
    const second = lanes.writeStructure(store, A, shape("s2"));
    release();
    await Promise.all([first, second]);
    expect(written).toEqual(["a:yaml:s1", "a:yaml:s2"]);
    expect(tagOf(lanes.structure)).toBe("s2");
    expect(shown.structure).toEqual(["s0", "s1", "s2"]);
  });

  it("skips a write that matches the open structure", async () => {
    const { store, written } = fakeStore();
    const { lanes } = lanesWithView();
    const s0 = shape("s0");
    lanes.open(A, s0, props("p0"), cat("c0"));
    await lanes.writeStructure(store, A, s0);
    expect(written).toEqual([]);
  });

  it("lands a change queued for a project in its own folder after a switch, and never shows it", async () => {
    const { store, written, holdNext } = fakeStore();
    const { lanes, shown } = lanesWithView();
    lanes.open(A, shape("a0"), props("pa"), cat("c0"));
    const release = holdNext();
    const queued = lanes.writeStructure(store, A, shape("a1"));
    lanes.open(B, shape("b0"), props("pb"), cat("c0"));
    release();
    await queued;
    expect(written).toEqual(["a:yaml:a1"]);
    expect(tagOf(lanes.structure)).toBe("b0");
    expect(shown.structure).toEqual(["a0", "b0"]);
  });

  it("keeps the lane going after a failed write", async () => {
    const { store, written } = fakeStore();
    const { lanes } = lanesWithView();
    lanes.open(A, shape("s0"), props("p0"), cat("c0"));
    vi.mocked(store.writeStructure).mockRejectedValueOnce(new Error("disk"));
    await expect(lanes.writeStructure(store, A, shape("s1"))).rejects.toThrow(
      "disk",
    );
    await lanes.writeStructure(store, A, shape("s2"));
    expect(written).toEqual(["a:yaml:s2"]);
    expect(tagOf(lanes.structure)).toBe("s2");
  });
});

describe("the properties lane", () => {
  it("builds each job on the latest properties when it runs", async () => {
    const { store, written, holdNext } = fakeStore();
    const { lanes } = lanesWithView();
    lanes.open(A, shape("s0"), props("p0", { n: 0 }), cat("c0"));
    const release = holdNext();
    const bump = (latest: DocumentProperties) => {
      const n = (latest as unknown as { n: number }).n + 1;
      return props(`p${n}`, { n });
    };
    const first = lanes.writeProperties(store, A, bump);
    const second = lanes.writeProperties(store, A, bump);
    release();
    await Promise.all([first, second]);
    expect(written).toEqual(["a:json:p1", "a:json:p2"]);
    expect(tagOf(lanes.properties)).toBe("p2");
  });

  it("writes nothing for a job whose answer is null or the base itself", async () => {
    const { store, written } = fakeStore();
    const { lanes } = lanesWithView();
    lanes.open(A, shape("s0"), props("p0"), cat("c0"));
    await lanes.writeProperties(store, A, () => null);
    await lanes.writeProperties(store, A, (latest) => latest);
    expect(written).toEqual([]);
  });

  it("writes nothing for a job queued for a project another one replaced", async () => {
    const { store, written, holdNext } = fakeStore();
    const { lanes } = lanesWithView();
    lanes.open(A, shape("a0"), props("pa"), cat("c0"));
    const release = holdNext();
    const inFlight = lanes.writeProperties(store, A, () => props("pa1"));
    const queued = lanes.writeProperties(store, A, () => props("pa2"));
    await vi.waitFor(() => expect(store.writeProperties).toHaveBeenCalled());
    lanes.open(B, shape("b0"), props("pb"), cat("c0"));
    release();
    await Promise.all([inFlight, queued]);
    // The job in flight lands in A's file; the one still queued writes
    // nothing, and neither becomes B's base.
    expect(written).toEqual(["a:json:pa1"]);
    expect(tagOf(lanes.properties)).toBe("pb");
  });

  it("writes nothing for a job queued for a folder that was refused", async () => {
    const { store, written, holdNext } = fakeStore();
    const { lanes } = lanesWithView();
    lanes.open(A, shape("a0"), props("pa"), cat("c0"));
    const release = holdNext();
    const inFlight = lanes.writeProperties(store, A, () => props("pa1"));
    const queued = lanes.writeProperties(store, A, () => props("pa2"));
    await vi.waitFor(() => expect(store.writeProperties).toHaveBeenCalled());
    lanes.refuse();
    release();
    await Promise.all([inFlight, queued]);
    expect(written).toEqual(["a:json:pa1"]);
    expect(lanes.owner).toBeNull();
    expect(lanes.structure).toBeNull();
  });

  it("keeps the lane going after a failed write", async () => {
    const { store, written } = fakeStore();
    const { lanes } = lanesWithView();
    lanes.open(A, shape("s0"), props("p0"), cat("c0"));
    vi.mocked(store.writeProperties).mockRejectedValueOnce(new Error("disk"));
    await expect(
      lanes.writeProperties(store, A, () => props("p1")),
    ).rejects.toThrow("disk");
    await lanes.writeProperties(store, A, () => props("p2"));
    expect(written).toEqual(["a:json:p2"]);
  });
});

describe("the catalogue lane", () => {
  it("builds each job on the latest catalogue, and skips a job that changes nothing", async () => {
    const { store, written, holdNext } = fakeStore();
    const { lanes, shown } = lanesWithView();
    lanes.open(A, shape("s0"), props("p0"), cat("c0", { n: 0 }));
    const release = holdNext();
    const bump = (latest: SnapshotCatalogue) => {
      const n = (latest as unknown as { n: number }).n + 1;
      return cat(`c${n}`, { n });
    };
    const first = lanes.writeCatalogue(store, A, bump);
    const second = lanes.writeCatalogue(store, A, bump);
    release();
    await Promise.all([first, second]);
    await lanes.writeCatalogue(store, A, () => null);
    await lanes.writeCatalogue(store, A, (latest) => latest);
    expect(written).toEqual(["a:catalogue:c1", "a:catalogue:c2"]);
    expect(tagOf(lanes.catalogue)).toBe("c2");
    expect(shown.catalogue).toEqual(["c0", "c1", "c2"]);
  });

  it("writes nothing for a job queued for a project another one replaced", async () => {
    const { store, written, holdNext } = fakeStore();
    const { lanes } = lanesWithView();
    lanes.open(A, shape("a0"), props("pa"), cat("ca"));
    const release = holdNext();
    const inFlight = lanes.writeCatalogue(store, A, () => cat("ca1"));
    const queued = lanes.writeCatalogue(store, A, () => cat("ca2"));
    await vi.waitFor(() => expect(store.writeCatalogue).toHaveBeenCalled());
    lanes.open(B, shape("b0"), props("pb"), cat("cb"));
    release();
    await Promise.all([inFlight, queued]);
    // The job in flight lands in A's own file; the queued one sees B open.
    expect(written).toEqual(["a:catalogue:ca1"]);
    expect(tagOf(lanes.catalogue)).toBe("cb");
  });

  it("keeps the lane going after a failed write", async () => {
    const { store, written } = fakeStore();
    const { lanes } = lanesWithView();
    lanes.open(A, shape("s0"), props("p0"), cat("c0"));
    vi.mocked(store.writeCatalogue).mockRejectedValueOnce(new Error("disk"));
    await expect(
      lanes.writeCatalogue(store, A, () => cat("c1")),
    ).rejects.toThrow("disk");
    await lanes.writeCatalogue(store, A, () => cat("c2"));
    expect(written).toEqual(["a:catalogue:c2"]);
    expect(tagOf(lanes.catalogue)).toBe("c2");
  });
});

describe("showing a structure with no yaml write", () => {
  it("shows it for the open project and ignores any other", () => {
    const { lanes, shown } = lanesWithView();
    lanes.open(A, shape("a0"), props("pa"), cat("c0"));
    lanes.showStructure(A, shape("a1"));
    lanes.showStructure(B, shape("b1"));
    expect(tagOf(lanes.structure)).toBe("a1");
    expect(shown.structure).toEqual(["a0", "a1"]);
  });
});
