// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button, Tick, WrapInput } from "../../ui";
import type { SearchAnswer, SearchAsk } from "../../ai/domain/types";
import { engineLabel } from "../../ai/domain/webEngine";
import { clipAt, QUERY_MAX, sendableQuery } from "../../ai/domain/webText";
import { webPhrase } from "./runStatus";

// ── The search ask ───────────────────────────────────────────────────────────
//
// A web search waiting on the writer. Nothing leaves the machine until the
// writer says so, one search at a time. The ask takes the live line's place
// in the running turn's foot: the run is waiting on the writer, not the
// machine, so there are no dots and no clock.
//
// Two bodies behind one shell. The ask (a first ask, or a re-ask after a
// provider failed) holds one query in a field the writer can edit. Several
// queries it shows whole, as read-only text, with one Search for all of them
// and an Edit that opens them into fields: the queries are there for the
// search to find more, not for the writer to choose between, so the first
// face asks only what consent needs. The retry (a search the engine slowed)
// resends the same queries to the same engine, so it holds them as text too,
// and its Retry waits, visibly, until the engine's wait has passed.
//
// The panel keys this on the ask's id, so every ask is a fresh element: no
// value, focus or armed state carries from a decided ask into the next.

/**
 * How long an ask stays deaf after it becomes visible, in milliseconds, so a
 * double-click or a double Enter meant for what came before never lands on
 * a search. 500 ms is the floor. Nothing in the look says the ask is not yet
 * armed; a window much past 700 ms would need to.
 */
export const ASK_ARM_MS = 500;

/**
 * Whether a press may approve yet. A ref, never state: arming re-renders
 * nothing and has no styling hook. The clock restarts whenever the ask could
 * newly be seen: its mount, its actions entering the transcript's view, the
 * tab coming back, and every explicit reveal the panel stamps (the jump, the
 * dock opening). It restarts on the press on Edit too, whose fields push the
 * actions down under a pointer that was just clicking, so a double press
 * cannot land on Search. A press inside the window is dropped, never queued.
 *
 * The observer watches the actions node it finds at mount, so that node must
 * live as long as the ask: both faces share one `span.ai-finding-actions`,
 * never two branches of it.
 */
function useAskArming(
  actions: RefObject<HTMLElement | null>,
  root: RefObject<HTMLElement | null>,
  revealedAt: number,
): { armed: () => boolean; restart: () => void } {
  const notBefore = useRef(Date.now() + ASK_ARM_MS);
  const restart = useCallback(() => {
    notBefore.current = Date.now() + ASK_ARM_MS;
  }, []);
  // Before paint, with the panel's stamp, so no frame shows an armed Search
  // after a reveal.
  useLayoutEffect(restart, [restart, revealedAt]);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") restart();
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [restart]);
  useEffect(() => {
    const element = actions.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) restart();
      },
      { root: root.current },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [actions, root, restart]);
  const armed = useCallback(() => Date.now() >= notBefore.current, []);
  return { armed, restart };
}

export interface AiSearchAskProps {
  ask: SearchAsk;
  /** `assistant.answerSearches` for this ask; `false` leaves it as it is. */
  onAnswer: (answer: SearchAnswer) => boolean;
  /** Whether an edited query repeats the writer's words. */
  holdsBookWords: (query: string) => boolean;
  /** The transcript scroller, the root the actions' visibility is read in. */
  scroller: RefObject<HTMLElement | null>;
  /** Stamped by the panel on every explicit reveal. */
  revealedAt: number;
  /** What the live region says for this ask, as it changes. */
  onSpeak: (words: string) => void;
  /** After a decision: whether focus was inside the ask when it was made. */
  onDecided: (focusWasInside: boolean) => void;
}

export default function AiSearchAsk(props: AiSearchAskProps) {
  return props.ask.kind === "retry" ? (
    <RetryBody {...props} ask={props.ask} />
  ) : (
    <AskBody {...props} ask={props.ask} />
  );
}

/** The destination and its cost, stated once with the live count. */
function noteOf(t: TFunction, engine: "wikipedia" | "web", count: number) {
  return t(`dock.web.note.${engine}`, { count });
}

/** Decide, remembering whether the writer's focus was in the ask. */
function useDecide(
  root: RefObject<HTMLElement | null>,
  onAnswer: AiSearchAskProps["onAnswer"],
  onDecided: AiSearchAskProps["onDecided"],
) {
  return (answer: SearchAnswer) => {
    const inside = !!root.current?.contains(document.activeElement);
    if (onAnswer(answer)) onDecided(inside);
  };
}

/**
 * Esc anywhere in the ask declines, never gated, because declining is the
 * safe direction. The Esc that cancels an IME's composition is the IME's: a
 * decline is a no to every later search in the run, too much to take from a
 * key the writer pressed at their input method.
 */
function escapeDeclines(decline: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    decline();
  };
}

/**
 * Queries shown whole, as text: the retry's resend and the several-row ask
 * before Edit. Each is the exact string that leaves, a text node in
 * `q > bdi`, never trimmed, clipped or scrolled. A query holding the
 * writer's words keeps its flag on its own line, tied to the query it is
 * about, never gathered into one line for the list.
 */
function QueryList({
  rows,
}: {
  rows: readonly { rowId: string; text: string; flagged: boolean }[];
}) {
  const { t } = useTranslation();
  const ids = useId();
  const items = rows.map((row, index) => {
    const flagId = `${ids}-${index}`;
    return (
      <div className="ai-ask-query-row" key={row.rowId}>
        <p
          className="ai-ask-query"
          aria-describedby={row.flagged ? flagId : undefined}
        >
          <q>
            <bdi>{row.text}</bdi>
          </q>
        </p>
        {row.flagged ? (
          <p id={flagId} className="ui-input-note ui-input-note-flag">
            {t("dock.web.flag")}
          </p>
        ) : null}
      </div>
    );
  });
  return items.length === 1 ? (
    items
  ) : (
    <ul className="ai-ask-queries">
      {rows.map((row, index) => (
        <li key={row.rowId}>{items[index]}</li>
      ))}
    </ul>
  );
}

// ── The ask body ─────────────────────────────────────────────────────────────

interface Row {
  rowId: string;
  value: string;
  ticked: boolean;
  flagged: boolean;
}

function AskBody({
  ask,
  onAnswer,
  holdsBookWords,
  scroller,
  revealedAt,
  onSpeak,
  onDecided,
}: AiSearchAskProps & { ask: Exclude<SearchAsk, { kind: "retry" }> }) {
  const { t } = useTranslation();
  const engine = engineLabel(ask.engine);
  const root = useRef<HTMLDivElement | null>(null);
  const actions = useRef<HTMLSpanElement | null>(null);
  const { armed, restart } = useAskArming(actions, scroller, revealedAt);
  const decide = useDecide(root, onAnswer, onDecided);
  const [rows, setRows] = useState<Row[]>(() =>
    ask.rows.map((row) => ({
      rowId: row.rowId,
      value: row.query,
      ticked: true,
      flagged: row.bookWords,
    })),
  );
  // Whether the fields are out. It only ever goes to true, because Edit is
  // one way. An ask holding a query that cannot leave as written starts
  // with them out, so a row is never dropped or held without its field.
  const [open, setOpen] = useState(() =>
    ask.rows.some((row) => sendableQuery(row.query) === null),
  );
  const firstField = useRef<HTMLTextAreaElement | null>(null);
  const lede =
    ask.kind === "re-ask"
      ? t(
          ask.reached === "no"
            ? "dock.web.reask.notSent"
            : "dock.web.reask.maybeSent",
        )
      : null;

  // Said once as the ask appears: waiting, why this ask exists, and the flag
  // where a row carries it. Edits are not announced.
  useEffect(() => {
    onSpeak(
      [
        t("dock.awaitingWriter"),
        lede,
        ask.rows.some((row) => row.bookWords) ? t("dock.web.flag") : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
    // Once per ask: the element is keyed on its id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The flag follows the words: re-checked a beat after typing stops, so
  // editing the book's words out lowers it and pasting them in raises it.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);
  const edit = (rowId: string, raw: string) => {
    // The query's own cap, in the ask and not the kit: a paste over it is
    // cut here, where the writer sees it, rather than silently on the way
    // out.
    const value = clipAt(raw, QUERY_MAX);
    setRows((all) =>
      all.map((row) => (row.rowId === rowId ? { ...row, value } : row)),
    );
    clearTimeout(timers.current.get(rowId));
    timers.current.set(
      rowId,
      setTimeout(() => {
        const flagged = holdsBookWords(value);
        setRows((all) =>
          all.map((row) => (row.rowId === rowId ? { ...row, flagged } : row)),
        );
      }, 250),
    );
  };

  const ticked = rows.filter((row) => row.ticked);
  // What leaves, worked out once: Search sends it and the read-only face
  // shows it, so what is shown is what is sent, as one value rather than two
  // calls that happen to agree. A ticked row that cannot leave as written has
  // no place in it.
  const outgoing = ticked.flatMap((row) => {
    const query = sendableQuery(row.value);
    return query === null
      ? []
      : [{ rowId: row.rowId, query, flagged: row.flagged }];
  });
  // A ticked row is never dropped silently: one that cannot be sent holds
  // Search until the writer fixes or unticks it.
  const sendable = outgoing.length > 0 && outgoing.length === ticked.length;
  const search = () => {
    if (!sendable || !armed()) return;
    decide({
      kind: "send",
      rows: outgoing.map(({ rowId, query }) => ({ rowId, query })),
    });
  };
  // Edit: the fields come out, and the writer's focus goes into the first,
  // caret at the end, never a selection. In this handler, not an effect: an
  // ask can mount with its fields out (one row, or an unsendable query), and
  // nothing may move focus on mount, so the press itself is the one place
  // that knows focus should move. `flushSync`, its one use in the app,
  // commits the fields before the handler reads them, so focus goes from
  // Edit, which the commit removes, straight into the field. The clock
  // restarts first, because the fields push Search down under a pointer that
  // was just clicking.
  const openFields = () => {
    restart();
    flushSync(() => setOpen(true));
    // Never null here: the commit `flushSync` waited for rendered the
    // fieldset, whose first row carries the ref, and Edit exists only with
    // several rows. A guard would be a branch no ask can reach.
    const field = firstField.current as HTMLTextAreaElement;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  };
  const decline = () => decide({ kind: "decline" });
  const onFieldKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.repeat &&
      !event.nativeEvent.isComposing
    )
      search();
  };

  const label = webPhrase(t, "ask", engine);
  const note = noteOf(t, engine, ticked.length);
  const noteId = useId();
  const labelId = useId();
  const only = rows.length === 1 ? rows[0] : undefined;
  // The face follows the row count, never the proposer: one query is its
  // field, and several are read-only text until Edit, for a chat's asks and
  // `/verify`'s alike.
  const collapsed = rows.length > 1 && !open;
  // A named group, focusable by script only, wherever no fieldset names the
  // ask already: one row, or the read-only list. Named by where the queries
  // go, the fact a writer landing here needs. Open, several rows are already
  // one group, their fieldset named by its legend, and a second group of the
  // same name around it would be heard twice.
  const group = only !== undefined || collapsed;
  return (
    <div
      className="ai-ask"
      ref={root}
      role={group ? "group" : undefined}
      aria-label={only ? label : undefined}
      aria-labelledby={collapsed ? labelId : undefined}
      // The read-only face's note is the group's description, as the
      // retry's is its own.
      aria-describedby={collapsed ? noteId : undefined}
      tabIndex={-1}
      onKeyDown={escapeDeclines(decline)}
    >
      {lede ? <p className="ai-lede">{lede}</p> : null}
      {/* One child slot, whichever face fills it, so the actions keep their
          node across Edit and the arming observer keeps watching the real
          one. */}
      {collapsed ? (
        <>
          <span className="ui-input-label" id={labelId}>
            {label}
          </span>
          <QueryList
            // Every row is ticked and sendable while collapsed (the `open`
            // rule, and no edit before Edit), so this is every row, each as
            // Search sends it.
            rows={outgoing.map(({ rowId, query, flagged }) => ({
              rowId,
              text: query,
              flagged,
            }))}
          />
          <p className="ui-input-note" id={noteId}>
            {note}
          </p>
        </>
      ) : only ? (
        <WrapInput
          label={label}
          value={only.value}
          flag={only.flagged ? t("dock.web.flag") : undefined}
          evidence={note}
          onChange={(event) => edit(only.rowId, event.target.value)}
          onKeyDown={onFieldKey}
        />
      ) : (
        // Where the jump lands when every row is unticked and no field is
        // open: the named group, never a tick.
        <fieldset className="ai-ask-rows" tabIndex={-1}>
          <legend className="ui-input-label">{label}</legend>
          {rows.map((row, index) => (
            <div className="ai-ask-row" key={row.rowId}>
              <Tick
                className="ui-tick-bare"
                // A checkbox: ticked is "this query is sent", a pick
                // among the rows, and the box is what is drawn.
                checked={row.ticked}
                // Named by its query; a row the writer emptied falls back to
                // the label, so no tick is ever nameless.
                aria-label={row.value.trim() ? row.value : label}
                onToggle={() =>
                  setRows((all) =>
                    all.map((one) =>
                      one.rowId === row.rowId
                        ? { ...one, ticked: !one.ticked }
                        : one,
                    ),
                  )
                }
              />
              <WrapInput
                // Where Edit puts the writer, through the kit's own ref
                // rather than its inner markup.
                ref={index === 0 ? firstField : undefined}
                label={label}
                labelHidden
                value={row.value}
                disabled={!row.ticked}
                // The one note, stated once for every row, describes each.
                aria-describedby={noteId}
                flag={
                  row.flagged && row.ticked ? t("dock.web.flag") : undefined
                }
                onChange={(event) => edit(row.rowId, event.target.value)}
                onKeyDown={onFieldKey}
              />
            </div>
          ))}
          <p className="ui-input-note" id={noteId}>
            {note}
          </p>
        </fieldset>
      )}
      <span className="ai-finding-actions" ref={actions}>
        <Button
          variant="soft"
          className="ui-btn-sm"
          disabled={!sendable}
          onClick={search}
        >
          {t("dock.web.search")}
        </Button>
        <Button variant="link" className="ui-btn-sm" onClick={decline}>
          {t("dock.web.decline")}
        </Button>
        {/* Last, because Edit leaves as the fields come, and in last place
            its going moves nothing sideways: Don't search never slides under
            a pointer that was clicking Edit, which would decline the run. No
            icon and no ember: a control that opens the fields, not a third
            answer. */}
        {collapsed ? (
          <Button
            variant="link"
            className="ui-btn-sm"
            aria-label={t("dock.web.editName")}
            onClick={openFields}
          >
            {t("dock.web.edit")}
          </Button>
        ) : null}
      </span>
    </div>
  );
}

// ── The retry body ───────────────────────────────────────────────────────────

/**
 * The instant as the writer's clock reads it, rounded up to the minute, so
 * "try again at 14:32" is never a minute the button still refuses in. A
 * clock time, never a countdown, as `waitForReset` shows it.
 */
function clockTime(at: number, language: string): string {
  const minute = 60_000;
  return new Intl.DateTimeFormat(language, { timeStyle: "short" }).format(
    new Date(Math.ceil(at / minute) * minute),
  );
}

function RetryBody({
  ask,
  onAnswer,
  scroller,
  revealedAt,
  onSpeak,
  onDecided,
}: AiSearchAskProps & { ask: Extract<SearchAsk, { kind: "retry" }> }) {
  const { t, i18n } = useTranslation();
  const engine = engineLabel(ask.engine);
  const root = useRef<HTMLDivElement | null>(null);
  const actions = useRef<HTMLSpanElement | null>(null);
  const { armed } = useAskArming(actions, scroller, revealedAt);
  const decide = useDecide(root, onAnswer, onDecided);
  // One instant drives the button, the lede and the announcement. The arming
  // window after the wait is spent visibly disabled, so a press on an
  // enabled Retry is never dropped for the wait. The pause's own gate is the
  // earlier `at`, so it never refuses a press this allowed.
  const at = Date.parse(ask.at);
  const readyAt = at + ASK_ARM_MS;
  const [ready, setReady] = useState(() => Date.now() >= readyAt);
  useEffect(() => {
    if (ready) return;
    const check = () => {
      if (Date.now() >= readyAt) setReady(true);
    };
    const timer = setTimeout(check, Math.max(0, readyAt - Date.now()));
    // A background tab's timers are throttled; coming back re-reads the
    // clock rather than trusting the timeout to have fired on time.
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [ready, readyAt]);

  const lede = ready
    ? t("dock.web.retryLede.ready")
    : t("dock.web.retryLede.wait", { time: clockTime(at, i18n.language) });
  // Waiting and the lede as the ask appears; the swapped lede once, when it
  // becomes true. The flag rides with the first words, as on a first ask, so
  // a resend of the writer's words is said to be one. Whether these are the
  // first words or the swap is read from `ready` having changed since the
  // last words, never from whether anything was said: StrictMode re-runs the
  // effect with its refs kept, and a "said already" flag would make the
  // re-run speak the lede alone.
  const spokenFor = useRef<boolean | null>(null);
  useEffect(() => {
    const swap = spokenFor.current !== null && spokenFor.current !== ready;
    spokenFor.current = ready;
    onSpeak(
      swap
        ? lede
        : [
            t("dock.awaitingWriter"),
            lede,
            ask.rows.some((row) => row.bookWords) ? t("dock.web.flag") : null,
          ]
            .filter(Boolean)
            .join(" "),
    );
    // The lede changes exactly once, at `readyAt`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const retry = () => {
    if (!ready || !armed()) return;
    decide({ kind: "retry" });
  };
  const decline = () => decide({ kind: "decline" });
  const ids = useId();
  return (
    <div
      className="ai-ask"
      ref={root}
      // A resend has no field: the jump lands on the ask itself, a group
      // named by where the queries go.
      role="group"
      aria-labelledby={`${ids}-label`}
      // Described by its note, as the several-search face is, so what the
      // resend costs is heard with where it goes.
      aria-describedby={`${ids}-note`}
      tabIndex={-1}
      onKeyDown={escapeDeclines(decline)}
    >
      <p className="ai-lede">{lede}</p>
      <span className="ui-input-label" id={`${ids}-label`}>
        {webPhrase(t, "ask", engine)}
      </span>
      {/* Each query whole, as text: nothing to edit on a resend. */}
      <QueryList
        rows={ask.rows.map((row) => ({
          rowId: row.rowId,
          text: row.query,
          flagged: row.bookWords,
        }))}
      />
      <p className="ui-input-note" id={`${ids}-note`}>
        {noteOf(t, engine, ask.rows.length)}
      </p>
      <span className="ai-finding-actions" ref={actions}>
        <Button
          variant="soft"
          className="ui-btn-sm"
          disabled={!ready}
          onClick={retry}
        >
          {t("dock.web.retry")}
        </Button>
        <Button variant="link" className="ui-btn-sm" onClick={decline}>
          {t("dock.web.decline")}
        </Button>
      </span>
    </div>
  );
}
