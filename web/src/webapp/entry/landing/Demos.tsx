// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FC,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { Button, CommandBarTrack } from "../../../ui";
import { useLandingMotion } from "./motion";
import Shot, { type ShotId } from "./Shot";
import { CAPITALS, KEYS, isKeyId, keyLabel, type KeyId } from "./keys";
import type { DemoId } from "./content";
import { useInView } from "./useInView";

// ── The small demos ──────────────────────────────────────────────────────────
//
// A few lines of the app drawn in HTML, one per feature the page can show
// better than it can say. The looping ones step through their beats only
// while on screen and hold the last beat, the finished state, for a visitor
// who asked for less motion. Their words are at `landing.<demo>.*`, and the
// app's own strings wherever the app already says the thing.

/**
 * The current beat of a loop, given how long each beat lasts. The last beat
 * is the finished state the loop holds when the page holds still.
 */
function useBeats(waits: readonly number[]) {
  const [ref, seen] = useInView<HTMLDivElement>({ once: false, margin: "0px" });
  const calm = useLandingMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (calm || !seen) return;
    const timer = setTimeout(
      () => setStep((current) => (current + 1) % waits.length),
      waits[step],
    );
    return () => clearTimeout(timer);
  }, [calm, seen, step, waits]);

  return [ref, calm ? waits.length - 1 : step] as const;
}

// ── Keys that keep you in the flow ───────────────────────────────────────────

interface Beat {
  text: string;
  key?: KeyId;
}

/**
 * The line `landing.keys.line` as beats: a `[keyId]` is one keystroke and
 * its character (`keys.ts`), every other character is typed.
 */
function beatsOf(line: string): Beat[] {
  return line.split(/\[([^\]]+)\]/).flatMap((part, index) => {
    if (index % 2 === 1 && isKeyId(part))
      return [{ text: KEYS[part].char, key: part }];
    return [...part].map((text) => ({ text }));
  });
}

function Keys() {
  const { t } = useTranslation();
  const line = t("landing.keys.line");
  const beats = useMemo(() => beatsOf(line), [line]);
  const waits = useMemo(
    // A keystroke lingers so its key is seen lit; the finished line holds.
    () => [
      900,
      ...beats.slice(0, -1).map((beat) => (beat.key ? 700 : 45)),
      2800,
    ],
    [beats],
  );
  const [ref, step] = useBeats(waits);
  const shown = beats
    .slice(0, step)
    .map((beat) => beat.text)
    .join("");
  const pressed = beats[step - 1]?.key;
  const keys = [...new Set(beats.flatMap((beat) => beat.key ?? []))];

  return (
    <div ref={ref} className="landing-demo" data-step={step}>
      <p className="landing-demo-prose" aria-hidden="true">
        {shown}
        <span className="landing-live-caret" />
      </p>
      <p className="ui-visually-hidden">
        {beats.map((beat) => beat.text).join("")}
      </p>
      <ul className="landing-keys" aria-label={t("landing.keys.label")}>
        {keys.map((id) => (
          <li key={id}>
            <kbd
              className="landing-key"
              data-on={id === pressed ? "" : undefined}
            >
              {keyLabel(id)}
              <span className="landing-key-char">{KEYS[id].char}</span>
            </kbd>
          </li>
        ))}
      </ul>
      <p className="landing-demo-label">
        {t("landing.keys.capitals", { key: keyLabel("È") })}
      </p>
      <p className="landing-capitals">{CAPITALS.join(" ")}</p>
    </div>
  );
}

// ── Two drafts, one better book ──────────────────────────────────────────────
//
// The compare view in small: the lens, the legend card and the marked prose
// use the editor's own classes (`comparing-*`, `df-*`), so each theme
// paints them as it paints the app. Deletions are the page's words, the
// tinted insertions the snapshot's, and Accept takes the snapshot's words.

type Grain = "paragraph" | "sentence" | "word";

/** One difference, with the Accept tag the pointer reveals. */
function Hunk({
  from,
  to,
  taken,
  onTake,
}: {
  from: string;
  to: string;
  taken: boolean;
  onTake: () => void;
}) {
  const { t } = useTranslation();
  if (taken) return <>{to}</>;
  return (
    <span className="df-hunk landing-hunk">
      <mark className="df-deleted">{from}</mark>
      <mark className="df-inserted">{to}</mark>
      <button
        type="button"
        className="df-accept landing-hunk-accept"
        aria-label={t("snapshots.acceptChange")}
        onClick={onTake}
      >
        {t("snapshots.accept")}
      </button>
    </span>
  );
}

function Compare() {
  const { t } = useTranslation();
  const [grain, setGrain] = useState<Grain>("word");
  const [taken, setTaken] = useState<ReadonlySet<string>>(new Set());
  const k = (id: string) => t(`landing.compare.${id}`);
  const before = k("before");
  const after = k("after");
  const oldSentence = `${k("aOld")}${k("mid")}${k("bOld")}.`;
  const newSentence = `${k("aNew")}${k("mid")}${k("bNew")}.`;
  const hunk = (id: string, from: string, to: string) => (
    <Hunk
      from={from}
      to={to}
      taken={taken.has(id)}
      onTake={() => setTaken(new Set(taken).add(id))}
    />
  );
  const hunks = { paragraph: 1, sentence: 1, word: 2 }[grain];
  const done = taken.size === hunks;

  return (
    <div className="landing-demo-app landing-compare">
      <select
        className="comparing-select"
        aria-label={t("snapshots.granularity")}
        value={grain}
        onChange={(e) => {
          setGrain(e.target.value as Grain);
          setTaken(new Set());
        }}
      >
        <option value="paragraph">{t("snapshots.granularityParagraph")}</option>
        <option value="sentence">{t("snapshots.granularitySentence")}</option>
        <option value="word">{t("snapshots.granularityWord")}</option>
      </select>
      <div className="comparing-bar landing-compare-bar">
        {done ? (
          <p className="comparing-question" role="status">
            {t("snapshots.allAccepted")}
          </p>
        ) : (
          <>
            <p className="comparing-question">
              {t("snapshots.questionAdoptedFirst")}
            </p>
            <p className="comparing-legend">
              <span
                className="comparing-swatch comparing-swatch-del"
                aria-hidden="true"
              />
              <span>{t("snapshots.removedAdoptedFirst")}</span>
            </p>
            <p className="comparing-legend">
              <span
                className="comparing-swatch comparing-swatch-add"
                aria-hidden="true"
              />
              <span>{t("snapshots.addedAdoptedFirst")}</span>
            </p>
          </>
        )}
      </div>
      <div className="landing-sheet landing-demo-page">
        <div className="editor landing-demo-editor">
          <p>
            {grain === "paragraph" &&
              hunk(
                "p",
                `${before} ${oldSentence} ${after}`,
                `${before} ${newSentence} ${after}`,
              )}
            {grain === "sentence" && (
              <>
                {before} {hunk("s", oldSentence, newSentence)} {after}
              </>
            )}
            {grain === "word" && (
              <>
                {before} {hunk("a", k("aOld"), k("aNew"))}
                {k("mid")}
                {hunk("b", k("bOld"), k("bNew"))}. {after}
              </>
            )}
          </p>
        </div>
      </div>
      {taken.size > 0 && (
        <Button
          variant="ghost"
          className="ui-btn-sm landing-compare-again"
          onClick={() => setTaken(new Set())}
        >
          {k("again")}
        </Button>
      )}
    </div>
  );
}

// ── Focus ────────────────────────────────────────────────────────────────────
//
// The editor's Focus on a few paragraphs: the same switch, and the same
// paint, `.editor.focus-dim` with the `focus` Custom Highlight returning the
// caret's line or paragraph to full ink. A click moves the caret, and the
// lit text follows it as it does in the app. The switch stands in the card's
// call to action, so the mode lives in the card's `DemoScope`.

type FocusMode = "off" | "line" | "paragraph";

const FocusModeContext = createContext<
  [FocusMode, Dispatch<SetStateAction<FocusMode>>] | null
>(null);

function useFocusMode() {
  const state = useContext(FocusModeContext);
  if (!state) throw new Error("Focus is used outside a DemoScope");
  return state;
}

/** The state a card's demo shares with the control in its call to action. */
export function DemoScope({ children }: { children: ReactNode }) {
  const state = useState<FocusMode>("line");
  return (
    <FocusModeContext.Provider value={state}>
      {children}
    </FocusModeContext.Provider>
  );
}

/** The editor's Focus switch, for the call to action above the demo. */
function FocusSwitch() {
  const { t } = useTranslation();
  const [mode, setMode] = useFocusMode();
  return (
    <div className="landing-focus-switch">
      <span>{t("tree.focus")}</span>
      <CommandBarTrack
        label={t("tree.focus")}
        cell={40}
        seat="sunk"
        value={mode}
        onChange={(next) => setMode(next as FocusMode)}
        options={[
          { value: "off", text: "—", label: t("tree.focusOff") },
          { value: "line", text: "Ln", label: t("tree.focusLine") },
          { value: "paragraph", text: "¶", label: t("tree.focusParagraph") },
        ]}
      />
    </div>
  );
}

interface Caret {
  paragraph: number;
  offset: number;
}

/** The text node a paragraph holds; each paragraph holds exactly one. */
const textOf = (p: Element | undefined) =>
  p?.firstChild instanceof Text ? p.firstChild : null;

/** Where on screen a character sits, for grouping characters into lines. */
function topAt(text: Text, at: number) {
  const range = document.createRange();
  range.setStart(text, at);
  range.setEnd(text, Math.min(at + 1, text.length));
  return range.getClientRects()[0]?.top ?? 0;
}

/** The range the highlight lights: the caret's paragraph or visual line. */
function litRange(text: Text, mode: FocusMode, offset: number) {
  const range = document.createRange();
  if (mode === "paragraph") {
    range.selectNodeContents(text);
    return range;
  }
  const at = Math.min(offset, text.length - 1);
  const top = topAt(text, at);
  let start = at;
  while (start > 0 && Math.abs(topAt(text, start - 1) - top) < 2) start--;
  let end = at;
  while (end < text.length - 1 && Math.abs(topAt(text, end + 1) - top) < 2)
    end++;
  range.setStart(text, start);
  range.setEnd(text, end + 1);
  return range;
}

/** The caret a click lands on, from the browser's own hit test. */
function caretFrom(event: React.MouseEvent, prose: HTMLElement): Caret | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  const hit = doc.caretPositionFromPoint
    ? doc.caretPositionFromPoint(event.clientX, event.clientY)
    : (() => {
        const range = document.caretRangeFromPoint?.(
          event.clientX,
          event.clientY,
        );
        return range
          ? { offsetNode: range.startContainer, offset: range.startOffset }
          : null;
      })();
  if (!hit || !(hit.offsetNode instanceof Text)) return null;
  const paragraph = [...prose.children].indexOf(
    hit.offsetNode.parentElement as Element,
  );
  return paragraph < 0 ? null : { paragraph, offset: hit.offset };
}

function Focus() {
  const { t } = useTranslation();
  const [mode] = useFocusMode();
  const [caret, setCaret] = useState<Caret>({ paragraph: 1, offset: 40 });
  const [width, setWidth] = useState(0);
  const [mark, setMark] = useState<{ left: number; top: number } | null>(null);
  const prose = useRef<HTMLDivElement>(null);
  const highlights = typeof CSS !== "undefined" ? CSS.highlights : undefined;
  const paragraphs = ["p1", "p2", "p3"].map((id) => t(`landing.focus.${id}`));

  // The lines move when the column narrows, so the lit line is measured
  // again on every resize.
  useEffect(() => {
    const node = prose.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A web font that finishes loading moves every glyph without resizing the
  // column, so the caret is measured again after each load. `ready` covers a
  // load that ended before the listener was added.
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    const set = typeof document !== "undefined" ? document.fonts : undefined;
    if (!set) return;
    let live = true;
    const loaded = () => {
      if (live) setFonts((n) => n + 1);
    };
    set.addEventListener("loadingdone", loaded);
    void set.ready.then(loaded);
    return () => {
      live = false;
      set.removeEventListener("loadingdone", loaded);
    };
  }, []);

  useLayoutEffect(() => {
    const node = prose.current;
    const text = textOf(node?.children[caret.paragraph]);
    const at = document.createRange();
    // Without layout (a test's DOM) there is nothing to measure or light.
    if (!node || !text || typeof at.getClientRects !== "function") return;
    at.setStart(text, Math.min(caret.offset, text.length));
    const box = at.getClientRects()[0];
    const frame = node.getBoundingClientRect();
    setMark(
      box ? { left: box.left - frame.left, top: box.top - frame.top } : null,
    );
    if (!highlights || mode === "off") return;
    highlights.set("focus", new Highlight(litRange(text, mode, caret.offset)));
    return () => {
      highlights.delete("focus");
    };
  }, [caret, mode, width, fonts, highlights]);

  const dim = mode !== "off" && Boolean(highlights);
  return (
    <div className="landing-demo-app landing-focus">
      <div className="landing-sheet landing-demo-page">
        <div
          ref={prose}
          className={`editor landing-demo-editor${dim ? " focus-dim" : ""}`}
          onClick={(event) => {
            if (!prose.current) return;
            const next = caretFrom(event, prose.current);
            if (next) setCaret(next);
          }}
        >
          {paragraphs.map((text) => (
            <p key={text}>{text}</p>
          ))}
          {mark && (
            <span
              className="fake-cursor landing-focus-caret"
              // Moved by `translate`, which needs no layout: a move by
              // `left` and `top` lays out the section around it again.
              style={{
                left: 0,
                top: 0,
                translate: `${mark.left}px ${mark.top}px`,
              }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    </div>
  );
}

const views: Record<"template" | "autosave", { shot: ShotId }> = {
  template: { shot: "reference" },
  autosave: { shot: "autosave" },
};
function Capture({ id }: { id: keyof typeof views }) {
  const { t } = useTranslation();
  const view = views[id];
  return (
    <div className="landing-feature-capture">
      <Shot id={view.shot} alt={t(`landing.captures.${id}`)} />
    </div>
  );
}
/**
 * The demos a visitor works by hand: the instruction each one gives, and the
 * control it puts beside the instruction.
 */
export const TRY: Partial<Record<DemoId, { hint: string; Control?: FC }>> = {
  focus: { hint: "landing.focus.hint", Control: FocusSwitch },
  compare: { hint: "landing.compare.hint" },
};

export const DEMOS: Record<DemoId, FC> = {
  keys: Keys,
  compare: Compare,
  focus: Focus,
  template: () => <Capture id="template" />,
  autosave: () => <Capture id="autosave" />,
};
