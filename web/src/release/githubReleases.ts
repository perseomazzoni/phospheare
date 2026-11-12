// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReleaseFeed } from "./application/checkForRelease";

// GitHub's newest published release (`GET /repos/{owner}/{repo}/releases/
// latest`). A draft or a repository GitHub does not show answers 404, which
// is "no release". The request carries no cookie and no referrer: GitHub
// learns the connection's address and nothing about the writer or the page.
//
// The page offered is built from the tag under `pages`, never taken from the
// answer, so a link on screen always leads to this project's releases.

/** A tag as GitHub's release workflow publishes it, `v1.2.0` or `1.2.0-rc.1`. */
const TAG = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const TIMEOUT_MS = 10_000;

export function githubReleases(feedUrl: string, pages: string): ReleaseFeed {
  return {
    async latest() {
      const ask = new AbortController();
      const timer = setTimeout(() => ask.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(feedUrl, {
          headers: { Accept: "application/vnd.github+json" },
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: ask.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      // 204 is the dev and E2E servers' stand-in for "nothing published".
      if (res.status === 404 || res.status === 204) return null;
      if (!res.ok) throw new Error(`release feed answered ${res.status}`);
      const body = (await res.json()) as { tag_name?: unknown };
      const tag = body?.tag_name;
      if (typeof tag !== "string" || !TAG.test(tag))
        throw new Error("release feed gave no readable tag");
      return { tag, url: `${pages}/tag/${encodeURIComponent(tag)}` };
    },
  };
}
