// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Dots } from "../../ui";
import {
  TOOL_NAMES,
  type RunActivity,
  type ToolName,
} from "../../ai/domain/types";
import { runElapsedMs } from "../../ai/domain/runClock";
import { slotted } from "../components/slotted";
import type { AssistantSnapshot } from "../../ai/application/assistant";

// What a run is doing, said once. A run has one live status. The
// words live here, and so does the clock; the chat turn being written draws
// them in its own summary line, and the line under the transcript is drawn
// only for runs with no turn to hold it (a full review, a continuation). The
// screen reader hears it from one visually hidden node the panel owns,
// because a turn remounts and a live region that remounts announces nothing.
//
// Each state is named for what the app knows: `waiting` from the
// request leaving to its first byte, with the model's name; `thinking` only
// once a reasoning event proves it. While the answer streams there are no
// words, since the arriving prose is its own status, so `shown` is null and
// only `spoken` carries it.

export interface ActivityWords {
  /** The words on the line, or null when the dots and clock say enough. */
  shown: string | null;
  /** The words for the live region. */
  spoken: string;
}

export function activityWords(
  t: TFunction,
  activity: RunActivity | null | undefined,
  preparing = false,
): ActivityWords {
  const say = (words: string): ActivityWords => ({
    shown: words,
    spoken: words,
  });
  if (!activity) return say(t(preparing ? "dock.preparing" : "dock.working"));
  switch (activity.kind) {
    case "preparing":
      return say(t("dock.preparing"));
    case "waiting":
      return say(t("dock.waiting", { model: activity.model }));
    case "thinking":
      return say(t("dock.thinking"));
    case "writing":
      return { shown: null, spoken: t("dock.writing") };
    case "tool":
      return say(toolPhrase(t, "doing", activity.tool, activity.subject));
    case "awaiting-writer":
      return say(t("dock.awaitingWriter"));
    case "searching-web":
      // The engine by name, so a search of Wikipedia never reads as "the
      // web"; never the query, since the line states what the run is doing,
      // not what it sent.
      return say(webPhrase(t, "doing", activity.engine));
    case "verifying":
      return say(t(`dock.verify.${activity.step}`));
    // The Section by its title: "Reading The Harbour" says how far the
    // reader has got, which is the one thing a long wait wants to know.
    case "reading":
      return say(t("dock.reading.reading", { title: activity.title }));
    case "predicting":
      return say(t("dock.reading.predicting"));
  }
}

/**
 * A tool call in words, in one of its three tenses.
 *
 * The name is checked against the tool catalogue before it becomes part of a
 * key: it is the model's `call.name`, and a key built from anything it likes
 * would print whatever i18next does with a missing key. A name outside the
 * catalogue is plain "working".
 *
 * `_named` is i18next's context suffix, and it falls back to the plain key on
 * its own, which is where a call with no subject lands without a branch.
 */
export function toolPhrase(
  t: TFunction,
  tense: "doing" | "did" | "failed",
  tool: string,
  subject?: string,
): string {
  // `web_search` speaks through `webPhrase`, which names the engine the
  // search went to; it has no tool keys of its own.
  if (!TOOL_NAMES.includes(tool as ToolName) || tool === "web_search")
    return t("dock.working");
  return t(`dock.${tense}.${tool}`, {
    context: subject ? "named" : undefined,
    subject,
  });
}

/**
 * A web search in words, in one of its five tenses: `ask` is
 * the field's label, `doing` the live line, and the three stored outcomes
 * the trace's rows. The engine is the model-facing label, `wikipedia` or
 * `web`, so what the writer reads and what the model was told agree.
 *
 * The query, where a tense shows it, is a slot and never a value: the locale
 * holds `{{query}}`, `slotted` cuts the sentence there, and the query arrives
 * as a React child inside `<q><bdi>`. So nothing a model proposed or a writer
 * typed is ever read as markup or as an interpolation, and the quotes are the
 * element's, in the writer's language.
 */
export function webPhrase(
  t: TFunction,
  tense: "ask" | "doing" | "declined",
  engine: "wikipedia" | "web",
): string;
export function webPhrase(
  t: TFunction,
  tense: "did" | "failed",
  engine: "wikipedia" | "web",
  query: string,
): ReactNode;
export function webPhrase(
  t: TFunction,
  tense: "ask" | "doing" | "did" | "failed" | "declined",
  engine: "wikipedia" | "web",
  query?: string,
): ReactNode {
  const key = `dock.web.${tense}.${engine}`;
  if (query === undefined) return t(key);
  return slotted((one, values) => t(one, values), key, {
    query: (
      <q>
        <bdi>{query}</bdi>
      </q>
    ),
  });
}

/** Seconds as the dock writes a duration, for the live and the frozen clock. */
export function formatElapsed(t: TFunction, seconds: number): string {
  return seconds < 60
    ? t("dock.elapsedSeconds", { seconds })
    : t("dock.elapsedMinutes", {
        minutes: Math.floor(seconds / 60),
        seconds: seconds % 60,
      });
}

/** Whole seconds between two instants, the one rounding both clocks use. */
export function wholeSeconds(milliseconds: number): number {
  return Math.max(0, Math.floor(milliseconds / 1000));
}

/**
 * Seconds the run has taken, ticking: since `createdAt`, or since this
 * mounted when the run has no stamp of its own, less `waitedMs`, the time it
 * spent waiting on the writer. Through the domain's `runElapsedMs`,
 * so the live clock and the stored one are one measurement and neither counts
 * the writer's minutes over a search ask.
 *
 * Measured from the wall clock rather than counted up, because a background
 * tab has its timers throttled to once a minute or stopped: a counter would
 * come back from a switched tab reading `3s` after two minutes away. The
 * interval only decides how often to look. Owned by the line that
 * shows it, so one second's tick re-renders a line and not the transcript.
 */
export function useElapsed(createdAt?: string, waitedMs = 0): number {
  const mounted = useRef(new Date().toISOString());
  const start =
    createdAt !== undefined && !Number.isNaN(Date.parse(createdAt))
      ? createdAt
      : mounted.current;
  const [seconds, setSeconds] = useState(() =>
    wholeSeconds(runElapsedMs(start, waitedMs, new Date().toISOString())),
  );
  useEffect(() => {
    const read = () =>
      setSeconds(
        wholeSeconds(runElapsedMs(start, waitedMs, new Date().toISOString())),
      );
    read();
    const tick = setInterval(read, 1_000);
    return () => clearInterval(tick);
  }, [start, waitedMs]);
  return seconds;
}

/**
 * The visible line: dots, the words, the clock. Hidden from assistive tech,
 * because the panel's live region already said it, and a clock read aloud
 * every second would say nothing else for the length of the answer.
 *
 * One ellipsis over the words rather than one per part: every phrase that can
 * grow ends in the part that may be cut (the model's name, a source's title, a
 * search's terms) in both locales, so a trailing ellipsis only shortens that,
 * while the verb before it and the clock beside it stay whole. A phrase that
 * puts its growing part first breaks this.
 */
export function RunLine({
  shown,
  createdAt,
  waitedMs,
  className,
}: {
  shown: string | null;
  /** The turn's stamp; the line's own mount when there is no turn. */
  createdAt?: string;
  /** The writer's share of the time so far (`runWaitedMs`). */
  waitedMs?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const seconds = useElapsed(createdAt, waitedMs);
  return (
    <span
      className={["ai-activity", className ?? ""].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      <Dots />
      {shown ? (
        <span className="ai-activity-label" title={shown}>
          {shown}
        </span>
      ) : null}
      <span className="ai-elapsed">{formatElapsed(t, seconds)}</span>
    </span>
  );
}

/**
 * A long run's count, in words: which count it is depends on the work. A
 * `/where` that has not yet chosen what to read says what it is doing
 * instead of "0 of 0".
 */
export function progressWords(
  t: TFunction,
  progress: NonNullable<AssistantSnapshot["runProgress"]>,
): string {
  const { work, complete, total } = progress;
  // Plural on the run's steps, as `/where`'s reading line is: a run of one
  // step says what it is doing with no "0 of 1", because the count answers
  // how long this will take and one step has nothing to count. A plan of
  // none reads the same, not "0 of 0": i18next picks `_other` for 0, and a
  // `/map` with no units publishes that.
  const steps = Math.max(1, total);
  if (work === "review")
    return t("dock.reviewProgress", { complete, count: steps });
  if (work === "map") return t("dock.mapProgress", { complete, count: steps });
  if (work === "locate" && total === 0) return t("dock.where.ranking");
  return t(work === "locate" ? "dock.where.reading" : "dock.summarising", {
    complete,
    count: total,
  });
}
