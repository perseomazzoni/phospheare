// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import i18next, { type TFunction } from "i18next";
import en from "../../locales/en.json";
import it_ from "../../locales/it.json";
import { webPhrase } from "./runStatus";
import { interpolation } from "../../locales/i18nOptions";

// The query slot on the real i18next and the shipped locales: under the
// house's key-echo mock no slot is drawn, the query never renders, and a test
// that it stays inert passes without testing anything.
let t: TFunction;
let tIt: TFunction;
beforeAll(async () => {
  const one = i18next.createInstance();
  await one.init({
    resources: { en: { translation: en }, it: { translation: it_ } },
    lng: "en",
    fallbackLng: "en",
    interpolation,
  });
  t = one.getFixedT("en");
  tIt = one.getFixedT("it");
});
afterEach(cleanup);

// A query built to look like everything it must not become: an
// interpolation, the slot's own name, the private mark, markup and a
// right-to-left override.
const MARK = String.fromCharCode(1);
const HOSTILE = [
  "{{query}}",
  "{{engine}} {{count}}",
  `${MARK}query${MARK}`,
  "<b>bold</b> <img src=x onerror=alert(1)>",
  `${String.fromCharCode(0x202e)}Porta Pia`,
  "$t(dock.web.search)",
  // The locked path's own string: `Trans`'s index-tag syntax, which
  // renders as literal text here because nothing parses it.
  "<0>x</0><strong>y</strong>{{z}}",
];

function drawn(node: ReturnType<typeof webPhrase>) {
  const { container } = render(<p>{node}</p>);
  return container.firstElementChild as HTMLElement;
}

describe("webPhrase: the query is a child, never a value", () => {
  for (const tense of ["did", "failed"] as const)
    for (const engine of ["wikipedia", "web"] as const)
      for (const query of HOSTILE)
        it(`${tense} · ${engine} · ${JSON.stringify(query)}`, () => {
          for (const translate of [t, tIt]) {
            const phrase = drawn(webPhrase(translate, tense, engine, query));
            // Exactly one element under the phrase: the quote and its bdi.
            const elements = phrase.querySelectorAll("*");
            expect([...elements].map((one) => one.tagName)).toEqual([
              "Q",
              "BDI",
            ]);
            // The query, literally, as the bdi's only text.
            expect(phrase.querySelector("q > bdi")?.textContent).toBe(query);
            // And the sentence around it is the locale's, with the slot
            // filled once: no mark, no brace, no second copy.
            const around = phrase.textContent?.replace(query, "") ?? "";
            expect(around).not.toContain(MARK);
            expect(around).not.toContain("{{");
            expect(around.length).toBeGreaterThan(0);
          }
        });

  it("keeps the locale's words either side of the query", () => {
    const phrase = drawn(webPhrase(t, "did", "wikipedia", "Porta Pia"));
    expect(phrase.textContent).toBe("Searched Wikipedia for Porta Pia");
  });
});
