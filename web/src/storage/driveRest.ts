// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { StorageError, baseName } from "./types";
import { driveAccessToken } from "./driveToken";
import { noteDriveAccepted, noteDriveRefused } from "./driveGrant";
import { PRODUCT } from "../product";

// The Drive HTTP primitives every Drive caller shares: the endpoints, the
// retry-on-401 fetch, the error mapping, and the two upload shapes. They live
// apart from `driveProvider.ts` because `driveLayout.ts` resolves `APP_DIR`
// before any project exists, and importing from the provider would be a
// cycle.

export const FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
export const UPLOAD_ENDPOINT =
  "https://www.googleapis.com/upload/drive/v3/files";

export const FOLDER_MIME = "application/vnd.google-apps.folder";

// Google answers rate limits with 403 as often as 429, so a 403 alone does not
// prove a permission loss. The error body's `reason` tells them apart, and a
// rate-limit reason is transient: the op retries instead of being written off.
const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
  "quotaExceeded",
]);

// A full account also answers 403. It is about room, not the grant, and it
// heals once the writer frees space, so it is `no-space` (retried, never
// dead-lettered) with its own notice, and it leaves the grant latch alone.
const STORAGE_FULL_REASON = "storageQuotaExceeded";

/** The `reason` of every error in Drive's error body; none when unreadable. */
function reasonsOf(body: string | undefined): string[] {
  if (!body) return [];
  try {
    const parsed = JSON.parse(body) as {
      error?: { errors?: { reason?: string }[] };
    };
    return (parsed.error?.errors ?? []).flatMap((e) =>
      typeof e.reason === "string" ? [e.reason] : [],
    );
  } catch {
    return [];
  }
}

export function fail(
  message: string,
  status: number,
  body?: string,
  name?: string,
): StorageError {
  if (status === 429)
    return new StorageError(message, "unavailable", "storage.unreachable");
  if (status === 401 || status === 403) {
    const reasons = reasonsOf(body);
    if (reasons.some((reason) => RATE_LIMIT_REASONS.has(reason)))
      return new StorageError(message, "unavailable", "storage.unreachable");
    if (reasons.includes(STORAGE_FULL_REASON))
      return new StorageError(message, "no-space", "storage.remoteFull");
    // A Drive 401/403 is a grant problem, not a folder permission problem. In
    // the copy, "permission" means a local folder gesture only, so the
    // surface gets the disconnected wording.
    //
    // The latch is set here rather than by the caller: the request has
    // already been retried with a fresh token and rate limits excluded above.
    noteDriveRefused();
    return new StorageError(message, "permission", "storage.disconnected");
  }
  if (status === 404)
    return new StorageError(message, "not-found", "storage.projectGone");
  if (status === 413)
    return new StorageError(message, "too-large", "storage.tooLargeDrive", {
      name: name ?? baseName(message),
    });
  if (status === 0)
    return new StorageError(
      `${PRODUCT.name} could not reach Google Drive.`,
      "unavailable",
      "storage.unreachable",
    );
  return new StorageError(message, "io", "storage.io");
}

export async function driveFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await driveAccessToken();

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw fail(`${PRODUCT.name} could not reach Google Drive.`, 0);
  }

  // One retry on 401/403: the cached token may have expired mid-session. A
  // second failure is a real refusal.
  if (response.status === 401 || response.status === 403) {
    const retryToken = await driveAccessToken({ force: true });
    headers.set("Authorization", `Bearer ${retryToken}`);
    try {
      response = await fetch(path, { ...init, headers });
    } catch {
      throw fail(`${PRODUCT.name} could not reach Google Drive.`, 0);
    }
  }

  if (response.ok) noteDriveAccepted();

  return response;
}

export async function driveJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await driveFetch(url, init);
  if (!response.ok) {
    // The body tells a quota 403 from a permission 403, and the queue's
    // dead-letter decision rests on that classification, so read it first.
    const body = await response.text().catch(() => "");
    throw fail("Google Drive refused that request.", response.status, body);
  }
  return (await response.json()) as T;
}

/** A project's own files are UTF-8 text. */
export const TEXT_CONTENT_TYPE = "text/plain; charset=UTF-8";

/** What Drive answers for a file `createMultipart` made. */
export interface CreatedFile {
  id: string;
  name: string;
  mimeType: string;
}

/**
 * Creates a file in a folder in one request: the metadata part says where it
 * goes and its name, the second part is the content. Drive has no "create at
 * this path" call.
 *
 * The boundary is a fresh `crypto.randomUUID()` per request. The content
 * part is the writer's prose, or an export's bytes, unescaped, so a body
 * containing the delimiter could forge a part with a new `parents` or
 * `name`. A fixed boundary would let anyone who can get text into a
 * manuscript aim that attack; 122 unpredictable bits make it impossible to
 * aim. Do not hardcode the boundary or derive it from the content it
 * delimits.
 *
 * Text goes as a string, bytes as a Blob around them. `mimeType` is set in the
 * metadata only for a Blob, from its type; text files are created without one
 * and left to Drive's own sniffing, as every existing book was.
 */
export async function createMultipart(
  parentId: string,
  name: string,
  content: string | Blob,
  contentType = TEXT_CONTENT_TYPE,
): Promise<CreatedFile> {
  // Carries no name: it only has to be unique within this request.
  const boundary = `boundary-${crypto.randomUUID()}`;
  const metadata =
    typeof content === "string"
      ? { name, parents: [parentId] }
      : { name, parents: [parentId], mimeType: content.type };
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  return driveJson<CreatedFile>(
    `${UPLOAD_ENDPOINT}?uploadType=multipart&fields=id,name,mimeType`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body:
        typeof content === "string"
          ? head + content + tail
          : new Blob([head, content, tail]),
    },
  );
}

/**
 * Overwrites a file's bytes, and reports whether the file written is in the
 * bin.
 *
 * Drive answers 200 for a write to a trashed file, so a stale id succeeds
 * into the bin: the save indicator says committed and the writer's prose is
 * somewhere they will never look. So the write returns a verdict, not void.
 *
 * `trashed` costs no extra request: the PATCH already returns a file
 * resource. No cache can answer the question, because a file trashed on
 * another device still looks alive in a listing taken before, so the check
 * sits at the write.
 *
 * @param path what the failure message names.
 */
export async function patchContent(
  path: string,
  id: string,
  content: BodyInit,
  contentType = TEXT_CONTENT_TYPE,
): Promise<{ trashed: boolean }> {
  const response = await driveFetch(
    `${UPLOAD_ENDPOINT}/${encodeURIComponent(id)}?uploadType=media&fields=id,trashed`,
    {
      method: "PATCH",
      headers: { "Content-Type": contentType },
      body: content,
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw fail(
      `Could not save ${path}.`,
      response.status,
      body,
      baseName(path),
    );
  }
  const file = (await response.json().catch(() => ({}))) as {
    trashed?: boolean;
  };
  return { trashed: file.trashed === true };
}
