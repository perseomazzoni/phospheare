// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AiComposer from "./AiComposer";
import { summariseSkill } from "../../ai/domain/skills";
import { __resetOverlays } from "../../ui/overlay/useOverlay";

// Every command file requires a guide; these hand-built commands test other
// things, so any guide will do.
const TEST_GUIDE = {
  en: { what: "What.", when: "When.", how: "How." },
  it: { what: "Cosa.", when: "Quando.", how: "Come." },
};

// The interface language picks which spelling of a scope word a completion
// offers first, so a test can switch it.
const ui = { language: "en" };
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values
        ? Object.entries(values).reduce(
            (text, [name, value]) => text.replace(`{{${name}}}`, value),
            key === "dock.scopeNote.structure"
              ? "{{structure}}: every Section"
              : key,
          )
        : key,
    i18n: ui,
  }),
}));

afterEach(() => {
  cleanup();
  __resetOverlays();
});

const field = () => screen.getByLabelText("dock.ask") as HTMLTextAreaElement;

function mount(props: Partial<Parameters<typeof AiComposer>[0]> = {}) {
  const handlers = {
    onOpenContext: vi.fn(),
    onPickCommand: vi.fn(),
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onDropQuote: vi.fn(),
    onUnpin: vi.fn(),
    onStop: vi.fn(),
  };
  const view = render(
    <AiComposer
      value=""
      chatId="chat-1"
      quote={null}
      pinned={[]}
      disabled={false}
      running={false}
      // No commands by default: every kind of chat but an editorial one has
      // none, so the plain field is the case worth being the default here.
      commands={[]}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, view };
}

/** What every command fixture here carries beyond its word and its text. */
const EDITORIAL = {
  chats: ["editorial"] as const,
  scopes: [],
  reads: [],
  needs: [],
  lenses: [],
  guide: TEST_GUIDE,
};

describe("AiComposer", () => {
  it("asks in the placeholder and keeps the tab's word as its name", () => {
    mount();
    // `dock.ask` is also the Dock tab's label, so a placeholder repeating it
    // says nothing. The accessible name stays the tab's word because a
    // placeholder vanishes at the first keystroke and is not a label.
    expect(field().getAttribute("placeholder")).toBe("dock.askPlaceholder");
    expect(field().getAttribute("aria-label")).toBe("dock.ask");
    expect(field().getAttribute("placeholder")).not.toBe(
      field().getAttribute("aria-label"),
    );
  });

  it("watches its own width, because dragging the dock changes no prop", () => {
    // The invitation that fits on one line at a 690px dock needs two at the
    // 340px floor, and the drag that narrows the dock is not a render.
    // jsdom ships no ResizeObserver, so the test supplies one.
    const observe = vi.fn();
    const disconnect = vi.fn();
    const seen: ResizeObserverCallback[] = [];
    class Fake {
      constructor(callback: ResizeObserverCallback) {
        seen.push(callback);
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", Fake);
    try {
      const { view } = mount();
      // The field is observed, not the pill around it: the pill's width is
      // what changes, but the height written is the field's.
      expect(observe).toHaveBeenCalledWith(field());
      const element = field();
      element.style.height = "999px";
      seen[0]?.([], new Fake(() => {}) as unknown as ResizeObserver);
      // Re-measured from scratch rather than grown from where it was: jsdom
      // reports `scrollHeight: 0`, so the floor is what comes back.
      expect(element.style.height).not.toBe("999px");
      view.unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("writes a height on every draft change and leaves none stale", () => {
    // jsdom reports `scrollHeight: 0`, so the pixels are not the subject; the
    // floor and the cap are pinned in `editorCss.test.ts`. The height is
    // rewritten on each value, and a send that empties the draft re-measures
    // rather than keeping the tallest height the field had.
    const { view } = mount({ value: "one" });
    expect(field().style.height).not.toBe("");
    const grown = field().style.height;

    view.rerender(
      <AiComposer
        value={"one\ntwo\nthree"}
        chatId="chat-1"
        quote={null}
        pinned={[]}
        disabled={false}
        running={false}
        commands={[]}
        onPickCommand={vi.fn()}
        onOpenContext={vi.fn()}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onDropQuote={vi.fn()}
        onUnpin={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(field().style.height).not.toBe("");

    view.rerender(
      <AiComposer
        value=""
        chatId="chat-1"
        quote={null}
        pinned={[]}
        disabled={false}
        running={false}
        commands={[]}
        onPickCommand={vi.fn()}
        onOpenContext={vi.fn()}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onDropQuote={vi.fn()}
        onUnpin={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(field().style.height).toBe(grown);
  });

  it("re-measures when two chats hold the same draft string", () => {
    // `value` is referentially equal across this switch, so `chatId` is the
    // only dependency that can fire the measure. Without it, a field carried
    // to an identical draft in another chat keeps a height nobody computed
    // for it.
    const { view } = mount({ value: "same", chatId: "chat-1" });
    field().style.height = "999px";
    view.rerender(
      <AiComposer
        value="same"
        chatId="chat-2"
        quote={null}
        pinned={[]}
        disabled={false}
        running={false}
        commands={[]}
        onPickCommand={vi.fn()}
        onOpenContext={vi.fn()}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onDropQuote={vi.fn()}
        onUnpin={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(field().style.height).not.toBe("999px");
  });

  it("centres its buttons at the resting height and drops them as it grows", () => {
    // `align-items: end` suits a grown field and not the resting one, where a
    // 30px button bottom-aligned in a 34px row has all its gap above and none
    // below. The flag comes from the measure the component already takes.
    //
    // jsdom reports `scrollHeight: 0` and no computed line-height, so both
    // are stubbed. The threshold is the height one line occupies, not
    // `min-height`, a floor below it that would call an empty field grown.
    const style = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pe) =>
      element instanceof HTMLTextAreaElement
        ? ({
            lineHeight: "19.5px",
            paddingTop: "8px",
            paddingBottom: "8px",
            minHeight: "34px",
          } as CSSStyleDeclaration)
        : style(element, pe),
    );
    const height = { value: 36 };
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => height.value,
    });

    const pill = () => document.querySelector(".composer");
    const { view } = mount({ value: "one line" });
    // 36 is one line of 13px/1.5 in 16px of padding — taller than the 34px
    // floor, and still not grown.
    expect(pill()?.getAttribute("data-grown")).toBe("0");

    height.value = 56;
    view.rerender(
      <AiComposer
        value={"one\ntwo"}
        chatId="chat-1"
        quote={null}
        pinned={[]}
        disabled={false}
        running={false}
        commands={[]}
        onPickCommand={vi.fn()}
        onOpenContext={vi.fn()}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onDropQuote={vi.fn()}
        onUnpin={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(pill()?.getAttribute("data-grown")).toBe("1");

    vi.restoreAllMocks();
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: unknown })
      .scrollHeight;
  });

  it("submits on Enter and makes a new line on Shift+Enter", () => {
    const { onSubmit } = mount({ value: "a question" });
    fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalled();
  });

  it("never submits mid-composition", () => {
    // An IME's Enter commits a candidate; it is not a send.
    const { onSubmit } = mount({ value: "にほん" });
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
    });
    Object.defineProperty(event, "isComposing", { value: true });
    fireEvent(field(), event);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("opens Context in one press, with no menu in between", () => {
    // The button is the control: a menu holding one item is a button that opens
    // a button.
    const onOpenContext = vi.fn();
    mount({ onOpenContext });
    const control = screen.getByLabelText("dock.context");
    fireEvent.click(control);
    expect(onOpenContext).toHaveBeenCalledTimes(1);
    // It announces the dialog it opens, and there is no popover to expand.
    expect(control.getAttribute("aria-haspopup")).toBe("dialog");
    expect(control.getAttribute("aria-expanded")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("goes quiet when the chat has no usable persona", () => {
    mount({ disabled: true });
    expect(field().disabled).toBe(true);
  });

  it("offers Stop only while a run is in flight", () => {
    const { onStop, view } = mount({ running: false });
    expect(screen.queryByLabelText("dock.stop")).toBeNull();
    view.rerender(
      <AiComposer
        value=""
        chatId="chat-1"
        quote={null}
        pinned={[]}
        disabled={false}
        running
        commands={[]}
        onPickCommand={vi.fn()}
        onOpenContext={vi.fn()}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onDropQuote={vi.fn()}
        onUnpin={vi.fn()}
        onStop={onStop}
      />,
    );
    fireEvent.click(screen.getByLabelText("dock.stop"));
    expect(onStop).toHaveBeenCalled();
  });

  it("marks Stop as running, so its edge shines and its spark travels, and Send never", () => {
    // The rainbow edge and the counterclockwise spark hang off `is-running`,
    // and only the wait wears it.
    mount({ running: true });
    expect(
      screen.getByLabelText("dock.stop").classList.contains("is-running"),
    ).toBe(true);
    cleanup();
    mount({ value: "A question" });
    expect(
      screen.getByLabelText("dock.send").classList.contains("is-running"),
    ).toBe(false);
  });

  it("keeps Stop, still enabled, but stills it while the run waits on the writer", () => {
    // The loop says the writer waits on the machine; while a search is asked
    // about, the machine waits on the writer. Stop still ends the run.
    const onStop = vi.fn();
    mount({ running: true, waiting: true, onStop });
    const stop = screen.getByLabelText("dock.stop") as HTMLButtonElement;
    expect(stop.classList.contains("is-running")).toBe(false);
    expect(stop.classList.contains("ai-stop")).toBe(true);
    expect(stop.disabled).toBe(false);
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalled();
  });

  it("offers Send in Stop's seat, and only when there is something to send", () => {
    // Send serves the writer who does not press Enter, and on a phone Enter
    // may be a line break or missing from the keyboard. One seat: Send at
    // rest, Stop in flight.
    const empty = mount({ value: "   " });
    const send = () => screen.getByLabelText("dock.send") as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    expect(send().classList.contains("ai-stop")).toBe(true);
    empty.view.unmount();

    const asked = mount({ value: "Is the lighthouse lit?" });
    expect(send().disabled).toBe(false);
    fireEvent.click(send());
    expect(asked.onSubmit).toHaveBeenCalledTimes(1);
    asked.view.unmount();

    // Nothing to ask with: no persona, no send.
    mount({ value: "A question", disabled: true });
    expect(send().disabled).toBe(true);
    cleanup();

    // In flight, the seat is Stop's and Send is gone.
    mount({ value: "Next question", running: true });
    expect(screen.queryByLabelText("dock.send")).toBeNull();
    expect(screen.getByLabelText("dock.stop")).toBeTruthy();
  });

  it("shows the quoted selection and a way to drop it", () => {
    const { onDropQuote } = mount({ quote: "the sea was a wall" });
    expect(screen.getByText("the sea was a wall")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("dock.dropQuote"));
    expect(onDropQuote).toHaveBeenCalled();
  });
  it("shows each pinned source above the field, and unpins it from there", () => {
    // A pin rides with every message, so it shows where the message is
    // written, not only in Context.
    const { onUnpin } = mount({
      pinned: [
        { id: "node:S1", title: "Opening" },
        { id: "ref:world", title: "World" },
      ],
    });
    const list = screen.getByRole("list", { name: "dock.pinnedSources" });
    expect(
      [...list.querySelectorAll(".composer-pin span")].map(
        (chip) => chip.textContent,
      ),
    ).toEqual(["Opening", "World"]);
    // The whole title is there to read when the chip clips it.
    expect(screen.getByText("World").getAttribute("title")).toBe("World");
    const unpins = screen.getAllByRole("button", { name: "dock.unpin" });
    expect(unpins).toHaveLength(2);
    fireEvent.click(unpins[1] as HTMLElement);
    expect(onUnpin).toHaveBeenCalledWith("ref:world");
  });

  it("draws no pin row when nothing is pinned", () => {
    mount();
    expect(screen.queryByRole("list")).toBeNull();
    expect(document.querySelector(".composer-pins")).toBeNull();
  });

  it("opens the commands on a bare slash, and only on a bare slash", () => {
    // A field holding only `/`, not one that starts with it. A question can
    // open with a slash, and a menu that seized the field at the first slash
    // would argue with the writer about what they meant.
    const commands = [
      { command: "unresolved", instruction: "What is open.", ...EDITORIAL },
      { command: "continuity", instruction: "What contradicts.", ...EDITORIAL },
    ];
    const { onPickCommand, view } = mount({ value: "", commands });
    expect(screen.queryByRole("menuitem")).toBeNull();

    view.rerender(
      <AiComposer
        value="/"
        chatId="chat-1"
        quote={null}
        pinned={[]}
        disabled={false}
        running={false}
        commands={commands}
        onPickCommand={onPickCommand}
        onOpenContext={vi.fn()}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onDropQuote={vi.fn()}
        onUnpin={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    // The command is the label: these are the words the writer types, so
    // anything else would teach the menu instead of the language. The label
    // alone is the name; each note is its description.
    expect(
      screen
        .getAllByRole("menuitem")
        .map((row) => row.querySelector(".ui-menu-text > span")?.textContent),
    ).toEqual(["/unresolved", "/continuity"]);
    expect(
      screen
        .getAllByRole("menuitem")
        .map((row) => row.querySelector(".ui-menu-desc")?.textContent),
    ).toEqual(["dock.commandNote.unresolved", "dock.commandNote.continuity"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "/continuity" }));
    expect(onPickCommand).toHaveBeenCalledWith(commands[1]);

    // A second character is the writer saying they meant to write.
    view.rerender(
      <AiComposer
        value="/un"
        chatId="chat-1"
        quote={null}
        pinned={[]}
        disabled={false}
        running={false}
        commands={commands}
        onPickCommand={onPickCommand}
        onOpenContext={vi.fn()}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onDropQuote={vi.fn()}
        onUnpin={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("advertises the commands in the placeholder only when there are some", () => {
    // A placeholder advertising commands the chat lacks misleads the writer,
    // and every kind but an editorial chat has none.
    const plain = mount({ commands: [] });
    expect(field().placeholder).toBe("dock.askPlaceholder");
    plain.view.unmount();
    mount({
      commands: [
        { command: "canon", instruction: "Against the record.", ...EDITORIAL },
      ],
    });
    expect(field().placeholder).toBe("dock.askPlaceholderCommands");
  });

  describe("a typed command", () => {
    const WHERE = {
      command: "where",
      instruction: "Judge.",
      chats: ["general"] as const,
      // As the shipped file declares: a workflow's words are its own, and a
      // quote stands for none of them.
      workflow: "locate" as const,
      argument: "text" as const,
      scopes: [],
      reads: [],
      needs: [],
      lenses: [],
      guide: TEST_GUIDE,
    };
    const CONTINUITY = {
      command: "continuity",
      instruction: "What contradicts.",
      reviewTask: "continuity" as const,
      ...EDITORIAL,
      scopes: ["section", "structure"] as const,
    };
    const mirror = () => document.querySelector(".composer-mirror");
    const drawn = (selector: string) =>
      document.querySelector(selector)?.textContent;

    it("draws the command in the accent and what it wants in brackets", () => {
      mount({ value: "/where", commands: [WHERE] });
      expect(drawn(".composer-command")).toBe("/where");
      expect(drawn(".composer-hint")).toBe(" [dock.where.hint]");
      expect(field().className).toBe("has-command");
      // The hint is spoken as the field's description, never as its value.
      const described = field().getAttribute("aria-describedby");
      expect(document.getElementById(described ?? "")?.textContent).toBe(
        "dock.where.hintDescription",
      );
      expect(mirror()?.getAttribute("aria-hidden")).toBe("true");
    });

    it("puts the hint right after a typed space, and drops it at the first word", () => {
      const { view } = mount({ value: "/where ", commands: [WHERE] });
      expect(drawn(".composer-hint")).toBe("[dock.where.hint]");
      view.rerender(
        <AiComposer
          value="/where the crash"
          chatId="chat-1"
          quote={null}
          pinned={[]}
          disabled={false}
          running={false}
          commands={[WHERE]}
          onOpenContext={vi.fn()}
          onPickCommand={vi.fn()}
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          onDropQuote={vi.fn()}
          onUnpin={vi.fn()}
          onStop={vi.fn()}
        />,
      );
      expect(document.querySelector(".composer-hint")).toBeNull();
      expect(mirror()?.textContent).toBe("/where the crash​");
      expect(field().hasAttribute("aria-describedby")).toBe(false);
    });

    describe("a question that takes words (/how-to-say)", () => {
      const HOW = {
        command: "how-to-say",
        instruction: "Find the words.",
        chats: ["general"] as const,
        argument: "text" as const,
        scopes: [],
        reads: [],
        needs: [],
        lenses: [],
        guide: TEST_GUIDE,
      };
      const describedAs = () =>
        document.getElementById(field().getAttribute("aria-describedby") ?? "")
          ?.textContent;

      it("names what it takes from its own keys, and says it to a reader", () => {
        mount({ value: "/how-to-say ", commands: [HOW] });
        expect(drawn(".composer-hint")).toBe("[dock.how-to-say.hint]");
        expect(describedAs()).toBe("dock.how-to-say.hintDescription");
      });

      it("names the quote over one, as Enter would send it", () => {
        mount({ value: "/how-to-say ", commands: [HOW], quote: "the gate" });
        expect(drawn(".composer-hint")).toBe("[dock.scope.quote]");
        expect(describedAs()).toBe("dock.how-to-say.hintQuoteDescription");
      });

      it("works the quote out afresh, so taking it away brings the hint back", () => {
        const { view } = mount({
          value: "/how-to-say ",
          commands: [HOW],
          quote: "the gate",
        });
        view.rerender(
          <AiComposer
            value="/how-to-say "
            chatId="chat-1"
            quote={null}
            pinned={[]}
            disabled={false}
            running={false}
            commands={[HOW]}
            onOpenContext={vi.fn()}
            onPickCommand={vi.fn()}
            onChange={vi.fn()}
            onSubmit={vi.fn()}
            onDropQuote={vi.fn()}
            onUnpin={vi.fn()}
            onStop={vi.fn()}
          />,
        );
        expect(drawn(".composer-hint")).toBe("[dock.how-to-say.hint]");
      });

      it("drops the ghost at the first word, over a quote or not", () => {
        mount({ value: "/how-to-say a sigh", commands: [HOW], quote: "x" });
        expect(document.querySelector(".composer-hint")).toBeNull();
        expect(field().hasAttribute("aria-describedby")).toBe(false);
      });

      it("names the quote over a bare /verify, which checks it", () => {
        const VERIFY = {
          ...WHERE,
          command: "verify",
          workflow: "verify" as const,
        };
        mount({ value: "/verify ", commands: [VERIFY], quote: "the gate" });
        expect(drawn(".composer-hint")).toBe("[dock.scope.quote]");
        expect(describedAs()).toBe("dock.verify.hintQuoteDescription");
        cleanup();
        mount({ value: "/verify ", commands: [VERIFY] });
        expect(drawn(".composer-hint")).toBe("[dock.verify.hint]");
        expect(describedAs()).toBe("dock.verify.hintDescription");
      });

      it("leaves /where its own hint over a quote: a quote is no search", () => {
        mount({ value: "/where ", commands: [WHERE], quote: "the gate" });
        expect(drawn(".composer-hint")).toBe("[dock.where.hint]");
        expect(describedAs()).toBe("dock.where.hintDescription");
      });
    });

    it("never suggests the review's widest word, only what Enter does now", () => {
      // Grey text after a command reads as "type this", so the ghost names
      // the reach Enter runs, never the widest word, whose run costs hours.
      mount({ value: "/continuity", commands: [CONTINUITY] });
      expect(drawn(".composer-hint")).toBe(" [dock.scope.current]");
    });

    it("names the quote as the reach when one is attached", () => {
      mount({
        value: "/continuity ",
        commands: [CONTINUITY],
        quote: "the gate",
      });
      expect(drawn(".composer-hint")).toBe("[dock.scope.quote]");
    });

    it("says nothing where the reach is already on screen", () => {
      // A command that reaches no further than a Section, over a quote: the
      // quote above the field is what it will read.
      const LINE = {
        ...CONTINUITY,
        command: "line",
        scopes: ["section"] as const,
      };
      mount({ value: "/line", commands: [LINE], quote: "the gate" });
      expect(document.querySelector(".composer-hint")).toBeNull();
      cleanup();
      mount({ value: "/line", commands: [LINE] });
      expect(drawn(".composer-hint")).toBe(" [dock.scope.current]");
    });

    it("says what the whole Structure costs once it is typed", () => {
      mount({ value: "/continuity structure", commands: [CONTINUITY] });
      expect(drawn(".composer-command")).toBe("/continuity");
      expect(drawn(".composer-hint")).toBe(" [dock.scope.cost]");
    });

    it("draws a bracketed ghost as one unit, the space before it outside", () => {
      mount({ value: "/continuity structure", commands: [CONTINUITY] });
      // The unit wraps whole (nowrap in the stylesheet); the space is the
      // mirror's own break point, the one the field has too, so the typed
      // keyword never follows the phrase down.
      expect(drawn(".composer-hint-unit")).toBe("[dock.scope.cost]");
      const hint = document.querySelector(".composer-hint");
      expect(hint?.firstChild?.nodeType).toBe(Node.TEXT_NODE);
      expect(hint?.firstChild?.textContent).toBe(" ");
      cleanup();
      // A completion is not a unit: it may break from the word it completes,
      // as the field breaks after the typed letters. Held together, a
      // completion at a line's end drags them below the caret.
      mount({ value: "/continuity st", commands: [CONTINUITY] });
      expect(document.querySelector(".composer-hint-unit")).toBeNull();
      expect(
        document.querySelector(".composer-hint")?.previousSibling?.nodeName,
      ).toBe("WBR");
    });

    it("completes part from the data, and gives it no cost ghost", () => {
      const PARTS = {
        ...CONTINUITY,
        scopes: ["section", "part", "structure"] as const,
      };
      mount({ value: "/continuity pa", commands: [PARTS] });
      expect(drawn(".composer-hint")).toBe("rt");
      cleanup();
      // The cost ghost is the Structure's alone: a Part is what a writer
      // reads in a sitting.
      mount({ value: "/continuity part", commands: [PARTS] });
      expect(drawn(".composer-command")).toBe("/continuity");
      expect(document.querySelector(".composer-hint")).toBeNull();
      cleanup();
      // The menu still teaches the widest word the command takes.
      mount({ value: "/", commands: [PARTS] });
      expect(document.querySelector(".ui-keyword")?.textContent).toBe(
        "structure",
      );
    });

    it("completes a half-typed word bare, in ink, and Tab takes it", () => {
      const { onChange } = mount({
        value: "/continuity st",
        commands: [CONTINUITY],
      });
      // Bare: no brackets, no space — a completion, not a description.
      expect(drawn(".composer-hint")).toBe("ructure");
      // Enter would still ask a question, so the command is not coloured.
      expect(document.querySelector(".composer-command")).toBeNull();
      expect(field().className).toBe("has-command");
      fireEvent.keyDown(field(), { key: "Tab" });
      expect(onChange).toHaveBeenCalledWith("/continuity structure");
    });

    it("completes in the interface's language first, and titles when only one fits", () => {
      ui.language = "it";
      try {
        mount({ value: "/continuity s", commands: [CONTINUITY] });
        expect(drawn(".composer-hint")).toBe("ezione");
      } finally {
        ui.language = "en";
      }
      cleanup();
      mount({ value: "/continuity s", commands: [CONTINUITY] });
      expect(drawn(".composer-hint")).toBe("ection");
      cleanup();
      const nodes = [
        { id: "h", title: "The Harbour" },
        { id: "f", title: "The Fire" },
      ];
      mount({
        value: "/continuity The H",
        commands: [CONTINUITY],
        names: { nodes, references: [] },
      });
      expect(drawn(".composer-hint")).toBe("arbour");
      cleanup();
      // Two titles the letters can still become: no guess.
      mount({
        value: "/continuity The ",
        commands: [CONTINUITY],
        names: { nodes, references: [] },
      });
      expect(document.querySelector(".composer-mirror")).toBeNull();
    });

    it("completes only a Part's title after /summarise", () => {
      // Another Section's title is refused there, so completing one would
      // write a line Enter refuses; a Part's composes.
      const names = {
        nodes: [
          { id: "P1", title: "Book One", kind: "part" as const },
          { id: "S1", title: "Bells", kind: "section" as const },
        ],
        references: [],
      };
      mount({ value: "/summarise B", commands: [summariseSkill], names });
      expect(drawn(".composer-hint")).toBe("ook One");
      cleanup();
      mount({ value: "/summarise Be", commands: [summariseSkill], names });
      expect(document.querySelector(".composer-hint")).toBeNull();
      cleanup();
      // With scopes offered, it names what Enter reads, as every command
      // that reaches the open Section does.
      mount({ value: "/summarise", commands: [summariseSkill], names });
      expect(drawn(".composer-hint")).toBe(" [dock.scope.current]");
    });

    it("leaves a reference the book does not hold in ink, with no ghost", () => {
      // No error styling while the writer types: a named reference colours
      // the command as any run does, and one that names nothing is no run
      // yet, so the command word stays ink.
      const CANON = {
        ...CONTINUITY,
        command: "canon",
        reviewTask: "consistency" as const,
        argument: "reference" as const,
        reads: [{ group: "characters" as const }],
      };
      const names = {
        nodes: [],
        references: [{ name: "Marta", ids: ["reference:character--Marta.md"] }],
      };
      mount({ value: "/canon Marta", commands: [CANON], names });
      expect(drawn(".composer-command")).toBe("/canon");
      cleanup();
      mount({ value: "/canon Bruno", commands: [CANON], names });
      expect(document.querySelector(".composer-command")).toBeNull();
      expect(document.querySelector(".composer-hint")).toBeNull();
    });

    it("completes a name in its slot, past a space, and never teaches the slot", () => {
      const CANON = {
        ...CONTINUITY,
        command: "canon",
        reviewTask: "consistency" as const,
        argument: "reference" as const,
        scopes: ["section", "part", "structure"] as const,
        reads: [{ group: "characters" as const }],
      };
      const names = {
        nodes: [
          { id: "h", title: "The Harbour" },
          { id: "p2", title: "Part Two" },
        ],
        references: [
          { name: "Marta", ids: ["reference:character--Marta.md"] },
          { name: "Key Locations", ids: ["reference:world--locations.md"] },
          { name: "Luoghi chiave", ids: ["reference:world--locations.md"] },
        ],
      };
      const hint = (value: string) => {
        mount({ value, commands: [CANON], names });
        const text = document.querySelector(".composer-hint")?.textContent;
        cleanup();
        return text ?? null;
      };
      // The first slot: a scope word first, then the one title or name.
      expect(hint("/canon st")).toBe("ructure");
      expect(hint("/canon ma")).toBe("rta");
      expect(hint("/canon the h")).toBe("arbour");
      // Past a space, while one candidate fits; appended, never re-cased.
      expect(hint("/canon key ")).toBe("Locations");
      // After a reach — a scope word or a whole title — names only.
      expect(hint("/canon part m")).toBe("arta");
      expect(hint("/canon The Harbour k")).toBe("ey Locations");
      expect(hint("/canon part two lu")).toBe("oghi chiave");
      // Never the slot itself, and nothing after a whole name.
      expect(hint("/canon part ")).toBeNull();
      expect(hint("/canon part Marta")).toBeNull();
      expect(hint("/canon Marta")).toBeNull();
    });

    // A spelling two references or two nodes share is no single candidate:
    // the parse names neither (`soleOf`) and the refused line's list leaves
    // it out, so completing it would have Tab write a name Enter refuses.
    it("completes no spelling two references or two titles share", () => {
      const CANON = {
        ...CONTINUITY,
        command: "canon",
        reviewTask: "consistency" as const,
        argument: "reference" as const,
        scopes: ["section", "part", "structure"] as const,
        reads: [{ group: "characters" as const }, { group: "notes" as const }],
      };
      const hint = (value: string) => {
        mount({
          value,
          commands: [CANON],
          names: {
            nodes: [
              { id: "a", title: "The Harbour" },
              { id: "b", title: "The Harbour" },
            ],
            references: [
              // A sheet and a note spelt alike: the parse takes neither.
              { name: "Bruno", ids: ["reference:character--Bruno.md"] },
              { name: "Bruno", ids: ["reference:notes--bruno.md"] },
            ],
          },
        });
        const text = document.querySelector(".composer-hint")?.textContent;
        cleanup();
        return text ?? null;
      };
      expect(hint("/canon br")).toBeNull();
      expect(hint("/canon the h")).toBeNull();
    });

    it("teaches the wider word in the menu note, with the word in ink", () => {
      mount({ value: "/", commands: [CONTINUITY] });
      const keyword = document.querySelector(".ui-keyword");
      expect(keyword?.textContent).toBe("structure");
      expect(keyword?.closest(".ui-menu-desc")?.textContent).toBe(
        "dock.commandNote.continuity · structure: every Section",
      );
    });

    it("says what a bare /map reads, and its menu note teaches part", () => {
      // A bare `/map` reads the whole Structure, its workflow's bare scope,
      // from summaries. So its ghost names that reach rather than a cost of
      // hours, and its note teaches `part`, since `structure` adds nothing.
      const MAP = {
        command: "map",
        instruction: "Place.",
        workflow: "map" as const,
        chats: ["editorial"] as const,
        scopes: ["part", "structure"] as const,
        reads: [],
        needs: [],
        lenses: [],
        guide: TEST_GUIDE,
      };
      mount({ value: "/map", commands: [MAP] });
      expect(drawn(".composer-command")).toBe("/map");
      expect(drawn(".composer-hint")).toMatch(/^ \[dock\.[\w.-]+\]$/);
      expect(drawn(".composer-hint")).not.toBe(" [dock.scope.cost]");
      expect(drawn(".composer-hint")).toBe(" [dock.scope.structure]");
      cleanup();
      // Typed out, the word says it: no ghost, and still no cost.
      mount({ value: "/map structure", commands: [MAP] });
      expect(drawn(".composer-command")).toBe("/map");
      expect(document.querySelector(".composer-hint")).toBeNull();
      cleanup();
      mount({ value: "/", commands: [MAP] });
      expect(document.querySelector(".ui-keyword")?.textContent).toBe("part");
    });

    // The menu never teaches a word the run would refuse. In a Section with
    // no Part around it `/map part` is refused and `/map section` runs; with
    // nothing open to map, neither is taught. A quote narrows nothing a map
    // reads, so it teaches no `withQuote`.
    it("teaches /map the narrower word that runs from here", () => {
      const MAP = {
        command: "map",
        instruction: "Place.",
        workflow: "map" as const,
        chats: ["editorial"] as const,
        scopes: ["section", "part", "structure"] as const,
        reads: [],
        needs: [],
        lenses: [],
        guide: TEST_GUIDE,
      };
      const keyword = () =>
        document.querySelector(".ui-keyword")?.textContent ?? null;
      mount({ value: "/", commands: [MAP], openWord: "section" });
      expect(keyword()).toBe("section");
      expect(document.querySelector(".ui-menu-desc")?.textContent).toContain(
        "dock.scopeNote.section",
      );
      cleanup();
      mount({ value: "/", commands: [MAP], openWord: "part" });
      expect(keyword()).toBe("part");
      cleanup();
      mount({ value: "/", commands: [MAP], openWord: null });
      expect(keyword()).toBeNull();
    });

    // One tail rule covers every scoped command across the closed table of
    // command, where the writer is, and a quote. No pair teaches a word the
    // command does not offer, `part` where no Part is open, or two keywords
    // at once.
    it("teaches every scoped command one word it runs, from where the writer is", () => {
      const LINE = {
        command: "line-editing",
        instruction: "Line.",
        reviewTask: "line" as const,
        ...EDITORIAL,
        scopes: ["section", "part"] as const,
      };
      const MAP = {
        command: "map",
        instruction: "Place.",
        workflow: "map" as const,
        chats: ["editorial"] as const,
        scopes: ["section", "part", "structure"] as const,
        reads: [],
        needs: [],
        lenses: [],
        guide: TEST_GUIDE,
      };
      const taught = (
        skill: typeof LINE | typeof CONTINUITY | typeof MAP,
        openWord: "part" | "section" | null,
        quote: string | null,
      ) => {
        mount({ value: "/", commands: [skill], openWord, quote });
        const words = [...document.querySelectorAll(".ui-keyword")].map(
          (one) => one.textContent,
        );
        cleanup();
        expect(
          words.length,
          `${skill.command} ${openWord} ${quote}`,
        ).toBeLessThan(2);
        if (words[0])
          expect(skill.scopes as readonly string[]).toContain(words[0]);
        return words[0] ?? null;
      };
      const table = (skill: typeof LINE | typeof CONTINUITY | typeof MAP) =>
        (["part", "section", null] as const).map((open) => [
          taught(skill, open, null),
          taught(skill, open, "the gate"),
        ]);
      // [no quote, a quote] for the open word part / section / nothing.
      expect(table(LINE)).toEqual([
        ["part", "section"],
        [null, "section"],
        [null, "section"],
      ]);
      expect(table(CONTINUITY)).toEqual([
        ["structure", "section"],
        ["structure", "section"],
        ["structure", "section"],
      ]);
      expect(table(MAP)).toEqual([
        ["part", "part"],
        ["section", "section"],
        [null, null],
      ]);
    });

    it("holds a note's tail on one line, keyword and gloss together", () => {
      // The note wraps before the tail, never inside it: the middot is inside
      // the unit, the space before it outside.
      mount({ value: "/", commands: [CONTINUITY] });
      const unit = document.querySelector(".ui-menu-tail");
      expect(unit?.textContent).toBe("· structure: every Section");
      expect(unit?.previousSibling?.textContent?.endsWith(" ")).toBe(true);
    });

    // The structure word is `/map`'s second slot: completed after a reach or
    // alone, never a second one. Typed alone it leaves the reach unsaid, so
    // the ghost still names the reach.
    describe("the /map structure word", () => {
      const MAP = {
        command: "map",
        instruction: "Place.",
        workflow: "map" as const,
        chats: ["editorial"] as const,
        scopes: ["part", "structure"] as const,
        reads: [],
        needs: [],
        lenses: [],
        guide: TEST_GUIDE,
      };

      it("completes a structure word after a reach, and alone", () => {
        mount({ value: "/map part h", commands: [MAP] });
        expect(drawn(".composer-hint")).toBe("ero");
        cleanup();
        mount({ value: "/map kisho", commands: [MAP] });
        expect(drawn(".composer-hint")).toBe("tenketsu");
        cleanup();
        // The other language's spelling completes too.
        mount({ value: "/map parte er", commands: [MAP] });
        expect(drawn(".composer-hint")).toBe("oe");
      });

      it("never completes a second structure word, or one past no reach", () => {
        mount({ value: "/map part hero t", commands: [MAP] });
        expect(document.querySelector(".composer-hint")).toBeNull();
        cleanup();
        // `nowhere` is no reach the parser reads: no promise of a run.
        mount({ value: "/map nowhere h", commands: [MAP] });
        expect(document.querySelector(".composer-hint")).toBeNull();
      });

      it("names the reach when only a structure word is typed", () => {
        mount({ value: "/map hero", commands: [MAP] });
        expect(drawn(".composer-command")).toBe("/map");
        expect(drawn(".composer-hint")).toBe(" [dock.scope.structure]");
        cleanup();
        mount({ value: "/map structure hero", commands: [MAP] });
        expect(document.querySelector(".composer-hint")).toBeNull();
      });

      it("offers no structure word to a command that takes none", () => {
        mount({ value: "/continuity part h", commands: [CONTINUITY] });
        expect(document.querySelector(".composer-hint")).toBeNull();
      });
    });

    it("leaves Tab alone when there is nothing to complete", () => {
      const { onChange } = mount({
        value: "/continuity",
        commands: [CONTINUITY],
      });
      fireEvent.keyDown(field(), { key: "Tab" });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("colours a scope word or a title the router would run", () => {
      for (const value of [
        "/continuity structure",
        "/continuity Sezione",
        "/continuity  the harbour ",
      ]) {
        cleanup();
        mount({
          value,
          commands: [CONTINUITY],
          names: {
            nodes: [{ id: "harbour", title: "The Harbour" }],
            references: [],
          },
        });
        expect(mirror()).not.toBeNull();
      }
    });

    it("colours only what the router would run", () => {
      // A prefix, a command this chat does not offer, and a review with a
      // word the parser refuses are all questions — and stay ink.
      for (const value of ["/wh", "/where x", "/continuity deeply"]) {
        cleanup();
        mount({ value, commands: [CONTINUITY] });
        expect(mirror()).toBeNull();
        expect(field().className).toBe("");
      }
    });
  });
});
