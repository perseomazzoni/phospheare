// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { githubReleases } from "./githubReleases";

const FEED = "https://feed.test/releases/latest";
const PAGES = "https://pages.test/releases";

function answer(status: number, body?: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const latest = () => githubReleases(FEED, PAGES).latest();

afterEach(() => vi.unstubAllGlobals());

describe("githubReleases", () => {
  it("reads the tag and builds the page from it, not from the answer", async () => {
    answer(200, { tag_name: "v1.2.0", html_url: "https://elsewhere.test/" });
    expect(await latest()).toEqual({
      tag: "v1.2.0",
      url: `${PAGES}/tag/v1.2.0`,
    });
  });

  it("asks with no cookie and no referrer", async () => {
    const fetchMock = answer(200, { tag_name: "v1.2.0" });
    await latest();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(FEED);
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.headers).toEqual({ Accept: "application/vnd.github+json" });
  });

  it.each([404, 204])("reads %i as no release", async (status) => {
    answer(status);
    expect(await latest()).toBeNull();
  });

  it("throws on any other refusal", async () => {
    answer(403, { message: "rate limited" });
    await expect(latest()).rejects.toThrow("403");
  });

  it.each([{}, { tag_name: 7 }, { tag_name: "latest" }, { tag_name: "v1.2" }])(
    "throws on an answer with no readable tag: %j",
    async (body) => {
      answer(200, body);
      await expect(latest()).rejects.toThrow("no readable tag");
    },
  );

  it("gives up on a feed that does not answer in ten seconds", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) =>
              init.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              ),
            ),
        ),
      );
      const asked = latest();
      const failed = expect(asked).rejects.toThrow("aborted");
      await vi.advanceTimersByTimeAsync(10_000);
      await failed;
    } finally {
      vi.useRealTimers();
    }
  });
});
