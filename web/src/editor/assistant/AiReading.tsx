// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import type {
  ChatRecord,
  ChatTurn,
  JournalEntry,
  Prediction,
  ReadingRecord,
} from "../../ai/domain/types";
import { attentionCurve } from "../../ai/domain/reading";

// A beta reader's reading, drawn on two surfaces, both from the chat's one
// `reading` record and never from a turn's prose:
//
// - `AiJournalEntry`, inside a `/read-on` answer under the reader's own
//   words: what it now believes, its questions of the book, where it got
//   lost, whom it cares about, its attention and whether it reads on, and
//   what happened to its predictions here. It carries the findings' quiet
//   left rule and no card, because the prose above it is the entry.
// - `AiReadingSoFar`, over the transcript: the attention curve and the
//   predictions ledger, closed by default. A `<details>`, because it is
//   consulted, not read, and an open curve would push every answer down.
//
// Everything the reader wrote reaches the page as text nodes only: it is the
// model's output about the writer's book, and nothing here renders it as
// markup.

/** The five-step scale as dots: filled to the score, hollow after. */
function Attention({ score }: { score: number }) {
  const { t } = useTranslation();
  return (
    <span
      className="ai-attention"
      role="img"
      aria-label={t("dock.reading.attention", { score })}
    >
      {[1, 2, 3, 4, 5].map((step) => (
        <span
          key={step}
          className={step <= score ? "is-on" : undefined}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

function Lines({ label, items }: { label: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="ai-journal-row">
      <span className="ai-finding-head">{label}</span>
      <ul className="ai-journal-list">
        {items.map((item, at) => (
          <li key={at}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function AiJournalEntry({
  entry,
  predictions,
}: {
  entry: JournalEntry;
  /** The whole ledger: this entry draws what was settled or made here. */
  predictions: readonly Prediction[];
}) {
  const { t } = useTranslation();
  const settled = predictions.filter(
    (one) => one.resolvedAt === entry.nodeId && one.state !== "open",
  );
  const made = predictions.filter((one) => one.madeAt === entry.nodeId);
  return (
    <div className="ai-journal">
      <p className="ai-journal-verdict">
        <Attention score={entry.attention} />
        <span>
          {t(
            entry.keepReading
              ? "dock.reading.keepsReading"
              : "dock.reading.putsDown",
          )}
        </span>
      </p>
      {entry.understanding ? (
        <div className="ai-journal-row">
          <span className="ai-finding-head">
            {t("dock.reading.understanding")}
          </span>
          <p className="ai-finding-body">{entry.understanding}</p>
        </div>
      ) : null}
      <Lines label={t("dock.reading.questions")} items={entry.questions} />
      <Lines label={t("dock.reading.confusion")} items={entry.confusion} />
      {entry.cares.length > 0 ? (
        <div className="ai-journal-row">
          <span className="ai-finding-head">{t("dock.reading.cares")}</span>
          <p className="ai-finding-body">{entry.cares.join(", ")}</p>
        </div>
      ) : null}
      {settled.length > 0 ? (
        <Lines
          label={t("dock.reading.settledHere")}
          items={settled.map(
            (one) =>
              `${t(`dock.reading.state.${one.state}`)}: ${one.text}${one.note ? ` — ${one.note}` : ""}`,
          )}
        />
      ) : null}
      <Lines
        label={t("dock.reading.expects")}
        items={made.map((one) => one.text)}
      />
    </div>
  );
}

/** The curve's drawing box; the SVG scales to the panel's width. */
const WIDTH = 300;
const HEIGHT = 64;
const PAD = 6;

export function AiReadingSoFar({
  reading,
  titleOf,
}: {
  reading: ReadingRecord;
  /** A read Section's title by node id, as the live catalogue names it. */
  titleOf: (nodeId: string) => string;
}) {
  const { t } = useTranslation();
  const curve = attentionCurve(reading);
  if (curve.length === 0 && reading.predictions.length === 0) return null;
  const step = curve.length > 1 ? (WIDTH - 2 * PAD) / (curve.length - 1) : 0;
  const x = (at: number) => (curve.length > 1 ? PAD + at * step : WIDTH / 2);
  const y = (score: number) =>
    HEIGHT - PAD - ((score - 1) / 4) * (HEIGHT - 2 * PAD);
  const points = curve.map((point, at) => `${x(at)},${y(point.attention)}`);
  return (
    <details className="ai-so-far">
      <summary className="ai-so-far-summary">
        {t("dock.reading.soFar", { count: curve.length })}
      </summary>
      {curve.length > 0 ? (
        <figure className="ai-so-far-curve">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline points={points.join(" ")} />
            {curve.map((point, at) => (
              <circle
                key={point.nodeId}
                cx={x(at)}
                cy={y(point.attention)}
                r={point.putDown ? 3.5 : 2.5}
                className={point.putDown ? "is-put-down" : undefined}
              >
                <title>{titleOf(point.nodeId)}</title>
              </circle>
            ))}
          </svg>
          {/* The curve in words, for whoever cannot see it: one line per
              Section, its attention and whether the reader would stop. */}
          <figcaption className="ui-visually-hidden">
            <ol>
              {curve.map((point) => (
                <li key={point.nodeId}>
                  {`${titleOf(point.nodeId)}: ${t("dock.reading.attention", { score: point.attention })}${point.putDown ? `, ${t("dock.reading.putsDown")}` : ""}`}
                </li>
              ))}
            </ol>
          </figcaption>
        </figure>
      ) : null}
      {reading.predictions.length > 0 ? (
        <table className="ai-ledger">
          <caption className="ai-finding-head">
            {t("dock.reading.ledger")}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("dock.reading.prediction")}</th>
              <th scope="col">{t("dock.reading.madeAt")}</th>
              <th scope="col">{t("dock.reading.outcome")}</th>
            </tr>
          </thead>
          <tbody>
            {reading.predictions.map((one) => (
              <tr key={one.id} className={`is-${one.state}`}>
                <td>{one.text}</td>
                <td>
                  {one.madeAt
                    ? titleOf(one.madeAt)
                    : t("dock.reading.beforeReading")}
                </td>
                <td>
                  {t(`dock.reading.state.${one.state}`)}
                  {one.note ? (
                    <span className="ai-ledger-note">{one.note}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </details>
  );
}

/**
 * A `/read-on` answer's entry and the ledger it draws from, only in a beta
 * chat and only while the chat's reading still holds the Section it read.
 */
export function journalOf(
  chat: ChatRecord,
  turn: ChatTurn,
): { entry: JournalEntry; predictions: readonly Prediction[] } | undefined {
  const marker = turn.journal;
  if (chat.kind !== "beta-reader" || marker?.kind !== "read" || !chat.reading)
    return undefined;
  const entry = chat.reading.entries.find(
    (one) => one.nodeId === marker.nodeId,
  );
  return entry ? { entry, predictions: chat.reading.predictions } : undefined;
}
