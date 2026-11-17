// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What the open project's services need of a project's folder, each role
// as narrow as its services use it. Their domain is `src/project`: the
// structure, the properties and the pure rules over them.

import type {
  DocumentProperties,
  DocumentStructure,
  SnapshotCatalogue,
} from "../../../project/types";

/**
 * What names one project. A storage `ProjectRef` is one; the core needs
 * only these two fields to tell two projects apart.
 */
export interface ProjectId {
  readonly providerId: string;
  readonly key: string;
}

/** Where a project's three metadata files are written. */
export interface MetadataStore<P extends ProjectId> {
  writeStructure(project: P, structure: DocumentStructure): Promise<void>;
  writeProperties(project: P, properties: DocumentProperties): Promise<void>;
  writeCatalogue(project: P, catalogue: SnapshotCatalogue): Promise<void>;
}

/** What an open reads from a project's folder. */
export interface ProjectReader<P extends ProjectId> {
  /**
   * The properties file's text, or `null` when it is not there. Any other
   * failure throws: an unreadable file is never taken for an absent one.
   */
  properties(project: P): Promise<string | null>;
  /** The snapshot catalogue's text, or `null` when it is not there; as above. */
  catalogue(project: P): Promise<string | null>;
  /** The structure file's text, or `null` when it is not there; as above. */
  structure(project: P): Promise<string | null>;
  /** A snapshot file's text, or `null` when it cannot be read. */
  snapshot(project: P, fileName: string): Promise<string | null>;
  /**
   * The Part and Section files in `document/`, by name. Throws when the
   * folder cannot be listed.
   */
  documentFiles(project: P): Promise<string[]>;
  /**
   * Whether the last sync's pull into this project stopped partway: files
   * came down whose records did not. `false` for a project with no sync.
   */
  pullUnfinished(project: P): Promise<boolean>;
}

/** Where a project's undo journals live, one per snapshot file. */
export interface JournalStore<P extends ProjectId> {
  /**
   * The file's journal, or `null` when it has none. Any other failure throws:
   * an unreadable journal is never taken for an absent one.
   */
  read(project: P, fileName: string): Promise<string | null>;
  write(project: P, fileName: string, journal: string): Promise<void>;
  remove(project: P, fileName: string): Promise<void>;
}
