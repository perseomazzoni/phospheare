// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import AiVerifyAnswer from "./AiVerifyAnswer";
import AiTurn from "./AiTurn";
import { turnAsText } from "./turnText";
import type { TFunction } from "i18next";
import { VERDICT_MARK, wikipediaLimited } from "./verifyAnswer";
import {
  CLAIM_VERDICTS,
  type ChatTurn,
  type ClaimVerdict,
  type VerifyOutcome,
  type WebSearchRecord,
} from "../../ai/domain/types";
import {
  NO_WEB_CITATIONS,
  webCitations,
  type CitedSource,
} from "../../ai/domain/webCitations";
import { appIcons } from "../../ui/appIcons";

// Pins a `/verify` answer: the verdict line, the Wikipedia hint, the
// reasoning, the sources with their quotes and the fix, in that order, and
// nothing of a verdict on a check that has none.

vi.mock("react-i18next", () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

afterEach(() => {
  cleanup();
});

const WIKI: WebSearchRecord = {
  callId: "c1",
  engine: { kind: "wikipedia" },
  status: "searched",
  query: "eiffel tower completed",
  results: [
    {
      id: "web:1",
      url: "https://en.wikipedia.org/wiki/Eiffel_Tower",
      title: "Eiffel Tower",
    },
    {
      id: "web:2",
      url: "https://it.wikipedia.org/wiki/Torre_Eiffel",
      title: "Torre Eiffel",
    },
  ],
};

const WEB: WebSearchRecord = {
  callId: "c2",
  engine: { kind: "provider", providerId: "openrouter" },
  status: "searched",
  query: "eiffel tower 1889",
  results: [
    { id: "web:3", url: "https://www.example.org/tower", title: "The tower" },
  ],
};

const FAILED_WEB: WebSearchRecord = {
  callId: "c3",
  engine: { kind: "provider", providerId: "openrouter" },
  status: "failed",
  query: "eiffel tower",
  code: "connection",
  reached: "unknown",
};

function judgedOutcome(
  verdict: ClaimVerdict,
  over: Partial<Extract<VerifyOutcome, { verdict: ClaimVerdict }>> = {},
): VerifyOutcome {
  return {
    verdict,
    sources: [
      {
        id: "web:1",
        stance: "contradicts",
        quote: "completed in 1889 for the fair",
      },
    ],
    ...over,
  };
}

function cited(...ids: string[]): CitedSource[] {
  const all = [...(WIKI.status === "searched" ? WIKI.results : [])];
  return ids.map((id, index) => {
    const result = all.find((one) => one.id === id);
    return {
      id,
      url: result?.url ?? "https://example.org/",
      title: result?.title ?? id,
      site: new URL(result?.url ?? "https://example.org/").hostname,
      n: index + 1,
    };
  });
}

const READING = <div className="dock-read">The reasoning.</div>;

function show(
  verified: VerifyOutcome,
  records: readonly WebSearchRecord[] = [WIKI],
  rows: readonly CitedSource[] = cited("web:1"),
) {
  return render(
    <div className="msg-body">
      <AiVerifyAnswer
        verified={verified}
        records={records}
        cited={rows}
        reading={READING}
      />
    </div>,
  );
}

const body = () => document.querySelector(".msg-body") as HTMLElement;
const $ = (selector: string) => document.querySelector(selector);

/** `a` comes before `b` in the document. */
function before(a: Element | null, b: Element | null) {
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(
    (a as Element).compareDocumentPosition(b as Element) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

describe("AiVerifyAnswer", () => {
  it("reads verdict, hint, reasoning, sources, then the fix", () => {
    show(
      judgedOutcome("inconclusive", {
        fix: "Say it opened in 1889.",
      }),
    );
    before($("p.ai-lede.ai-verdict"), $(".ai-verify > p.dock-hint"));
    before($(".ai-verify > p.dock-hint"), $(".dock-read"));
    before($(".dock-read"), $("ol.ai-web-sources"));
    before($("ol.ai-web-sources"), $(".ai-findings > .ai-finding"));
    // The fix after the list, with nothing after it: a rewording no source
    // backs never sits among the rows that are sourced.
    expect(body().lastElementChild?.matches(".ai-findings")).toBe(true);
    // The hint sits inside the verdict's block, 4px under it; the reasoning
    // follows the block, where `.ai-verify + .dock-read` spaces it.
    expect($(".ai-verify")?.nextElementSibling?.matches(".dock-read")).toBe(
      true,
    );
  });

  it("marks each verdict through one closed lookup", () => {
    const drawn: Record<string, [string, string]> = {};
    for (const verdict of CLAIM_VERDICTS) {
      show(judgedOutcome(verdict), [WEB], []);
      const mark = $(".ai-verdict > svg.ai-mark");
      expect(mark?.getAttribute("aria-hidden")).toBe("true");
      expect(mark?.getAttribute("width")).toBe("12");
      const degree = [...(mark?.classList ?? [])].find((one) =>
        one.startsWith("is-"),
      );
      drawn[verdict] = [degree ?? "", VERDICT_MARK[verdict].icon];
      cleanup();
    }
    expect(drawn).toEqual({
      plausible: ["is-full", appIcons.verdictPlausible],
      doubtful: ["is-partly", appIcons.verdictDoubtful],
      implausible: ["is-none", appIcons.verdictImplausible],
      inconclusive: ["is-unsettled", appIcons.verdictUnsettled],
    });
    // "Can't tell" never reads as "implausible" by its glyph either.
    expect(appIcons.verdictUnsettled).not.toBe(appIcons.verdictImplausible);
  });

  it("says the verdict in the word it shows, and nothing else", () => {
    show(judgedOutcome("doubtful"), [WEB], []);
    const line = $(".ai-verdict") as HTMLElement;
    expect(line.querySelector("strong")?.textContent).toBe(
      "dock.verify.verdict.doubtful",
    );
    expect(line.textContent).toBe("dock.verify.verdict.doubtful");
    expect(line.querySelector("[aria-label]")).toBeNull();
    expect(line.hasAttribute("aria-label")).toBe(false);
  });

  it("gives an unjudged check one line and nothing a verdict carries", () => {
    for (const why of ["unchecked", "nothing-found"] as const) {
      show({ unjudged: why }, [FAILED_WEB], cited("web:1"));
      const verify = $(".ai-verify") as HTMLElement;
      expect(verify.children).toHaveLength(1);
      expect(verify.firstElementChild?.matches("p.ai-lede")).toBe(true);
      expect(verify.firstElementChild?.classList.contains("ai-verdict")).toBe(
        false,
      );
      expect(verify.textContent).toBe(`dock.verify.unjudged.${why}`);
      expect(body().children).toHaveLength(1);
      expect(body().querySelector("svg")).toBeNull();
      expect(body().querySelector(".dock-read")).toBeNull();
      expect(body().querySelector(".ai-web-sources")).toBeNull();
      expect(body().querySelector(".ai-findings")).toBeNull();
      expect(body().querySelector("button, a")).toBeNull();
      cleanup();
    }
  });

  it("writes the fix as the characters it is", () => {
    const fix = "See web:1 and [the page](https://evil.example/) **now**.";
    show(judgedOutcome("implausible", { fix }));
    const finding = $(".ai-findings > .ai-finding") as HTMLElement;
    expect(finding.querySelector(".ai-finding-head")?.textContent).toBe(
      "dock.verify.fix",
    );
    const text = finding.querySelector("p.ai-finding-body");
    expect(text?.textContent).toBe(fix);
    expect(text?.childNodes).toHaveLength(1);
    expect(text?.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(finding.querySelector("a, button, strong, .ai-web-mark")).toBeNull();
  });

  it("draws no fix when there is none", () => {
    show(judgedOutcome("plausible"));
    expect($(".ai-findings")).toBeNull();
    expect(body().lastElementChild?.matches("ol.ai-web-sources")).toBe(true);
  });

  it("never counts its sources", () => {
    // Two rows for one page must never read as corroboration: no number
    // but the rows' own ordinals appears anywhere on the answer.
    const twin = cited("web:1", "web:2");
    show(
      judgedOutcome("plausible", {
        sources: [
          { id: "web:1", stance: "supports", quote: "completed in 1889" },
          { id: "web:2", stance: "supports", quote: "completata nel 1889" },
        ],
      }),
      [WIKI],
      twin,
    );
    const outside = [...body().childNodes]
      .filter((node) => !(node as Element).matches?.("ol.ai-web-sources"))
      .map((node) => node.textContent)
      .join(" ");
    expect(outside).not.toMatch(/\d/);
    expect(body().textContent).not.toMatch(/count/);
    expect(
      [...document.querySelectorAll(".ai-web-n")].map((n) => n.textContent),
    ).toEqual(["1", "2"]);
  });

  it("hangs each quote under its own row", () => {
    show(
      judgedOutcome("doubtful", {
        sources: [
          { id: "web:2", stance: "context", quote: "completata nel 1889" },
          { id: "web:1", stance: "contradicts" },
        ],
      }),
      [WIKI],
      cited("web:1", "web:2"),
    );
    const rows = [...document.querySelectorAll(".ai-web-sources > li")];
    expect(rows[0]?.querySelector(".ai-web-quote")).toBeNull();
    expect(rows[1]?.querySelector(".ai-web-quote bdi")?.textContent).toBe(
      "completata nel 1889",
    );
    expect(
      rows[1]?.querySelector(".ai-web-quote bdi")?.getAttribute("lang"),
    ).toBe("it");
  });
});

describe("the Wikipedia hint", () => {
  // Exhaustive over verdict × the engines of the check × judged or not. Only
  // an inconclusive verdict whose searches came back from Wikipedia alone,
  // in a check that holds no provider record at all, shows the hint.
  // Connecting OpenRouter is the hint's next step, and any provider record,
  // searched, failed or declined, means the writer already has.
  const ENGINES: Record<string, readonly WebSearchRecord[]> = {
    wikipedia: [WIKI],
    "wikipedia after a failed provider attempt": [FAILED_WEB, WIKI],
    "wikipedia after a declined provider search": [
      {
        callId: "c5",
        engine: { kind: "provider", providerId: "openrouter" },
        status: "declined",
      },
      WIKI,
    ],
    web: [WEB],
    mixed: [WIKI, WEB],
    none: [FAILED_WEB],
  };
  const hinted = () =>
    document.querySelector(".ai-verify > p.dock-hint")?.textContent ?? null;

  it("appears only on can't-tell from Wikipedia alone", () => {
    const seen: string[] = [];
    for (const [engines, records] of Object.entries(ENGINES)) {
      for (const verdict of CLAIM_VERDICTS) {
        show(judgedOutcome(verdict), records, []);
        const hint = hinted();
        expect(wikipediaLimited(judgedOutcome(verdict), records)).toBe(
          hint !== null,
        );
        if (hint !== null) {
          expect(hint).toBe("dock.verify.wikipediaLimit");
          seen.push(`${verdict} / ${engines}`);
        }
        cleanup();
      }
      for (const why of ["unchecked", "nothing-found"] as const) {
        show({ unjudged: why }, records, []);
        expect(hinted()).toBeNull();
        expect(wikipediaLimited({ unjudged: why }, records)).toBe(false);
        cleanup();
      }
    }
    expect(seen).toEqual(["inconclusive / wikipedia"]);
  });
});

// ── In the turn ──────────────────────────────────────────────────────────────

function answer(over: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: "a1",
    role: "assistant",
    text: "The sources say 1889 web:1.",
    createdAt: "2026-09-27T00:00:00.000Z",
    outcome: "complete",
    verifies: true,
    verified: judgedOutcome("implausible", { fix: "It opened in 1889." }),
    web: [WIKI],
    ...over,
  };
}

function mountTurn(one: ChatTurn, { live = false }: { live?: boolean } = {}) {
  return render(
    <AiTurn
      turn={one}
      agentName={null}
      running={live}
      live={live}
      status={live ? { shown: "dock.verify.judging" } : undefined}
      titles={new Map()}
      web={
        webCitations([one], live ? one.id : undefined).get(one.id) ??
        NO_WEB_CITATIONS
      }
      pendingReview={null}
      onFindingStatus={vi.fn()}
      onShowEvidence={vi.fn()}
      onOpenSource={vi.fn()}
      onResumeReview={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
}

describe("a /verify answer in its turn", () => {
  it("draws the verdict inside the body, the reasoning's markers numbered by its rows", () => {
    mountTurn(answer());
    const body = document.querySelector(".msg-body") as HTMLElement;
    expect(body.firstElementChild?.matches(".ai-verify")).toBe(true);
    expect(body.querySelector(".dock-read")?.textContent).toContain(
      "The sources say 1889",
    );
    expect(body.querySelectorAll(".dock-read .ai-web-mark")).toHaveLength(1);
    expect(
      [...body.querySelectorAll(".ai-web-sources .ai-web-n")].map(
        (n) => n.textContent,
      ),
    ).toEqual(["1"]);
    expect(body.querySelector(".ai-web-quote bdi")?.textContent).toBe(
      "completed in 1889 for the fair",
    );
    // One body, one list: the chat body is not drawn beside it.
    expect(document.querySelectorAll(".msg-body")).toHaveLength(1);
    expect(document.querySelectorAll(".ai-web-sources")).toHaveLength(1);
  });

  it("lists a source the reasoning never named, after those it did", () => {
    mountTurn(
      answer({
        text: "Only the Italian page settles it web:2.",
        verified: judgedOutcome("doubtful", {
          sources: [
            { id: "web:1", stance: "context" },
            {
              id: "web:2",
              stance: "contradicts",
              quote: "completata nel 1889",
            },
          ],
        }),
      }),
    );
    expect(
      [...document.querySelectorAll(".ai-web-sources li")].map((row) => [
        row.querySelector(".ai-web-n")?.textContent,
        row.querySelector("a")?.getAttribute("href"),
      ]),
    ).toEqual([
      ["1", "https://it.wikipedia.org/wiki/Torre_Eiffel"],
      ["2", "https://en.wikipedia.org/wiki/Eiffel_Tower"],
    ]);
  });

  it("draws no verdict, mark or failure while the check runs", () => {
    // Exhaustive over what a running check can hold: the placeholder, and a
    // stored outcome (a Retry's replaced turn is a new turn, but a live
    // render must never trust a block it is still writing).
    for (const stored of [
      answer({ outcome: "interrupted", text: "", verified: undefined }),
      answer({
        outcome: "interrupted",
        text: "",
        verified: { unjudged: "unchecked" },
      }),
      answer({ outcome: "interrupted" }),
    ]) {
      mountTurn(stored, { live: true });
      expect(document.querySelector(".ai-verify")).toBeNull();
      expect(document.querySelector(".ai-mark")).toBeNull();
      expect(document.querySelector(".msg-body")).toBeNull();
      expect(document.querySelector(".ui-banner")).toBeNull();
      expect(document.body.textContent).not.toContain("dock.stopped");
      cleanup();
    }
  });

  it("draws no mark on a check that stopped or failed, only its banner", () => {
    for (const [outcome, errorCode] of [
      ["interrupted", "cancelled"],
      ["interrupted", "interrupted"],
      ["failed", "invalid-response"],
    ] as const) {
      mountTurn(answer({ outcome, errorCode, text: "", verified: undefined }));
      expect(document.querySelector(".ai-verify")).toBeNull();
      expect(document.querySelector("svg.ai-mark")).toBeNull();
      expect(document.querySelector(".msg-body")).toBeNull();
      expect(document.querySelector(".ui-banner")).not.toBeNull();
      cleanup();
    }
  });

  it("shows every attempt in the trace on an unchecked answer", () => {
    mountTurn(
      answer({
        text: "Claim not checked: no search came back.",
        verified: { unjudged: "unchecked" },
        web: [
          FAILED_WEB,
          { callId: "c4", engine: { kind: "wikipedia" }, status: "declined" },
        ],
      }),
    );
    expect(document.querySelector(".ai-verify")?.textContent).toBe(
      "dock.verify.unjudged.unchecked",
    );
    // The model's line is never the writer's.
    expect(document.body.textContent).not.toContain("Claim not checked");
    const trace = document.querySelector(".ai-trace") as HTMLElement;
    const summary = trace.querySelector("summary");
    if (summary) summary.click();
    const said = trace.textContent ?? "";
    expect(said).toContain("dock.web.failed");
    expect(said).toContain("dock.web.declined");
  });
});

describe("a quote under an earlier answer's source (security C4)", () => {
  // The walk's `cited` also holds an earlier answer's source when the
  // reasoning names it; a verdict never rests on one, so a quote an edited
  // file hangs there is drawn nowhere, on screen or in Copy.
  const earlier: ChatTurn = {
    id: "a0",
    role: "assistant",
    text: "The tower web:1.",
    createdAt: "2026-09-27T00:00:00.000Z",
    outcome: "complete",
    web: [WIKI],
  };
  const planted = answer({
    text: "As the earlier answer said web:1.",
    web: [WEB],
    verified: judgedOutcome("plausible", {
      sources: [
        { id: "web:1", stance: "supports", quote: "planted words here" },
      ],
    }),
  });

  it("draws the row the reasoning names, and no quote under it", async () => {
    const entry =
      webCitations([earlier, planted]).get(planted.id) ?? NO_WEB_CITATIONS;
    expect(entry.cited.map((one) => one.id)).toEqual(["web:1"]);
    render(
      <AiTurn
        turn={planted}
        agentName={null}
        running={false}
        titles={new Map()}
        web={entry}
        pendingReview={null}
        onFindingStatus={vi.fn()}
        onShowEvidence={vi.fn()}
        onOpenSource={vi.fn()}
        onResumeReview={vi.fn()}
      />,
    );
    expect(document.querySelectorAll(".ai-web-sources li")).toHaveLength(1);
    expect(document.querySelector(".ai-web-quote")).toBeNull();
    expect(document.body.textContent).not.toContain("planted words here");
    const { turnAsText } = await import("./turnText");
    const copied = turnAsText(planted, {
      titles: new Map(),
      web: entry,
      t: ((key: string) => key) as never,
      offersMap: true,
    });
    expect(copied).not.toContain("planted words here");
  });
});

// ── Defects pinned in the answer ─────────────────────────────────────────────

describe("defects in the /verify answer", () => {
  const plainT = ((key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${String(values.text)})` : key) as unknown as TFunction;

  it("shows and copies no verdict on a check whose stored outcome did not complete", () => {
    // A chat file can hold a settled block beside an ending that is not
    // `complete`, because the codec checks the block alone. An interrupted
    // or failed `/verify` draws no mark, and Copy is the screen in words, so
    // it offers no verdict either.
    for (const [outcome, errorCode] of [
      ["interrupted", "interrupted"],
      ["interrupted", "cancelled"],
      ["failed", "invalid-response"],
    ] as const) {
      const stored = answer({ outcome, errorCode });
      mountTurn(stored);
      expect(document.querySelector(".ai-verify")).toBeNull();
      expect(document.querySelector("svg.ai-mark")).toBeNull();
      expect(document.querySelector(".ui-banner")).not.toBeNull();
      expect(
        turnAsText(stored, {
          titles: new Map(),
          web: webCitations([stored]).get(stored.id) ?? NO_WEB_CITATIONS,
          t: plainT,
          offersMap: true,
        }),
      ).toBeNull();
      cleanup();
    }
  });
});
