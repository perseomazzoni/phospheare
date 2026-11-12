// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  KEY_CEILING_USD,
  keyAcceptance,
  keyReset,
  keyVerdict,
  readKeyInfo,
  readingCurrent,
  spendWindow,
  windowEnd,
  windowSpend,
} from "./openrouterKey";
import type { OpenRouterKeyInfo } from "./openrouterKey";

// Pins the key rules the panel renders and the custody check refuses by:
// what is accepted, what a key's figures come to, and where each
// UTC window starts and ends.

const NOW = Date.UTC(2026, 9, 21, 15, 30); // a Wednesday

function info(overrides: Partial<OpenRouterKeyInfo> = {}): OpenRouterKeyInfo {
  return {
    label: "Phospheare",
    limitUsd: 5,
    limitRemainingUsd: null,
    limitReset: "monthly",
    includeByokInLimit: true,
    usage: { total: 3, daily: 0.5, weekly: 1, monthly: 2 },
    byokUsage: { total: 0, daily: 0, weekly: 0, monthly: 0 },
    isFreeTier: false,
    isManagementKey: false,
    isProvisioningKey: false,
    expiresAt: null,
    freeModelDailyRequests: null,
    ...overrides,
  };
}

describe("reading the vendor's answer", () => {
  const answer = {
    data: {
      label: "sk-or-v1-abc...xyz",
      limit: 5,
      limit_remaining: 4.25,
      limit_reset: "Monthly",
      include_byok_in_limit: true,
      usage: 1.5,
      usage_daily: 0.1,
      usage_weekly: 0.4,
      usage_monthly: "0.75",
      byok_usage: 0,
      byok_usage_daily: 0,
      byok_usage_weekly: 0,
      byok_usage_monthly: 0,
      is_free_tier: false,
      is_management_key: false,
      is_provisioning_key: false,
      expires_at: "2027-01-01T00:00:00Z",
      free_model_daily_requests: { limit: 50, remaining: 0, used: 50 },
    },
  };

  it("normalises every field it knows", () => {
    expect(readKeyInfo(answer)).toEqual({
      label: "sk-or-v1-abc...xyz",
      limitUsd: 5,
      limitRemainingUsd: 4.25,
      limitReset: "monthly",
      includeByokInLimit: true,
      usage: { total: 1.5, daily: 0.1, weekly: 0.4, monthly: 0.75 },
      byokUsage: { total: 0, daily: 0, weekly: 0, monthly: 0 },
      isFreeTier: false,
      isManagementKey: false,
      isProvisioningKey: false,
      expiresAt: Date.UTC(2027, 0, 1),
      freeModelDailyRequests: { limit: 50, remaining: 0, used: 50 },
    });
  });

  it("reads an absent limit, reset and expiry as none, never as zero", () => {
    const read = readKeyInfo({
      data: { limit: null, limit_reset: null, expires_at: null, usage: 1 },
    });
    expect(read).toMatchObject({
      limitUsd: null,
      limitReset: null,
      expiresAt: null,
      includeByokInLimit: false,
      byokUsage: { total: null },
    });
  });

  it("counts BYOK as inside the limit only on an explicit true", () => {
    for (const value of ["true", 1, null, undefined])
      expect(
        readKeyInfo({ data: { include_byok_in_limit: value } })
          ?.includeByokInLimit,
      ).toBe(false);
  });

  it("refuses an expiry it cannot read rather than reading it as never", () => {
    expect(readKeyInfo({ data: { limit: 5, expires_at: "soon" } })).toBeNull();
    expect(
      readKeyInfo({ data: { limit: 5, expires_at: 1_800_000_000 } }),
    ).toBeNull();
  });

  it("is null for a body that is not a key's description", () => {
    for (const body of [null, "x", [], { data: [] }, { data: "x" }, {}])
      expect(readKeyInfo(body)).toBeNull();
  });

  it("keeps a figure that is not a number out", () => {
    const read = readKeyInfo({
      data: { limit: "five", usage: Infinity, usage_daily: "1e400" },
    });
    expect(read?.limitUsd).toBeNull();
    expect(read?.usage.total).toBeNull();
    expect(read?.usage.daily).toBeNull();
  });
});

describe("the UTC spend windows", () => {
  it("cuts a day at midnight UTC", () => {
    expect(spendWindow("daily", NOW)).toEqual({
      start: Date.UTC(2026, 9, 21),
      end: Date.UTC(2026, 9, 22),
    });
  });

  it("starts a week on Monday, whichever day it is", () => {
    expect(spendWindow("weekly", NOW)).toEqual({
      start: Date.UTC(2026, 9, 19),
      end: Date.UTC(2026, 9, 26),
    });
    // A Sunday belongs to the week that began six days earlier.
    expect(spendWindow("weekly", Date.UTC(2026, 9, 25, 23, 59))?.start).toBe(
      Date.UTC(2026, 9, 19),
    );
    expect(spendWindow("weekly", Date.UTC(2026, 9, 26))?.start).toBe(
      Date.UTC(2026, 9, 26),
    );
  });

  it("ends a month on the 1st of the next, across a year", () => {
    expect(windowEnd("monthly", Date.UTC(2026, 11, 31, 23))).toBe(
      Date.UTC(2027, 0, 1),
    );
    expect(windowEnd("monthly", Date.UTC(2027, 0, 31))).toBe(
      Date.UTC(2027, 1, 1),
    );
  });

  it("has no window for a limit that never resets, or one it does not know", () => {
    expect(windowEnd(null, NOW)).toBeNull();
    expect(windowEnd("hourly", NOW)).toBeNull();
  });

  it("names a documented renewal period and nothing else", () => {
    expect(keyReset("monthly")).toBe("monthly");
    expect(keyReset(null)).toBeNull();
    expect(keyReset("hourly")).toBeNull();
    expect(keyReset("constructor")).toBeNull();
  });
});

describe("the spend in the key's window", () => {
  it("reads the window's own total, credit and BYOK together", () => {
    expect(
      windowSpend(
        info({ byokUsage: { total: 0, daily: 0, weekly: 0, monthly: 0.5 } }),
      ),
    ).toBe(2.5);
    expect(windowSpend(info({ limitReset: "daily" }))).toBe(0.5);
    expect(windowSpend(info({ limitReset: null }))).toBe(3);
  });

  it("is unknown when the vendor's limit leaves BYOK out and the BYOK figure is missing", () => {
    const missing = { total: null, daily: null, weekly: null, monthly: null };
    expect(
      windowSpend(info({ includeByokInLimit: false, byokUsage: missing })),
    ).toBeNull();
    expect(
      windowSpend(info({ includeByokInLimit: true, byokUsage: missing })),
    ).toBe(2);
  });

  it("is unknown for a window it does not know, never the wrong total", () => {
    expect(windowSpend(info({ limitReset: "hourly" }))).toBeNull();
  });
});

describe("whether the app takes a key", () => {
  it("accepts a capped key with no expiry and no reset", () => {
    expect(
      keyAcceptance(info({ expiresAt: null, limitReset: null }), NOW),
    ).toEqual({
      accepted: true,
      coverage: "credits-and-byok",
    });
  });

  it("says when the vendor's limit leaves BYOK spend out", () => {
    expect(keyAcceptance(info({ includeByokInLimit: false }), NOW)).toEqual({
      accepted: true,
      coverage: "credits-only",
    });
  });

  it("never holds a key that manages other keys, whatever its limit", () => {
    expect(keyAcceptance(info({ isManagementKey: true }), NOW)).toEqual({
      accepted: false,
      reason: "management-key",
    });
    expect(
      keyAcceptance(info({ isProvisioningKey: true, limitUsd: null }), NOW),
    ).toEqual({
      accepted: false,
      reason: "management-key",
    });
  });

  it("refuses an unlimited key", () => {
    expect(keyAcceptance(info({ limitUsd: null }), NOW)).toEqual({
      accepted: false,
      reason: "no-limit",
    });
  });

  it("holds the limit to five dollars, inclusive", () => {
    expect(
      keyAcceptance(info({ limitUsd: KEY_CEILING_USD }), NOW).accepted,
    ).toBe(true);
    expect(
      keyAcceptance(info({ limitUsd: KEY_CEILING_USD + 0.01 }), NOW),
    ).toEqual({
      accepted: false,
      reason: "limit-too-high",
    });
  });

  it("refuses a key expired on arrival, at the instant itself", () => {
    expect(keyAcceptance(info({ expiresAt: NOW }), NOW)).toEqual({
      accepted: false,
      reason: "already-expired",
    });
    expect(keyAcceptance(info({ expiresAt: NOW + 1 }), NOW).accepted).toBe(
      true,
    );
  });

  it("names the first failing rule", () => {
    expect(
      keyAcceptance(info({ limitUsd: 50, expiresAt: NOW - 1 }), NOW),
    ).toEqual({
      accepted: false,
      reason: "limit-too-high",
    });
  });
});

describe("what a key's facts come to", () => {
  it("is ready with the figures worked out", () => {
    expect(keyVerdict(info(), NOW)).toEqual({
      state: "ready",
      notice: null,
      waitUntil: null,
      spentUsd: 2,
      remainingUsd: 3,
      spentShare: 0.4,
    });
  });

  it("is expired at its date, whatever is left", () => {
    expect(keyVerdict(info({ expiresAt: NOW }), NOW)).toMatchObject({
      state: "expired",
      notice: null,
      waitUntil: null,
    });
  });

  it("offers the wait only when the key outlives the reset", () => {
    const spent = { usage: { total: 5, daily: 5, weekly: 5, monthly: 5 } };
    const end = new Date(Date.UTC(2026, 10, 1)).toISOString();

    expect(keyVerdict(info(spent), NOW)).toMatchObject({
      state: "limit-reached",
      waitUntil: end,
    });
    expect(
      keyVerdict(info({ ...spent, expiresAt: Date.UTC(2027, 0, 1) }), NOW)
        .waitUntil,
    ).toBe(end);
    expect(
      keyVerdict(info({ ...spent, expiresAt: Date.UTC(2026, 10, 1) }), NOW)
        .waitUntil,
    ).toBeNull();
    // A limit that never resets has nothing to wait for.
    expect(
      keyVerdict(info({ ...spent, limitReset: null }), NOW).waitUntil,
    ).toBeNull();
  });

  it("judges by the more conservative of the window total and limit_remaining", () => {
    // `limit_remaining` says 4 is spent; the window says 2.
    expect(keyVerdict(info({ limitRemainingUsd: 1 }), NOW)).toMatchObject({
      spentUsd: 4,
      remainingUsd: 1,
      notice: "limit-mostly-used",
    });
    // A credits-only key's `limit_remaining` leaves BYOK out; the window has it.
    const byok = { total: 0, daily: 0, weekly: 0, monthly: 3 };
    expect(
      keyVerdict(
        info({
          includeByokInLimit: false,
          limitRemainingUsd: 3,
          byokUsage: byok,
        }),
        NOW,
      ),
    ).toMatchObject({
      state: "limit-reached",
      spentUsd: 5,
      remainingUsd: 0,
      spentShare: 1,
    });
  });

  it("falls back to limit_remaining when the window total is unknown", () => {
    const verdict = keyVerdict(
      info({ limitReset: "hourly", limitRemainingUsd: 0 }),
      NOW,
    );
    expect(verdict).toMatchObject({
      state: "limit-reached",
      spentUsd: 5,
      remainingUsd: 0,
      waitUntil: null,
    });
  });

  it("knows no figure when neither source states one", () => {
    expect(
      keyVerdict(info({ limitReset: "hourly", limitRemainingUsd: null }), NOW),
    ).toMatchObject({
      state: "ready",
      spentUsd: null,
      remainingUsd: null,
      spentShare: null,
    });
  });

  it("floors what is left at zero and clamps the share, for the turn that overshoots", () => {
    expect(
      keyVerdict(
        info({ usage: { total: 7, daily: 7, weekly: 7, monthly: 7 } }),
        NOW,
      ),
    ).toMatchObject({ remainingUsd: 0, spentShare: 1 });
  });

  it("says expiring-soon within ten minutes, before mostly-used", () => {
    const soon = { expiresAt: NOW + 600_000 };
    expect(keyVerdict(info(soon), NOW).notice).toBe("expiring-soon");
    expect(
      keyVerdict(info({ expiresAt: NOW + 600_001 }), NOW).notice,
    ).toBeNull();
    expect(
      keyVerdict(
        info({
          ...soon,
          usage: { total: 4.5, daily: 4.5, weekly: 4.5, monthly: 4.5 },
        }),
        NOW,
      ).notice,
    ).toBe("expiring-soon");
  });

  it("says mostly-used at eighty percent", () => {
    expect(
      keyVerdict(
        info({ usage: { total: 4, daily: 4, weekly: 4, monthly: 4 } }),
        NOW,
      ).notice,
    ).toBe("limit-mostly-used");
    expect(
      keyVerdict(
        info({
          usage: { total: 3.99, daily: 3.99, weekly: 3.99, monthly: 3.99 },
        }),
        NOW,
      ).notice,
    ).toBeNull();
  });

  it("divides by nothing for a zero limit", () => {
    expect(keyVerdict(info({ limitUsd: 0 }), NOW)).toMatchObject({
      state: "limit-reached",
      spentShare: null,
      remainingUsd: 0,
    });
  });
});

describe("a reading from a spend window that has ended", () => {
  const DAY_START = Date.UTC(2026, 9, 21);
  const spent = info({
    limitReset: "daily",
    usage: { total: 9, daily: 5, weekly: 5, monthly: 5 },
  });

  it("is current from the window's first moment, and stale before it", () => {
    expect(readingCurrent(spent, DAY_START, NOW)).toBe(true);
    expect(readingCurrent(spent, NOW, NOW)).toBe(true);
    expect(readingCurrent(spent, DAY_START - 1, NOW)).toBe(false);
  });

  it("never goes stale for a limit that does not reset, or a window not known", () => {
    expect(readingCurrent(info({ limitReset: null }), 0, NOW)).toBe(true);
    expect(readingCurrent(info({ limitReset: "hourly" }), 0, NOW)).toBe(true);
  });

  it("judges by its spend while the window it was read in lasts", () => {
    expect(keyVerdict(spent, NOW, DAY_START + 1).state).toBe("limit-reached");
  });

  // The vendor's daily total covers yesterday; judged today it would
  // refuse a key whose limit has already reset.
  it("counts as no reading of the spend once the window has turned over", () => {
    expect(keyVerdict(spent, NOW, DAY_START - 30_000)).toEqual({
      state: "ready",
      notice: null,
      waitUntil: null,
      spentUsd: null,
      remainingUsd: null,
      spentShare: null,
    });
  });

  it("still judges the expiry, which no window resets", () => {
    expect(
      keyVerdict(info({ ...spent, expiresAt: NOW - 1 }), NOW, DAY_START - 1)
        .state,
    ).toBe("expired");
  });
});
