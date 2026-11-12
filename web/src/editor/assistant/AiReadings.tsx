// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { Meter, Popover, useMenuAnchor } from "../../ui";
import { sameModel } from "../../ai/domain/types";
import type { ChatTurn, ModelRef } from "../../ai/domain/types";
import type { KeyVerdict } from "./keyVerdict";
import { formatUsd } from "../../ai/formatUsd";

// The chat bar's readings: how full the model's window was on the last
// answer, and what is left of a remote key's credit. Each is a meter and a
// number on the bar's leading end, and each opens a small panel with the
// reading drawn large. A panel, not a browser tooltip, which cannot hold a
// graph, appears on a delay nobody controls, and never appears on touch.
//
// The panels hold figures and nothing else: the trigger already names the
// reading, and the colours are learnt by watching them.

/**
 * The answer's fill of its window, or `null` when its numbers are not a
 * reading. They come out of the writer's own chat file, which is replayed
 * without a schema below the turn array, so only sane numbers count.
 */
function fillOf(turn: ChatTurn): { used: number; window: number } | null {
  const used = turn.usage?.contextTokens;
  const window = turn.usage?.contextWindow;
  return typeof used === "number" &&
    typeof window === "number" &&
    Number.isFinite(used) &&
    Number.isFinite(window) &&
    used > 0 &&
    window > 0
    ? { used, window }
    : null;
}

export interface ContextReadingProps {
  turns: readonly ChatTurn[];
  /** The model the chat answers with now. */
  model: ModelRef | null;
}

/**
 * The last answer's fullest request against the window it was sized for.
 *
 * Only for the model the chat answers with now: after a switch, the old
 * model's share of its own window says nothing about the new one.
 */
export function ContextReading({ turns, model }: ContextReadingProps) {
  const { t, i18n } = useTranslation();
  const menu = useMenuAnchor();
  // Compact, to one decimal ("177.8k / 500k"): the panel is read at a
  // glance.
  const numbers = new Intl.NumberFormat(i18n.language, {
    notation: "compact",
    maximumFractionDigits: 1,
  });

  const last = [...turns]
    .reverse()
    .find((turn) => turn.role === "assistant" && turn.usage);
  const fill = last ? fillOf(last) : null;
  if (!last?.model || !model || !sameModel(last.model, model) || !fill)
    return null;

  const share = Math.min(1, fill.used / fill.window);
  // Rounded up and floored at 1: "0% context" after an answer reads as a
  // broken meter, and a window the writer is filling never reads emptier
  // than it is.
  const percent = Math.min(100, Math.max(1, Math.ceil(share * 100)));

  return (
    <>
      <button
        type="button"
        className="ai-reading"
        aria-haspopup="dialog"
        aria-expanded={menu.open}
        onClick={(event) => menu.toggle(event.currentTarget)}
      >
        <Meter shape="ring" share={share} />
        <span className="ai-reading-text">
          {t("dock.contextUsed", { percent })}
        </span>
      </button>
      <Popover
        open={menu.open}
        onClose={menu.close}
        anchor={menu.anchor}
        placement="above-start"
        label={t("dock.reading.contextTitle")}
        className="ai-reading-panel"
      >
        <div className="ai-reading-head">
          <Meter shape="ring" share={share} size={32} />
          <span>
            <strong>{t("dock.reading.context")}</strong>{" "}
            {t("dock.reading.contextUsed", {
              used: numbers.format(fill.used),
              window: numbers.format(fill.window),
              percent,
            })}
          </span>
        </div>
      </Popover>
    </>
  );
}

export interface CreditReadingProps {
  /** The key's verdict for the chat's provider, figures included. */
  verdict: KeyVerdict | undefined;
}

/**
 * The credit left, printed as the verdict states it and never worked out
 * here, so the request gate and this bar cannot judge a key differently.
 * The bar's share is the verdict's division too; a verdict with
 * none draws the words alone.
 */
export function CreditReading({ verdict }: CreditReadingProps) {
  const { t, i18n } = useTranslation();
  const menu = useMenuAnchor();
  if (
    !verdict?.connected ||
    typeof verdict.remainingUsd !== "number" ||
    typeof verdict.spentUsd !== "number" ||
    verdict.limitUsd === null
  )
    return null;
  // The Assistant's one money formatter: a credit under a cent reads as what
  // is left, never "$0.00" beside a key that still works.
  const money = (amount: number) => formatUsd(amount, i18n.language);
  const share =
    typeof verdict.spentShare === "number" ? verdict.spentShare : null;
  const figures: Array<[string, number]> = [
    ["dock.reading.creditSpent", verdict.spentUsd],
    ["dock.reading.creditLeft", verdict.remainingUsd],
    ["dock.reading.creditLimit", verdict.limitUsd],
  ];
  // The key's last moment, beside what it may still spend: date and time,
  // because a key's expiry falls at an hour of the day. The vendor's
  // instant in the writer's own clock and language; an unparseable
  // one is left out rather than printed as "Invalid Date".
  const expires = verdict.expiresAtOrBefore
    ? new Date(verdict.expiresAtOrBefore)
    : null;
  const expiresText =
    expires && !Number.isNaN(expires.getTime())
      ? new Intl.DateTimeFormat(i18n.language, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(expires)
      : null;

  return (
    <>
      <button
        type="button"
        className="ai-reading"
        aria-haspopup="dialog"
        aria-expanded={menu.open}
        onClick={(event) => menu.toggle(event.currentTarget)}
      >
        {share !== null ? <Meter shape="bar" share={share} /> : null}
        <span className="ai-reading-text">
          {t("dock.creditLeft", { amount: money(verdict.remainingUsd) })}
        </span>
      </button>
      <Popover
        open={menu.open}
        onClose={menu.close}
        anchor={menu.anchor}
        placement="above-start"
        label={t("dock.reading.creditTitle")}
        className="ai-reading-panel"
      >
        {share !== null ? (
          <Meter shape="bar" share={share} className="ai-reading-wide" />
        ) : null}
        <dl className="ai-reading-figures">
          {figures.map(([label, amount]) => (
            <div key={label}>
              <dt>{t(label)}</dt>
              <dd>{money(amount)}</dd>
            </div>
          ))}
          {expiresText ? (
            <div>
              <dt>{t("dock.reading.keyExpires")}</dt>
              <dd>{expiresText}</dd>
            </div>
          ) : null}
        </dl>
      </Popover>
    </>
  );
}
