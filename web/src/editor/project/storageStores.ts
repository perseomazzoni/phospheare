// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ProjectRef, StorageProvider } from "../../storage";
import { StorageError } from "../../storage/types";
import {
  DOCUMENT_DIR,
  PROPERTIES_FILE,
  SNAPSHOTS_CATALOGUE_FILE,
  STRUCTURE_FILE,
  filePath,
  historyPath,
  kindOf,
} from "../../project/naming";
import { serializeProperties } from "../../project/properties";
import { serializeCatalogue } from "../../project/snapshotCatalogue";
import { serializeStructure } from "../../project/structure";
import type {
  JournalStore,
  MetadataStore,
  ProjectReader,
} from "./application/stores";

// The open project's stores over a storage provider, one per role the
// services declare.

/** The metadata store over a project's folder, in its three files' formats. */
export function providerMetadata(
  provider: StorageProvider,
): MetadataStore<ProjectRef> {
  return {
    writeStructure: async (project, structure) => {
      await provider.writeFile(
        project,
        STRUCTURE_FILE,
        serializeStructure(structure),
      );
    },
    writeProperties: async (project, properties) => {
      await provider.writeFile(
        project,
        PROPERTIES_FILE,
        serializeProperties(properties),
      );
    },
    writeCatalogue: async (project, catalogue) => {
      await provider.writeFile(
        project,
        SNAPSHOTS_CATALOGUE_FILE,
        serializeCatalogue(catalogue),
      );
    },
  };
}

/**
 * The project reader over a project's folder. `pullUnfinished` answers from
 * the sync, which the program around the editor holds; without it no pull is
 * ever unfinished.
 */
export function providerReader(
  provider: StorageProvider,
  pullUnfinished: (project: ProjectRef) => Promise<boolean> = async () => false,
): ProjectReader<ProjectRef> {
  // "Not there" and "cannot be read" are both null: the checks that follow
  // tell a missing file from a broken project.
  const readOrNull = async (project: ProjectRef, path: string) => {
    try {
      return await provider.readFile(project, path);
    } catch {
      return null;
    }
  };
  return {
    properties: (project) => readOrNull(project, PROPERTIES_FILE),
    catalogue: (project) => readOrNull(project, SNAPSHOTS_CATALOGUE_FILE),
    structure: (project) => readOrNull(project, STRUCTURE_FILE),
    snapshot: (project, fileName) => readOrNull(project, filePath(fileName)),
    documentFiles: async (project) =>
      (await provider.listDir(project, DOCUMENT_DIR))
        .filter((entry) => entry.kind === "file" && kindOf(entry.name) !== null)
        .map((entry) => entry.name),
    pullUnfinished,
  };
}

/** The journal store over a project's `history/` folder. */
export function providerJournal(
  provider: StorageProvider,
): JournalStore<ProjectRef> {
  return {
    read: async (project, fileName) => {
      try {
        return await provider.readFile(project, historyPath(fileName));
      } catch (err) {
        if (err instanceof StorageError && err.code === "not-found")
          return null;
        throw err;
      }
    },
    write: async (project, fileName, journal) => {
      await provider.writeFile(project, historyPath(fileName), journal);
    },
    remove: (project, fileName) =>
      provider.removeFile(project, historyPath(fileName)),
  };
}
