// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  createMultipart,
  driveFetch,
  driveJson,
  fail,
  FILES_ENDPOINT,
  patchContent,
} from "../storage/driveRest";
import { StorageError } from "../storage/types";
import { driveQueryString } from "../storage/driveLayout";

// The writer's profile copies in Google Drive's application data folder:
// hidden from the Drive interface, reachable only by this application's
// Google Cloud project, and listable without any file id remembered on the
// device, which is how a new installation finds an existing profile. One file
// per installation, `profile-<installation>.json`; each installation writes
// only its own.

const PREFIX = "profile-";
const MAX_COPY_BYTES = 8 * 1024 * 1024;
const JSON_TYPE = "application/json";

export interface ProfileCopy {
  fileId: string;
  installation: string;
  /** Drive's last-modified time; `null` when the listing did not carry it. */
  modifiedTime: string | null;
  /** Drive's checksum of the content; `null` when the listing did not carry it. */
  md5: string | null;
}

export function copyName(installation: string): string {
  return `${PREFIX}${installation}.json`;
}

/** Every installation's copy, this one's included. */
export async function listProfileCopies(): Promise<ProfileCopy[]> {
  const copies: ProfileCopy[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      spaces: "appDataFolder",
      q: `name contains ${driveQueryString(PREFIX)} and trashed = false`,
      fields: "nextPageToken, files(id, name, modifiedTime, md5Checksum)",
      pageSize: "100",
      ...(pageToken ? { pageToken } : {}),
    });
    const page = await driveJson<{
      nextPageToken?: string;
      files?: {
        id?: string;
        name?: string;
        modifiedTime?: string;
        md5Checksum?: string;
      }[];
    }>(`${FILES_ENDPOINT}?${query}`);
    for (const file of page.files ?? []) {
      if (typeof file.id !== "string" || typeof file.name !== "string")
        continue;
      const match = /^profile-([A-Za-z0-9_-]{8,64})\.json$/.exec(file.name);
      if (match)
        copies.push({
          fileId: file.id,
          installation: match[1],
          modifiedTime:
            typeof file.modifiedTime === "string" ? file.modifiedTime : null,
          md5: typeof file.md5Checksum === "string" ? file.md5Checksum : null,
        });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return copies;
}

/** One copy's parsed body; `null` when it is not JSON or too large. */
export async function readProfileCopy(fileId: string): Promise<unknown> {
  const response = await driveFetch(
    `${FILES_ENDPOINT}/${encodeURIComponent(fileId)}?alt=media`,
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw fail("Google Drive refused that request.", response.status, body);
  }
  const text = await response.text();
  if (text.length > MAX_COPY_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Asks Drive to delete one copy. A refusal resolves; no answer rejects. */
export async function deleteProfileCopy(fileId: string): Promise<void> {
  const response = await driveFetch(
    `${FILES_ENDPOINT}/${encodeURIComponent(fileId)}`,
    { method: "DELETE" },
  );
  // A copy already gone is deleted; any other refusal leaves it in Drive.
  if (!response.ok && response.status !== 404) {
    const body = await response.text().catch(() => "");
    throw fail("Google Drive refused that request.", response.status, body);
  }
}

/**
 * Deletes every installation's copy. Every delete is let finish before a
 * refusal rejects, so a retry finds only the copies still there.
 */
export async function deleteAllProfileCopies(): Promise<void> {
  const copies = await listProfileCopies();
  const results = await Promise.allSettled(
    copies.map((copy) => deleteProfileCopy(copy.fileId)),
  );
  const refused = results.find((result) => result.status === "rejected");
  if (refused) throw refused.reason;
}

/**
 * Writes this installation's copy, the profile as JSON, creating it when
 * `fileId` is `null`, and resolves its file id. A copy that is gone or in the
 * bin is created again: Drive answers a write to a trashed file as a success,
 * and a listing never shows a trashed copy to the merge.
 */
export async function writeProfileCopy(
  installation: string,
  json: string,
  fileId: string | null,
): Promise<string> {
  const name = copyName(installation);
  if (fileId) {
    try {
      if (!(await patchContent(name, fileId, json, JSON_TYPE)).trashed)
        return fileId;
    } catch (error) {
      // The writer cleared the app's data in Drive.
      if (!(error instanceof StorageError && error.code === "not-found"))
        throw error;
    }
  }
  const created = await createMultipart(
    "appDataFolder",
    name,
    new Blob([json], { type: JSON_TYPE }),
    JSON_TYPE,
  );
  if (typeof created.id !== "string")
    throw fail("Google Drive refused that request.", 500, "");
  return created.id;
}
