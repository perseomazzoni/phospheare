// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { elapsed } from "./relativeTime";

const NOW = Date.parse("2026-07-28T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("elapsed", () => {
  it('calls anything inside the minute "now"', () => {
    expect(elapsed(ago(0), NOW)).toEqual({ value: 0, unit: "second" });
    expect(elapsed(ago(59 * SECOND), NOW)).toEqual({
      value: 0,
      unit: "second",
    });
  });

  it("counts minutes up to the hour", () => {
    expect(elapsed(ago(MINUTE), NOW)).toEqual({ value: -1, unit: "minute" });
    expect(elapsed(ago(59 * MINUTE), NOW)).toEqual({
      value: -59,
      unit: "minute",
    });
  });

  it("counts hours up to the day", () => {
    expect(elapsed(ago(HOUR), NOW)).toEqual({ value: -1, unit: "hour" });
    expect(elapsed(ago(2 * HOUR), NOW)).toEqual({ value: -2, unit: "hour" });
    expect(elapsed(ago(23 * HOUR), NOW)).toEqual({ value: -23, unit: "hour" });
  });

  it("counts days up to the week", () => {
    expect(elapsed(ago(DAY), NOW)).toEqual({ value: -1, unit: "day" });
    expect(elapsed(ago(6 * DAY), NOW)).toEqual({ value: -6, unit: "day" });
  });

  it("counts weeks up to the month", () => {
    expect(elapsed(ago(7 * DAY), NOW)).toEqual({ value: -1, unit: "week" });
    expect(elapsed(ago(21 * DAY), NOW)).toEqual({ value: -3, unit: "week" });
  });

  it("counts months up to the year", () => {
    expect(elapsed(ago(30 * DAY), NOW)).toEqual({ value: -1, unit: "month" });
    expect(elapsed(ago(200 * DAY), NOW)).toEqual({ value: -6, unit: "month" });
  });

  it("counts years beyond that", () => {
    expect(elapsed(ago(365 * DAY), NOW)).toEqual({ value: -1, unit: "year" });
    expect(elapsed(ago(900 * DAY), NOW)).toEqual({ value: -2, unit: "year" });
  });

  // A file copied between two machines can carry a stamp minutes ahead of
  // this one, and a future phrase would contradict the writer's own clock.
  it("reads a stamp from the future as now", () => {
    expect(elapsed(new Date(NOW + 3 * HOUR).toISOString(), NOW)).toEqual({
      value: 0,
      unit: "second",
    });
  });

  it("is null when there is no usable stamp", () => {
    expect(elapsed("", NOW)).toBeNull();
    expect(elapsed("whenever", NOW)).toBeNull();
  });
});
