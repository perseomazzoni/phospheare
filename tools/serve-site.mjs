// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Serves a built site the way GitHub Pages does, for the demo site's
// browser suite:
//
//     node tools/serve-site.mjs <directory> <port>
//
// A file is served as it is. A folder holding `index.html` serves it, after a
// redirect that adds the closing slash. Every other address gets `404.html`
// with a 404, and so does a hidden file, which Pages never receives. There is
// no fallback to the page: `vite preview` answers every address with it, so
// a page the build forgot to write would pass there and fail on the site.
//
// It listens on 127.0.0.1 only. Exit 2 on a bad argument.

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
};

function fileAt(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * What the site answers for a request path: `{ status, file }` for a file or
 * the not-found page, `{ status, location }` for a redirect. `root` is the
 * site's folder; `url` is the request's path and query.
 */
export function answer(root, url) {
  const site = resolve(root);
  const notFound = { status: 404, file: join(site, "404.html") };
  const [rawPath, query] = url.split(/\?(.*)/s);
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return notFound;
  }
  if (!path.startsWith("/") || path.includes("\0")) return notFound;
  const parts = path.split("/").filter(Boolean);
  if (parts.some((part) => part.startsWith(".") || part.includes("\\")))
    return notFound;
  const target = resolve(site, ...parts);
  if (target !== site && !target.startsWith(site + sep)) return notFound;
  const found = fileAt(target);
  if (found?.isFile() && !path.endsWith("/"))
    return { status: 200, file: target };
  if (found?.isDirectory() && fileAt(join(target, "index.html"))?.isFile()) {
    if (!path.endsWith("/"))
      return {
        status: 301,
        location: `${rawPath}/${query === undefined ? "" : `?${query}`}`,
      };
    return { status: 200, file: join(target, "index.html") };
  }
  return notFound;
}

/** Starts the server; resolves once it listens. */
export function serve(root, port) {
  const server = createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const result = answer(root, request.url ?? "/");
    if (result.location) {
      response.writeHead(result.status, { Location: result.location }).end();
      return;
    }
    if (!fileAt(result.file)?.isFile()) {
      response.writeHead(result.status, { "Content-Type": TYPES[".txt"] });
      response.end(request.method === "HEAD" ? undefined : "Not found\n");
      return;
    }
    response.writeHead(result.status, {
      "Content-Type":
        TYPES[extname(result.file).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(result.file).pipe(response);
  });
  return new Promise((done) =>
    server.listen(port, "127.0.0.1", () => done(server)),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [root, port, ...rest] = process.argv.slice(2);
  if (!root || !/^\d+$/.test(port ?? "") || rest.length) {
    console.error("usage: node tools/serve-site.mjs <directory> <port>");
    process.exit(2);
  }
  if (!fileAt(join(root, "index.html"))?.isFile()) {
    console.error(`serve-site: no index.html in ${root}`);
    process.exit(2);
  }
  await serve(root, Number(port));
  console.log(`serve-site: ${resolve(root)} on http://127.0.0.1:${port}`);
}
