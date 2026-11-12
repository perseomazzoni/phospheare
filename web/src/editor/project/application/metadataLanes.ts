// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The open project's three metadata files, `document-structure.yaml`,
// `document-properties.json` and `snapshots-catalogue.json`, each written
// through one FIFO lane, and the latest structure, properties and catalogue
// those writes leave.
//
// The lanes keep the disk level with memory. Under strict validation a yaml
// behind memory, or a catalogue whose records name files the folder does not
// hold, is a project that will not open.
//
// One provider can open one project after another, so every job carries its
// project and the lanes know which one is open (`owner`). A job always lands
// in its own folder when it can, but only the open project's results reach
// `structure`, `properties`, `catalogue` and the screen.

import type {
  DocumentProperties,
  DocumentStructure,
  SnapshotCatalogue,
} from "../../../project/types";
import type { MetadataStore, ProjectId } from "./stores";

/** Where the lanes hand what they leave, for the screen to draw. */
export interface MetadataView {
  structure(structure: DocumentStructure | null): void;
  properties(properties: DocumentProperties): void;
  catalogue(catalogue: SnapshotCatalogue): void;
}

/** Whether `target` is the project `owner` names. */
export function sameProject(
  owner: ProjectId | null,
  target: ProjectId,
): boolean {
  return (
    owner !== null &&
    owner.providerId === target.providerId &&
    owner.key === target.key
  );
}

export class MetadataLanes<P extends ProjectId> {
  /** The open project: set by a successful open, cleared by a refusal. */
  owner: P | null = null;
  /** The open project's structure, ahead of the render that shows it. */
  structure: DocumentStructure | null = null;
  /**
   * The open project's properties, ahead of the render that shows it. A
   * refusal keeps them: nothing reads them without an owner.
   */
  properties: DocumentProperties | null = null;
  /** The open project's snapshot catalogue, kept like its properties. */
  catalogue: SnapshotCatalogue | null = null;

  private structureLane: Promise<void> = Promise.resolve();
  private propertiesLane: Promise<void> = Promise.resolve();
  private catalogueLane: Promise<void> = Promise.resolve();

  constructor(private readonly view: MetadataView) {}

  /** Whether `target` is the open project. */
  owns(target: ProjectId): boolean {
    return sameProject(this.owner, target);
  }

  /**
   * Makes `owner` the open project, with what its files hold. A job still
   * queued for the previous project sees the new owner and writes nothing
   * into the new one.
   */
  open(
    owner: P,
    structure: DocumentStructure,
    properties: DocumentProperties,
    catalogue: SnapshotCatalogue,
  ) {
    this.owner = owner;
    this.structure = structure;
    this.properties = properties;
    this.catalogue = catalogue;
    this.view.properties(properties);
    this.view.catalogue(catalogue);
    this.view.structure(structure);
  }

  /**
   * Leaves no project open: the folder was refused. A properties job still
   * queued for it writes nothing more into it.
   */
  refuse() {
    this.owner = null;
    this.structure = null;
    this.view.structure(null);
  }

  /**
   * Shows `next` as the open project's structure with no yaml write: a change
   * that lives in the properties file alone, or the rollback of one. Nothing
   * happens when `target` is not the open project.
   */
  showStructure(target: P, next: DocumentStructure) {
    if (!this.owns(target)) return;
    this.structure = next;
    this.view.structure(next);
  }

  /**
   * Queues a yaml write of `next` for `target`. A write that matches the open
   * structure is skipped. The write lands in `target`'s folder even after
   * another project opened, since its files have already moved; only the open
   * project's structure is shown.
   */
  writeStructure(
    store: MetadataStore<P>,
    target: P,
    next: DocumentStructure,
  ): Promise<void> {
    const run = this.structureLane.then(async () => {
      if (this.owns(target) && next === this.structure) return;
      await store.writeStructure(target, next);
      if (!this.owns(target)) return;
      this.structure = next;
      this.view.structure(next);
    });
    // A failed job never breaks the chain: one rejected write must not strand
    // every later structure write.
    this.structureLane = run.catch(() => undefined);
    return run;
  }

  /**
   * Queues a properties write for `target`, built by `job` from the latest
   * properties when the job runs, so a job built from a stale base never
   * undoes a newer one. `job` answers `null`, or the properties it was given,
   * to write nothing; it may resolve later, keeping its place in the lane.
   *
   * The base is the open project's, so a job whose project is not open
   * writes nothing: merged onto another project's document it would write
   * that document into the wrong file.
   */
  writeProperties(
    store: MetadataStore<P>,
    target: P,
    job: (
      latest: DocumentProperties,
    ) => DocumentProperties | null | Promise<DocumentProperties | null>,
  ): Promise<void> {
    const run = this.propertiesLane.then(async () => {
      const latest = this.properties;
      if (!latest || !this.owns(target)) return;
      const next = await job(latest);
      if (!next || next === latest) return;
      await store.writeProperties(target, next);
      // The write can outlive a project switch. A result built from the old
      // project's base must never become the base of the next project's
      // jobs; the job's own file already has its content.
      if (!this.owns(target)) return;
      this.properties = next;
      this.view.properties(next);
    });
    // As in `writeStructure`, a failed job never breaks the chain.
    this.propertiesLane = run.catch(() => undefined);
    return run;
  }

  /**
   * Queues a catalogue write for `target`, built by `job` from the latest
   * catalogue when the job runs, by the rule of `writeProperties`: a stale
   * base never undoes a newer job, `null` or the same catalogue writes
   * nothing, and a job whose project is not open writes nothing.
   */
  writeCatalogue(
    store: MetadataStore<P>,
    target: P,
    job: (
      latest: SnapshotCatalogue,
    ) => SnapshotCatalogue | null | Promise<SnapshotCatalogue | null>,
  ): Promise<void> {
    const run = this.catalogueLane.then(async () => {
      const latest = this.catalogue;
      if (!latest || !this.owns(target)) return;
      const next = await job(latest);
      if (!next || next === latest) return;
      await store.writeCatalogue(target, next);
      if (!this.owns(target)) return;
      this.catalogue = next;
      this.view.catalogue(next);
    });
    this.catalogueLane = run.catch(() => undefined);
    return run;
  }
}
