// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Where an export is kept: the host side of the `ExportSink` port. It writes
// `export/<name>` in every home the book has (its folder on this device, its
// Remote Storage folder, or both for a book that lives on disk and syncs there),
// then hands the browser its download.
//
// It writes through each home's bare provider, around the working copy and
// the queue that carry a remote book's text. Those two are text-only
// and promise the writer's work; an export is binary and can be made again at
// will, so it belongs in neither. The cost: a Remote Storage home that cannot be
// reached now is reported as skipped, and the download happens anyway,
// because the writer asked for a file and gets one.
//
// An export never overwrites, and this file is where that holds.
// Each home's `export/` folder is listed once, and a name is taken
// when any home holds it under any letter case: a Windows or macOS disk opens
// `Book.pdf` for `book.pdf`, so a case-sensitive check lets the second export
// truncate the first. A home whose folder cannot be listed is not free but
// unknown, so it is not written to at all and is reported as skipped. Reading
// a failed check as "no collision" would let flaky Remote Storage replace an export
// the writer had already sent.

import { EXPORT_DIR } from "../../../project/naming";
import { remoteFor } from "../../../project/sync/remoteFor";
import {
  getProvider,
  type ProjectRef,
  type StorageProvider,
} from "../../../storage";
import type { ExportSink, HomeReport } from "../ports";

interface Home {
  kind: "device" | "remote";
  provider: StorageProvider;
  ref: ProjectRef;
}

interface ProjectSinkOptions {
  /**
   * The provider the book was read through. Used only for a backend this build
   * does not register; it is then a wrapper with no `writeBytes`, so that home
   * is reported as unsaved rather than silently missing from the report.
   */
  storage: StorageProvider;
  ref: ProjectRef;
  download: (fileName: string, bytes: Uint8Array, mime: string) => void;
}

/**
 * The book's homes: where its ref points, and, for a book on this device, the
 * remote it is paired with, if any.
 */
async function homesOf(
  storage: StorageProvider,
  ref: ProjectRef,
): Promise<Home[]> {
  const base = getProvider(ref.providerId) ?? storage;
  const homes: Home[] = [{ kind: base.kind, provider: base, ref }];
  if (base.kind === "device") {
    const remote = await remoteFor(ref).catch(() => null);
    const remoteProvider = remote ? getProvider(remote.providerId) : null;
    if (remote && remoteProvider)
      homes.push({
        kind: "remote",
        provider: remoteProvider,
        ref: { ...ref, providerId: remote.providerId, key: remote.key },
      });
  }
  return homes;
}

/** A home's `export/` names folded to one case, or unknown if it cannot say. */
type Listing = ReadonlySet<string> | "unknown";

const fold = (name: string) => name.toLowerCase();

async function listingOf(home: Home): Promise<Listing> {
  try {
    if (!(await home.provider.exists(home.ref, EXPORT_DIR))) return new Set();
    const entries = await home.provider.listDir(home.ref, EXPORT_DIR);
    return new Set(entries.map((entry) => fold(entry.name)));
  } catch {
    return "unknown";
  }
}

/**
 * The file name, checked once more at the last step before a path is built
 * from it: the window sanitises what the writer types, and this refuses
 * anything that could still climb out of `export/`.
 */
function exportPath(fileName: string): string {
  if (!fileName || /[\\/]/.test(fileName) || fileName.startsWith("."))
    throw new Error("export-file-name");
  return `${EXPORT_DIR}/${fileName}`;
}

export function projectExportSink(options: ProjectSinkOptions): ExportSink {
  const { storage, ref } = options;
  // The homes, and what each one's folder holds, are asked once per export,
  // however many names are tried.
  let surveyed: Promise<{ home: Home; listing: Listing }[]> | null = null;
  const survey = () =>
    (surveyed ??= homesOf(storage, ref).then((homes) =>
      Promise.all(
        homes.map(async (home) => ({ home, listing: await listingOf(home) })),
      ),
    ));

  return {
    async exists(fileName) {
      exportPath(fileName);
      const name = fold(fileName);
      return (await survey()).some(
        ({ listing }) => listing !== "unknown" && listing.has(name),
      );
    },

    async save(fileName, bytes, mime): Promise<HomeReport[]> {
      const path = exportPath(fileName);
      const reports: HomeReport[] = [];
      for (const { home, listing } of await survey()) {
        // Unknown is skipped, never written: what that folder holds cannot be
        // seen, so a write could be an overwrite.
        if (listing === "unknown" || !home.provider.writeBytes) {
          reports.push({ home: home.kind, ok: false });
          continue;
        }
        try {
          await home.provider.writeBytes(home.ref, path, bytes, mime);
          reports.push({ home: home.kind, ok: true });
        } catch {
          reports.push({ home: home.kind, ok: false });
        }
      }
      return reports;
    },

    download: (fileName, bytes, mime) => {
      exportPath(fileName);
      options.download(fileName, bytes, mime);
    },
  };
}
