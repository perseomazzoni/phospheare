// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { formatSavedAt, formatWhen } from "./datetime";

// The save chip's stamp: the word "Today" comes from the locale files, so the
// time and the month must come from the same language, never the browser's.

describe("formatWhen", () => {
  it("formats a stamp in the app's language, not the browser's", () => {
    const at = new Date(2026, 8, 16, 14, 32);
    const short = { dateStyle: "short", timeStyle: "short" } as const;
    expect(formatWhen(at.toISOString(), "it")).toBe(
      at.toLocaleString("it", short),
    );
    expect(formatWhen(at.toISOString(), "en-US")).toBe(
      at.toLocaleString("en-US", short),
    );
  });

  it("hands back a stamp it cannot read", () => {
    expect(formatWhen("not a date", "it")).toBe("not a date");
  });
});

describe("formatSavedAt", () => {
  const now = new Date(2026, 9, 4, 18, 0);
  const at = new Date(2026, 9, 4, 14, 32).getTime();

  it("says today's time in the app's language", () => {
    const time = new Date(at).toLocaleTimeString("it", {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(formatSavedAt(at, "it", "Oggi", now)).toBe(`Oggi, ${time}`);
    expect(formatSavedAt(at, "en-US", "Today", now)).toBe(
      `Today, ${new Date(at).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })}`,
    );
  });

  it("names an earlier day's month in the app's language", () => {
    const earlier = new Date(2026, 7, 4, 14, 32).getTime();
    const day = new Date(earlier).toLocaleDateString("it", {
      month: "short",
      day: "numeric",
    });
    expect(formatSavedAt(earlier, "it", "Oggi", now)).toMatch(
      new RegExp(`^${day}, `),
    );
  });
});
