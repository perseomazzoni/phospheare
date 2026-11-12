// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";
import it_ from "../../locales/it.json";
import { greetingKeys, randomGreetingKey } from "./randomGreeting";

const lookup = (bundle: unknown, key: string): string =>
  key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown>)[part],
      bundle,
    ) as string;

describe("randomGreetingKey", () => {
  it("picks from the pool asked for", () => {
    expect(randomGreetingKey("first", () => 0)).toBe(greetingKeys("first")[0]);
    const returning = greetingKeys("returning");
    expect(randomGreetingKey("returning", () => 0.999)).toBe(
      returning[returning.length - 1],
    );
  });

  it("keeps the two pools apart", () => {
    const first = new Set(greetingKeys("first"));
    expect(greetingKeys("returning").some((key) => first.has(key))).toBe(false);
  });

  // A first visit is never a return (the welcome page's greeting).
  it("says nothing of coming back on a first visit, in either language", () => {
    for (const key of greetingKeys("first")) {
      expect(lookup(en, key)).not.toMatch(/\b(back|again)\b/i);
      expect(lookup(it_, key)).not.toMatch(
        /ritrov|rivederti|ripart|di nuovo|bentornat/i,
      );
    }
  });
});
