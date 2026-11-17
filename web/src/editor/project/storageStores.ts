// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ProjectRef, StorageProvider } from "../../storage";
import { StorageError } from "../../storage/types";
import { appLog, describeError } from "../../log";
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
/** A project file as the log may name it: the fixed files by name, a Section's file by kind. */
function kindOfFile(path: string): string {
  return path === PROPERTIES_FILE ||
    path === SNAPSHOTS_CATALOGUE_FILE ||
    path === STRUCTURE_FILE
    ? path
    : "section";
}

export function providerReader(
  provider: StorageProvider,
  pullUnfinished: (project: ProjectRef) => Promise<boolean> = async () => false,
): ProjectReader<ProjectRef> {
  const isMissing = (err: unknown) =>
    err instanceof StorageError && err.code === "not-found";
  // A metadata file that is not there is `null`, and the open's checks say
  // what that means. One that cannot be read throws, so the open fails with
  // Try again: never read as missing, which would call the folder "not a
  // project".
  const readOrMissing = async (project: ProjectRef, path: string) => {
    try {
      return await provider.readFile(project, path);
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  };
  // A snapshot is read for counts and hashes, best effort: a failure skips
  // it, and is logged by its kind of file; the path stays out.
  const readOrSkip = async (project: ProjectRef, path: string) => {
    try {
      return await provider.readFile(project, path);
    } catch (err) {
      if (!isMissing(err))
        appLog.warn("editor", "A project file could not be read.", {
          file: kindOfFile(path),
          ...describeError(err),
        });
      return null;
    }
  };
  return {
    properties: (project) => readOrMissing(project, PROPERTIES_FILE),
    catalogue: (project) => readOrMissing(project, SNAPSHOTS_CATALOGUE_FILE),
    structure: (project) => readOrMissing(project, STRUCTURE_FILE),
    snapshot: (project, fileName) => readOrSkip(project, filePath(fileName)),
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
