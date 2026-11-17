// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  MAX_FILE_BYTES,
  ROOT_PATH,
  StorageError,
  baseName,
  parentPath,
  joinPath,
  type Access,
  type DirEntry,
  type FileFingerprint,
  type FileHint,
  type ProjectRef,
  type StorageProvider,
} from "./types";
import { appIcons } from "../ui/appIcons";
import { onUserChange } from "../auth/currentUser";
import {
  FILES_ENDPOINT,
  FOLDER_MIME,
  UPLOAD_ENDPOINT,
  createMultipart,
  driveFetch,
  driveJson,
  fail,
  patchContent,
} from "./driveRest";
import { projectsFolderId } from "./driveLayout";
import { listProjectsInFolder } from "./projectScan";
import { appLog, describeError } from "../log";

// ── Google Drive provider ────────────────────────────────────────────────────
//
// The writer's own Drive, reached straight from the browser. The platform
// (the identity service or the native bridge) mints a short-lived access
// token from the refresh credential it keeps; every byte after that goes
// between the SPA and Google.
//
// Everything above this layer speaks in paths, and Drive has none. A file is
// an id with a list of parents, so `/document/section--opening.md` is walked
// segment by segment: `document` among the root's children, then
// `section--opening.md` among that folder's. Folder listings are cached,
// because a project reads the same few folders repeatedly, and invalidated
// wherever a name or a parent changes.

const PROVIDER_ID = "drive";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /**
   * Requested on every listing, so `fingerprintDir` reads them without a
   * second per-file request.
   */
  sha256Checksum?: string;
  modifiedTime?: string;
}

// ── One listing cache ────────────────────────────────────────────────────────
//
// `resolve` always walks through `childrenOf`, which is cached per folder and
// kept in step with every mutation. Do not add a path-to-id cache beside it.
// A file replaced from another device would leave its dead id in
// such a cache, `writeFile` would PATCH that id, and Drive answers 200 for a
// write to a trashed file: the save would report success while the writer's
// prose went into the bin and the live file kept stale bytes. The listing
// cache already saves the repeated requests.

/**
 * Test-only: drops the listing cache so the next call re-reads. It holds file
 * arrays, not just ids, so a test that re-seeds its fake Drive with different
 * names or fingerprints must start cold.
 */
export function __resetDriveCachesForTest(): void {
  listings.clear();
}

/** In-flight create per path, serializing concurrent writes to one path. */
const writeLocks = new Map<string, Promise<void>>();

/**
 * The immediate children of a folder, by id, each with its fingerprint.
 *
 * Cached per folder id, so two reads touching one folder share one
 * `files.list`. A create adds its file to the cached listing; every
 * rename, move and trash invalidates the folder ids it touches. The trust
 * resets (`reopenProject`, `trashProject`) clear the whole map, because a raw
 * folder id carries no project to prune by. The cache learns only of this
 * tab's mutations: a file another device created or replaced is invisible to
 * `resolve` until an invalidation.
 */
const listings = new Map<string, Promise<DriveFile[]>>();

// An account switch must not serve the previous account's folder views.
// `onUserChange` fires on every sign-in and sign-out.
onUserChange(() => {
  listings.clear();
});

function invalidateListings(...folderIds: string[]): void {
  for (const id of folderIds) listings.delete(id);
}

/**
 * Adds a child this tab just created to its folder's cached listing, so the
 * next create in that folder walks it without a new `files.list`. Drive's own
 * create response is the source, so the entry carries the real id. An entry
 * under the same name is replaced: the file just written is the one the next
 * write under that name means. The entry has no checksum, and nothing reads
 * one from the cache (`fingerprintDir` lists afresh).
 */
function addToListing(folderId: string, created: DriveFile): void {
  const cached = listings.get(folderId);
  if (!cached) return;
  const next = cached.then((files) => [
    ...files.filter((file) => file.name !== created.name),
    created,
  ]);
  listings.set(folderId, next);
  // Evicted on failure, as `childrenOf` does for its own task.
  next.catch(() => {
    if (listings.get(folderId) === next) listings.delete(folderId);
  });
}

/**
 * A Drive file id, refused if it is not one.
 *
 * A Drive project's `ref.key` is a folder id, but it does not come from Drive:
 * it round-trips through the writer's portable profile, so it is
 * writer-controlled, persisted, and replayed on every installation that
 * syncs it. Two sites trust its shape:
 *
 *   - `listChildren` interpolates it into Drive's query language, where a key
 *     of `x' in parents or name contains 'a` is a valid two-predicate query.
 *   - Several sites interpolate it into a `googleapis.com` URL path, where
 *     `../../../oauth2/v3/userinfo` normalises out of `/drive/v3/files/` and
 *     sends the Drive bearer token to an endpoint of the key's choosing.
 *
 * `drive.file` bounds every response to files this app created for this
 * user, but that bound is one `SCOPE` edit away, and a persisted address is
 * the wrong place to rely on it. Drive ids are `[A-Za-z0-9_-]`;
 * `asPortableDoc` holds a profile copy to the same shape, and this check
 * holds it again where the key is used.
 */
const DRIVE_ID = /^[A-Za-z0-9_-]{1,255}$/;

function driveId(value: string): string {
  if (!DRIVE_ID.test(value))
    throw new StorageError(
      "This project's Drive address is not valid.",
      "not-found",
      "storage.projectGone",
    );
  return value;
}

/** The uncached listing fetch; `childrenOf` caches it. */
async function listChildren(folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${driveId(folderId)}' in parents and trashed = false`,
      fields:
        "nextPageToken, files(id, name, mimeType, sha256Checksum, modifiedTime)",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const page = await driveJson<{
      files?: DriveFile[];
      nextPageToken?: string;
    }>(`${FILES_ENDPOINT}?${params}`);
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return files;
}

async function childrenOf(folderId: string): Promise<DriveFile[]> {
  const cached = listings.get(folderId);
  if (cached) return cached;
  const task = listChildren(folderId);
  listings.set(folderId, task);
  // A rejected listing must not poison the folder for the session: the cache
  // holds the promise, so a stale rejection would re-throw for every later
  // read until an invalidation. It is evicted on failure, unless a newer task
  // has replaced it, and the next read retries.
  task.catch(() => {
    if (listings.get(folderId) === task) listings.delete(folderId);
  });
  return task;
}

/**
 * The refusal for a file over `MAX_FILE_BYTES`. `too-large`, not `io`: the
 * queue dead-letters `too-large` as permanent, and a file that does not fit
 * never will.
 */
function tooLarge(path: string): StorageError {
  return new StorageError(
    `${baseName(path)} is too large to open.`,
    "too-large",
    "storage.tooLargeFile",
    { name: baseName(path) },
  );
}

/**
 * Walks a path to its file id, or `null`, through the listing cache at every
 * step.
 *
 * The answer always comes from what the folder is known to hold, so a file
 * replaced or trashed elsewhere cannot be resolved from a memory of it.
 *
 * A path segment cannot escape the project: each step matches a name against
 * real children, so `..` resolves only to a Drive file named `..`. Do not
 * normalise paths here; that would remove a containment nothing else
 * provides.
 */
async function resolve(ref: ProjectRef, path: string): Promise<string | null> {
  if (path === ROOT_PATH) return driveId(ref.key);

  const parentId = await resolve(ref, parentPath(path));
  if (!parentId) return null;

  const name = baseName(path);
  for (const file of await childrenOf(parentId))
    if (file.name === name) return file.id;
  return null;
}

/**
 * `resolve`, against listings read now: every folder on the way is listed
 * again rather than answered from the cache. A caller about to decide whether
 * a write would overwrite someone else's edit asks this one when the cheap
 * walk misses or lands on a binned id.
 */
async function resolveFresh(
  ref: ProjectRef,
  path: string,
): Promise<string | null> {
  if (path === ROOT_PATH) return driveId(ref.key);

  const parentId = await resolveFresh(ref, parentPath(path));
  if (!parentId) return null;

  invalidateListings(parentId);
  const name = baseName(path);
  for (const file of await childrenOf(parentId))
    if (file.name === name) return file.id;
  return null;
}

async function requireId(ref: ProjectRef, path: string): Promise<string> {
  const id = await resolve(ref, path);
  if (!id)
    throw new StorageError(
      `Not found: ${path}`,
      "not-found",
      "storage.fileGone",
      { name: baseName(path) },
    );
  return id;
}

/** Resolves a parent folder, creating the chain when asked. */
async function requireParent(
  ref: ProjectRef,
  path: string,
  create: boolean,
): Promise<string> {
  const parent = parentPath(path);
  const existing = await resolve(ref, parent);
  if (existing) return existing;
  if (!create)
    throw new StorageError(
      `Folder not found: ${parent}`,
      "not-found",
      "storage.folderGone",
      { name: baseName(parent) },
    );
  return createFolders(ref, parent);
}

/** Creates every missing folder along a path and returns the deepest id. */
async function createFolders(ref: ProjectRef, path: string): Promise<string> {
  if (path === ROOT_PATH) return driveId(ref.key);

  const existing = await resolve(ref, path);
  if (existing) return existing;

  const parentId = await createFolders(ref, parentPath(path));
  const created = await driveJson<DriveFile>(
    `${FILES_ENDPOINT}?fields=id,name,mimeType`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: baseName(path),
        mimeType: FOLDER_MIME,
        parents: [parentId],
      }),
    },
  );

  // The parent gained a child its cached listing does not hold yet.
  addToListing(parentId, created);
  return created.id;
}

/**
 * Creates a file through `createMultipart` and adds it to its folder's cached
 * listing, which does not hold it yet.
 */
async function createFile(
  parentId: string,
  name: string,
  content: string | Blob,
  contentType?: string,
): Promise<string> {
  const created = await createMultipart(parentId, name, content, contentType);
  addToListing(parentId, created);
  return created.id;
}

interface FileMeta {
  sha256Checksum?: string;
  modifiedTime?: string;
  trashed?: boolean;
}

/** One file's fingerprint fields, or `null` for an id Drive does not know. */
async function fileMeta(path: string, id: string): Promise<FileMeta | null> {
  const response = await driveFetch(
    `${FILES_ENDPOINT}/${id}?fields=sha256Checksum,modifiedTime,trashed`,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw fail(`Could not read ${path}.`, response.status, body);
  }
  return (await response.json()) as FileMeta;
}

function fingerprintOf(meta: FileMeta): FileFingerprint {
  if (meta.sha256Checksum) return { hash: meta.sha256Checksum };
  return { hash: meta.modifiedTime ?? "", weak: true };
}

export const driveProvider: StorageProvider = {
  id: PROVIDER_ID,
  kind: "remote",
  label: () => "Google Drive",
  icon: appIcons.drive,

  // Whether the writer connected Remote Storage is the connection's question,
  // not this flag's.
  isAvailable: () => true,

  /**
   * Drive has no per-document permission to lose: access is the OAuth token,
   * and the Library lists Remote Storage documents only when it holds one.
   * So this answers optimistically and costs nothing; a trashed document
   * surfaces on the read that follows, without a request per card.
   */
  async canAccess(): Promise<Access> {
    return "granted";
  },

  async reopenProject(ref: ProjectRef): Promise<boolean> {
    // A trust reset: the whole listing cache goes, as `listings` says.
    listings.clear();
    try {
      const response = await driveFetch(
        `${FILES_ENDPOINT}/${driveId(ref.key)}?fields=id,trashed`,
      );
      if (!response.ok) {
        // A 404 is a folder that is gone; any other refusal reads as gone too,
        // and only the log tells the two apart.
        if (response.status !== 404)
          appLog.warn("drive", "A Remote Storage book could not be reopened.", {
            status: response.status,
          });
        return false;
      }
      const file = (await response.json()) as { trashed?: boolean };
      return file.trashed !== true;
    } catch (err) {
      appLog.warn("drive", "A Remote Storage book could not be reopened.", {
        ...describeError(err),
      });
      return false;
    }
  },

  async listDir(ref: ProjectRef, path: string): Promise<DirEntry[]> {
    const folderId = await requireId(ref, path);

    return (await childrenOf(folderId)).map((file) => {
      const childPath = joinPath(path, file.name);
      return {
        path: childPath,
        name: file.name,
        kind:
          file.mimeType === FOLDER_MIME
            ? ("folder" as const)
            : ("file" as const),
      };
    });
  },

  async exists(ref: ProjectRef, path: string): Promise<boolean> {
    return (await resolve(ref, path)) !== null;
  },

  async readFile(ref: ProjectRef, path: string): Promise<string> {
    const id = await requireId(ref, path);
    const response = await driveFetch(`${FILES_ENDPOINT}/${id}?alt=media`);
    if (!response.ok) {
      // The body tells a rate-limit 403 from a lost grant.
      const body = await response.text().catch(() => "");
      throw fail(`Could not read ${path}.`, response.status, body);
    }

    // Refuse before reading: `Content-Length` makes the normal case free. A
    // missing header is not a refusal; Drive sends one for a media download,
    // and failing closed on its absence would break reads for little.
    const declared = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declared) && declared > MAX_FILE_BYTES)
      throw tooLarge(path);

    const text = await response.text();
    // Again on what arrived: the header is the remote's claim about the body,
    // not the body.
    if (text.length > MAX_FILE_BYTES) throw tooLarge(path);
    return text;
  },

  async writeFile(
    ref: ProjectRef,
    path: string,
    content: string,
  ): Promise<string> {
    const existing = await resolve(ref, path);

    if (existing) {
      if (!(await patchContent(path, existing, content)).trashed)
        return existing;

      // The file just written is in the bin, so the id came from a listing
      // taken before another device replaced it. The listing is the only
      // authority and is now known wrong: drop it, resolve again, and write
      // where the writer meant.
      const staleParent = await resolve(ref, parentPath(path));
      if (staleParent) invalidateListings(staleParent);

      const live = await resolve(ref, path);
      if (live && live !== existing) {
        if (!(await patchContent(path, live, content)).trashed) return live;
      }
      // Nothing live under this name: the file was deleted, not replaced.
      // Saving asks for it to exist, so fall through and create it.
    }

    // Serialize creates: wait for any in-flight write to the same path, then
    // re-check, because a concurrent create may already have made the file.
    // A loop, not one wait: every waiter behind a gate wakes when it opens,
    // and only the first to find no gate may take it, or two of them create
    // the same name twice. The check and the take below run in one turn.
    const lockKey = `${ref.key}:${path}`;
    for (
      let prev = writeLocks.get(lockKey);
      prev;
      prev = writeLocks.get(lockKey)
    )
      await prev.catch(() => {});

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    writeLocks.set(lockKey, gate);

    try {
      const current = await resolve(ref, path);
      if (current) {
        const response = await driveFetch(
          `${UPLOAD_ENDPOINT}/${current}?uploadType=media`,
          {
            method: "PATCH",
            headers: { "Content-Type": "text/plain; charset=UTF-8" },
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
        return current;
      }

      // Nothing at the path: create it.
      const parentId = await requireParent(ref, path, true);
      return await createFile(parentId, baseName(path), content);
    } finally {
      writeLocks.delete(lockKey);
      release();
    }
  },

  trashProject,

  /**
   * Drive folders are addressable, and the ref's key is the folder id, so the
   * URL needs no request.
   */
  folderUrl(ref: ProjectRef): string {
    return `https://drive.google.com/drive/folders/${driveId(ref.key)}`;
  },

  /**
   * The id of a path that resolves; `null` when it does not, or when the walk
   * fails midway (offline, gone). The sync layer stores it in the manifest as
   * information only, so a failure here must not fail the pull it rides on.
   */
  async fileIdOf(ref: ProjectRef, path: string): Promise<string | null> {
    try {
      return await resolve(ref, path);
    } catch {
      return null;
    }
  },

  /**
   * Writes an export's bytes, created with their real media type so
   * Drive shows a PDF as a PDF and converts nothing. The export sink refuses a
   * taken name before it gets here, but the port promises
   * create-or-overwrite, so an existing file is overwritten in place.
   */
  async writeBytes(
    ref: ProjectRef,
    path: string,
    bytes: Uint8Array,
    mime: string,
  ): Promise<void> {
    const content = new Blob([bytes as Uint8Array<ArrayBuffer>], {
      type: mime,
    });
    const existing = await resolve(ref, path);
    if (existing) {
      if (!(await patchContent(path, existing, content, mime)).trashed) return;
      // The id came from a listing taken before the file went to the bin, so
      // the bytes just landed in the bin. Drop the listing and create the
      // file where the writer will look. Unlike `writeFile` there is no
      // re-resolve and retry: the sink has just checked the name is free, so
      // a live twin under it is not worth a second round trip.
      invalidateListings(await requireParent(ref, path, false));
    }
    // No create lock, unlike `writeFile`: the export window is busy for the
    // whole of one export, so two creates of one path never race.
    const parentId = await requireParent(ref, path, true);
    await createFile(parentId, baseName(path), content, mime);
  },

  async createDir(ref: ProjectRef, path: string): Promise<void> {
    await createFolders(ref, path);
  },

  async renameFile(
    ref: ProjectRef,
    path: string,
    newName: string,
  ): Promise<void> {
    const id = await requireId(ref, path);
    // The parent's listing holds this child's old name. The walk above has
    // just cached the parent's own listing, so this costs no extra request.
    const parentId = await requireId(ref, parentPath(path));
    await driveJson(`${FILES_ENDPOINT}/${id}?fields=id`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });

    invalidateListings(parentId);
  },

  async moveFile(
    ref: ProjectRef,
    fromPath: string,
    toDir: string,
  ): Promise<void> {
    const id = await requireId(ref, fromPath);
    const fromParent = await requireId(ref, parentPath(fromPath));
    const toParent = await createFolders(ref, toDir);

    const params = new URLSearchParams({
      addParents: toParent,
      removeParents: fromParent,
      fields: "id",
    });
    await driveJson(`${FILES_ENDPOINT}/${id}?${params}`, { method: "PATCH" });

    // The source lost a child and the target gained one.
    invalidateListings(fromParent, toParent);
  },

  /**
   * Trashed, not destroyed: Drive's own bin is a safety net the writer can
   * restore from, as the project's `recyclebin/` folder is for removed nodes.
   */
  async removeFile(ref: ProjectRef, path: string): Promise<void> {
    const id = await requireId(ref, path);
    // The parent's listing holds this child; the same walk cached it.
    const parentId = await requireId(ref, parentPath(path));
    await driveJson(`${FILES_ENDPOINT}/${id}?fields=id`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });

    invalidateListings(parentId);
  },

  async statFile(
    ref: ProjectRef,
    path: string,
  ): Promise<{ created: string; updatedAt?: string } | null> {
    const id = await requireId(ref, path);
    if (!id) return null;
    const response = await driveFetch(
      `${FILES_ENDPOINT}/${id}?fields=createdTime,modifiedTime`,
    );
    if (!response.ok) return null;
    const meta = (await response.json()) as {
      createdTime?: string;
      modifiedTime?: string;
    };
    if (!meta.createdTime) return null;
    const updated =
      meta.modifiedTime && meta.modifiedTime !== meta.createdTime
        ? meta.modifiedTime
        : undefined;
    return { created: meta.createdTime, updatedAt: updated };
  },

  /**
   * Drive's own `sha256Checksum`: no download, only metadata Drive keeps for
   * binary content. Older or non-binary uploads may lack it, so such a file
   * falls back to `modifiedTime` and is marked `weak`.
   */
  async fingerprintFile(
    ref: ProjectRef,
    path: string,
    hint?: FileHint,
  ): Promise<FileFingerprint> {
    // Drive's checksum is one metadata field, so a hint has nothing to save
    // here; it is accepted for the port's uniform signature.
    void hint;
    // The queue asks this right before it overwrites a file, so the answer
    // must be about the file Drive holds under this name now: a miss or a
    // binned id means the listing is stale, and `resolveFresh` walks again.
    const cachedId = await resolve(ref, path);
    const first = cachedId ? await fileMeta(path, cachedId) : null;
    if (first && !first.trashed) return fingerprintOf(first);

    const liveId = await resolveFresh(ref, path);
    const live = liveId ? await fileMeta(path, liveId) : null;
    if (!live || live.trashed)
      throw new StorageError(
        `Not found: ${path}`,
        "not-found",
        "storage.fileGone",
        { name: baseName(path) },
      );
    return fingerprintOf(live);
  },

  /**
   * Every file directly inside `dirPath`, fingerprinted from the one
   * `files.list` that `childrenOf` makes instead of a `files.get` per file.
   * Throws, like `listDir`, when `dirPath` does not resolve;
   * the walk in `sync/scan.ts` treats that as nothing to scan.
   *
   * The folder is listed again on every call and the fresh listing replaces
   * the cached one: fingerprints are what a sync check compares, so a cached
   * checksum would hide an edit made on another device and the check would
   * push over it. Nothing else reads a checksum from the cache, so a content
   * write needs no invalidation of its own.
   */
  async fingerprintDir(
    ref: ProjectRef,
    dirPath: string,
    hints?: Map<string, FileHint>,
  ): Promise<Map<string, FileFingerprint>> {
    void hints;
    const folderId = await requireId(ref, dirPath);
    invalidateListings(folderId);

    const out = new Map<string, FileFingerprint>();
    for (const file of await childrenOf(folderId)) {
      out.set(
        file.name,
        file.sha256Checksum
          ? { hash: file.sha256Checksum }
          : { hash: file.modifiedTime ?? "", weak: true },
      );
    }
    return out;
  },

  // Only Drive can rename a folder; the File System Access API cannot.
  // Retitle dispatches on this capability, never on the provider id.
  renameFolder: renameDriveProject,
};

/**
 * Every project the writer's Drive holds, as refs, in the same shape as
 * `listLocalProjects`.
 *
 * Only the canonical place is scanned: `APP_DIR` at the account root holds
 * the projects directly, and `listProjectsInFolder` keeps the folders that
 * carry a structure manifest.
 */
export async function listDriveProjects(): Promise<ProjectRef[]> {
  const projectsId = await projectsFolderId().catch((err: unknown) => {
    appLog.warn(
      "drive",
      "The Remote Storage projects folder could not be reached.",
      {
        ...describeError(err),
      },
    );
    return null;
  });
  if (!projectsId) return [];

  // A project added from another device or drive.google.com is invisible to
  // the cached listing, so a sweep re-reads the app folder: one `files.list`
  // per sweep, with per-project listings kept.
  invalidateListings(projectsId);

  return listProjectsInFolder(
    driveProvider,
    {
      providerId: PROVIDER_ID,
      key: projectsId,
      name: "",
      openedAt: "",
    },
    ROOT_PATH,
  );
}

/**
 * Renames the project's own folder, and resolves the name Drive settled on.
 *
 * Not `renameFile(ref, ROOT_PATH, name)`: for the root, its parent path is
 * the root again, so it would invalidate the project folder's own listing
 * instead of the parents' listings that hold the old name. The root's id does
 * not change, so only those parents' listings are invalidated.
 */
export async function renameDriveProject(
  ref: ProjectRef,
  name: string,
): Promise<string> {
  const renamed = await driveJson<DriveFile & { parents?: string[] }>(
    `${FILES_ENDPOINT}/${driveId(ref.key)}?fields=id,name,parents`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );

  // The parents' listings hold the folder's old name.
  for (const parent of renamed.parents ?? []) invalidateListings(parent);

  return renamed.name;
}

/**
 * Moves the project's whole folder to the writer's Drive bin.
 *
 * Trashed, not destroyed: the bin is the writer's own, and they can restore
 * the project without the app. The caller updates the shelf (drop or forget);
 * Drive is not re-scanned.
 */
async function trashProject(ref: ProjectRef): Promise<void> {
  await driveJson(`${FILES_ENDPOINT}/${driveId(ref.key)}?fields=id,parents`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });

  // A trust reset: the whole listing cache goes, as `listings` says.
  listings.clear();
}

/**
 * Creates an empty folder in the writer's Drive to scaffold a project into.
 *
 * `parentId` is required, not defaulted, so no caller can land a project
 * loose in "My Drive" by omission.
 */
export async function createDriveProject(
  name: string,
  parentId: string,
): Promise<ProjectRef> {
  const folder = await driveJson<DriveFile>(
    `${FILES_ENDPOINT}?fields=id,name,mimeType`,
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

  // The parent gained a child its cached listing does not hold.
  invalidateListings(parentId);

  return {
    providerId: PROVIDER_ID,
    key: folder.id,
    name: folder.name,
    openedAt: new Date().toISOString(),
  };
}
