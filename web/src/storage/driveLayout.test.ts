// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockDriveFetch,
  mockDriveFiles,
  mockDriveSeed,
} from "./mockDrive.fixture";
import {
  __resetDriveLayoutCacheForTest,
  driveQueryString,
  projectsFolderId,
} from "./driveLayout";
import { setCurrentUserId } from "../auth/currentUser";
import { APP_DIR } from "./layout";
import { PRODUCT } from "../product";

// The same fetch fake as `driveProvider.test.ts`: a small in-memory Drive and
// a record of every request. Pins idempotence, so an app folder resolved once
// is never created twice, from a cold cache or from two racing calls, and
// that the memo never outlives its account.

vi.mock("./driveToken", () => ({
  driveAccessToken: () => Promise.resolve("test-token"),
  forgetDriveToken: () => {},
}));

const FOLDER = "application/vnd.google-apps.folder";

beforeEach(() => {
  __resetDriveLayoutCacheForTest();
  mockDriveSeed([]);
  vi.stubGlobal("fetch", vi.fn(mockDriveFetch));
  setCurrentUserId("u1");
});

afterEach(() => vi.unstubAllGlobals());

describe("projectsFolderId", () => {
  it("creates the app folder under the account root when it does not exist", async () => {
    const id = await projectsFolderId();

    const created = mockDriveFiles().get(id);
    expect(created?.name).toBe(APP_DIR);
    expect(created?.parents).toEqual(["root"]);
  });

  it("reuses an existing app folder rather than duplicating it", async () => {
    mockDriveSeed([
      { id: "app-1", name: APP_DIR, mimeType: FOLDER, parents: ["root"] },
    ]);

    expect(await projectsFolderId()).toBe("app-1");
    expect(
      [...mockDriveFiles().values()].filter((f) => f.name === APP_DIR),
    ).toHaveLength(1);
  });

  it("memoizes: a second call makes no further requests", async () => {
    await projectsFolderId();
    await projectsFolderId();

    // The first call cost two requests, one find and one create, and the
    // second call added none.
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("creates the app folder only once even when two first calls race", async () => {
    const [first, second] = await Promise.all([
      projectsFolderId(),
      projectsFolderId(),
    ]);

    // One shared in-flight promise: both callers got the same folder, one
    // app folder exists, and the whole resolution cost one find + one create.
    expect(first).toBe(second);
    expect(mockDriveFiles().get(first)?.name).toBe(APP_DIR);
    expect(
      [...mockDriveFiles().values()].filter((f) => f.name === APP_DIR),
    ).toHaveLength(1);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("a failed lookup is not remembered: the next call asks Drive again", async () => {
    // One offline moment at boot must not leave the Library without an app
    // folder until the next sign-in.
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));

    await expect(projectsFolderId()).rejects.toMatchObject({
      code: "unavailable",
    });
    const id = await projectsFolderId();

    expect(mockDriveFiles().get(id)?.name).toBe(APP_DIR);
  });

  it("re-resolves for the next account after a user change", async () => {
    const first = await projectsFolderId();
    expect(mockDriveFiles().get(first)?.name).toBe(APP_DIR);

    // The next account's Drive has its own app folder. Without the
    // `onUserChange` invalidation the memo would keep serving the departed
    // account's folder id for the rest of the session.
    mockDriveSeed([
      { id: "app-2", name: APP_DIR, mimeType: FOLDER, parents: ["root"] },
    ]);
    setCurrentUserId("u2");

    expect(await projectsFolderId()).toBe("app-2");
    setCurrentUserId(null);
  });
});

describe("APP_DIR", () => {
  // The product's name with no spaces, so a remote addressed by path or URL
  // need not encode it, nor a writer quote it.
  it("is the product's name in Pascal form", () => {
    expect(APP_DIR).toBe(PRODUCT.pascal);
    expect(APP_DIR).toMatch(/^[A-Za-z0-9]+$/);
  });
});

describe("driveQueryString", () => {
  it("keeps a quote or a backslash in the product's name inside the literal", () => {
    expect(driveQueryString("Once Dark Studio")).toBe("'Once Dark Studio'");
    expect(driveQueryString("Writer's \\ Room")).toBe("'Writer\\'s \\\\ Room'");
  });
});
