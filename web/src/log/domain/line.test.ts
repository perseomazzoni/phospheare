// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  atLeast,
  escape,
  fieldValue,
  formatLine,
  formatTime,
  header,
  type LogEntry,
} from "./line";

// The suite runs in Europe/Rome (`vite.config.ts`), one hour ahead in winter.
const AT = Date.UTC(2026, 10, 15, 14, 21, 40, 8);

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  at: AT,
  level: "error",
  area: "sync",
  message: "Sync stopped at a change.",
  account: "Q2x5bmF0dGhlRXhhbXBs",
  fields: { code: "quota", tries: 3 },
  ...over,
});

describe("a log line", () => {
  it("has the desktop program's columns, then its fields", () => {
    expect(formatLine(entry())).toBe(
      "2026-11-15T15:21:40.008+01:00  ERROR  spa       Q2x5bmF0dGhlRXhhbXBs    sync      Sync stopped at a change.  code=quota tries=3",
    );
  });

  it("shows a dash for no account and no area, and no fields when none", () => {
    expect(
      formatLine(entry({ account: null, area: "", fields: {}, level: "info" })),
    ).toBe(
      "2026-11-15T15:21:40.008+01:00  INFO   spa       -                       -         Sync stopped at a change.",
    );
  });

  it("stays one line, whatever the message holds", () => {
    const line = formatLine(
      entry({ message: "first\nsecond\x1b[31m", fields: { stack: "a\n\tb" } }),
    );
    expect(line.includes("\n") || line.includes("\x1b")).toBe(false);
    expect(line).toContain("first\\nsecond\\x1b[31m");
    expect(line).toContain('stack="a\\n\\tb"');
  });

  it("quotes a value that would not split back", () => {
    expect(fieldValue("two words")).toBe('"two words"');
    expect(fieldValue("")).toBe('""');
    expect(fieldValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(fieldValue("a=b")).toBe('"a=b"');
    expect(fieldValue("C:\\x y")).toBe('"C:\\\\x y"');
    expect(fieldValue(false)).toBe("false");
    expect(fieldValue(42)).toBe("42");
  });

  it("escapes every control character", () => {
    expect(escape("a\rb\u0007c\u0085")).toBe("a\\rb\\x07c\\x85");
    expect(escape("plain")).toBe("plain");
  });

  it("writes local time with its offset, east and west", () => {
    expect(formatTime(AT)).toBe("2026-11-15T15:21:40.008+01:00");
  });

  it("orders the levels", () => {
    expect(atLeast("error", "warn")).toBe(true);
    expect(atLeast("warn", "warn")).toBe(true);
    expect(atLeast("info", "warn")).toBe(false);
  });

  it("starts a download with a header that names the source", () => {
    expect(header("Once Dark Studio", "1.2.0", AT)).toBe(
      "━━ Once Dark Studio 1.2.0 · browser · spa · log saved 2026-11-15T15:21:40.008+01:00 ━━",
    );
  });
});
