// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useTimeWords } from "./useTimeWords";

const language = { current: "en" };

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: language.current } }),
}));

afterEach(() => {
  cleanup();
  language.current = "en";
  vi.useRealTimers();
});

const words = () => renderHook(() => useTimeWords()).result.current;

describe("useTimeWords", () => {
  it("says how long ago in the writer's language", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T12:00:00.000Z"));
    expect(words().relative("2026-09-16T10:00:00.000Z")).toBe("2 hours ago");
    language.current = "it";
    expect(words().relative("2026-09-16T10:00:00.000Z")).toBe("2 ore fa");
  });

  it("says the instant itself in the same language", () => {
    // The exact reading is the tooltip under the relative one: the only form
    // that holds outside the app and compares against anything else.
    expect(words().exact("2026-09-16T14:32:00.000Z")).toMatch(/2026/);
    expect(words().exact("2026-09-16T14:32:00.000Z")).toMatch(/Sep/);
  });

  it("shows nothing rather than a wrong thing for an unusable stamp", () => {
    // A hand-edited chat file can carry anything. An empty string parses to
    // epoch zero, which would date a message decades back.
    for (const bad of ["", "not-a-date"]) {
      expect(words().relative(bad)).toBe("");
      expect(words().exact(bad)).toBe("");
    }
  });

  it("builds its formatters once per language, not once per call", () => {
    // A transcript calls these on every message on every render, and an Intl
    // formatter is not a cheap object.
    const view = renderHook(() => useTimeWords());
    const first = view.result.current;
    view.rerender();
    expect(view.result.current).toBe(first);
  });
});
