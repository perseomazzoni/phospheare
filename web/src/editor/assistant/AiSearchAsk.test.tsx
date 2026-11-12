// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createRef, StrictMode, useLayoutEffect } from "react";
import AiSearchAsk, { ASK_ARM_MS, type AiSearchAskProps } from "./AiSearchAsk";
import type { SearchAsk } from "../../ai/domain/types";
import { QUERY_MAX } from "../../ai/domain/webText";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: "en" },
  }),
}));

// The ask's clock is the wall clock (`Date.now`), and fake timers move both.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-27T12:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const WIKI = { kind: "wikipedia" } as const;

function first(
  rows: Array<{ query: string; bookWords?: boolean }>,
  over: Partial<SearchAsk> = {},
): SearchAsk {
  return {
    askId: "ask-1",
    engine: WIKI,
    kind: "first",
    rows: rows.map((row, index) => ({
      rowId: `r${index}`,
      query: row.query,
      bookWords: row.bookWords ?? false,
    })),
    ...over,
  } as SearchAsk;
}

function mount(ask: SearchAsk, over: Partial<AiSearchAskProps> = {}) {
  const props: AiSearchAskProps = {
    ask,
    onAnswer: vi.fn(() => true),
    holdsBookWords: vi.fn(() => false),
    scroller: createRef<HTMLElement>(),
    revealedAt: 0,
    onSpeak: vi.fn(),
    onDecided: vi.fn(),
    ...over,
  };
  const view = render(<AiSearchAsk {...props} />);
  return { ...props, ...view };
}

const search = () =>
  screen.getByRole("button", { name: "dock.web.search" }) as HTMLButtonElement;
const decline = () => screen.getByRole("button", { name: "dock.web.decline" });
const field = () => screen.getByRole("textbox") as HTMLTextAreaElement;
// Several queries are read-only text until Edit: the rows that pin
// the fields press it first.
const openFields = () =>
  fireEvent.click(screen.getByRole("button", { name: "dock.web.editName" }));
const later = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("AiSearchAsk: arming", () => {
  it("drops an Enter inside the window and takes one at 500 ms", () => {
    const { onAnswer } = mount(first([{ query: "Porta Pia 1870" }]));
    later(ASK_ARM_MS - 1);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onAnswer).not.toHaveBeenCalled();
    later(1);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onAnswer).toHaveBeenCalledWith({
      kind: "send",
      rows: [{ rowId: "r0", query: "Porta Pia 1870" }],
    });
  });

  it("drops a click on Search inside the window, never queues it", () => {
    const { onAnswer } = mount(first([{ query: "Porta Pia" }]));
    fireEvent.click(search());
    later(ASK_ARM_MS);
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(search());
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("takes only a plain, first, composed Enter", () => {
    const { onAnswer } = mount(first([{ query: "Porta Pia" }]));
    later(ASK_ARM_MS);
    fireEvent.keyDown(field(), { key: "Enter", repeat: true });
    fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(field(), { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("restarts on every reveal the panel stamps", () => {
    const ask = first([{ query: "Porta Pia" }]);
    const view = mount(ask);
    later(ASK_ARM_MS);
    view.rerender(<AiSearchAsk {...view} ask={ask} revealedAt={Date.now()} />);
    fireEvent.click(search());
    expect(view.onAnswer).not.toHaveBeenCalled();
    later(ASK_ARM_MS);
    fireEvent.click(search());
    expect(view.onAnswer).toHaveBeenCalledTimes(1);
  });

  it("restarts when the tab comes back", () => {
    const { onAnswer } = mount(first([{ query: "Porta Pia" }]));
    later(ASK_ARM_MS);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    fireEvent.click(search());
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("gives a new ask its own window: nothing armed carries across", () => {
    const one = first([{ query: "Porta Pia" }]);
    const view = mount(one);
    later(ASK_ARM_MS);
    const two = first([{ query: "Breccia" }], { askId: "ask-2" });
    // The panel keys the ask on its id: a fresh element.
    view.rerender(<AiSearchAsk key="ask-2" {...view} ask={two} />);
    fireEvent.click(search());
    expect(view.onAnswer).not.toHaveBeenCalled();
  });
});

describe("AiSearchAsk: the answer", () => {
  it("sends each field as the writer left it", () => {
    const { onAnswer } = mount(first([{ query: "Porta Pia" }]));
    fireEvent.change(field(), { target: { value: "  Breccia di Porta Pia " } });
    later(ASK_ARM_MS);
    fireEvent.click(search());
    expect(onAnswer).toHaveBeenCalledWith({
      kind: "send",
      rows: [{ rowId: "r0", query: "Breccia di Porta Pia" }],
    });
  });

  it("holds Search while a ticked field cannot be sent", () => {
    mount(first([{ query: "Porta Pia" }]));
    fireEvent.change(field(), { target: { value: "   " } });
    expect(search().disabled).toBe(true);
  });

  it("sends the ticked rows only, and holds Search when none is", () => {
    const { onAnswer } = mount(
      first([{ query: "Porta Pia" }, { query: "Cadorna" }]),
    );
    // Several rows open behind Edit.
    openFields();
    const ticks = screen.getAllByRole("checkbox", { checked: true });
    expect(ticks).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox", { name: "Cadorna" }));
    const fields = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    expect(fields[1]?.disabled).toBe(true);
    // The note counts what would leave, live.
    expect(document.body.textContent).toContain(
      'dock.web.note.wikipedia:{"count":1}',
    );
    later(ASK_ARM_MS);
    fireEvent.click(search());
    expect(onAnswer).toHaveBeenCalledWith({
      kind: "send",
      rows: [{ rowId: "r0", query: "Porta Pia" }],
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Porta Pia" }));
    expect(search().disabled).toBe(true);
  });

  it("never leaves a tick nameless when its field is emptied", () => {
    mount(first([{ query: "Porta Pia" }, { query: "Cadorna" }]));
    // Several rows open behind Edit.
    openFields();
    const fields = screen.getAllByRole("textbox");
    fireEvent.change(fields[1] as HTMLElement, { target: { value: "" } });
    expect(
      screen.getByRole("checkbox", { name: "dock.web.ask.wikipedia" }),
    ).toBeTruthy();
  });

  it("declines on Esc at once, ungated, and keeps it from the dock", () => {
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    const { onAnswer } = mount(first([{ query: "Porta Pia" }]));
    fireEvent.keyDown(field(), { key: "Escape" });
    document.removeEventListener("keydown", outer);
    expect(onAnswer).toHaveBeenCalledWith({ kind: "decline" });
    expect(outer).not.toHaveBeenCalled();
  });

  it("declines on Don't search inside the window", () => {
    const { onAnswer } = mount(first([{ query: "Porta Pia" }]));
    fireEvent.click(decline());
    expect(onAnswer).toHaveBeenCalledWith({ kind: "decline" });
  });

  it("says whether focus was in the ask when it was decided", () => {
    const inside = mount(first([{ query: "Porta Pia" }]));
    field().focus();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(inside.onDecided).toHaveBeenCalledWith(true);
    cleanup();
    const outside = mount(first([{ query: "Porta Pia" }]));
    fireEvent.click(decline());
    expect(outside.onDecided).toHaveBeenCalledWith(false);
  });

  it("reports nothing decided when the Assistant refused the answer", () => {
    const { onDecided } = mount(first([{ query: "Porta Pia" }]), {
      onAnswer: vi.fn(() => false),
    });
    fireEvent.click(decline());
    expect(onDecided).not.toHaveBeenCalled();
  });
});

describe("AiSearchAsk: the flag", () => {
  it("follows the words a beat after typing stops", () => {
    const holds = vi.fn((query: string) => query.includes("Marta"));
    mount(first([{ query: "Porta Pia" }]), { holdsBookWords: holds });
    expect(document.querySelector(".ui-input-note-flag")).toBeNull();
    fireEvent.change(field(), { target: { value: "Marta a Porta Pia" } });
    later(249);
    expect(document.querySelector(".ui-input-note-flag")).toBeNull();
    later(1);
    expect(document.querySelector(".ui-input-note-flag")?.textContent).toBe(
      "dock.web.flag",
    );
    fireEvent.change(field(), { target: { value: "Porta Pia" } });
    later(250);
    expect(document.querySelector(".ui-input-note-flag")).toBeNull();
  });

  it("is said with the ask as it appears", () => {
    const { onSpeak } = mount(
      first([{ query: "Marta a Porta Pia", bookWords: true }]),
    );
    expect(onSpeak).toHaveBeenCalledWith("dock.awaitingWriter dock.web.flag");
  });
});

describe("AiSearchAsk: a re-ask", () => {
  it("says only whether the search left", () => {
    mount(
      first([{ query: "Porta Pia" }], {
        kind: "re-ask",
        code: "connection",
        reached: "no",
      } as Partial<SearchAsk>),
    );
    expect(document.querySelector(".ai-lede")?.textContent).toBe(
      "dock.web.reask.notSent",
    );
    cleanup();
    mount(
      first([{ query: "Porta Pia" }], {
        kind: "re-ask",
        code: "connection",
        reached: "unknown",
      } as Partial<SearchAsk>),
    );
    expect(document.querySelector(".ai-lede")?.textContent).toBe(
      "dock.web.reask.maybeSent",
    );
  });
});

describe("AiSearchAsk: a retry", () => {
  function retry(inMs: number, bookWords = false): SearchAsk {
    return {
      askId: "ask-r",
      engine: { kind: "provider", providerId: "openrouter" },
      kind: "retry",
      at: new Date(Date.now() + inMs).toISOString(),
      rows: [{ rowId: "r0", query: "Porta Pia 1870", bookWords }],
    };
  }
  const again = () =>
    screen.getByRole("button", { name: "dock.web.retry" }) as HTMLButtonElement;

  it("is a group named by where the queries go and described by its note", () => {
    // The resend's cost is heard with its destination, as on the
    // several-search face; the note it points at is the one on screen.
    mount(retry(2_000));
    const group = screen.getByRole("group", {
      name: "dock.web.ask.web",
      description: 'dock.web.note.web:{"count":1}',
    });
    const note = document.getElementById(
      group.getAttribute("aria-describedby") ?? "",
    );
    expect(note?.className).toBe("ui-input-note");
    expect(group.contains(note)).toBe(true);
  });

  it("holds the query as text, with nothing to edit", () => {
    mount(retry(2_000));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelector(".ai-ask-query q bdi")?.textContent).toBe(
      "Porta Pia 1870",
    );
  });

  it("stays disabled until the wait and the arming have both passed", () => {
    const { onAnswer } = mount(retry(2_000));
    expect(again().disabled).toBe(true);
    expect(document.querySelector(".ai-lede")?.textContent).toContain(
      "dock.web.retryLede.wait",
    );
    later(2_000 + ASK_ARM_MS - 1);
    expect(again().disabled).toBe(true);
    later(1);
    expect(again().disabled).toBe(false);
    expect(document.querySelector(".ai-lede")?.textContent).toBe(
      "dock.web.retryLede.ready",
    );
    fireEvent.click(again());
    expect(onAnswer).toHaveBeenCalledWith({ kind: "retry" });
  });

  it("names the wait by a clock minute, never earlier than the wait", () => {
    mount(retry(61_000));
    // 12:01:01 rounds up to 12:02 in the writer's clock.
    const lede = document.querySelector(".ai-lede")?.textContent ?? "";
    const time = new Intl.DateTimeFormat("en", { timeStyle: "short" }).format(
      new Date("2026-09-27T12:02:00.000Z"),
    );
    expect(lede).toContain(time);
  });

  it("is ready at once when the wait is already over, armed a beat later", () => {
    const { onAnswer } = mount(retry(-10_000));
    expect(again().disabled).toBe(false);
    fireEvent.click(again());
    expect(onAnswer).not.toHaveBeenCalled();
    later(ASK_ARM_MS);
    fireEvent.click(again());
    expect(onAnswer).toHaveBeenCalledWith({ kind: "retry" });
  });

  it("speaks the flag with the first words, then only the swapped lede", () => {
    const { onSpeak } = mount(retry(1_000, true));
    expect(onSpeak).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /^dock\.awaitingWriter dock\.web\.retryLede\.wait.* dock\.web\.flag$/,
      ),
    );
    later(1_000 + ASK_ARM_MS);
    expect(onSpeak).toHaveBeenLastCalledWith("dock.web.retryLede.ready");
  });

  it("declines on Esc while Retry still waits", () => {
    const { onAnswer } = mount(retry(5_000));
    fireEvent.keyDown(document.querySelector(".ai-ask") as HTMLElement, {
      key: "Escape",
    });
    expect(onAnswer).toHaveBeenCalledWith({ kind: "decline" });
  });

  // `npm run dev` renders under StrictMode, which runs every effect twice on
  // mount while keeping refs. A `spoken` ref set by the first run must not
  // leave the second speaking the lede alone, without "waiting" and the
  // flag.
  it("speaks waiting and the flag first under StrictMode too", () => {
    const onSpeak = vi.fn();
    render(
      <StrictMode>
        <AiSearchAsk
          ask={retry(1_000, true)}
          onAnswer={vi.fn(() => true)}
          holdsBookWords={vi.fn(() => false)}
          scroller={createRef<HTMLElement>()}
          revealedAt={0}
          onSpeak={onSpeak}
          onDecided={vi.fn()}
        />
      </StrictMode>,
    );
    expect(onSpeak).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /^dock\.awaitingWriter dock\.web\.retryLede\.wait.* dock\.web\.flag$/,
      ),
    );
  });
});

// ── Guarantees pinned against their mutations ────────────────────────────────
//
// Each row fails under the mutation it names.

/** The ids an element is described by, resolved to their text. */
function describedBy(element: Element | null | undefined): string {
  return (element?.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" | ");
}

describe("AiSearchAsk: the corners the rows above leave unpinned", () => {
  it("restarts arming before paint: a parent's layout effect cannot land a press", () => {
    // A parent's layout effect runs after its child's: if the restart were
    // passive, this press would find the old window spent.
    const onAnswer = vi.fn(() => true);
    function Probe({ revealedAt }: { revealedAt: number }) {
      useLayoutEffect(() => {
        if (revealedAt > 0)
          document
            .querySelector<HTMLButtonElement>(".ai-ask .ui-btn-soft")
            ?.click();
      }, [revealedAt]);
      return (
        <AiSearchAsk
          ask={first([{ query: "Porta Pia" }])}
          onAnswer={onAnswer}
          holdsBookWords={() => false}
          scroller={createRef<HTMLElement>()}
          revealedAt={revealedAt}
          onSpeak={vi.fn()}
          onDecided={vi.fn()}
        />
      );
    }
    const view = render(<Probe revealedAt={0} />);
    later(ASK_ARM_MS);
    view.rerender(<Probe revealedAt={Date.now()} />);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("holds Search while ANY ticked row cannot be sent, not only all", () => {
    const { onAnswer } = mount(
      first([{ query: "Porta Pia" }, { query: "Cadorna" }]),
    );
    // Several rows open behind Edit.
    openFields();
    const fields = screen.getAllByRole("textbox");
    fireEvent.change(fields[1] as HTMLElement, { target: { value: "  " } });
    later(ASK_ARM_MS);
    expect(search().disabled).toBe(true);
    fireEvent.keyDown(fields[0] as HTMLElement, { key: "Enter" });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("never says a search that reached its engine was not sent", () => {
    mount(
      first([{ query: "Porta Pia" }], {
        kind: "re-ask",
        code: "timeout",
        reached: "yes",
      } as Partial<SearchAsk>),
    );
    expect(document.querySelector(".ai-lede")?.textContent).toBe(
      "dock.web.reask.maybeSent",
    );
  });

  it("describes the single field by the destination and its count", () => {
    mount(first([{ query: "Porta Pia" }]));
    expect(describedBy(field())).toContain(
      'dock.web.note.wikipedia:{"count":1}',
    );
  });

  it("describes every row's field by the one note", () => {
    mount(first([{ query: "Porta Pia" }, { query: "Cadorna" }]));
    // Several rows open behind Edit.
    openFields();
    for (const one of screen.getAllByRole("textbox"))
      expect(describedBy(one)).toContain('dock.web.note.wikipedia:{"count":2}');
  });

  it("follows the ticked count on a paid search: each, then one", () => {
    mount(
      first([{ query: "Porta Pia" }, { query: "Cadorna" }], {
        engine: { kind: "provider", providerId: "openrouter" },
      }),
    );
    // Several rows open behind Edit.
    openFields();
    const note = () => document.querySelector(".ai-ask-rows .ui-input-note");
    expect(note()?.textContent).toBe('dock.web.note.web:{"count":2}');
    fireEvent.click(screen.getByRole("checkbox", { name: "Cadorna" }));
    expect(note()?.textContent).toBe('dock.web.note.web:{"count":1}');
  });

  it("shows the flag as the ask appears, not only after an edit", () => {
    mount(first([{ query: "Marta a Porta Pia", bookWords: true }]));
    expect(document.querySelector(".ui-input-note-flag")?.textContent).toBe(
      "dock.web.flag",
    );
    expect(describedBy(field())).toContain("dock.web.flag");
  });

  it("ties a retry's flag to the query it is about", () => {
    mount({
      askId: "ask-r",
      engine: WIKI,
      kind: "retry",
      at: new Date(Date.now() + 1_000).toISOString(),
      rows: [
        { rowId: "r0", query: "Porta Pia", bookWords: false },
        { rowId: "r1", query: "Marta a Roma", bookWords: true },
      ],
    });
    const [plain, flagged] = [...document.querySelectorAll(".ai-ask-query")];
    expect(describedBy(plain)).toBe("");
    expect(describedBy(flagged)).toBe("dock.web.flag");
  });

  it("cuts a query at the cap in the field, where the writer sees it", () => {
    mount(first([{ query: "Porta Pia" }]));
    fireEvent.change(field(), {
      target: { value: "a".repeat(QUERY_MAX + 40) },
    });
    expect(Array.from(field().value)).toHaveLength(QUERY_MAX);
  });

  it("re-reads the clock when a throttled tab comes back", () => {
    mount({
      askId: "ask-r",
      engine: WIKI,
      kind: "retry",
      at: new Date(Date.now() + 2_000).toISOString(),
      rows: [{ rowId: "r0", query: "Porta Pia", bookWords: false }],
    });
    const again = () =>
      screen.getByRole("button", {
        name: "dock.web.retry",
      }) as HTMLButtonElement;
    expect(again().disabled).toBe(true);
    // The wall clock moves; the throttled timer has not fired.
    vi.setSystemTime(Date.now() + 2_000 + ASK_ARM_MS);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(again().disabled).toBe(false);
  });

  it("restarts when the actions come into the transcript's view", () => {
    let fire: (entries: Array<{ isIntersecting: boolean }>) => void = () =>
      undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof fire) {
          fire = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      const { onAnswer } = mount(first([{ query: "Porta Pia" }]));
      later(ASK_ARM_MS);
      act(() => fire([{ isIntersecting: true }]));
      fireEvent.click(search());
      expect(onAnswer).not.toHaveBeenCalled();
      later(ASK_ARM_MS);
      fireEvent.click(search());
      expect(onAnswer).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("takes no Enter with Alt or Meta held", () => {
    const { onAnswer } = mount(first([{ query: "Porta Pia" }]));
    later(ASK_ARM_MS);
    fireEvent.keyDown(field(), { key: "Enter", altKey: true });
    fireEvent.keyDown(field(), { key: "Enter", metaKey: true });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("keeps its Esc from the page's other handlers", () => {
    mount(first([{ query: "Porta Pia" }]));
    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    field().dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
  });

  it("says a re-ask's reason with its first words", () => {
    const { onSpeak } = mount(
      first([{ query: "Porta Pia" }], {
        kind: "re-ask",
        code: "connection",
        reached: "no",
      } as Partial<SearchAsk>),
    );
    expect(onSpeak).toHaveBeenCalledWith(
      "dock.awaitingWriter dock.web.reask.notSent",
    );
  });

  it("re-checks the flag once typing stops, not once per keystroke", () => {
    const holds = vi.fn((query: string) => query.length < 0);
    mount(first([{ query: "Porta Pia" }]), { holdsBookWords: holds });
    fireEvent.change(field(), { target: { value: "Porta" } });
    later(200);
    fireEvent.change(field(), { target: { value: "Porta Pia 1870" } });
    later(250);
    expect(holds.mock.calls).toEqual([["Porta Pia 1870"]]);
  });
});

describe("AiSearchAsk: the security conditions", () => {
  it("leaves the Esc that cancels an IME composition to the IME", () => {
    const { onAnswer } = mount(first([{ query: "Porta Pia" }]));
    fireEvent.keyDown(field(), { key: "Escape", isComposing: true });
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(onAnswer).toHaveBeenCalledWith({ kind: "decline" });
  });

  it("is a group named by where the query goes, on both bodies", () => {
    mount(first([{ query: "Porta Pia" }]));
    expect(
      screen.getByRole("group", { name: "dock.web.ask.wikipedia" }),
    ).toBeTruthy();
    cleanup();
    mount({
      askId: "ask-r",
      engine: WIKI,
      kind: "retry",
      at: new Date(Date.now() + 1_000).toISOString(),
      rows: [{ rowId: "r0", query: "Porta Pia", bookWords: false }],
    });
    expect(
      screen.getByRole("group", { name: "dock.web.ask.wikipedia" }),
    ).toBeTruthy();
  });
});

// ── Several queries, read-only until Edit ────────────────────────────────────
//
// An ask with more than one query shows them whole, as text, with one Search
// and an Edit that opens the fields, so the first face asks only what consent
// needs.

describe("AiSearchAsk: several queries, read-only until Edit", () => {
  const two = () => first([{ query: "Porta Pia" }, { query: "Cadorna" }]);
  const edit = () =>
    screen.queryByRole("button", { name: "dock.web.editName" });
  const shown = () =>
    Array.from(document.querySelectorAll(".ai-ask-query q > bdi")).map(
      (one) => one.textContent,
    );

  it("shows each query whole, as text, in a group named by where they go", () => {
    mount(two());
    const group = screen.getByRole("group", { name: "dock.web.ask.wikipedia" });
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(
      0,
    );
    expect(
      document.querySelectorAll("ul.ai-ask-queries > li .ai-ask-query"),
    ).toHaveLength(2);
    expect(shown()).toEqual(["Porta Pia", "Cadorna"]);
    // The note describes the group, and counts every query, since all go.
    const note = document.getElementById(
      group.getAttribute("aria-describedby") ?? "",
    );
    expect(note?.textContent).toBe('dock.web.note.wikipedia:{"count":2}');
  });

  it("puts Edit LAST, a button named for what it edits", () => {
    mount(two());
    const actions = document.querySelector(".ai-finding-actions");
    expect(
      Array.from(actions?.querySelectorAll("button") ?? []).map(
        (one) => one.textContent,
      ),
    ).toEqual(["dock.web.search", "dock.web.decline", "dock.web.edit"]);
    expect(edit()?.getAttribute("aria-label")).toBe("dock.web.editName");
    expect(edit()?.querySelector("svg")).toBeNull();
  });

  it("sends every query as shown, one press", () => {
    const { onAnswer } = mount(two());
    later(ASK_ARM_MS);
    fireEvent.click(search());
    expect(onAnswer).toHaveBeenCalledWith({
      kind: "send",
      rows: [
        { rowId: "r0", query: "Porta Pia" },
        { rowId: "r1", query: "Cadorna" },
      ],
    });
  });

  it("shows exactly what leaves: the cap whole, right-to-left text as it is, the normalised form", () => {
    const full = "q".repeat(QUERY_MAX);
    const rtl = "القدس 1917";
    const astral = "𝔄𝔅 Roma 1870";
    // NFD and a zero-width space in, the normalised line out: what is shown
    // is the string sent, never the raw one, so a face drawing `row.value`
    // fails this.
    const crafted = "Città ​di  Castello";
    const { onAnswer } = mount(
      first([
        { query: full },
        { query: rtl },
        { query: astral },
        { query: crafted },
      ]),
    );
    later(ASK_ARM_MS);
    fireEvent.click(search());
    expect(onAnswer).toHaveBeenCalledTimes(1);
    const sent = (
      vi.mocked(onAnswer).mock.calls[0]?.[0] as { rows: { query: string }[] }
    ).rows.map((row) => row.query);
    expect(sent).toEqual([full, rtl, astral, "Città di Castello"]);
    // Never fewer sent than listed, and each as its row shows it.
    expect(shown()).toEqual(sent);
  });

  it("opens with its fields when a query cannot leave as written", () => {
    mount(first([{ query: "Porta Pia" }, { query: "   " }]));
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(edit()).toBeNull();
    later(ASK_ARM_MS);
    expect(search().disabled).toBe(true);
  });

  // An ask can mount with its fields out, and nothing may take focus then,
  // which a focus effect keyed on `open` would do; focus belongs to Edit's
  // handler.
  it("takes no focus when several rows mount with their fields out", () => {
    mount(first([{ query: "Porta Pia" }, { query: "   " }]));
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(document.activeElement).toBe(document.body);
  });

  it("opens into today's fields, all ticked, and never closes again", () => {
    mount(two());
    fireEvent.click(edit() as HTMLElement);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
    expect(edit()).toBeNull();
    expect(document.querySelector(".ai-ask-queries")).toBeNull();
    // Nothing offers the text face back.
    expect(
      Array.from(document.querySelectorAll(".ai-finding-actions button")).map(
        (one) => one.textContent,
      ),
    ).toEqual(["dock.web.search", "dock.web.decline"]);
  });

  it("moves no focus by itself, and puts Edit's press in the first field, caret at the end", () => {
    // An astral first query, so the caret is placed in UTF-16 units — the
    // unit `setSelectionRange` counts — never in code points.
    const astral = "𝔄𝔅 Roma";
    const view = mount(first([{ query: astral }, { query: "Cadorna" }]));
    expect(document.activeElement).toBe(document.body);
    // Neither a reveal nor the tab coming back moves it.
    view.rerender(<AiSearchAsk {...view} revealedAt={Date.now()} />);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(document.activeElement).toBe(document.body);
    (edit() as HTMLElement).focus();
    fireEvent.click(edit() as HTMLElement);
    const [firstField] = screen.getAllByRole(
      "textbox",
    ) as HTMLTextAreaElement[];
    expect(document.activeElement).toBe(firstField);
    expect(firstField?.selectionStart).toBe(astral.length);
    expect(firstField?.selectionEnd).toBe(astral.length);
    // Taken once: focus the writer moves on stays where they put it, through
    // a later reveal.
    search().focus();
    view.rerender(<AiSearchAsk {...view} revealedAt={Date.now() + 1} />);
    expect(document.activeElement).toBe(search());
  });

  it("restarts arming on Edit, so a double press never lands on Search", () => {
    const { onAnswer } = mount(two());
    later(ASK_ARM_MS);
    fireEvent.click(edit() as HTMLElement);
    fireEvent.click(search());
    fireEvent.keyDown(screen.getAllByRole("textbox")[0] as HTMLElement, {
      key: "Enter",
    });
    expect(onAnswer).not.toHaveBeenCalled();
    later(ASK_ARM_MS);
    fireEvent.click(search());
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("takes no Enter outside a focused Search", () => {
    const { onAnswer } = mount(two());
    later(ASK_ARM_MS);
    const group = screen.getByRole("group");
    fireEvent.keyDown(group, { key: "Enter" });
    for (const query of document.querySelectorAll(".ai-ask-query"))
      fireEvent.keyDown(query, { key: "Enter" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onAnswer).not.toHaveBeenCalled();
    // Esc still declines, ungated.
    fireEvent.keyDown(group, { key: "Escape" });
    expect(onAnswer).toHaveBeenCalledWith({ kind: "decline" });
  });

  it("flags the query that holds the writer's words, under it, in both faces", () => {
    mount(
      first([
        { query: "Porta Pia" },
        { query: "Marta's letter", bookWords: true },
      ]),
    );
    const [plain, flagged] = Array.from(
      document.querySelectorAll(".ai-ask-query"),
    );
    expect(plain?.getAttribute("aria-describedby")).toBeNull();
    const flag = document.getElementById(
      flagged?.getAttribute("aria-describedby") ?? "",
    );
    expect(flag?.textContent).toBe("dock.web.flag");
    expect(flag?.previousElementSibling).toBe(flagged);
    // The flag never opens the fields: Edit is the remedy, and stays plain.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    fireEvent.click(edit() as HTMLElement);
    expect(document.body.textContent).toContain("dock.web.flag");
  });

  it("keeps ONE actions node across Edit, so arming keeps watching it", () => {
    let fire: (entries: Array<{ isIntersecting: boolean }>) => void = () =>
      undefined;
    const watched: Element[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof fire) {
          fire = callback;
        }
        observe(element: Element) {
          watched.push(element);
        }
        disconnect() {}
      },
    );
    try {
      const { onAnswer } = mount(two());
      const actions = document.querySelector(".ai-finding-actions");
      fireEvent.click(edit() as HTMLElement);
      expect(document.querySelector(".ai-finding-actions")).toBe(actions);
      expect(watched.every((one) => one.isConnected)).toBe(true);
      // The actions coming into view after Edit still restart the clock.
      later(ASK_ARM_MS);
      act(() => fire([{ isIntersecting: true }]));
      fireEvent.click(search());
      expect(onAnswer).not.toHaveBeenCalled();
      later(ASK_ARM_MS);
      fireEvent.click(search());
      expect(onAnswer).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens at once on Edit, even inside the arming window, because Edit sends nothing", () => {
    mount(two());
    fireEvent.click(edit() as HTMLElement);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });

  it("takes no Enter on Edit as a send, and a held one in the new field neither", () => {
    const { onAnswer } = mount(two());
    later(ASK_ARM_MS);
    // A keydown is not a click in jsdom: Enter on Edit does nothing here,
    // and in a browser its activation is Edit's click, which sends nothing.
    fireEvent.keyDown(edit() as HTMLElement, { key: "Enter" });
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    fireEvent.click(edit() as HTMLElement);
    later(ASK_ARM_MS);
    fireEvent.keyDown(screen.getAllByRole("textbox")[0] as HTMLElement, {
      key: "Enter",
      repeat: true,
    });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("declines on Esc from Edit at once, and leaves an IME's Esc alone", () => {
    const { onAnswer } = mount(two());
    // The IME's Esc is the IME's, so it travels on untouched.
    fireEvent.keyDown(edit() as HTMLElement, {
      key: "Escape",
      isComposing: true,
    });
    expect(onAnswer).not.toHaveBeenCalled();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    fireEvent.keyDown(edit() as HTMLElement, { key: "Escape" });
    document.removeEventListener("keydown", outer);
    expect(onAnswer).toHaveBeenCalledWith({ kind: "decline" });
    expect(outer).not.toHaveBeenCalled();
  });

  it("says nothing but the label, the queries, their flag, the note and the three buttons", () => {
    mount(first([{ query: "Porta Pia" }, { query: "Marta", bookWords: true }]));
    expect(document.querySelector(".ai-ask")?.textContent).toBe(
      [
        "dock.web.ask.wikipedia",
        "Porta Pia",
        "Marta",
        "dock.web.flag",
        'dock.web.note.wikipedia:{"count":2}',
        "dock.web.search",
        "dock.web.decline",
        "dock.web.edit",
      ].join(""),
    );
  });

  it("speaks once as it appears, and Edit adds nothing to say", () => {
    const { onSpeak } = mount(
      first([{ query: "Porta Pia" }, { query: "Marta", bookWords: true }]),
    );
    expect(onSpeak).toHaveBeenCalledTimes(1);
    expect(onSpeak).toHaveBeenCalledWith("dock.awaitingWriter dock.web.flag");
    fireEvent.click(edit() as HTMLElement);
    expect(onSpeak).toHaveBeenCalledTimes(1);
  });

  it("names the paid engine's note per search on the text face too", () => {
    mount(
      first([{ query: "Porta Pia" }, { query: "Cadorna" }, { query: "Roma" }], {
        engine: { kind: "provider", providerId: "openrouter" },
      }),
    );
    const group = screen.getByRole("group", { name: "dock.web.ask.web" });
    expect(
      document.getElementById(group.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe('dock.web.note.web:{"count":3}');
  });

  it("collapses a re-ask too, under its lede; one query keeps its field", () => {
    mount(
      first([{ query: "Porta Pia" }, { query: "Cadorna" }], {
        kind: "re-ask",
        reached: "no",
      } as Partial<SearchAsk>),
    );
    expect(document.querySelector(".ai-lede")?.textContent).toBe(
      "dock.web.reask.notSent",
    );
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(edit()).not.toBeNull();
    cleanup();
    mount(first([{ query: "Porta Pia" }]));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(edit()).toBeNull();
  });
});

// ── What each face offers ────────────────────────────────────────────────────
//
// Each face as assistive technology meets it: the one group and its name and
// description, the queries and their flags, the fields' names, values and
// descriptions, and the actions in order with their disabled state.

/** Every button an ask shows, in order, with whether it is disabled. */
function actions(): Array<[string, boolean]> {
  return (screen.getAllByRole("button") as HTMLButtonElement[]).map((one) => [
    one.textContent ?? "",
    one.disabled,
  ]);
}

/**
 * The queries a read-only face shows, each in its bidi-isolated quote, with
 * what describes the element holding that quote.
 */
function quoted(root: Element): Array<[string, string]> {
  return Array.from(root.querySelectorAll("q > bdi")).map((one) => [
    one.textContent ?? "",
    describedBy(one.closest("q")?.parentElement),
  ]);
}

describe("AiSearchAsk: what each face offers", () => {
  const retry = (rows: Array<{ query: string; bookWords?: boolean }>) =>
    ({
      askId: "ask-r",
      engine: WIKI,
      kind: "retry",
      at: new Date(Date.now() + 1_000).toISOString(),
      rows: rows.map((row, index) => ({
        rowId: `r${index}`,
        query: row.query,
        bookWords: row.bookWords ?? false,
      })),
    }) as SearchAsk;

  it("offers a two-row retry as one described group, its flag on its query, Retry held", () => {
    mount(retry([{ query: "Porta Pia" }, { query: "Marta", bookWords: true }]));
    // The only group, so the destination is heard once; focusable by script
    // only, where the jump lands.
    const [group, ...others] = screen.getAllByRole("group");
    expect(others).toHaveLength(0);
    expect(group).toBe(
      screen.getByRole("group", {
        name: "dock.web.ask.wikipedia",
        description: 'dock.web.note.wikipedia:{"count":2}',
      }),
    );
    expect(group?.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByText(/^dock\.web\.retryLede/).textContent).toBe(
      'dock.web.retryLede.wait:{"time":"2:01 PM"}',
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(quoted(group as Element)).toEqual([
      ["Porta Pia", ""],
      ["Marta", "dock.web.flag"],
    ]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(actions()).toEqual([
      ["dock.web.retry", true],
      ["dock.web.decline", false],
    ]);
  });

  it("offers a one-row retry as its query alone, not a one-item list", () => {
    mount(retry([{ query: "Porta Pia" }]));
    const group = screen.getByRole("group", {
      name: "dock.web.ask.wikipedia",
      description: 'dock.web.note.wikipedia:{"count":1}',
    });
    expect(group.getAttribute("tabindex")).toBe("-1");
    expect(screen.queryByRole("list")).toBeNull();
    expect(quoted(group)).toEqual([["Porta Pia", ""]]);
    expect(actions()).toEqual([
      ["dock.web.retry", true],
      ["dock.web.decline", false],
    ]);
  });

  it.each([
    ["an ask", {}, ""],
    [
      "a re-ask",
      { kind: "re-ask", reached: "unknown" } as Partial<SearchAsk>,
      "dock.web.reask.maybeSent",
    ],
  ])(
    "offers %s with one row as a named group around one described field",
    (_, over, lede) => {
      mount(first([{ query: "Porta Pia" }], over));
      const group = screen.getByRole("group", {
        name: "dock.web.ask.wikipedia",
      });
      expect(group.getAttribute("tabindex")).toBe("-1");
      const query = screen.getByRole("textbox", {
        name: "dock.web.ask.wikipedia",
        description: 'dock.web.note.wikipedia:{"count":1}',
      }) as HTMLTextAreaElement;
      expect(query.value).toBe("Porta Pia");
      // A query can hold the writer's words; the browser's spellchecker is
      // never handed them.
      expect(query.getAttribute("spellcheck")).toBe("false");
      // The lede, if any, comes first, and nothing else is said.
      expect(group.textContent).toBe(
        [
          lede,
          "dock.web.ask.wikipedia",
          "Porta Pia",
          'dock.web.note.wikipedia:{"count":1}',
          "dock.web.search",
          "dock.web.decline",
        ].join(""),
      );
      expect(actions()).toEqual([
        ["dock.web.search", false],
        ["dock.web.decline", false],
      ]);
    },
  );

  it("opens several rows into one named group of ticked, named, described fields", () => {
    mount(first([{ query: "Porta Pia" }, { query: "Marta", bookWords: true }]));
    openFields();
    // The fieldset is the only group: a second one of the same name around
    // it would be heard twice.
    const [group, ...others] = screen.getAllByRole("group");
    expect(others).toHaveLength(0);
    expect(group).toBe(
      screen.getByRole("group", { name: "dock.web.ask.wikipedia" }),
    );
    expect(group?.getAttribute("tabindex")).toBe("-1");
    expect(
      screen
        .getAllByRole("checkbox")
        .map((one) => [
          one.getAttribute("aria-label"),
          one.getAttribute("aria-checked"),
        ]),
    ).toEqual([
      ["Porta Pia", "true"],
      ["Marta", "true"],
    ]);
    const fields = screen.getAllByRole("textbox", {
      name: "dock.web.ask.wikipedia",
    }) as HTMLTextAreaElement[];
    expect(
      fields.map((one) => [
        one.value,
        describedBy(one),
        one.disabled,
        one.getAttribute("spellcheck"),
      ]),
    ).toEqual([
      ["Porta Pia", 'dock.web.note.wikipedia:{"count":2}', false, "false"],
      [
        "Marta",
        'dock.web.note.wikipedia:{"count":2} | dock.web.flag',
        false,
        "false",
      ],
    ]);
    expect(actions()).toEqual([
      ["dock.web.search", false],
      ["dock.web.decline", false],
    ]);
  });
});
