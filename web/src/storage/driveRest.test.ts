// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./driveToken", () => ({
  driveAccessToken: () => Promise.resolve("test-token"),
  forgetDriveToken: () => {},
}));

import { fail } from "./driveRest";
import { driveGrantLapsed, resetDriveGrant } from "./driveGrant";

describe("fail", () => {
  it("maps a 403 with a rate-limit reason to transient, not a permission loss", () => {
    const body = JSON.stringify({
      error: { errors: [{ reason: "userRateLimitExceeded" }] },
    });
    expect(fail("x", 403, body).code).toBe("unavailable");
  });

  it("maps a 403 with a quota reason to transient", () => {
    const body = JSON.stringify({
      error: { errors: [{ reason: "quotaExceeded" }] },
    });
    expect(fail("x", 403, body).code).toBe("unavailable");
  });

  it("a 403 with any other reason is a real permission loss", () => {
    expect(fail("x", 403).code).toBe("permission");
    const body = JSON.stringify({
      error: { errors: [{ reason: "insufficientPermissions" }] },
    });
    expect(fail("x", 403, body).code).toBe("permission");
  });

  it("a 429 is transient", () => {
    expect(fail("x", 429).code).toBe("unavailable");
  });

  it("a full Remote Storage is its own error: retryable, and says so", () => {
    // Drive answers a full account with a 403. Read as a revoked grant, it
    // tells the writer to reconnect an account that is connected, and the
    // queue stops the save as refused for good.
    const body = JSON.stringify({
      error: { errors: [{ reason: "storageQuotaExceeded" }] },
    });
    const err = fail("x", 403, body);
    expect(err.code).toBe("no-space");
    expect(err.key).toBe("storage.remoteFull");
  });

  it("an unparseable body never masks the status mapping", () => {
    expect(fail("x", 403, "not json at all").code).toBe("permission");
  });
});

// What reaches the grant latch. `fail` discovers a lapsed grant from Drive's
// side, so it also sets the latch. A rate-limit 403 and an unreachable
// network must not tell a writer to reconnect an account that is connected,
// and each is a far more common answer from Drive than a real revocation.

describe("the grant latch, set from the classification", () => {
  beforeEach(() => {
    resetDriveGrant();
  });

  it("a real 401 latches the grant as lapsed", () => {
    fail("x", 401);
    expect(driveGrantLapsed()).toBe(true);
  });

  it("a real 403 latches too — a revoked grant answers with either", () => {
    fail("x", 403);
    expect(driveGrantLapsed()).toBe(true);
  });

  it("a rate-limit 403 does NOT: the grant is fine and the request was not", () => {
    const body = JSON.stringify({
      error: { errors: [{ reason: "userRateLimitExceeded" }] },
    });
    fail("x", 403, body);
    expect(driveGrantLapsed()).toBe(false);
  });

  it("a full Remote Storage does not: the grant is fine, the space is not", () => {
    const body = JSON.stringify({
      error: { errors: [{ reason: "storageQuotaExceeded" }] },
    });
    fail("x", 403, body);
    expect(driveGrantLapsed()).toBe(false);
  });

  it("a 429 does not", () => {
    fail("x", 429);
    expect(driveGrantLapsed()).toBe(false);
  });

  it("an unreachable network does not — that is the offline notice's job", () => {
    fail("x", 0);
    expect(driveGrantLapsed()).toBe(false);
  });

  it("a 404 does not: a deleted folder proves the grant, it does not deny it", () => {
    fail("x", 404);
    expect(driveGrantLapsed()).toBe(false);
  });
});
