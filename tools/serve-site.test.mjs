// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { answer, serve } from "./serve-site.mjs";

const site = mkdtempSync(join(tmpdir(), "serve-site-"));
after(() => rmSync(site, { recursive: true, force: true }));
for (const [file, text] of [
  ["index.html", "home"],
  ["404.html", "missing"],
  ["legal/index.html", "legal"],
  ["app/editor/demo/index.html", "demo"],
  ["assets/app.js", "code"],
  [".well-known/secret", "hidden"],
]) {
  mkdirSync(join(site, file, ".."), { recursive: true });
  writeFileSync(join(site, file), text);
}

test("a file and a page folder are served, with the closing slash", () => {
  assert.deepEqual(answer(site, "/assets/app.js"), {
    status: 200,
    file: join(site, "assets/app.js"),
  });
  assert.deepEqual(answer(site, "/"), {
    status: 200,
    file: join(site, "index.html"),
  });
  assert.deepEqual(answer(site, "/legal/"), {
    status: 200,
    file: join(site, "legal/index.html"),
  });
  assert.deepEqual(answer(site, "/app/editor/demo?lang=it&x=1"), {
    status: 301,
    location: "/app/editor/demo/?lang=it&x=1",
  });
});

test("every other address is the not-found page with a 404", () => {
  const notFound = { status: 404, file: join(site, "404.html") };
  for (const url of [
    "/app",
    "/app/editor",
    "/terms",
    "/assets/missing.js",
    "/assets/app.js/",
    "/.well-known/secret",
    "/../package.json",
    "/%2e%2e/package.json",
    "/legal%5c..%5c..%5cpackage.json",
    "/%E0%A4%A",
  ])
    assert.deepEqual(answer(site, url), notFound, url);
});

test("the server answers with the status and the file", async () => {
  const server = await serve(site, 0);
  after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const missing = await fetch(`${base}/terms`);
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), "missing");
  assert.match(missing.headers.get("content-type"), /^text\/html/);
  const moved = await fetch(`${base}/legal`, { redirect: "manual" });
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get("location"), "/legal/");
  const code = await fetch(`${base}/assets/app.js`);
  assert.equal(code.status, 200);
  assert.match(code.headers.get("content-type"), /^text\/javascript/);
  assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
});
