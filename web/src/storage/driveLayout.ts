// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { FILES_ENDPOINT, FOLDER_MIME, driveJson } from "./driveRest";
import { APP_DIR } from "./layout";
import { onUserChange } from "../auth/currentUser";

// The app folder on Drive: `APP_DIR` at the storage root, the parent of every
// project.
//
// Resolved once per tab and memoized: at most one find and one create, not
// one per project. The in-flight promise is shared, so two racing first calls
// (the shelf's sweep and a creation at once) cannot each scaffold a folder.
//
// The memo must not outlive its account. `onUserChange` drops it; otherwise a
// same-tab account switch would list and create projects in the previous
// account's folder.

interface DriveFolder {
  id: string;
  name: string;
}

async function findFolder(q: string): Promise<string | null> {
  const params = new URLSearchParams({
    q,
    fields: "files(id, name)",
    pageSize: "1",
  });
  const page = await driveJson<{ files?: DriveFolder[] }>(
    `${FILES_ENDPOINT}?${params}`,
  );
  return page.files?.[0]?.id ?? null;
}

async function createFolder(name: string, parentId: string): Promise<string> {
  const created = await driveJson<DriveFolder>(
    `${FILES_ENDPOINT}?fields=id,name`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      }),
    },
  );
  return created.id;
}

let projectsPromise: Promise<string> | null = null;

function invalidateLayoutCache(): void {
  projectsPromise = null;
}

/** Test-only: drops the memo so the next call re-resolves. */
export function __resetDriveLayoutCacheForTest(): void {
  if (!import.meta.env.DEV) return;
  invalidateLayoutCache();
}

onUserChange(() => invalidateLayoutCache());

/**
 * A string literal in Drive's query language. The app folder's name is the
 * product's public name, chosen per release, so a quote or backslash
 * in it must stay inside the literal instead of ending it.
 */
export function driveQueryString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * The id of the app folder (`APP_DIR`), found or created directly under the
 * account root; every project on this backend lives in it.
 */
export function projectsFolderId(): Promise<string> {
  if (projectsPromise) return projectsPromise;
  const task = (async () => {
    const existing = await findFolder(
      `'root' in parents and name = ${driveQueryString(APP_DIR)} and mimeType = '${FOLDER_MIME}' and trashed = false`,
    );
    return existing ?? (await createFolder(APP_DIR, "root"));
  })();
  projectsPromise = task;
  // A failure is not memoized: one offline moment would otherwise answer
  // every later call with the same rejection until the account changes. Only
  // this task is dropped, never a newer one an account switch put in its
  // place.
  task.catch(() => {
    if (projectsPromise === task) projectsPromise = null;
  });
  return task;
}
