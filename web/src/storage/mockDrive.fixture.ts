// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// An in-memory fake Google Drive, for tests only. Test suites stub
// `globalThis.fetch` with `mockDriveFetch`.
//
// Nothing in the running app reaches this file. Do not import it
// from runtime code: that would ship the fake in the production bundle, and a
// runtime switch to it would let one setting reroute every save away from
// Drive.
//
// The tree is a flat Map keyed by file id. Folders are implied by the
// `parents` arrays of their children, except the ones created empty.

export interface MockFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content?: string;
  trashed?: boolean;
  /** Drive's own timestamps, seeded by the `statFile` contract tests. */
  createdTime?: string;
  modifiedTime?: string;
  /** Seeded by the fingerprint contract tests. */
  sha256Checksum?: string;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

const files = new Map<string, MockFile>();
let nextId = 0;

function mockDriveReset(): void {
  files.clear();
  nextId = 0;
}

/** The in-memory file tree itself, for tests that assert on state. */
export function mockDriveFiles(): Map<string, MockFile> {
  return files;
}

export function mockDriveSeed(seed: MockFile[]): void {
  mockDriveReset();
  for (const f of seed) files.set(f.id, { ...f });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The id in `'<id>' in parents` from the `q` parameter, or `null`. */
function parentFromQuery(url: URL): string | null {
  const q = url.searchParams.get("q") ?? "";
  return /'([^']+)' in parents/.exec(q)?.[1] ?? null;
}

export async function mockDriveFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const raw = typeof input === "string" ? input : input.toString();
  const url = new URL(raw);
  const method = (init.method ?? "GET").toUpperCase();

  const isUpload = url.pathname.startsWith("/upload/");
  const idFromPath = /\/files\/([^/?]+)/.exec(url.pathname)?.[1];

  // List children
  if (method === "GET" && !idFromPath) {
    const parent = parentFromQuery(url);
    const nameMatch = /name = '([^']+)'/.exec(
      url.searchParams.get("q") ?? "",
    )?.[1];
    const matches = [...files.values()].filter((f) => {
      if (f.trashed) return false;
      if (parent) return f.parents.includes(parent);
      if (nameMatch) return f.name === nameMatch;
      return false;
    });

    // Real pagination, as the API does it: `pageSize` caps a page, and a
    // `nextPageToken` (here the next page's start offset) comes back while
    // results remain, so callers that page are tested for real.
    const pageSize = Number(url.searchParams.get("pageSize") ?? matches.length);
    const start = Number(url.searchParams.get("pageToken") ?? 0);
    const page = matches.slice(start, start + pageSize);
    const body: { files: MockFile[]; nextPageToken?: string } = {
      files: page.map((f) => ({ ...f, parents: f.parents })),
    };
    if (start + pageSize < matches.length)
      body.nextPageToken = String(start + pageSize);
    return json(body);
  }

  // Read content
  if (
    method === "GET" &&
    idFromPath &&
    url.searchParams.get("alt") === "media"
  ) {
    const file = files.get(idFromPath);
    if (!file) return json({ error: "not found" }, 404);
    return new Response(file.content ?? "");
  }

  // Metadata
  if (method === "GET" && idFromPath) {
    const file = files.get(idFromPath);
    if (!file) return json({ error: "not found" }, 404);
    return json(file);
  }

  // Create a folder or a multipart file
  if (method === "POST") {
    const id = `mock-${nextId++}`;
    if (isUpload) {
      const body = String(init.body);
      const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/.exec(body)?.[1] ?? "{}");
      const content =
        body.split("\r\n\r\n")[2]?.replace(/\r\n--.*--$/, "") ?? "";
      files.set(id, {
        id,
        name: meta.name,
        mimeType: "text/plain",
        parents: meta.parents ?? [],
        content,
      });
    } else {
      const meta = JSON.parse(String(init.body ?? "{}"));
      files.set(id, {
        id,
        name: meta.name,
        mimeType: meta.mimeType ?? FOLDER_MIME,
        parents: meta.parents ?? [],
      });
    }
    return json(files.get(id));
  }

  // Update: rename, trash, move, or media overwrite
  if (method === "PATCH" && idFromPath) {
    const file = files.get(idFromPath);
    if (!file) return json({ error: "not found" }, 404);

    if (isUpload) {
      file.content = String(init.body);
      return json(file);
    }

    const addParents = url.searchParams.get("addParents");
    const removeParents = url.searchParams.get("removeParents");
    if (addParents || removeParents) {
      file.parents = file.parents.filter((p) => p !== removeParents);
      if (addParents) file.parents.push(addParents);
      return json(file);
    }

    const meta = JSON.parse(String(init.body ?? "{}"));
    if (meta.name !== undefined) file.name = meta.name;
    if (meta.trashed !== undefined) file.trashed = meta.trashed;
    return json(file);
  }

  return json({ error: "unhandled" }, 500);
}
