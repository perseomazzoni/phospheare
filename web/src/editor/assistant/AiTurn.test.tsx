// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  NO_WEB_CITATIONS,
  type WebCitations,
} from "../../ai/domain/webCitations";
import { webCitations } from "../../ai/domain/webCitations";
import AiTurn from "./AiTurn";
import { markdown } from "../components/safeMarkdown";
import type { KeyVerdict } from "./keyVerdict";
import type { ChatTurn } from "../../ai/domain/types";
import { parseChat } from "../../ai/adapters/chatCodec";

vi.mock("react-i18next", () => {
  // One `t` for every render, as react-i18next's own is while the language
  // holds. A fresh one per render makes every memo keyed on `t` recompute on
  // every render, so no row could see a memo work, or see it drop a key.
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function turn(over: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: "t1",
    role: "assistant",
    text: "An answer.",
    createdAt: "2026-09-16T00:00:00.000Z",
    outcome: "complete",
    ...over,
  };
}

/** The live catalogue the panel would hand down: ids to titles. */
const TITLES: ReadonlyMap<string, string> = new Map([
  ["node:S1", "Opening"],
  ["node:S2", "Scene two"],
]);

function mount(
  one: ChatTurn,
  agentName: string | null = null,
  handlers: {
    onRetry?: (id: string) => void;
    onRenew?: (id: string) => void;
    onEdit?: (id: string, text: string) => boolean;
    onOpenSource?: (id: string) => void;
    keyVerdict?: KeyVerdict;
    live?: boolean;
    status?: { shown: string | null };
    titles?: ReadonlyMap<string, string>;
    web?: WebCitations;
  } = {},
) {
  return render(
    <AiTurn
      turn={one}
      agentName={agentName}
      running={handlers.live ?? false}
      live={handlers.live}
      status={handlers.status}
      titles={handlers.titles ?? TITLES}
      web={handlers.web ?? NO_WEB_CITATIONS}
      pendingReview={null}
      onFindingStatus={vi.fn()}
      onShowEvidence={vi.fn()}
      onOpenSource={handlers.onOpenSource ?? vi.fn()}
      onResumeReview={vi.fn()}
      onRetry={handlers.onRetry}
      onRenew={handlers.onRenew}
      onEdit={handlers.onEdit}
      keyVerdict={handlers.keyVerdict}
    />,
  );
}

const meta = () => document.querySelector(".ai-turn-meta");
const facts = () => document.querySelector(".ai-turn-facts");
const caret = () => document.querySelector(".ai-turn-caret");

/** Two hours after the fixture's stamp, so "ago" has one stable answer. */
function atTwoHoursLater() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T02:00:00.000Z"));
}

// The component resolves nothing: `agentName` arrives as a prop, already
// looked up by the panel. Naming one of the voices the application ships
// would tie this file to a folder it never reads.
const AGENT_ID = "persona-fixture";
const AGENT_NAME = "The Voice";

const SOURCE = {
  id: "node:S1",
  kind: "manuscript",
  title: "Opening",
  path: "/document/opening.md",
  authority: "manuscript",
  reason: "default",
  coverage: "full-text",
  characters: 100,
  origin: "project-file",
} as const;

describe("AiTurn", () => {
  it("puts no eyebrow over the writer's message", () => {
    // An eyebrow over the writer's bubble labels a distinction the layout
    // already makes, and costs a line above every turn.
    mount(turn({ role: "user", text: "A question." }));
    expect(document.querySelector(".msg-who")).toBeNull();
    expect(screen.queryByText("dock.you")).toBeNull();
  });

  it("names the agent from the id, never from the record", () => {
    // The turn carries `{ id, revision }` and no name at all, so a rename
    // reaches every message the persona ever wrote.
    mount(turn({ personaId: AGENT_ID }), AGENT_NAME);
    expect(meta()?.textContent).toContain(AGENT_NAME);
  });

  it("says something rather than nothing for a persona that is gone", () => {
    // A persona whose file has since been renamed or removed still answered;
    // an empty gap where a name belongs reads as a bug rather than as history.
    mount(turn({ personaId: "ghost" }), null);
    expect(meta()?.textContent).toContain("dock.assistant");
    expect(meta()?.textContent?.trim()).not.toBe("");
  });

  it("shows the line for a persona with no token count", () => {
    atTwoHoursLater();
    mount(turn({ personaId: AGENT_ID }), AGENT_NAME);
    expect(facts()?.textContent).toBe(`${AGENT_NAME} · 2 hours ago`);
  });

  it("names the cached part of the prompt when the provider reported one", () => {
    mount(
      turn({
        usage: {
          steps: 3,
          totalTokens: 1_100,
          inputTokens: 1_000,
          cachedInputTokens: 700,
          outputTokens: 100,
        },
      }),
    );
    expect(facts()?.textContent).toContain("dock.tokenUsageCached");
    expect(facts()?.textContent).toContain('"cached":"700"');
  });

  it("shows the line for a token count with no persona", () => {
    mount(turn({ usage: { steps: 1, totalTokens: 90, inputTokens: 60 } }));
    expect(facts()?.textContent).toContain("dock.tokenUsage");
    expect(facts()?.textContent).not.toContain("dock.assistant");
  });

  // ── The footer ─────────────────────────────────────────────────────────────

  it("puts every fact on one line, in one order", () => {
    // Who spoke, what it cost, what it read, what it could not reach, and
    // when. What it ran is the trace above the answer, so a count of calls
    // here would be the same fact twice.
    atTwoHoursLater();
    mount(
      turn({
        personaId: AGENT_ID,
        usage: { steps: 1, totalTokens: 90, inputTokens: 60, outputTokens: 30 },
        sources: [SOURCE],
        tools: [{ callId: "c1", name: "read", status: "ok" }],
        coverage: { intended: 2, inspected: 1, skipped: [], complete: false },
      }),
      AGENT_NAME,
    );
    const parts = (facts()?.textContent ?? "").split(" · ");
    expect(parts[0]).toBe(AGENT_NAME);
    expect(parts[1]).toContain("dock.tokenUsage");
    expect(parts[2]).toContain("dock.sourcesUsed");
    // The shortfall stays on the line rather than behind the fold: a run that
    // could not read what it meant to is the one receipt nobody would think
    // to go looking for.
    expect(parts[3]).toContain("dock.coverage");
    expect(parts[4]).toBe("2 hours ago");
    expect(facts()?.textContent).not.toContain("dock.toolsUsed");
  });

  it("stores the instant whole and shows it short", () => {
    // The relative reading is what a person wants; the exact one is the only
    // form that survives leaving this app, so it is the tooltip and not the
    // text. Forty messages each stamped with a full date is a log file.
    atTwoHoursLater();
    mount(turn({ personaId: AGENT_ID }), AGENT_NAME);
    const stamp = document.querySelector("time");
    expect(stamp?.getAttribute("datetime")).toBe("2026-09-16T00:00:00.000Z");
    expect(stamp?.textContent).toBe("2 hours ago");
    expect(stamp?.getAttribute("title")).toMatch(/2026/);
    expect(stamp?.getAttribute("title")).not.toBe(stamp?.textContent);
  });

  it("says nothing rather than something wrong for an unreadable stamp", () => {
    // A hand-edited chat file can carry anything, and a blank slot on a
    // dot-separated line reads as a missing fact rather than a bad one.
    mount(turn({ createdAt: "not-a-date", personaId: "m" }));
    expect(document.querySelector("time")).toBeNull();
    expect(facts()?.textContent).toBe("dock.assistant");
  });

  it("opens all of it behind ONE fold", () => {
    mount(
      turn({
        personaId: AGENT_ID,
        sources: [SOURCE],
        tools: [{ callId: "c1", name: "read", status: "ok" }],
        coverage: {
          intended: 2,
          inspected: 1,
          skipped: [{ sourceId: "node:S2", reason: "not-read" }],
          complete: false,
        },
      }),
      AGENT_NAME,
    );
    // Three folds for three lists is a filing cabinet: one row, one caret, one
    // panel holding what the turn read and what it could not reach. The calls
    // it made are the trace's, and every source is its title, never
    // an id such as `node:S2`.
    expect(document.querySelectorAll(".ai-turn-meta").length).toBe(1);
    expect(document.querySelectorAll("details.ai-turn-meta").length).toBe(1);
    expect(document.querySelectorAll(".ai-turn-caret").length).toBe(1);
    const detail = document.querySelector(".ai-turn-detail");
    expect(detail?.textContent).toContain("Opening");
    expect(detail?.textContent).toContain("Scene two");
    expect(detail?.textContent).not.toContain("node:S2");
    expect(detail?.textContent).not.toContain("dock.toolsUsed");
  });

  it("names a source the project no longer has without its id", () => {
    mount(
      turn({
        personaId: AGENT_ID,
        coverage: {
          intended: 1,
          inspected: 0,
          skipped: [{ sourceId: "node:GONE", reason: "not-read" }],
          complete: false,
        },
      }),
      AGENT_NAME,
    );
    const detail = document.querySelector(".ai-turn-detail");
    expect(detail?.textContent).toContain("dock.sourceGone");
    expect(detail?.textContent).not.toContain("node:GONE");
  });

  it("says why a source was skipped in words, never the code", () => {
    mount(
      turn({
        personaId: AGENT_ID,
        coverage: {
          intended: 2,
          inspected: 1,
          skipped: [{ sourceId: "node:S2", reason: "invalidated" }],
          complete: false,
        },
      }),
      AGENT_NAME,
    );
    const detail = document.querySelector(".ai-turn-detail");
    expect(detail?.textContent).toContain(
      "Scene two · dock.coverageSkip.invalidated",
    );
  });

  it("names a fact the check could not judge, and how many it never asked about", () => {
    mount(
      turn({
        personaId: AGENT_ID,
        coverage: {
          intended: 2,
          inspected: 2,
          skipped: [],
          complete: false,
          judgement: {
            candidates: 3,
            judged: 1,
            unjudged: [
              {
                key: "marta|job|doctor|teacher",
                entity: "Marta",
                attribute: "job",
                sourceIds: ["node:S1", "node:S2"],
              },
            ],
          },
        },
      }),
      AGENT_NAME,
    );
    // The fold opens on a review whose reading is whole and whose
    // judgement is not: the fact by name, where it stands, and the count
    // of what was never asked — neither of which is "no issues found".
    const detail = document.querySelector(".ai-turn-detail");
    expect(detail?.textContent).toContain(
      "Marta · job · Opening, Scene two · dock.coverageUnjudged",
    );
    expect(detail?.textContent).toContain("dock.coverageUnasked");
    expect(detail?.textContent).not.toContain("node:S1");
  });

  it("names the facts a check deferred, and counts only what it could not name", () => {
    mount(
      turn({
        personaId: AGENT_ID,
        coverage: {
          intended: 2,
          inspected: 2,
          skipped: [{ sourceId: "node:S1", reason: "unextracted" }],
          complete: false,
          judgement: {
            candidates: 45,
            judged: 40,
            unjudged: [],
            deferred: [
              {
                key: "marta|home|rome|milan",
                entity: "Marta",
                attribute: "home",
                sourceIds: ["node:S1", "node:S2"],
              },
            ],
          },
        },
      }),
      AGENT_NAME,
    );
    const detail = document.querySelector(".ai-turn-detail");
    // A fact the check held and did not reach, by name and place, told
    // apart from one the judge could not answer; and the count line names
    // only the four it could not list.
    expect(detail?.textContent).toContain(
      "Marta · home · Opening, Scene two · dock.coverageDeferred",
    );
    expect(detail?.textContent).not.toContain("dock.coverageUnjudged");
    expect(detail?.textContent).toContain("dock.coverageUnasked");
    expect(detail?.textContent).toContain("dock.coverageSkip.unextracted");
  });

  it("keeps a skipped row whose reason a hand-edited chat mangled", () => {
    // A chat is replayed from the writer's (possibly shared) folder with no
    // validation below the turn array, so the reason is whatever the file
    // says. Rendered raw, an object would crash the dock and a stray string
    // would print a key path. Both read as the fallback, and the row stays,
    // because dropping it would overstate how much the run inspected.
    const skipped = [
      { sourceId: "node:S1", reason: "banana" },
      { sourceId: "node:S2", reason: { x: 1 } },
    ] as unknown as NonNullable<ChatTurn["coverage"]>["skipped"];
    mount(
      turn({
        personaId: AGENT_ID,
        coverage: { intended: 2, inspected: 0, skipped, complete: false },
      }),
      AGENT_NAME,
    );
    const detail = document.querySelector(".ai-turn-detail");
    expect(detail?.textContent).toContain(
      "Opening · dock.coverageSkip.unknown",
    );
    expect(detail?.textContent).toContain(
      "Scene two · dock.coverageSkip.unknown",
    );
    expect(detail?.textContent).not.toContain("banana");
  });

  // The sources block above the coverage reasons reads the same unvalidated
  // turn: an object in `authority`, `coverage` or the captured `title`, or
  // an unknown `origin`, shows as nothing rather than throwing out of the
  // render, which has no error boundary above the dock.
  it("keeps a source row whose fields a hand-edited chat mangled", () => {
    const sources = [
      { ...SOURCE, authority: { x: 1 }, coverage: { y: 2 } },
      { ...SOURCE, id: "node:S2", origin: "banana" },
      { ...SOURCE, id: "node:GONE", title: { z: 3 } },
    ] as unknown as ChatTurn["sources"];
    mount(turn({ personaId: AGENT_ID, sources }), AGENT_NAME);
    const detail = document.querySelector(".ai-turn-detail");
    expect(detail?.textContent).toContain("Opening");
    expect(detail?.textContent).toContain("Scene two");
    expect(detail?.textContent).not.toContain("banana");
    expect(detail?.textContent).not.toContain("[object Object]");
  });

  it("gives a question no footer, only the row its pencil sits in", () => {
    // A question's one footer fact, its time, would repeat the answer's
    // footer a line below, and that row plus the pencil's would be most of
    // the ~75px between a question and its answer. Nothing a
    // question has is folded, so there is no button to nowhere.
    atTwoHoursLater();
    mount(turn({ role: "user", text: "A question." }), null, {
      onEdit: vi.fn(() => true),
    });
    expect(meta()).toBeNull();
    expect(caret()).toBeNull();
    expect(document.querySelector("time")).toBeNull();
    const row = document.querySelector(".msg-you-actions");
    expect(row?.querySelector("button")).toBeTruthy();
  });

  it("holds the pencil's row while the pencil is withheld", () => {
    // The row holds: a run starting withdraws the pencil, and a row that went
    // with it would pull the answer up under the writer's eyes.
    mount(turn({ role: "user", text: "A question.", createdAt: "" }));
    const row = document.querySelector(".msg-you-actions");
    expect(row).toBeTruthy();
    expect(row?.querySelector("button")).toBeNull();
  });

  it("answers a keyboard as well as a pointer", () => {
    // The row is revealed on hover and holds a real disclosure button. A
    // reveal only a pointer can summon is a control a keyboard can focus and
    // never see, which is why the stylesheet pairs `:hover` with
    // `:focus-within` and why the summary has to be focusable at all.
    mount(turn({ personaId: "m", sources: [SOURCE] }));
    const summary = document.querySelector<HTMLElement>(
      ".ai-turn-meta > summary",
    );
    expect(summary).toBeTruthy();
    summary?.focus();
    expect(document.activeElement).toBe(summary);
  });

  it("keeps the quoted selection apart from the question it was asked about", () => {
    mount(turn({ role: "user", text: "Tighten this", quote: "the sea" }));
    const quote = document.querySelector(".msg-quote");
    expect(quote?.textContent).toBe("the sea");
    expect(quote?.parentElement?.className).toBe("msg-body");
  });

  // ── The HTML seam ──────────────────────────────────────────────────────────
  //
  // These are the security regression tests for the one place in this app
  // where a model's output reaches the DOM as markup. `safeMarkdown`'s
  // settings are the primary control, and the build's
  // Content-Security-Policy is only a second layer behind them. Every
  // assertion below is a payload that an injected project source could steer
  // a model into emitting.

  it("renders an answer as markdown", () => {
    mount(turn({ text: "**bold** and *thin*" }));
    expect(
      document.querySelector(".msg-assistant .dock-read strong"),
    ).toBeTruthy();
    expect(document.querySelector(".msg-assistant .dock-read em")).toBeTruthy();
  });

  it("escapes model-authored HTML instead of running it", () => {
    mount(
      turn({ text: "<script>alert(1)</script><img src=x onerror=alert(1)>" }),
    );
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    // Escaped, not swallowed: the writer sees what the model wrote.
    expect(document.querySelector(".dock-read")?.textContent).toContain(
      "<script>alert(1)</script>",
    );
  });

  it("renders a javascript: link inert, as text", () => {
    mount(turn({ text: "[click](javascript:alert(1))" }));
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
    expect(document.querySelector(".dock-read a")).toBeNull();
    expect(document.querySelector(".dock-read")?.textContent).toContain(
      "click",
    );
  });

  it("refuses a data: URL too", () => {
    mount(turn({ text: "[x](data:text/html,<script>alert(1)</script>)" }));
    expect(document.querySelector(".dock-read a")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("never fetches an image the model chose", () => {
    // A remote image is a network request the writer never asked for, and a
    // read receipt for whoever hosts it. It degrades to its alt text.
    mount(turn({ text: "![a pixel](https://evil.example/pixel.png)" }));
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector(".dock-read")?.textContent).toContain(
      "a pixel",
    );
  });

  it("disowns and unendorses every link it does allow", () => {
    mount(turn({ text: "[docs](https://ok.example/)" }));
    const link = document.querySelector<HTMLAnchorElement>(".dock-read a");
    expect(link?.getAttribute("href")).toBe("https://ok.example/");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("leaves a writer's own question exactly as they typed it", () => {
    // `*maybe*` in a question is emphasis by typing; rendering it as italics
    // would silently edit what they said. It also keeps the HTML seam to one
    // role.
    mount(turn({ role: "user", text: "**not bold** and # not a heading" }));
    expect(document.querySelector(".msg-you .dock-read")).toBeNull();
    expect(document.querySelector(".msg-you strong")).toBeNull();
    expect(document.querySelector(".msg-you .msg-body")?.textContent).toBe(
      "**not bold** and # not a heading",
    );
  });

  it("never runs the quoted selection through the renderer", () => {
    mount(turn({ text: "An answer.", quote: "**the sea** was a wall" }));
    const quote = document.querySelector(".msg-quote");
    expect(quote?.textContent).toBe("**the sea** was a wall");
    expect(quote?.querySelector("strong")).toBeNull();
  });
});

/** A key's verdict; ready, with nothing to say, by default. */
function verdict(over: Partial<KeyVerdict> = {}): KeyVerdict {
  return {
    connected: true,
    state: "ready",
    notice: null,
    waitUntil: null,
    limitUsd: 5,
    ...over,
  };
}

describe("what a failed turn offers", () => {
  const failed = (over: Partial<ChatTurn> = {}) =>
    turn({
      outcome: "failed",
      runId: "r1",
      model: { providerId: "a-provider", modelId: "vendor/some-model" },
      ...over,
    });

  it("offers nothing at all on a turn that did not fail", () => {
    mount(turn(), null, { onRetry: vi.fn(), onRenew: vi.fn() });

    expect(screen.queryByText("dock.retry.again")).toBeNull();
  });

  it("offers a plain retry when the reason is not one it can act on", () => {
    // Most failures are this: offline, rate limited, the provider refusing.
    // The only offer that holds is to ask again.
    mount(failed({ errorCode: "connection" }), null, {
      onRetry: vi.fn(),
      onRenew: vi.fn(),
    });

    expect(screen.getByText("dock.retry.again")).toBeTruthy();
    expect(screen.queryByText("dock.retry.renew")).toBeNull();
  });

  it("offers the plain retry for a failure recorded before the reason was kept", () => {
    // A turn written before `errorCode` existed, or by a path that had no
    // code to give. The strip must still work — it is the same failure to the
    // writer, and a transcript that offers nothing on an old turn reads as a
    // broken button rather than as a missing field.
    mount(failed(), null, { onRetry: vi.fn(), onRenew: vi.fn() });

    expect(screen.getByText("dock.retry.again")).toBeTruthy();
    expect(screen.queryByText("dock.retry.renew")).toBeNull();
  });

  it("offers to mint a new key when that is what went wrong", () => {
    const onRenew = vi.fn();
    mount(failed({ errorCode: "key-expired" }), null, {
      onRetry: vi.fn(),
      onRenew,
    });

    screen.getByText("dock.retry.renew").click();

    // The provider that answered, taken off the turn. Nothing here knows a
    // vendor's name and nothing should.
    expect(onRenew).toHaveBeenCalledWith("a-provider");
  });

  it("does not offer to mint a key for a failure a new key will not fix", () => {
    // The two credential codes are two because the app can replace an
    // expired key but cannot add credit to somebody's account at a vendor.
    // A Renew button here would promise what it cannot do.
    mount(failed({ errorCode: "credit-exhausted" }), null, {
      onRetry: vi.fn(),
      onRenew: vi.fn(),
    });

    expect(screen.queryByText("dock.retry.renew")).toBeNull();
    // The reason, then the one thing only the writer can do about it.
    const said = document.querySelector(".ui-banner-attention")?.textContent;
    expect(said).toContain("dock.modelError.credit-exhausted");
    expect(said).toContain("dock.retry.creditExhausted");
    // Still retryable: the writer may go and top up in another tab.
    expect(screen.getByText("dock.retry.again")).toBeTruthy();
  });

  it("offers a new key when the key's own limit is spent", () => {
    // The limit bounds what a stolen key is worth, and every key lapses
    // within the hour, so a spent limit is remedied the way a lapsed key is,
    // with a new one, under its own words.
    const onRenew = vi.fn();
    mount(failed({ errorCode: "limit-reached" }), null, {
      onRetry: vi.fn(),
      onRenew,
    });

    const said = document.querySelector(".ui-banner-attention")?.textContent;
    expect(said).toContain("dock.modelError.limit-reached");
    // Not the vendor's remedy: nothing about adding credit.
    expect(said).not.toContain("dock.retry.creditExhausted");
    expect(screen.queryByText("dock.retry.renew")).toBeNull();
    // No reset handed down: waiting is not a real choice, so not offered.
    expect(said).not.toContain("dock.retry.waitForReset");
    screen.getByText("dock.retry.newKey").click();
    expect(onRenew).toHaveBeenCalledWith("a-provider");
  });

  it("offers waiting too, when the server says the key outlives the reset", () => {
    // Two ways on: a new key now (the button), or the same key
    // once its limit resets (the sentence). No Try again yet — pressed now
    // it would fail; it arrives when the verdict says the key can answer.
    mount(failed({ errorCode: "limit-reached" }), null, {
      onRetry: vi.fn(),
      onRenew: vi.fn(),
      keyVerdict: verdict({
        state: "limit-reached",
        waitUntil: "2026-09-24T00:00:00+00:00",
      }),
    });

    const said = document.querySelector(".ui-banner-attention")?.textContent;
    expect(said).toContain("dock.modelError.limit-reached");
    expect(said).toContain("dock.retry.waitForReset");
    expect(screen.getByText("dock.retry.newKey")).toBeTruthy();
    expect(screen.queryByText("dock.retry.again")).toBeNull();
  });

  it("never offers the wait on a failure that is not a spent limit", () => {
    // A reset date is about the limit, and only the limit: an expired key
    // does not come back by waiting.
    mount(failed({ errorCode: "key-expired" }), null, {
      onRenew: vi.fn(),
      keyVerdict: verdict({
        state: "expired",
        waitUntil: "2026-09-24T00:00:00+00:00",
      }),
    });
    expect(
      document.querySelector(".ui-banner-attention")?.textContent,
    ).not.toContain("dock.retry.waitForReset");
  });

  it("draws the remedy as the shared ember button, one per strip", () => {
    // The app's grammar for "recoverable, and blocking": the Library's
    // attention banner, whose one remedy is the shared `attention` variant.
    // Before the Renew, Try again fails every time, so the strip offers one
    // way out.
    mount(failed({ errorCode: "key-expired" }), null, {
      onRetry: vi.fn(),
      onRenew: vi.fn(),
      keyVerdict: verdict({ state: "expired" }),
    });

    const banner = document.querySelector(".msg .ui-banner-attention");
    expect(banner?.textContent).toContain("dock.modelError.key-expired");
    expect(
      screen
        .getByText("dock.retry.renew")
        .classList.contains("ui-btn-attention"),
    ).toBe(true);
    expect(screen.queryByText("dock.retry.again")).toBeNull();
    expect(banner?.querySelectorAll("button")).toHaveLength(1);
  });

  // ── One button, the one that works ─────────────────────────────────────────
  //
  // The strip offers the one remedy the key's verdict allows.

  it("offers only the Renew while the key cannot answer", () => {
    mount(failed({ errorCode: "key-expired" }), null, {
      onRetry: vi.fn(),
      onRenew: vi.fn(),
      keyVerdict: verdict({ state: "expired" }),
    });

    expect(screen.getByText("dock.retry.renew")).toBeTruthy();
    expect(screen.queryByText("dock.retry.again")).toBeNull();
  });

  it("offers Try again once the key can answer, and says so", () => {
    // Renewed since the failure: the verdict says the key is ready. The
    // failure's reason ("has expired, renew it") would contradict the button,
    // so the line says what is true now, and looks it: the strip turns quiet
    // and the button soft, so the writer need not read the sentence to learn
    // they can go ahead.
    const onRetry = vi.fn();
    mount(failed({ errorCode: "key-expired" }), null, {
      onRetry,
      onRenew: vi.fn(),
      keyVerdict: verdict({ state: "ready" }),
    });

    expect(document.querySelector(".msg .ui-banner-attention")).toBeNull();
    const banner = document.querySelector(".msg .ui-banner-quiet");
    expect(banner?.textContent).toContain("dock.retry.keyReady");
    expect(banner?.textContent).not.toContain("dock.modelError.key-expired");
    expect(screen.queryByText("dock.retry.renew")).toBeNull();
    const again = screen.getByText("dock.retry.again");
    expect(again.classList.contains("ui-btn-soft")).toBe(true);
    expect(again.classList.contains("ui-btn-sm")).toBe(true);
    again.click();
    expect(onRetry).toHaveBeenCalledWith("t1");
  });

  it("offers what the key needs now, even when it failed for another reason", () => {
    // The key lapsed; the one renewed since has already used its limit. A
    // Try again would fail every time, because what decides is what the key
    // can do now, so the turn says what is true of it and offers its remedy.
    mount(failed({ errorCode: "key-expired" }), null, {
      onRetry: vi.fn(),
      onRenew: vi.fn(),
      keyVerdict: verdict({ state: "limit-reached" }),
    });

    const banner = document.querySelector(".msg .ui-banner-attention");
    expect(banner?.textContent).toContain("dock.modelError.limit-reached");
    expect(screen.getByText("dock.retry.newKey")).toBeTruthy();
    expect(screen.queryByText("dock.retry.again")).toBeNull();
  });

  it("offers Try again once a spent limit has reset", () => {
    mount(failed({ errorCode: "limit-reached" }), null, {
      onRetry: vi.fn(),
      onRenew: vi.fn(),
      keyVerdict: verdict({ state: "ready" }),
    });

    expect(screen.getByText("dock.retry.again")).toBeTruthy();
    expect(screen.queryByText("dock.retry.newKey")).toBeNull();
  });

  it("offers the remedy when nothing is known about the key now", () => {
    // Disconnected since, or no verdict handed down: the connect popup is
    // right in every case, a Try again might not be.
    mount(failed({ errorCode: "key-expired" }), null, {
      onRetry: vi.fn(),
      onRenew: vi.fn(),
      keyVerdict: verdict({ connected: false, state: null }),
    });

    expect(screen.getByText("dock.retry.renew")).toBeTruthy();
    expect(screen.queryByText("dock.retry.again")).toBeNull();
  });

  it("says why in the writer's language, from the code, never from the text", () => {
    // A turn that failed before any prose arrived has empty text; the reason
    // is the locale's sentence for its code. It draws no body at all: an
    // empty bubble above the banner reads as an answer that failed to render.
    mount(failed({ text: "", errorCode: "connection" }), null, {
      onRetry: vi.fn(),
    });

    expect(
      document.querySelector(".ui-banner-attention")?.textContent,
    ).toContain("dock.modelError.connection");
    expect(document.querySelector(".msg-body")).toBeNull();
  });

  it("keeps the prose that did arrive, above the reason", () => {
    mount(failed({ text: "Half an answer", errorCode: "connection" }), null, {
      onRetry: vi.fn(),
    });

    expect(document.querySelector(".msg-body")?.textContent).toContain(
      "Half an answer",
    );
    expect(
      document.querySelector(".ui-banner-attention")?.textContent,
    ).toContain("dock.modelError.connection");
  });

  it("says the honest generic when there is no code to say", () => {
    // A bug of ours, or a turn recorded before codes were kept.
    mount(failed({ text: "" }), null, { onRetry: vi.fn() });

    expect(
      document.querySelector(".ui-banner-attention")?.textContent,
    ).toContain("dock.modelError.unknown");
  });

  it("makes Try again the ember remedy when it is the only one", () => {
    mount(failed({ errorCode: "connection" }), null, {
      onRetry: vi.fn(),
      onRenew: vi.fn(),
    });

    expect(
      screen
        .getByText("dock.retry.again")
        .classList.contains("ui-btn-attention"),
    ).toBe(true);
  });

  it("draws no retry while a run is going", () => {
    // The panel withholds the callback rather than disabling a button: a
    // retry would queue behind the running turn, which is right and looks
    // like nothing happening.
    mount(failed({ errorCode: "connection" }), null, { onRenew: vi.fn() });

    expect(screen.queryByText("dock.retry.again")).toBeNull();
  });

  it("asks again for the turn it belongs to", () => {
    const onRetry = vi.fn();
    mount(failed({ id: "the-failed-one", errorCode: "connection" }), null, {
      onRetry,
    });

    screen.getByText("dock.retry.again").click();

    expect(onRetry).toHaveBeenCalledWith("the-failed-one");
  });

  describe("editing a question in place", () => {
    const asked = () =>
      turn({
        id: "q1",
        role: "user",
        text: "Is it sharp?",
        quote: "the blade",
      });

    it("offers the pencil only when editing is possible", () => {
      mount(asked());
      expect(screen.queryByLabelText("dock.editQuestion")).toBeNull();
      cleanup();
      mount(asked(), null, { onEdit: vi.fn(() => true) });
      expect(screen.getByLabelText("dock.editQuestion")).toBeTruthy();
      cleanup();
      // Never on the assistant's own words.
      mount(turn(), null, { onEdit: vi.fn(() => true) });
      expect(screen.queryByLabelText("dock.editQuestion")).toBeNull();
    });

    it("rewrites the question in the bubble and sends it with Enter", () => {
      const onEdit = vi.fn(() => true);
      mount(asked(), null, { onEdit });
      fireEvent.click(screen.getByLabelText("dock.editQuestion"));

      const field = screen.getByRole("textbox", { name: "dock.editQuestion" });
      expect((field as HTMLTextAreaElement).value).toBe("Is it sharp?");
      // The passage stays shown: it rides with the edit.
      expect(screen.getByText("the blade")).toBeTruthy();
      fireEvent.change(field, { target: { value: "Is it sharp enough?" } });
      fireEvent.keyDown(field, { key: "Enter" });

      expect(onEdit).toHaveBeenCalledWith("q1", "Is it sharp enough?");
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("keeps Shift+Enter a line break, and Escape a way out", () => {
      const onEdit = vi.fn(() => true);
      mount(asked(), null, { onEdit });
      fireEvent.click(screen.getByLabelText("dock.editQuestion"));
      const field = screen.getByRole("textbox", { name: "dock.editQuestion" });

      fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
      expect(onEdit).not.toHaveBeenCalled();
      fireEvent.keyDown(field, { key: "Escape" });

      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.getByText("Is it sharp?")).toBeTruthy();
      expect(onEdit).not.toHaveBeenCalled();
    });

    it("will not send an empty question", () => {
      const onEdit = vi.fn(() => true);
      mount(asked(), null, { onEdit });
      fireEvent.click(screen.getByLabelText("dock.editQuestion"));
      const field = screen.getByRole("textbox", { name: "dock.editQuestion" });
      fireEvent.change(field, { target: { value: "   " } });
      fireEvent.keyDown(field, { key: "Enter" });

      expect(onEdit).not.toHaveBeenCalled();
      expect(
        (screen.getByText("dock.editSend") as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it("keeps the edit open when its line is not taken", () => {
      // A command still missing its words is held by the panel, as the
      // composer holds it; closing the box first would throw the line away.
      const onEdit = vi.fn(() => false);
      mount(asked(), null, { onEdit });
      fireEvent.click(screen.getByLabelText("dock.editQuestion"));
      const field = screen.getByRole("textbox", { name: "dock.editQuestion" });
      fireEvent.change(field, { target: { value: "/how-to-say" } });
      fireEvent.keyDown(field, { key: "Enter" });

      expect(onEdit).toHaveBeenCalledWith("q1", "/how-to-say");
      expect(
        (
          screen.getByRole("textbox", {
            name: "dock.editQuestion",
          }) as HTMLTextAreaElement
        ).value,
      ).toBe("/how-to-say");
    });

    it("shows and edits the command the writer typed, never the rubric it sent", () => {
      // A command's question is stored with its rubric, but the bubble shows,
      // and Edit hands back, only the line the writer typed.
      const onEdit = vi.fn(() => true);
      mount(
        turn({
          id: "q1",
          role: "user",
          text: "Summarise this part of the manuscript. At length.",
          command: { skill: "how-to-say", argument: "a tired sigh" },
        }),
        null,
        { onEdit },
      );
      const body = document.querySelector(".msg-body");
      expect(body?.textContent).toBe("/how-to-say a tired sigh");
      expect(body?.textContent).not.toContain("Summarise");

      fireEvent.click(screen.getByLabelText("dock.editQuestion"));
      const field = screen.getByRole("textbox", { name: "dock.editQuestion" });
      expect((field as HTMLTextAreaElement).value).toBe(
        "/how-to-say a tired sigh",
      );
    });
  });

  describe("an answer that did not finish", () => {
    // The neutral banner: the fact is plain, and only the remedy wears ember.
    const banner = () => document.querySelector(".ui-banner-info");

    it("says the writer stopped it, and what Try again will do", () => {
      // The ember button alone would leave the writer to guess what happened
      // and why it is there, so the fact and the remedy come together, in the
      // failure strip's own shape.
      const onRetry = vi.fn();
      mount(
        turn({
          outcome: "interrupted",
          errorCode: "cancelled",
          text: "Half an answer",
          runId: "r1",
        }),
        null,
        { onRetry },
      );

      expect(banner()?.textContent).toContain("dock.stopped.cancelled");
      expect(banner()?.textContent).toContain("dock.stopped.retryHint");
      expect(document.querySelector(".ui-banner-attention")).toBeNull();
      // The prose that arrived stays above it.
      expect(screen.getByText("Half an answer")).toBeTruthy();
      const again = screen.getByText("dock.retry.again");
      expect(again.classList.contains("ui-btn-attention")).toBe(true);
      again.click();
      expect(onRetry).toHaveBeenCalledWith("t1");
    });

    it("says a reload cut it off, when that is what the turn records", () => {
      mount(
        turn({ outcome: "interrupted", errorCode: "interrupted", text: "" }),
        null,
        { onRetry: vi.fn() },
      );
      expect(banner()?.textContent).toContain("dock.stopped.interrupted");
      // Nothing arrived: no empty body where an answer would be.
      expect(document.querySelector(".msg-body")).toBeNull();
    });

    it("claims neither when no reason was recorded", () => {
      // A ceiling ended it, and its own text says which.
      mount(turn({ outcome: "interrupted", text: "Reached its limit." }));
      expect(banner()?.textContent).toContain("dock.stopped.unfinished");
    });

    it("keeps the fact and drops the hint on a turn with no Try again", () => {
      // An older turn: the button goes, so its sentence
      // about the button must go with it.
      mount(turn({ outcome: "interrupted", errorCode: "cancelled" }));
      expect(banner()?.textContent).toContain("dock.stopped.cancelled");
      expect(banner()?.textContent).not.toContain("dock.stopped.retryHint");
      expect(screen.queryByText("dock.retry.again")).toBeNull();
    });

    it("says nothing about the answer still being written", () => {
      // Stored `interrupted` from the moment its run began; it has not
      // stopped, it is streaming.
      mount(turn({ outcome: "interrupted", errorCode: "interrupted" }), null, {
        live: true,
      });
      expect(banner()).toBeNull();
    });
  });
});

// ── How the answer was reached ───────────────────────────────────────────────
//
// The trace fold shows a run's working above its answer.
describe("the trace fold", () => {
  const fold = () => document.querySelector<HTMLDetailsElement>(".ai-trace");
  const summary = () => fold()?.querySelector("summary");
  const thoughts = () =>
    [...document.querySelectorAll(".ai-trace-thought")].map(
      (one) => one.textContent,
    );
  const rows = () => [...document.querySelectorAll(".ai-trace-row")];
  const step = (reasoning: string, extra: object = {}) => ({
    reasoning,
    toolCallIds: [] as string[],
    ...extra,
  });

  it("sits folded above the answer, as plain text that is never markup", () => {
    // A model's working may restate whatever was planted in the writer's
    // sources, so it is a text node, with no Markdown, links or HTML, however
    // it is phrased. The prose a step wrote beside its calls is held to the
    // same rule.
    const hostile =
      '<img src=x onerror="alert(1)"> [a link](https://x.test) **bold**';
    mount(
      turn({
        trace: { steps: [step(hostile, { text: `aside ${hostile}` })] },
        elapsedMs: 14_000,
      }),
    );

    const details = fold();
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    // Reasoning is the only fact, so it gets the only rung, with the time.
    expect(summary()?.textContent).toContain("dock.trail.thoughtFor");
    expect(thoughts()).toEqual([hostile, `aside ${hostile}`]);
    expect(details?.querySelector("img, a, strong")).toBeNull();
    // No caveat over the working: the fold's own place, closed, quiet and
    // above the answer, says it is not the answer.
    // The working itself is the first thing inside.
    expect(details?.querySelector(".ai-trace-note")).toBeNull();
    expect(
      details?.querySelector(".ui-disclosure-body")?.firstElementChild
        ?.className,
    ).toBe("ai-trace-body");
    // Above the answer, which is still the answer.
    const article = document.querySelector("article");
    expect(article?.firstElementChild).toBe(details);
    expect(document.querySelector(".dock-read")?.textContent).toContain(
      "An answer.",
    );
  });

  it("flows at full height, with no scroll box of its own", () => {
    // No box scrolls inside the transcript's own scroll, so nothing in the
    // trace is a focusable scroller.
    mount(turn({ trace: { steps: [step("long")] } }));
    expect(fold()?.querySelector("[tabindex]")).toBeNull();
    expect(document.querySelector(".ai-reasoning-text")).toBeNull();
  });

  it("is the run's live line on the turn being written, and says no more", () => {
    // One live voice. The turn being written carries it, dots, words
    // and clock, at its foot, where the conversation ends and the eye waits;
    // above the answer it would leave the space under it empty until
    // something arrived. Nothing sits above the answer until there is
    // something to open: a button with nothing behind it misstates the surface.
    const line = () => document.querySelector(".ai-turn-foot > .ai-activity");
    mount(turn({ text: "", outcome: "interrupted" }), null, {
      live: true,
      status: { shown: "dock.waiting" },
    });
    expect(fold()).toBeNull();
    expect(document.querySelector(".ai-trace-line")).toBeNull();
    expect(line()?.textContent).toContain("dock.waiting");
    expect(line()?.querySelector(".ui-dots")).toBeTruthy();
    expect(line()?.querySelector(".ai-elapsed")).toBeTruthy();
    // It stands in for the foot's Copy and facts, in the same held row.
    expect(document.querySelector(".ai-turn-copy")).toBeNull();
    expect(meta()).toBeNull();
    cleanup();

    // Something to open: the fold appears above, under a fixed name — never
    // the live words, which would be the run's second voice.
    mount(
      turn({
        text: "",
        outcome: "interrupted",
        trace: { steps: [step("Hm.")] },
      }),
      null,
      { live: true, status: { shown: "dock.thinking" } },
    );
    expect(summary()?.textContent).toBe("dock.traceLive");
    expect(summary()?.querySelector(".ai-activity")).toBeNull();
    expect(line()?.textContent).toContain("dock.thinking");
    cleanup();

    // The answer streaming says enough: no words, dots and clock only.
    mount(turn({ outcome: "interrupted" }), null, {
      live: true,
      status: { shown: null },
    });
    expect(line()?.querySelector(".ai-activity-label")).toBeNull();
    expect(line()?.querySelector(".ui-dots")).toBeTruthy();
    // Under the answer, not over it.
    const article = document.querySelector("article");
    expect(article?.lastElementChild?.className).toBe("ai-turn-foot");
    expect(
      document
        .querySelector(".msg-body")
        ?.compareDocumentPosition(line() as Node),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  // A summary is a focusable control, so the live fold's `<summary>` needs a
  // name for as long as the run lasts; the chevron is `aria-hidden`, and the
  // live fold reads a visible noun, which names it. Read the way assistive
  // tech reads it: the `aria-label` if any, else the text outside every
  // hidden subtree.
  it("names the live fold's button for assistive tech", () => {
    mount(
      turn({
        text: "",
        outcome: "interrupted",
        trace: { steps: [step("Hm.")] },
      }),
      null,
      { live: true, status: { shown: "dock.thinking" } },
    );
    const control = summary();
    expect(control).toBeTruthy();
    const heard = (node: Node): string => {
      if (
        node instanceof Element &&
        node.getAttribute("aria-hidden") === "true"
      )
        return "";
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      return [...node.childNodes].map(heard).join("");
    };
    const name =
      control?.getAttribute("aria-label") ?? (control ? heard(control) : "");
    expect(name.trim()).not.toBe("");
  });

  it("says when its start was cut, and draws nothing when there is none", () => {
    mount(turn({ trace: { steps: [step("tail")], trimmed: true } }));
    expect(fold()?.textContent).toContain("dock.reasoning.trimmed");
    cleanup();

    mount(turn());
    expect(fold()).toBeNull();
    expect(document.querySelector(".ai-trace-line")).toBeNull();
    mount(
      turn({ role: "user", text: "Q", trace: { steps: [step("not mine")] } }),
    );
    expect(fold()).toBeNull();
  });

  it("stays on a failed turn that never answered", () => {
    mount(
      turn({
        text: "",
        outcome: "failed",
        errorCode: "timeout",
        trace: { steps: [step("Halfway there.")] },
      }),
    );
    expect(thoughts()).toEqual(["Halfway there."]);
  });

  it("shows the run in the order it happened, a read as a button to its source", () => {
    const onOpenSource = vi.fn();
    mount(
      turn({
        trace: {
          steps: [
            step("Look first.", { toolCallIds: ["r1"] }),
            step("Now search.", { toolCallIds: ["s1", "f1", "e1"] }),
          ],
        },
        tools: [
          {
            callId: "r1",
            name: "read_source",
            status: "ok",
            sourceId: "node:S1",
          },
          {
            callId: "s1",
            name: "grep",
            status: "ok",
            arguments: { terms: ["tofu"] },
          },
          {
            callId: "f1",
            name: "read_source",
            status: "error",
            sourceId: "node:S2",
          },
          // Plumbing, already on screen as the findings list: no row.
          { callId: "e1", name: "submit_findings", status: "ok" },
        ],
      }),
      null,
      { onOpenSource },
    );
    const body = fold()?.querySelector(".ai-trace-body");
    const order = [
      ...(body?.querySelectorAll(".ai-trace-thought, .ai-trace-row") ?? []),
    ].map((one) => one.textContent);
    expect(order).toEqual([
      "Look first.",
      `dock.did.read_source:${JSON.stringify({ context: "named", subject: "Opening" })}`,
      "Now search.",
      `dock.did.grep:${JSON.stringify({ context: "named", subject: "tofu" })}`,
      `dock.failed.read_source:${JSON.stringify({ context: "named", subject: "Scene two" })}`,
    ]);
    const [read, search, failed] = rows();
    expect(read?.tagName).toBe("BUTTON");
    expect(search?.tagName).toBe("P");
    expect(failed?.tagName).toBe("P");
    fireEvent.click(read as Element);
    expect(onOpenSource).toHaveBeenCalledWith("node:S1");
  });

  it("never names a source by its id, even one the project no longer has", () => {
    mount(
      turn({
        tools: [
          {
            callId: "r1",
            name: "read_source",
            status: "ok",
            sourceId: "node:GONE",
            arguments: { sourceId: "node:GONE" },
          },
        ],
      }),
    );
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.tagName).toBe("P");
    expect(rows()[0]?.textContent).toBe("dock.did.read_source:{}");
    expect(document.body.textContent).not.toContain("node:GONE");
  });

  it("names a failed read by what it asked for", () => {
    // "Couldn't read a source" names nothing. A failed receipt may carry no
    // `sourceId`, so the row reads the call's own arguments: the title when
    // the id is real, else the id, cleaned of bidi overrides and clipped.
    mount(
      turn({
        tools: [
          {
            callId: "f1",
            name: "read_source",
            status: "error",
            arguments: { sourceId: "node:S2", start: 0, end: 0 },
          },
          {
            callId: "f2",
            name: "read_source",
            status: "error",
            arguments: { sourceId: "EL2, capitolo 1\u202e" },
          },
        ],
      }),
    );
    expect(rows().map((row) => row.textContent)).toEqual([
      `dock.failed.read_source:${JSON.stringify({ context: "named", subject: "Scene two" })}`,
      `dock.failed.read_source:${JSON.stringify({ context: "named", subject: "EL2, capitolo 1" })}`,
    ]);
  });

  it("sums a finished run up on its line, what it did first and the time last", () => {
    mount(
      turn({
        trace: { steps: [step("Hm.", { toolCallIds: ["a", "b", "c"] })] },
        tools: [
          {
            callId: "a",
            name: "read_source",
            status: "ok",
            sourceId: "node:S1",
          },
          {
            callId: "b",
            name: "read_source",
            status: "ok",
            sourceId: "node:S2",
          },
          { callId: "c", name: "grep", status: "ok" },
        ],
        elapsedMs: 14_900,
      }),
    );
    expect(summary()?.textContent).toBe(
      [
        `dock.trail.read:${JSON.stringify({ count: 2 })}`,
        "dock.trail.searched",
        `dock.elapsedSeconds:${JSON.stringify({ seconds: 14 })}`,
      ].join(" · "),
    );
  });

  it("keeps a caret-less line for a finished run with nothing to open", () => {
    // So the answer does not jump up a line the moment its run ends.
    mount(turn({ elapsedMs: 3_000 }));
    expect(fold()).toBeNull();
    expect(document.querySelector(".ai-trace-line")?.textContent).toBe(
      `dock.elapsedSeconds:${JSON.stringify({ seconds: 3 })}`,
    );
  });
});

// ── Citations ────────────────────────────────────────────────────────────────
//
// A source an answer cites reads as its title, never its id.
describe("a cited source", () => {
  const cites = () => [
    ...document.querySelectorAll<HTMLButtonElement>(".ai-cite"),
  ];

  it("reads as its title and opens through the panel", () => {
    const onOpenSource = vi.fn();
    mount(turn({ text: "From node:S1, the tofu.", sources: [SOURCE] }), null, {
      onOpenSource,
    });
    expect(cites().map((one) => one.textContent)).toEqual(["Opening"]);
    expect(cites()[0]?.getAttribute("aria-label")).toBe(
      `dock.citation:${JSON.stringify({ title: "Opening" })}`,
    );
    expect(document.querySelector(".dock-read")?.textContent).not.toContain(
      "node:S1",
    );
    fireEvent.click(cites()[0] as Element);
    expect(onOpenSource).toHaveBeenCalledWith("node:S1");
  });

  it("stays as written when the turn never used it or nobody lists it", () => {
    // `node:S2` is in the catalogue but this turn neither attached nor read
    // it; `node:S9` is in nothing. Neither becomes a citation.
    mount(turn({ text: "See node:S2 and node:S9.", sources: [SOURCE] }));
    expect(cites()).toHaveLength(0);
    expect(document.querySelector(".dock-read")?.textContent).toContain(
      "See node:S2 and node:S9.",
    );
  });

  it("never turns a model's link or code into a citation", () => {
    mount(
      turn({
        text: "[node:S1](https://x.test) and `node:S1`",
        sources: [SOURCE],
      }),
    );
    expect(cites()).toHaveLength(0);
    expect(document.querySelector(".dock-read a")?.textContent).toBe("node:S1");
    expect(document.querySelector(".dock-read code")?.textContent).toBe(
      "node:S1",
    );
  });

  it("does not let an answer write its own citation button", () => {
    // Raw HTML is off, so markup the model writes is text — including a
    // button dressed with the attribute the panel's listener looks for, and
    // naming a source this turn never used.
    const onOpenSource = vi.fn();
    mount(
      turn({
        text: '<button data-cite="node:S2">open</button>',
        sources: [SOURCE],
      }),
      null,
      { onOpenSource },
    );
    expect(document.querySelector(".dock-read [data-cite]")).toBeNull();
    fireEvent.click(document.querySelector(".dock-read p") as Element);
    expect(onOpenSource).not.toHaveBeenCalled();
  });

  it("draws a title as text however it is written", () => {
    mount(turn({ text: "See node:S1.", sources: [SOURCE] }), null, {
      titles: new Map([["node:S1", '<img src=x onerror="alert(1)">']]),
    });
    expect(cites()[0]?.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(document.querySelector(".dock-read img")).toBeNull();
  });

  it("waits for an id at the very end of an answer still arriving", () => {
    // `node:S1` may be the start of `node:S12`: no title until something
    // follows it, or the answer is done.
    mount(turn({ text: "See node:S1", sources: [SOURCE] }), null, {
      live: true,
    });
    expect(cites()).toHaveLength(0);
    cleanup();
    mount(turn({ text: "See node:S1", sources: [SOURCE] }));
    expect(cites()).toHaveLength(1);
  });

  it("names a finding's source by its title", () => {
    mount(
      turn({
        findings: [
          {
            id: "f1",
            title: "A slip",
            explanation: "It changes.",
            severity: "issue",
            status: "open",
            evidence: [{ sourceId: "node:S1", quote: "the tofu" }],
          } as unknown as NonNullable<ChatTurn["findings"]>[number],
        ],
      }),
    );
    const evidence = document.querySelector(".ai-evidence small");
    expect(evidence?.textContent).toContain("Opening");
    expect(evidence?.textContent).not.toContain("node:S1");
  });

  it("says why a demoted finding is unverified, in the writer's language", () => {
    mount(
      turn({
        findings: [
          {
            id: "f1",
            title: "A slip",
            explanation: "It changes.",
            severity: "observation",
            status: "open",
            unverified: "half",
            evidence: [{ sourceId: "node:S1", quote: "the tofu" }],
          },
        ],
      }),
    );
    expect(document.body.textContent).toContain("dock.finding.unverified.half");
  });

  it("heads a finished review with its line in the writer's language, not the file's English", () => {
    const finding = {
      id: "f1",
      title: "A slip",
      explanation: "It changes.",
      severity: "minor" as const,
      status: "open" as const,
      evidence: [],
    };
    mount(
      turn({
        text: "Completed the continuity review with 1 finding.",
        findings: [finding],
        review: {
          runId: "run-1",
          task: "continuity",
          scope: { kind: "structure" },
        },
      }),
    );
    const read = document.querySelector(".dock-read")?.textContent ?? "";
    expect(read).toContain('dock.reviewDone:{"count":1}');
    expect(read).not.toContain("Completed the");
    cleanup();
    mount(
      turn({
        text: "No evidence-backed issues were found in the completed review.",
        findings: [],
        review: {
          runId: "run-1",
          task: "continuity",
          scope: { kind: "structure" },
        },
      }),
    );
    expect(document.querySelector(".dock-read")?.textContent).toContain(
      "dock.reviewDoneNone",
    );
  });

  it("says a review whose coverage is short stopped short, never that it is complete", () => {
    const review = {
      runId: "run-1",
      task: "continuity" as const,
      scope: { kind: "structure" as const },
    };
    const coverage = {
      intended: 2,
      inspected: 1,
      skipped: [],
      complete: false,
    };
    const finding = {
      id: "f1",
      title: "A slip",
      explanation: "It changes.",
      severity: "minor" as const,
      status: "open" as const,
      evidence: [],
    };
    const read = () => document.querySelector(".dock-read")?.textContent ?? "";
    mount(turn({ text: "x", findings: [finding], coverage, review }));
    expect(read()).toContain('dock.reviewShort:{"count":1}');
    expect(read()).not.toContain("dock.reviewDone");
    cleanup();
    mount(turn({ text: "x", findings: [], coverage, review }));
    expect(read()).toContain("dock.reviewShortNone");
    cleanup();
    mount(
      turn({
        text: "x",
        findings: [],
        commented: [{ nodeId: "EL2", count: 1 }],
        coverage,
        review,
      }),
    );
    expect(read()).toContain("dock.reviewShortMargin");
  });

  it("says a review whose findings went to the margin found something, and opens each chapter they are in", () => {
    const onOpenSource = vi.fn();
    mount(
      turn({
        text: "Completed the review; what it found is in the margin.",
        findings: [],
        commented: [
          { nodeId: "EL2", count: 2 },
          // A chapter gone from the book since has no button.
          { nodeId: "gone", count: 1 },
        ],
        review: {
          runId: "run-1",
          task: "continuity",
          scope: { kind: "structure" },
        },
      }),
      null,
      {
        onOpenSource,
        titles: new Map([["node:EL2", "The Storm"]]),
      },
    );
    expect(document.querySelector(".dock-read")?.textContent).toContain(
      "dock.reviewDoneMargin",
    );
    const controls = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".ai-route-row button"),
    );
    expect(controls.map((control) => control.textContent)).toEqual([
      'dock.commented:{"count":2,"title":"The Storm"}',
    ]);
    controls[0].click();
    expect(onOpenSource).toHaveBeenCalledWith("node:EL2");
  });
});

describe("copying an answer", () => {
  const copyButton = () =>
    document.querySelector<HTMLButtonElement>(".ai-turn-copy");

  function withClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("copies the answer as the screen reads it, citations as titles, then shows a tick", async () => {
    // A raw id is the app's address, not the writer's. The clipboard
    // is text/plain, and `**` lands as junk in a document, an email and the
    // manuscript itself, so the copy is plain words from the renderer's own
    // parse (`plainOf`), never the Markdown source.
    const writeText = vi.fn(() => Promise.resolve());
    withClipboard(writeText);
    mount(turn({ text: "From **node:S1**, the tofu.", sources: [SOURCE] }));
    const button = copyButton();
    expect(button?.getAttribute("aria-label")).toBe("dock.copyAnswer");
    // At the foot of the answer, before its facts.
    expect(button?.parentElement?.className).toBe("ai-turn-foot");
    expect(button?.nextElementSibling).toBe(meta());

    fireEvent.click(button as Element);
    expect(writeText).toHaveBeenCalledWith("From Opening, the tofu.");
    await vi.waitFor(() =>
      expect(copyButton()?.getAttribute("aria-label")).toBe("dock.copied"),
    );
  });

  it("claims nothing when the write is refused", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("denied")));
    withClipboard(writeText);
    mount(turn());
    fireEvent.click(copyButton() as Element);
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalled();
    expect(copyButton()?.getAttribute("aria-label")).toBe("dock.copyAnswer");
  });

  it("is offered only on a settled answer with words in it", () => {
    // Mid-stream is half an answer that looks whole once pasted; a question
    // is the writer's own text; a failure with nothing said has nothing.
    mount(turn({ outcome: "interrupted" }), null, {
      live: true,
      status: { shown: null },
    });
    expect(copyButton()).toBeNull();
    cleanup();
    mount(turn({ role: "user", text: "A question." }));
    expect(copyButton()).toBeNull();
    cleanup();
    mount(turn({ text: "  ", outcome: "failed" }));
    expect(copyButton()).toBeNull();
  });
});

// ── What `/where` found ──────────────────────────────────────────────────────
//
// A `/where` answer is passages as rows, with no chat prose.

describe("a /where answer", () => {
  const found = turn({
    text: "The described moment is in node:S1, node:S2.",
    located: {
      matches: [
        { sourceId: "node:S1", quote: "The truck came out of the fog." },
        { sourceId: "node:S2", quote: "Glass everywhere, and then silence." },
      ],
      coverage: {
        intended: 3,
        inspected: 2,
        skipped: [{ sourceId: "node:S3", reason: "unmapped" }],
        complete: false,
      },
    },
  });

  function renderLocated(
    one: ChatTurn,
    onSummarise?: () => void,
    summarised?: ReadonlySet<string>,
  ) {
    const onShowEvidence = vi.fn();
    render(
      <AiTurn
        web={NO_WEB_CITATIONS}
        turn={one}
        agentName={null}
        running={false}
        titles={TITLES}
        pendingReview={null}
        onFindingStatus={vi.fn()}
        onShowEvidence={onShowEvidence}
        onOpenSource={vi.fn()}
        onResumeReview={vi.fn()}
        onCompleteSearch={onSummarise}
        stillMissing={
          summarised
            ? (ids) => ids.filter((id) => !summarised.has(id))
            : undefined
        }
      />,
    );
    return { onShowEvidence };
  }

  it("draws the passages as rows, and no chat prose", () => {
    const { onShowEvidence } = renderLocated(found);
    const rows = screen.getAllByRole("button", { name: /The truck|Glass/ });
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Opening"),
      expect.stringContaining("Scene two"),
    ]);
    expect(
      screen.getByRole("list", { name: /dock\.where\.found/ }),
    ).toBeTruthy();
    // The text is the line kept for the model's history, not for the writer.
    expect(document.body.textContent).not.toContain("described moment");
    expect(screen.queryByLabelText("dock.copyAnswer")).toBeNull();
    fireEvent.click(rows[1]);
    expect(onShowEvidence).toHaveBeenCalledWith(found.located?.matches[1]);
  });

  it("says what it could not consider, and offers to summarise it", () => {
    const onSummarise = vi.fn();
    renderLocated(found, onSummarise);
    fireEvent.click(
      screen.getByRole("button", { name: /dock\.where\.summariseMissing/ }),
    );
    expect(onSummarise).toHaveBeenCalledOnce();
  });

  // The note is that search's record; the button is about the book as it is
  // now. After a Stop part-way, what was written is not offered
  // again, and once nothing is missing there is no button at all.
  it("offers only the summaries still missing, and none once they exist", () => {
    const partly = turn({
      text: "The described moment was not found in the Sections searched.",
      located: {
        matches: [],
        coverage: {
          intended: 3,
          inspected: 1,
          skipped: [
            { sourceId: "node:S2", reason: "unmapped" },
            { sourceId: "node:S3", reason: "unmapped" },
          ],
          complete: false,
        },
      },
    });
    renderLocated(partly, vi.fn(), new Set(["node:S2"]));
    expect(
      screen.getByText(/dock\.where\.noSummary:\{"count":2\}/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /dock\.where\.summariseMissing:\{"count":1\}/,
      }),
    ).toBeTruthy();
    cleanup();
    renderLocated(partly, vi.fn(), new Set(["node:S2", "node:S3"]));
    expect(
      screen.queryByRole("button", { name: /summariseMissing/ }),
    ).toBeNull();
  });

  // A Section this model could not summarise is named, not offered, and the
  // button counts only the rest, until the chat asks another model, when it
  // joins the button's count again.
  it("says which Sections this model couldn't summarise and offers only the rest", () => {
    const qwen = { providerId: "ollama", modelId: "qwen3:8b" };
    const blocked = turn({
      text: "The described moment was not found in the Sections searched.",
      model: qwen,
      located: {
        matches: [],
        coverage: {
          intended: 3,
          inspected: 1,
          skipped: [
            { sourceId: "node:S2", reason: "unsummarisable" },
            { sourceId: "node:S3", reason: "unmapped" },
          ],
          complete: false,
        },
      },
    });
    const show = (chatModel: typeof qwen, one = blocked) =>
      render(
        <AiTurn
          web={NO_WEB_CITATIONS}
          turn={one}
          agentName={null}
          running={false}
          titles={TITLES}
          pendingReview={null}
          onFindingStatus={vi.fn()}
          onShowEvidence={vi.fn()}
          onOpenSource={vi.fn()}
          onResumeReview={vi.fn()}
          onCompleteSearch={vi.fn()}
          stillMissing={(ids) => ids}
          chatModel={chatModel}
        />,
      );
    show(qwen);
    const line = screen.getByText(/dock\.where\.unsummarisable:\{"count":1\}/);
    expect(
      line.compareDocumentPosition(
        screen.getByText(/dock\.where\.noSummary:\{"count":1\}/),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /dock\.where\.summariseMissing:\{"count":1\}/,
      }),
    ).toBeTruthy();
    cleanup();
    // Every skipped Section blocked: the line alone, and no button.
    show(qwen, {
      ...blocked,
      located: {
        matches: [],
        coverage: {
          intended: 3,
          inspected: 1,
          complete: false,
          skipped: [{ sourceId: "node:S2", reason: "unsummarisable" }],
        },
      },
    });
    expect(screen.getByText(/dock\.where\.unsummarisable/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /summariseMissing/ }),
    ).toBeNull();
    cleanup();
    // Another model now: the block lifts and the button takes it again.
    show({ providerId: "ollama", modelId: "llama3" });
    expect(screen.queryByText(/dock\.where\.unsummarisable/)).toBeNull();
    expect(
      screen.getByRole("button", {
        name: /dock\.where\.summariseMissing:\{"count":2\}/,
      }),
    ).toBeTruthy();
  });

  // The note and the button both go once the summaries succeed,
  // also when the search after them stopped or failed: a note saying "has no
  // summary yet" about Sections that have one is false.
  it("says no Section lacks a summary once every one has it", () => {
    renderLocated(
      turn({
        text: "The described moment was not found in the Sections searched.",
        located: {
          matches: [],
          coverage: {
            intended: 3,
            inspected: 1,
            skipped: [
              { sourceId: "node:S2", reason: "unmapped" },
              { sourceId: "node:S3", reason: "unmapped" },
            ],
            complete: false,
          },
        },
      }),
      vi.fn(),
      new Set(["node:S2", "node:S3"]),
    );
    expect(screen.queryByText(/dock\.where\.noSummary/)).toBeNull();
    // It says the answer predates them, and offers to search again in its
    // place.
    expect(screen.getByText("dock.where.searchIncomplete")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "dock.where.searchAgain" }),
    ).toBeTruthy();
  });

  it("says nothing was found, with what was read, and no button mid-run", () => {
    renderLocated(
      turn({
        text: "The described moment was not found in the Sections searched.",
        located: {
          matches: [],
          coverage: {
            intended: 62,
            inspected: 4,
            skipped: [
              { sourceId: "node:S7", reason: "unmapped" },
              { sourceId: "node:S8", reason: "not-read" },
            ],
            complete: false,
          },
        },
      }),
    );
    expect(screen.getByText("dock.where.notFound")).toBeTruthy();
    expect(
      screen.getByText('dock.where.checked:{"count":4,"total":62}'),
    ).toBeTruthy();
    // Only the unmapped Section counts as "no summary"; a ranked-and-unread
    // one had a summary.
    expect(
      screen.getByText(/dock\.where\.noSummary:\{"count":1\}/),
    ).toBeTruthy();
    // No `onSummarise`: a run is going, and the button is not drawn.
    expect(
      screen.queryByRole("button", { name: /summariseMissing/ }),
    ).toBeNull();
  });

  // `LocatedAnswer` reads `row.reason` on every coverage entry, so one `null`
  // in a hand-edited or shared chat file must not throw out of the render
  // and take the dock with it. Through the codec, so either the sanitizer or
  // the render guard holds it.
  it("a replayed /where answer with a mangled coverage row still renders", () => {
    const answer = turn({
      text: "The described moment was not found in the Sections searched.",
      located: {
        matches: [],
        coverage: {
          intended: 3,
          inspected: 1,
          skipped: [null, { sourceId: "node:S3", reason: "unmapped" }],
          complete: false,
        },
      },
    } as unknown as Partial<ChatTurn>);
    const chat = parseChat(
      JSON.stringify({
        schemaVersion: 1,
        id: "c1",
        kind: "general",
        title: "A chat",
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
        preferences: { personaId: "p", model: null, pinnedSourceIds: [] },
        turns: [answer],
      }),
    );
    expect(() => renderLocated(chat.turns[0])).not.toThrow();
    expect(screen.getByText("dock.where.notFound")).toBeTruthy();
  });
});

// A wide review's answer carries `/where`'s widening block: the note counting
// the answer's own `unmapped` rows, the button counting what a click would
// summarise now, and on a remote model the line that says where the click
// sends the book, before the button.
describe("a wide review's answer", () => {
  function reviewed(
    scope: NonNullable<ChatTurn["review"]>["scope"],
    skipped: NonNullable<ChatTurn["coverage"]>["skipped"],
  ): ChatTurn {
    return turn({
      runId: "run-1",
      text: "Completed the continuity review with 0 findings.",
      coverage: { intended: 3, inspected: 1, skipped, complete: false },
      review: { runId: "run-1", task: "continuity", scope },
    });
  }
  const unmapped = reviewed({ kind: "structure" }, [
    { sourceId: "node:S2", reason: "unmapped" },
    { sourceId: "node:S3", reason: "unmapped" },
    { sourceId: "node:S4", reason: "too-large" },
  ]);

  function renderReview(
    one: ChatTurn,
    options: {
      onComplete?: () => void;
      summarised?: ReadonlySet<string>;
      pending?: string;
      replaces?: string;
      transit?: string;
      status?: { shown: string | null };
    } = {},
  ) {
    render(
      <AiTurn
        web={NO_WEB_CITATIONS}
        turn={one}
        agentName={null}
        running={false}
        titles={TITLES}
        status={options.status}
        pendingReview={
          options.pending
            ? {
                runId: options.pending,
                task: "continuity",
                complete: 1,
                total: 3,
                ...(options.replaces ? { replaces: options.replaces } : {}),
              }
            : null
        }
        onFindingStatus={vi.fn()}
        onShowEvidence={vi.fn()}
        onOpenSource={vi.fn()}
        onResumeReview={vi.fn()}
        onCompleteReview={options.onComplete}
        transitProvider={options.transit}
        stillMissing={
          options.summarised
            ? (ids) => ids.filter((id) => !options.summarised?.has(id))
            : undefined
        }
      />,
    );
  }

  it("counts only the unmapped Sections, and offers to summarise them and review again", () => {
    const onComplete = vi.fn();
    renderReview(unmapped, {
      onComplete,
      summarised: new Set(["node:S2"]),
    });
    // The note is the answer's record: two unmapped (the too-large one is
    // not a summary's to fix). The button counts what a click writes now: one.
    expect(
      screen.getByText('dock.reviewFollowUp.noSummary:{"count":2}'),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: 'dock.reviewFollowUp.summariseMissing:{"count":1}',
      }),
    );
    expect(onComplete).toHaveBeenCalledOnce();
    // A local model: nothing leaves, and nothing says it does.
    expect(screen.queryByText(/reviewTransit/)).toBeNull();
  });

  // A Section the model could not summarise is named first and left out of
  // the button; with nothing else missing, no button.
  it("says which Sections this model couldn't summarise and offers only the rest", () => {
    renderReview(
      reviewed({ kind: "structure" }, [
        { sourceId: "node:S2", reason: "unsummarisable" },
        { sourceId: "node:S3", reason: "unmapped" },
      ]),
      { onComplete: vi.fn() },
    );
    const line = screen.getByText(
      'dock.reviewFollowUp.unsummarisable:{"count":1}',
    );
    expect(
      line.compareDocumentPosition(
        screen.getByText('dock.reviewFollowUp.noSummary:{"count":1}'),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: 'dock.reviewFollowUp.summariseMissing:{"count":1}',
      }),
    ).toBeTruthy();
    cleanup();
    renderReview(
      reviewed({ kind: "structure" }, [
        { sourceId: "node:S2", reason: "unsummarisable" },
      ]),
      { onComplete: vi.fn() },
    );
    expect(
      screen.getByText('dock.reviewFollowUp.unsummarisable:{"count":1}'),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /dock.reviewFollowUp./ }),
    ).toBeNull();
  });

  it("names no summary request on a button that only reviews again", () => {
    renderReview(unmapped, {
      onComplete: vi.fn(),
      summarised: new Set(["node:S2", "node:S3"]),
      transit: "openrouter.ai",
    });
    // Nothing is summarised on this click, so the lead would claim the
    // character names travel when they do not.
    expect(
      screen.getByText(
        'dock.reviewTransit.withSummaries:{"provider":"openrouter.ai"}',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/dock\.summariseTransit/)).toBeNull();
  });

  it("says the answer came before the summaries once none is missing", () => {
    renderReview(unmapped, {
      onComplete: vi.fn(),
      summarised: new Set(["node:S2", "node:S3"]),
    });
    expect(screen.queryByText(/reviewFollowUp\.noSummary/)).toBeNull();
    expect(
      screen.getByText("dock.reviewFollowUp.answerOutOfDate"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "dock.reviewFollowUp.reviewAgain" }),
    ).toBeTruthy();
  });

  it("says where a relay model sends the book, before the button", () => {
    renderReview(unmapped, { onComplete: vi.fn(), transit: "openrouter.ai" });
    // What a summary request sends first, the character names included,
    // then what the review sends.
    const line = screen.getByText(
      'dock.summariseTransit:{"provider":"openrouter.ai"} dock.reviewTransit.withSummaries:{"provider":"openrouter.ai"}',
    );
    const control = screen.getByRole("button", {
      name: /reviewFollowUp\.summariseMissing/,
    });
    expect(
      line.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the note but draws no button, and no transit line, while a run is going", () => {
    renderReview(unmapped, { transit: "openrouter.ai" });
    expect(
      screen.getByText('dock.reviewFollowUp.noSummary:{"count":2}'),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /reviewFollowUp/ })).toBeNull();
    expect(screen.queryByText(/reviewTransit/)).toBeNull();
  });

  it("withholds the button while the answer's own Resume is on offer", () => {
    renderReview(unmapped, { onComplete: vi.fn(), pending: "run-1" });
    expect(screen.queryByRole("button", { name: /reviewFollowUp/ })).toBeNull();
  });

  it("withholds the button while a review-again started from it can be resumed", () => {
    renderReview(unmapped, {
      onComplete: vi.fn(),
      pending: "run-2",
      replaces: "run-1",
    });
    expect(screen.queryByRole("button", { name: /reviewFollowUp/ })).toBeNull();
  });

  it("offers no button for a pair no command would type", () => {
    renderReview(
      turn({
        ...unmapped,
        review: { runId: "run-1", task: "line", scope: { kind: "structure" } },
      }),
      { onComplete: vi.fn() },
    );
    expect(screen.queryByText(/reviewFollowUp/)).toBeNull();
  });

  it("says nothing for a live turn, a focused review, or one with nothing unmapped", () => {
    renderReview(unmapped, { onComplete: vi.fn(), status: { shown: null } });
    renderReview(
      reviewed({ kind: "current" }, [
        { sourceId: "node:S2", reason: "unmapped" },
      ]),
      { onComplete: vi.fn() },
    );
    renderReview(
      reviewed({ kind: "node", nodeId: "part-one" }, [
        { sourceId: "node:S4", reason: "not-read" },
      ]),
      { onComplete: vi.fn() },
    );
    expect(screen.queryByText(/reviewFollowUp/)).toBeNull();
    expect(screen.queryByRole("button", { name: /reviewFollowUp/ })).toBeNull();
  });
});

describe("a /where answer's transit line", () => {
  function renderLocated(
    skipped: string[],
    summarised: ReadonlySet<string>,
    onComplete?: () => void,
  ) {
    render(
      <AiTurn
        web={NO_WEB_CITATIONS}
        turn={turn({
          text: "The described moment was not found in the Sections searched.",
          located: {
            matches: [],
            coverage: {
              intended: 3,
              inspected: 1,
              skipped: skipped.map((sourceId) => ({
                sourceId,
                reason: "unmapped" as const,
              })),
              complete: false,
            },
          },
        })}
        agentName={null}
        running={false}
        titles={TITLES}
        pendingReview={null}
        onFindingStatus={vi.fn()}
        onShowEvidence={vi.fn()}
        onOpenSource={vi.fn()}
        onResumeReview={vi.fn()}
        onCompleteSearch={onComplete}
        transitProvider="openrouter.ai"
        stillMissing={(ids) => ids.filter((id) => !summarised.has(id))}
      />,
    );
  }

  it("says whole Sections travel when the click summarises first", () => {
    renderLocated(["node:S2"], new Set(), vi.fn());
    expect(
      screen.getByText(
        'dock.summariseTransit:{"provider":"openrouter.ai"} dock.where.remoteTransit:{"provider":"openrouter.ai"}',
      ),
    ).toBeTruthy();
  });

  it("says what a search sends when the click only searches again", () => {
    renderLocated(["node:S2"], new Set(["node:S2"]), vi.fn());
    expect(
      screen.getByText('dock.where.remoteTransit:{"provider":"openrouter.ai"}'),
    ).toBeTruthy();
  });

  it("draws no transit line with no button", () => {
    renderLocated(["node:S2"], new Set());
    expect(screen.queryByText(/remoteTransit/)).toBeNull();
  });
});

describe("a /map answer", () => {
  const MAPPED: NonNullable<ChatTurn["mapped"]> = {
    kind: "arc",
    mode: "positional",
    shapeFrom: "declared",
    shape: "threeact",
    scope: { kind: "structure" },
    structureRevision: "rev",
    nodes: [
      {
        sourceId: "node:S1",
        kind: "part",
        title: "Opening",
        standsIn: "setup",
        verdict: "fits",
        reason: "It sets up.",
      },
    ],
    coverage: { intended: 1, inspected: 1, skipped: [], complete: true },
  };
  const answer = (over: Partial<ChatTurn> = {}) =>
    turn({
      text: "Mapped the manuscript on threeact.",
      model: { providerId: "ollama", modelId: "qwen3:8b" },
      mapped: MAPPED,
      ...over,
    });

  function renderMap(one: ChatTurn, offersMap: boolean) {
    return render(
      <AiTurn
        web={NO_WEB_CITATIONS}
        turn={one}
        agentName={null}
        running={false}
        titles={TITLES}
        pendingReview={null}
        onFindingStatus={vi.fn()}
        onShowEvidence={vi.fn()}
        onOpenSource={vi.fn()}
        onResumeReview={vi.fn()}
        offersMap={offersMap}
        liveStructure={{ revision: "rev", nodeIds: new Set(["node:S1"]) }}
      />,
    );
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("draws the rows and no chat prose — no headline, no id", () => {
    renderMap(answer(), true);
    expect(document.querySelector(".ai-map")).toBeTruthy();
    expect(document.querySelector(".msg-body")).toBeNull();
    const article = document.querySelector("article") as HTMLElement;
    expect(article.textContent).not.toContain("Mapped the manuscript");
    expect(article.textContent).not.toContain("node:");
  });

  it("draws none of it in a chat that does not offer /map, and offers no Copy", () => {
    // A reader chat whose file carries a map: not the rows, not
    // the headline, not a word count, and nothing to copy.
    renderMap(answer(), false);
    expect(document.querySelector(".ai-map")).toBeNull();
    expect(document.querySelector(".msg-body")).toBeNull();
    expect(document.querySelector(".ai-turn-copy")).toBeNull();
  });

  it("copies what the rows say, in words", () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderMap(answer(), true);
    fireEvent.click(
      document.querySelector(".ai-turn-copy") as HTMLButtonElement,
    );
    const [text] = writeText.mock.calls[0] as unknown as [string];
    expect(text).toContain("Opening");
    expect(text).toContain("It sets up.");
    expect(text).not.toContain("node:");
    expect(text).not.toContain("Mapped the manuscript");
  });

  it("falls back to the id-free headline when a replayed map is dropped", () => {
    // The codec drops a malformed block whole, leaving the stored text: the
    // headline, never the history line's ids.
    renderMap(answer({ mapped: undefined }), true);
    const body = document.querySelector(".msg-body") as HTMLElement;
    expect(body.textContent).toContain("Mapped the manuscript on threeact.");
    expect(body.textContent).not.toContain("node:");
  });
});

// Under the latest answer of a bare `/canon`, a reference its coverage left
// out for want of room can be checked by naming it: said once, with no button,
// count or list.
describe("the name hint", () => {
  const hint = () =>
    [...document.querySelectorAll(".dock-hint")].find((one) =>
      one.textContent?.startsWith("dock.canon.namedHint"),
    );
  const left = (sourceId: string) =>
    turn({
      coverage: {
        intended: 3,
        inspected: 2,
        skipped: [{ sourceId, reason: "not-in-budget" }],
        complete: false,
      },
    });
  const draw = (one: ChatTurn, nameHint?: string) =>
    render(
      <AiTurn
        web={NO_WEB_CITATIONS}
        turn={one}
        agentName={null}
        running={false}
        titles={TITLES}
        pendingReview={null}
        onFindingStatus={vi.fn()}
        onShowEvidence={vi.fn()}
        onOpenSource={vi.fn()}
        onResumeReview={vi.fn()}
        nameHint={nameHint}
      />,
    );

  it("teaches naming a reference that had no room", () => {
    draw(left("reference:character--Marta.md"), "/canon");
    expect(hint()).toBeDefined();
  });

  it("says nothing where it would not help", () => {
    // Not the latest answer of a bare review by a naming command.
    draw(left("reference:character--Marta.md"));
    expect(hint()).toBeUndefined();
    cleanup();
    // A Section left out is not a reference to name.
    draw(left("node:S2"), "/canon");
    expect(hint()).toBeUndefined();
    cleanup();
    // A review that already named one.
    draw(
      {
        ...left("reference:character--Marta.md"),
        sources: [
          {
            ...SOURCE,
            id: "reference:character--Aldo.md",
            kind: "reference",
            authority: "reference",
            reason: "named",
          },
        ],
      },
      "/canon",
    );
    expect(hint()).toBeUndefined();
  });
});

// An answer named against a reference the book has dropped offers no Resume,
// which would only be refused.
describe("an answer whose named reference is gone", () => {
  it("offers no Resume", () => {
    const answer = turn({
      runId: "run",
      review: {
        runId: "run",
        task: "consistency",
        scope: { kind: "structure" },
        references: ["reference:character--Marta.md"],
      },
    });
    const draw = (referenceGone: boolean) =>
      render(
        <AiTurn
          web={NO_WEB_CITATIONS}
          turn={answer}
          agentName={null}
          running={false}
          titles={TITLES}
          pendingReview={{
            runId: "run",
            task: "consistency",
            complete: 1,
            total: 3,
          }}
          onFindingStatus={vi.fn()}
          onShowEvidence={vi.fn()}
          onOpenSource={vi.fn()}
          onResumeReview={vi.fn()}
          referenceGone={referenceGone}
        />,
      );
    const resume = () =>
      [...document.querySelectorAll("button")].find((one) =>
        one.textContent?.startsWith("dock.resumeReview"),
      );
    draw(false);
    expect(resume()).toBeDefined();
    cleanup();
    draw(true);
    expect(resume()).toBeUndefined();
  });
});

// A Part's account says where it came from, after the prose, with no count,
// and one clause when Sections were kept back.
describe("a Part's account", () => {
  const provenance = () =>
    [...document.querySelectorAll(".dock-hint")].find((one) =>
      one.textContent?.startsWith("dock.summarisePart."),
    );
  const draw = (one: ChatTurn, summarisedFrom?: string) =>
    render(
      <AiTurn
        web={NO_WEB_CITATIONS}
        turn={one}
        agentName={null}
        running={false}
        titles={TITLES}
        summarisedFrom={summarisedFrom}
        pendingReview={null}
        onFindingStatus={vi.fn()}
        onShowEvidence={vi.fn()}
        onOpenSource={vi.fn()}
        onResumeReview={vi.fn()}
      />,
    );

  it("says it came from the Part's Section summaries, after the prose", () => {
    draw(turn({ summarisedPart: { nodeId: "P1" } }), "Book One");
    const line = provenance();
    expect(line?.textContent).toMatch(/^dock\.summarisePart\.from:/);
    const body = document.querySelector(".msg-body");
    expect(body?.textContent).toContain("An answer.");
    expect(
      body &&
        line &&
        body.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("adds the one clause when Sections were kept from the assistant", () => {
    draw(turn({ summarisedPart: { nodeId: "P1", withheld: true } }), "Book");
    expect(provenance()?.textContent).toMatch(
      /^dock\.summarisePart\.fromWithheld:/,
    );
  });

  it("says nothing on any other answer, or with no title to name", () => {
    draw(turn(), "Book One");
    expect(provenance()).toBeUndefined();
    cleanup();
    draw(turn({ summarisedPart: { nodeId: "P1" } }));
    expect(provenance()).toBeUndefined();
    cleanup();
    draw(
      turn({
        role: "user",
        text: "/summarise",
        summarisedPart: { nodeId: "P1" },
      }),
      "Book One",
    );
    expect(provenance()).toBeUndefined();
  });
});

// ── A failed search in the fold ──────────────────────────────────────────────
//
// A web search is a step of the run like any tool call.

describe("AiTrace: a failed search in the fold", () => {
  // The folded line counts a failed web search (`traceFacts.failed`), so the
  // fold draws a row for every failure the line counts, both reading
  // `traceRows`. Otherwise the writer is told "1 step failed" and opens a
  // fold with nothing in it that failed.
  it("draws a row for the failed web search the line counts", () => {
    const { container } = mount(
      turn({
        trace: { steps: [{ reasoning: "Checking.", toolCallIds: ["w"] }] },
        tools: [{ callId: "w", name: "web_search", status: "ok" }],
        web: [
          {
            callId: "w",
            engine: { kind: "wikipedia" },
            status: "failed",
            query: "Porta Pia 1870",
            code: "connection",
            reached: "no",
          },
        ],
        elapsedMs: 4_000,
      }),
    );
    const line = container.querySelector(".ai-trace summary, .ai-trace-line");
    expect(line?.textContent).toContain('dock.trail.failed:{"count":1}');
    expect(container.querySelectorAll(".ai-trace-row")).toHaveLength(1);
  });
});

// ── Web search in the trace and foot ─────────────────────────────────────────
//
// How a run's web searches read in the fold and on the turn's foot.

describe("AiTrace: web search rows", () => {
  const web = (records: NonNullable<ChatTurn["web"]>) =>
    turn({
      trace: {
        steps: [
          {
            reasoning: "Checking.",
            toolCallIds: records.map((record) => record.callId),
          },
        ],
      },
      tools: records.map((record) => ({
        callId: record.callId,
        name: "web_search" as const,
        status: "ok" as const,
      })),
      web: records,
      elapsedMs: 4_000,
    });
  const rows = () => [...document.querySelectorAll(".ai-trace-row.is-web")];
  const line = () => document.querySelector(".ai-trace summary")?.textContent;
  const RESULT = { id: "web:1", url: "https://it.wikipedia.org/x", title: "X" };

  it("draws a search by its engine, the query as a quoted child, and its count", () => {
    mount(
      web([
        {
          callId: "w",
          engine: { kind: "wikipedia" },
          status: "searched",
          query: "Porta Pia <b>1870</b> {{query}}",
          results: [RESULT, { ...RESULT, id: "web:2" }],
        },
      ]),
    );
    const [row] = rows();
    // The query is the words' tip, whole, and never markup. Its place in the
    // sentence (q > bdi) is pinned on the real i18next in
    // `webPhrase.test.tsx`, because this file's key-echo `t` draws no slot.
    expect(row?.querySelector("span[title]")?.getAttribute("title")).toBe(
      "Porta Pia <b>1870</b> {{query}}",
    );
    expect(row?.querySelector("b")).toBeNull();
    expect(row?.textContent).toContain("dock.web.did.wikipedia");
    // Wikipedia is not billed: a count and no cost at all.
    expect(row?.querySelector("small")?.textContent).toBe(
      `dock.web.results:${JSON.stringify({ count: 2 })}`,
    );
    expect(line()).toContain("dock.trail.web.wikipedia");
  });

  // `/verify`'s dedupe stores a search whose pages were all shown under an
  // earlier search as `results: []` with `repeated`. "0 results"
  // there would be false, since the trace counts what the search returned,
  // and this row is the field's one reader.
  it("counts a /verify search's repeats, never 0 results for pages on screen", () => {
    mount(
      web([
        {
          callId: "w",
          engine: { kind: "wikipedia" },
          status: "searched",
          query: "Eiffel Tower",
          results: [RESULT],
        },
        {
          callId: "v",
          engine: { kind: "wikipedia" },
          status: "searched",
          query: "Tour Eiffel",
          results: [],
          repeated: 2,
        },
      ]),
    );
    const small = rows()[1]?.querySelector("small")?.textContent ?? "";
    expect(small).not.toContain(JSON.stringify({ count: 0 }));
    expect(small).toContain(JSON.stringify({ count: 2 }));
  });

  it("gives a billed search its cost as reported, never rounded to nothing", () => {
    mount(
      web([
        {
          callId: "w",
          engine: { kind: "provider", providerId: "openrouter" },
          status: "searched",
          query: "Porta Pia",
          results: [RESULT],
          costUsd: 0.004,
        },
      ]),
    );
    const small = rows()[0]?.querySelector("small")?.textContent ?? "";
    expect(small).toContain("$0.004");
    expect(small).not.toContain("$0.00 ");
  });

  it("says a billed search's cost was not reported rather than inventing one", () => {
    mount(
      web([
        {
          callId: "w",
          engine: { kind: "provider", providerId: "openrouter" },
          status: "searched",
          query: "Porta Pia",
          results: [],
        },
      ]),
    );
    expect(rows()[0]?.querySelector("small")?.textContent).toContain(
      "dock.web.costNotReported",
    );
  });

  it("names no query on a declined row: it never left", () => {
    mount(
      web([{ callId: "w", engine: { kind: "wikipedia" }, status: "declined" }]),
    );
    const [row] = rows();
    expect(row?.textContent).toContain("dock.web.declined.wikipedia");
    expect(row?.querySelector("q")).toBeNull();
    expect(row?.querySelector("[title]")).toBeNull();
    expect(row?.querySelector("small")).toBeNull();
  });

  it("tells a failed search as one, never as searched", () => {
    mount(
      web([
        {
          callId: "w",
          engine: { kind: "wikipedia" },
          status: "failed",
          query: "Porta Pia",
          code: "connection",
          reached: "no",
        },
      ]),
    );
    const text = rows()[0]?.textContent ?? "";
    expect(text).toContain("dock.web.failed.wikipedia");
    expect(text).not.toContain("dock.web.did");
  });

  it("draws no row for a search still in flight while live, and does once stored", () => {
    // Written ahead of its send, a record reads "interrupted" until the
    // search returns: while live that is the foot's to say, not the fold's.
    const inFlight = web([
      {
        callId: "w",
        engine: { kind: "wikipedia" },
        status: "failed",
        query: "Porta Pia",
        code: "interrupted",
        reached: "unknown",
      },
    ]);
    mount({ ...inFlight, outcome: "interrupted" }, null, {
      live: true,
      status: { shown: "dock.working" },
    });
    expect(rows()).toHaveLength(0);
    cleanup();
    mount({ ...inFlight, outcome: "interrupted" });
    expect(rows()).toHaveLength(1);
  });

  it("names both engines when both returned", () => {
    mount(
      web([
        {
          callId: "a",
          engine: { kind: "provider", providerId: "openrouter" },
          status: "searched",
          query: "one",
          results: [],
        },
        {
          callId: "b",
          engine: { kind: "wikipedia" },
          status: "searched",
          query: "two",
          results: [],
        },
      ]),
    );
    expect(line()).toContain("dock.trail.web.both");
  });

  it("says on the foot that an answer stood on no search, only when true", () => {
    mount(
      web([{ callId: "w", engine: { kind: "wikipedia" }, status: "declined" }]),
    );
    expect(facts()?.textContent).toContain("dock.answeredWithoutWeb");
    cleanup();
    // A query that may have left is never hidden behind "without".
    mount(
      web([
        {
          callId: "w",
          engine: { kind: "wikipedia" },
          status: "failed",
          query: "Porta Pia",
          code: "connection",
          reached: "unknown",
        },
      ]),
    );
    expect(facts()?.textContent ?? "").not.toContain("dock.answeredWithoutWeb");
  });
});

describe("AiTurn: the ask in the live foot", () => {
  it("takes the live line's place while a search waits on the writer", () => {
    render(
      <AiTurn
        web={NO_WEB_CITATIONS}
        turn={turn({ outcome: undefined, text: "" })}
        agentName={null}
        running
        live
        status={{ shown: "dock.awaitingWriter", ask: <p>the ask</p> }}
        titles={TITLES}
        pendingReview={null}
        onFindingStatus={vi.fn()}
        onShowEvidence={vi.fn()}
        onOpenSource={vi.fn()}
        onResumeReview={vi.fn()}
      />,
    );
    expect(document.body.textContent).toContain("the ask");
    expect(document.querySelector(".ai-activity")).toBeNull();
    cleanup();
    // Without an ask the live line is there: the check above is not vacuous.
    mount(turn({ outcome: undefined, text: "" }), null, {
      live: true,
      status: { shown: "dock.working" },
    });
    expect(document.querySelector(".ai-activity")).not.toBeNull();
  });
});

// ── Web sources cited, and the copy ──────────────────────────────────────────
//
// The entry is the domain's (`webCitations` over a turn with a real
// `searched` record), passed as the panel passes it. These rows pin where
// the list sits, that it arrives with the answer and stays when the answer
// stops, and that the screen and the copy come from one parse: in a chat
// that searched, no model link survives on either.

describe("an answer that cited the web", () => {
  const RESULTS = [
    { id: "web:1", url: "https://en.wikipedia.org/wiki/Rome", title: "Rome" },
    { id: "web:2", url: "https://www.example.org/two", title: "Two" },
  ];

  function searched(over: Partial<ChatTurn> = {}): ChatTurn {
    return turn({
      text: "Roma cadde web:1, e poi web:2.",
      web: [
        {
          callId: "c1",
          engine: { kind: "wikipedia" },
          status: "searched",
          query: "rome",
          results: RESULTS,
        },
      ],
      ...over,
    });
  }

  /** The entry the panel hands this turn; `live` names it while it streams. */
  const entryFor = (one: ChatTurn, live?: string) =>
    webCitations([one], live).get(one.id) ?? NO_WEB_CITATIONS;

  const rows = () =>
    [...document.querySelectorAll(".ai-web-sources li")].map(
      (row) => row.querySelector(".ai-web-n")?.textContent,
    );

  const copyButton = () =>
    document.querySelector<HTMLButtonElement>(".ai-turn-copy");

  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
    vi.restoreAllMocks();
  });

  it("puts the list last in the body, after the answer's prose", () => {
    const one = searched();
    mount(one, null, { web: entryFor(one) });
    const body = document.querySelector(".msg-body");
    const list = body?.lastElementChild;
    expect(list?.matches("ol.ai-web-sources")).toBe(true);
    expect(list?.previousElementSibling?.classList.contains("dock-read")).toBe(
      true,
    );
    expect(rows()).toEqual(["1", "2"]);
  });

  it("keeps the rows of a stopped turn and of a failed turn with text", () => {
    // What the answer said before it stopped still cites what it
    // cites, and a row gone with the stop would leave numbers pointing at
    // nothing.
    const stopped = searched({ outcome: "interrupted" });
    mount(stopped, null, { web: entryFor(stopped) });
    expect(rows()).toEqual(["1", "2"]);
    cleanup();
    const failed = searched({ outcome: "failed" });
    mount(failed, null, { web: entryFor(failed) });
    expect(rows()).toEqual(["1", "2"]);
  });

  // A model starting a sentence writes "Web:1"; it draws as the source it
  // names, with its row, never as the raw id.
  it("draws a capitalised id as its source", () => {
    const capital = searched({ text: "Web:1 places the fall in 1453." });
    mount(capital, null, { web: entryFor(capital) });
    expect(document.querySelectorAll(".dock-read .ai-web-mark")).toHaveLength(
      1,
    );
    expect(document.querySelector(".dock-read")?.textContent).not.toContain(
      "Web:1",
    );
    expect(rows()).toEqual(["1"]);
  });

  it("brings rows in while the answer streams, and none for a held-back trailing id", () => {
    // The trailing id may be half an id (`web:2` of a `web:21` still
    // arriving), so the domain holds it out of `cited` as the
    // renderer holds its marker: no marker, no row.
    const live = searched({
      outcome: undefined,
      text: "Roma cadde web:1, e poi web:2",
    });
    mount(live, null, {
      live: true,
      status: { shown: "dock.working" },
      web: entryFor(live, live.id),
    });
    expect(rows()).toEqual(["1"]);
    expect(document.querySelectorAll(".dock-read .ai-web-mark")).toHaveLength(
      1,
    );
    expect(document.querySelector(".dock-read")?.textContent).toContain(
      "web:2",
    );
  });

  it("holds a trailing id followed by whitespace out of the rows, as the screen holds its marker", () => {
    // Markdown trims a paragraph's trailing whitespace, so the renderer's
    // last text still ends on `web:2` and holds its marker. The walk scans
    // the live text trimmed, so no row numbered 2 stands under an answer
    // showing "web:2" as words.
    for (const tail of ["\n", " "]) {
      const live = searched({
        outcome: undefined,
        text: `Roma cadde web:1, e poi web:2${tail}`,
      });
      mount(live, null, {
        live: true,
        status: { shown: "dock.working" },
        web: entryFor(live, live.id),
      });
      expect(
        document.querySelectorAll(".dock-read .ai-web-mark"),
        JSON.stringify(tail),
      ).toHaveLength(1);
      expect(rows(), JSON.stringify(tail)).toEqual(["1"]);
      cleanup();
    }
  });

  // The one walk reads the raw Markdown, not the drawn text, so an id in a
  // link's destination or a reference definition's title is cited and
  // numbered though nothing on screen shows it, in source order: a
  // destination before the visible id takes 1 (the marker reads 2) and a
  // definition after it takes 2. The one visible marker
  // is `web:2`'s number and opens `web:2`'s url, and every row opens only a
  // url the search returned.
  it("numbers an id nothing on screen shows, and every row still opens a searched url", () => {
    for (const [text, visible, order] of [
      [
        "See [the page](https://x.org/web:1). Roma cadde (web:2).",
        "2",
        ["web:1", "web:2"],
      ],
      [
        'See [the page][r]. Roma cadde (web:2).\n\n[r]: https://x.org/p "web:1"',
        "1",
        ["web:2", "web:1"],
      ],
    ] as const) {
      const one = searched({ text });
      const entry = entryFor(one);
      mount(one, null, { web: entry });
      expect(document.querySelector(".dock-read")?.textContent).not.toContain(
        "web:1",
      );
      const marks = [
        ...document.querySelectorAll(".dock-read .ai-web-mark"),
      ].map((mark) => mark.textContent);
      expect(marks, text).toEqual([visible]);
      expect(rows(), text).toEqual(["1", "2"]);
      expect(entry.cited.map((source) => source.id)).toEqual(order);
      const searchedUrls = (one.web ?? []).flatMap((record) =>
        record.status === "searched"
          ? record.results.map((result) => result.url)
          : [],
      );
      const hrefs = [
        ...document.querySelectorAll<HTMLAnchorElement>(".ai-web-source"),
      ].map((row) => row.getAttribute("href"));
      expect(hrefs).toHaveLength(2);
      for (const href of hrefs) expect(searchedUrls).toContain(href);
      expect(hrefs[Number(visible) - 1]).toBe(
        entry.cited.find((source) => source.id === "web:2")?.url,
      );
      cleanup();
    }
  });

  it("draws no model link and copies no model url, from one parse (security's addendum (b))", () => {
    // One inert turn holding every shape a model link can take. The screen
    // has no anchor in the prose, and the copy holds no `https://` outside
    // the source lines, which are the only urls the writer is handed.
    const writeText = vi.fn<(text: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const one = searched({
      text: [
        "See [a page](https://evil.example/?q=prose), [a ref][r], ![img](https://img.example/i.png) and [web:1](https://x).",
        "Cited web:1.",
        "",
        "[r]: https://ref.example/x",
      ].join("\n"),
    });
    mount(one, null, { web: entryFor(one) });
    expect(document.querySelectorAll(".dock-read a")).toHaveLength(0);
    fireEvent.click(copyButton() as Element);
    const copied = writeText.mock.calls[0]?.[0] ?? "";
    const [body, ...sources] = copied.split("\n\n");
    expect(sources).toEqual(["[1] Rome · https://en.wikipedia.org/wiki/Rome"]);
    expect(body).toBe("See a page, a ref, img and web:1. Cited[1].");
    expect(body).not.toContain("https://");
  });

  it("re-renders a settled answer when a title it cites is renamed", () => {
    // Kept alive by the memo on `titles`: a memo that dropped it would keep
    // the old title on screen until something else moved.
    const one = turn({ text: "From node:S1.", sources: [SOURCE] });
    const draw = (titles: ReadonlyMap<string, string>) => (
      <AiTurn
        turn={one}
        agentName={null}
        running={false}
        titles={titles}
        web={NO_WEB_CITATIONS}
        pendingReview={null}
        onFindingStatus={vi.fn()}
        onShowEvidence={vi.fn()}
        onOpenSource={vi.fn()}
        onResumeReview={vi.fn()}
      />
    );
    const { rerender } = render(draw(TITLES));
    expect(document.querySelector(".ai-cite")?.textContent).toBe("Opening");
    rerender(draw(new Map([["node:S1", "The Opening, renamed"]])));
    expect(document.querySelector(".ai-cite")?.textContent).toBe(
      "The Opening, renamed",
    );
  });

  it("does not parse Copy's text per render", () => {
    // A settled answer re-renders whenever the panel does, as another
    // answer streams. Its copy is one parse of its text, memoized on what
    // it reads; computed in render it would parse the answer again on
    // every one of those renders.
    const writeText = vi.fn<(text: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const one = searched();
    const web = entryFor(one);
    const draw = (running: boolean) => (
      <AiTurn
        turn={one}
        agentName={null}
        running={running}
        titles={TITLES}
        web={web}
        pendingReview={null}
        onFindingStatus={vi.fn()}
        onShowEvidence={vi.fn()}
        onOpenSource={vi.fn()}
        onResumeReview={vi.fn()}
      />
    );
    const { rerender } = render(draw(false));
    const parse = vi.spyOn(markdown, "parse");
    rerender(draw(true));
    rerender(draw(false));
    expect(parse).not.toHaveBeenCalled();
    fireEvent.click(copyButton() as Element);
    expect(writeText).toHaveBeenCalledWith(
      [
        "Roma cadde[1], e poi[2].",
        "[1] Rome · https://en.wikipedia.org/wiki/Rome\n[2] Two · https://www.example.org/two",
      ].join("\n\n"),
    );
  });
});

describe("a chat continued from one that searched", () => {
  it("renders a model-written link as its words, before the chat's own first search", () => {
    // The digest of a searched chat can carry a steered link; the continued
    // chat starts latched, so no answer in it opens one.
    const one = turn({
      text: "See [the full story](https://evil.example/collect?q=chapter).",
    });
    const latched =
      webCitations([one], undefined, undefined, true).get(one.id) ??
      NO_WEB_CITATIONS;
    mount(one, null, { web: latched });
    const read = document.querySelector(".dock-read") as HTMLElement;
    expect(read.textContent).toContain("the full story");
    expect(read.querySelector("a")).toBeNull();
    cleanup();
    // Unlatched, the same answer's link is live: the row above is the flag's.
    mount(one, null, {
      web: webCitations([one]).get(one.id) ?? NO_WEB_CITATIONS,
    });
    expect(document.querySelector(".dock-read a")?.getAttribute("href")).toBe(
      "https://evil.example/collect?q=chapter",
    );
  });
});

// An answer's quotations the run could not find in what it read are named
// under the answer, after the prose.
describe("quotations not found in what was read", () => {
  const notice = () => document.querySelector(".ai-unfound");
  const draw = (one: ChatTurn, live = false) =>
    render(
      <AiTurn
        web={NO_WEB_CITATIONS}
        turn={one}
        agentName={null}
        running={false}
        live={live}
        titles={TITLES}
        pendingReview={null}
        onFindingStatus={vi.fn()}
        onShowEvidence={vi.fn()}
        onOpenSource={vi.fn()}
        onResumeReview={vi.fn()}
      />,
    );

  it("names each one, after the answer, and cuts a long one", () => {
    draw(
      turn({
        unfoundQuotes: ["A sentence the book never held.", "x".repeat(200)],
      }),
    );
    const line = notice();
    expect(line?.textContent).toContain('dock.unfoundQuotes:{"count":2}');
    const quotes = [...(line?.querySelectorAll("q") ?? [])].map(
      (one) => one.textContent,
    );
    expect(quotes).toEqual([
      "A sentence the book never held.",
      `${"x".repeat(89)}…`,
    ]);
    const body = document.querySelector(".msg-body");
    expect(
      body &&
        line &&
        body.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says nothing when every quotation was found, or while the answer streams", () => {
    draw(turn());
    expect(notice()).toBeNull();
    cleanup();
    draw(turn({ unfoundQuotes: ["A sentence the book never held."] }), true);
    expect(notice()).toBeNull();
  });
});

describe("the button to the chat an answer pointed to", () => {
  it("names the chat and where a reader will read to, and opens it", () => {
    const onOpenRoute = vi.fn();
    const route = { kind: "beta-reader" as const, through: "S2" };
    render(
      <AiTurn
        turn={turn({ route })}
        agentName={null}
        running={false}
        titles={TITLES}
        web={NO_WEB_CITATIONS}
        pendingReview={null}
        onFindingStatus={vi.fn()}
        onShowEvidence={vi.fn()}
        onOpenSource={vi.fn()}
        onResumeReview={vi.fn()}
        onOpenRoute={onOpenRoute}
      />,
    );
    const control = screen.getByRole("button", {
      name: `dock.route.openThrough:${JSON.stringify({
        chat: "dock.chatKind.beta-reader",
        title: "Scene two",
      })}`,
    });
    fireEvent.click(control);
    expect(onOpenRoute).toHaveBeenCalledWith(route);
  });

  it("offers no button where the panel gives none, as while a run is in flight", () => {
    mount(turn({ route: { kind: "editorial" } }));
    expect(document.querySelector(".ai-route-row")).toBeNull();
  });
});

describe("the facts line's counts", () => {
  it("groups the tokens as the language groups a count", () => {
    mount(
      turn({
        personaId: AGENT_ID,
        usage: {
          inputTokens: 1820,
          outputTokens: 320,
          totalTokens: 2140,
          steps: 1,
        },
      }),
      AGENT_NAME,
    );
    expect(facts()?.textContent).toContain(`"total":"2,140"`);
    expect(facts()?.textContent).toContain(`"input":"1,820"`);
  });
});
