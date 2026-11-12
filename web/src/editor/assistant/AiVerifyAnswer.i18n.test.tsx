// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
//
// Pins a `/verify` answer against the real i18next instance and both locale
// files, for what the mocked suite cannot see: a raw key, a verdict word too
// long for its one line, a quote whose marks are not the language's, and
// third-party text that the real interpolation might turn into markup.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import i18n from "i18next";
import type { TFunction } from "i18next";
import { initI18n } from "../../locales/i18n";
import AiTurn from "./AiTurn";
import { turnAsText } from "./turnText";
import en from "../../locales/en.json";
import itLocale from "../../locales/it.json";
import {
  CLAIM_VERDICTS,
  type ChatTurn,
  type WebSearchRecord,
} from "../../ai/domain/types";
import { NO_WEB_CITATIONS, webCitations } from "../../ai/domain/webCitations";

beforeAll(async () => {
  await initI18n();
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

const HOSTILE_QUOTE = `<img src=x onerror=alert(1)> javascript:alert(1) {{text}}`;
const HOSTILE_FIX = `<a href="javascript:alert(1)">click</a> web:1 [x](https://evil.example/)`;

const RECORD: WebSearchRecord = {
  callId: "c1",
  engine: { kind: "wikipedia" },
  status: "searched",
  query: "eiffel tower",
  results: [
    {
      id: "web:1",
      url: "https://it.wikipedia.org/wiki/Torre_Eiffel",
      title: "Torre Eiffel",
    },
  ],
};

function answer(over: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: "a1",
    role: "assistant",
    text: "Le fonti dicono 1889 web:1.",
    createdAt: "2026-09-27T00:00:00.000Z",
    outcome: "complete",
    verifies: true,
    verified: {
      verdict: "inconclusive",
      sources: [{ id: "web:1", stance: "context", quote: HOSTILE_QUOTE }],
      fix: HOSTILE_FIX,
    },
    web: [RECORD],
    ...over,
  };
}

const entry = (one: ChatTurn) =>
  webCitations([one]).get(one.id) ?? NO_WEB_CITATIONS;

function mount(one: ChatTurn) {
  return render(
    <AiTurn
      turn={one}
      agentName={null}
      running={false}
      titles={new Map()}
      web={entry(one)}
      pendingReview={null}
      onFindingStatus={() => undefined}
      onShowEvidence={() => undefined}
      onOpenSource={() => undefined}
      onResumeReview={() => undefined}
    />,
  );
}

describe("a /verify answer on the real i18n", () => {
  it("says every word from the locale file, in each language", async () => {
    for (const [lng, file] of [
      ["en", en],
      ["it", itLocale],
    ] as const) {
      await i18n.changeLanguage(lng);
      mount(answer());
      expect(document.querySelector(".ai-verdict strong")?.textContent).toBe(
        file.dock.verify.verdict.inconclusive,
      );
      expect(
        document.querySelector(".ai-verify > .dock-hint")?.textContent,
      ).toBe(file.dock.verify.wikipediaLimit);
      expect(document.querySelector(".ai-finding-head")?.textContent).toBe(
        file.dock.verify.fix,
      );
      expect(document.body.textContent).not.toMatch(/dock\.verify\./);
      cleanup();
      for (const why of ["unchecked", "nothing-found"] as const) {
        mount(answer({ verified: { unjudged: why } }));
        expect(document.querySelector(".ai-verify")?.textContent).toBe(
          file.dock.verify.unjudged[why],
        );
        cleanup();
      }
    }
  });

  it("writes a hostile quote and fix as their characters", () => {
    mount(answer());
    const quote = document.querySelector(".ai-web-quote bdi");
    expect(quote?.textContent).toBe(HOSTILE_QUOTE);
    expect(document.querySelector(".ai-finding-body")?.textContent).toBe(
      HOSTILE_FIX,
    );
    // Nothing the third party wrote became an element: the only image is
    // none, and the only links are the source row's own.
    expect(document.querySelector("img")).toBeNull();
    expect(
      [...document.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ).toEqual(["https://it.wikipedia.org/wiki/Torre_Eiffel"]);
    expect(document.querySelector('[href^="javascript"]')).toBeNull();
    expect(document.querySelector("[onerror]")).toBeNull();
  });

  it("keeps each verdict word to one line's budget and the eyebrow to its own", () => {
    // At most 24 characters, so the word stays on one line at 280px;
    // the fix eyebrow at most 16. Counted in code points, as a reader sees.
    for (const file of [en, itLocale]) {
      for (const verdict of CLAIM_VERDICTS)
        expect(
          [...file.dock.verify.verdict[verdict]].length,
        ).toBeLessThanOrEqual(24);
      expect([...file.dock.verify.fix].length).toBeLessThanOrEqual(16);
    }
  });
});

describe("a /verify answer's Copy on the real i18n", () => {
  const copy = (one: ChatTurn) =>
    turnAsText(one, {
      titles: new Map(),
      web: entry(one),
      t: i18n.t.bind(i18n) as TFunction,
      offersMap: true,
    });

  it("is the screen in words, the quote in the language's marks", async () => {
    const one = answer({
      verified: {
        verdict: "inconclusive",
        sources: [
          { id: "web:1", stance: "context", quote: "completata nel 1889" },
        ],
        fix: "Scrivi che fu inaugurata nel 1889.",
      },
    });
    await i18n.changeLanguage("it");
    expect(copy(one)).toBe(
      [
        `${itLocale.dock.verify.verdict.inconclusive}\n${itLocale.dock.verify.wikipediaLimit}`,
        // The marker as chat's Copy writes one (`plainOf`).
        "Le fonti dicono 1889[1].",
        // Italian quotes with “ ” too, so both languages quote with the same
        // marks.
        "[1] Torre Eiffel · https://it.wikipedia.org/wiki/Torre_Eiffel\n    “completata nel 1889”",
        `${itLocale.dock.verify.fix}\nScrivi che fu inaugurata nel 1889.`,
      ].join("\n\n"),
    );
    await i18n.changeLanguage("en");
    expect(copy(one)).toContain("\n    “completata nel 1889”");
    expect(copy(one)?.startsWith(en.dock.verify.verdict.inconclusive)).toBe(
      true,
    );
  });

  it("never interpolates the quote a second time", () => {
    // A quote is third-party text: `{{text}}` inside it stays those
    // characters (i18next's `skipOnVariables`).
    const text = copy(answer()) ?? "";
    expect(text).toContain(`“${HOSTILE_QUOTE}”`);
  });

  it("is an unjudged check's one line", async () => {
    await i18n.changeLanguage("it");
    expect(copy(answer({ verified: { unjudged: "nothing-found" } }))).toBe(
      itLocale.dock.verify.unjudged["nothing-found"],
    );
  });
});
