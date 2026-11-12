// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { activityWords, toolPhrase } from "./runStatus";

// The status line in words. Keys, not copy: the locale owns
// the words, and `locales.test.ts` owns that every key has them.
const t = ((key: string) => key) as unknown as TFunction;

describe("activityWords", () => {
  it("says which of /verify's two steps is running", () => {
    for (const step of ["proposing", "judging"] as const)
      expect(activityWords(t, { kind: "verifying", step })).toEqual({
        shown: `dock.verify.${step}`,
        spoken: `dock.verify.${step}`,
      });
  });

  it("says which Section a beta reader is reading, and when it predicts", () => {
    const said = ((key: string, values?: { title?: string }) =>
      values?.title ? `${key}:${values.title}` : key) as unknown as TFunction;
    expect(
      activityWords(said, { kind: "reading", title: "The Harbour" }),
    ).toEqual({
      shown: "dock.reading.reading:The Harbour",
      spoken: "dock.reading.reading:The Harbour",
    });
    expect(activityWords(t, { kind: "predicting" }).shown).toBe(
      "dock.reading.predicting",
    );
  });

  it("says the run waits on the writer while a search is asked about", () => {
    expect(activityWords(t, { kind: "awaiting-writer" })).toEqual({
      shown: "dock.awaitingWriter",
      spoken: "dock.awaitingWriter",
    });
  });

  it("names the engine a search goes to, never its query", () => {
    expect(
      activityWords(t, { kind: "searching-web", engine: "wikipedia" }),
    ).toEqual({
      shown: "dock.web.doing.wikipedia",
      spoken: "dock.web.doing.wikipedia",
    });
    expect(activityWords(t, { kind: "searching-web", engine: "web" })).toEqual({
      shown: "dock.web.doing.web",
      spoken: "dock.web.doing.web",
    });
    // Its retired tool keys never come back through the tool path.
    expect(toolPhrase(t, "did", "web_search")).toBe("dock.working");
    expect(toolPhrase(t, "failed", "web_search")).toBe("dock.working");
  });
});
