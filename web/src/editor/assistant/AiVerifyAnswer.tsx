// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../ui";
import {
  judged,
  type VerifyOutcome,
  type WebSearchRecord,
} from "../../ai/domain/types";
import type { CitedSource } from "../../ai/domain/webCitations";
import AiWebSources from "./AiWebSources";
import { VERDICT_MARK, quotesOf, wikipediaLimited } from "./verifyAnswer";

// A `/verify` answer: what the web said of a claim. In order: the
// verdict line (its mark and word, and the one Wikipedia hint 4px under it),
// the judge's reasoning, the sources it rests on with the words each was
// quoted for, and last the suggested fix, after the list so a rewording no
// source backs never reads as sourced. Inside the turn's `.msg-body` with no
// card, no gap column and no count of sources, because two rows for one page
// must never read as corroboration.
//
// Only a settled answer comes here. While the check runs, the trace's live
// line says so; an interrupted or failed check has no verdict and draws no
// mark, and the turn's banner says what happened. So the dashed ring is
// never a pending mark: it is "can't tell", a thing the sources settled.
//
// The fix is a plain text node: never parsed, never resolved, so a `web:1`
// or a link in it stays the characters it is.

export default function AiVerifyAnswer({
  verified,
  records,
  cited,
  reading,
}: {
  verified: VerifyOutcome;
  /** The turn's web records: what the Wikipedia hint is read from. */
  records: readonly WebSearchRecord[];
  /** This turn's entry from the chat's one citation walk. */
  cited: readonly CitedSource[];
  /** The reasoning, as the turn renders any answer's prose. */
  reading: ReactNode;
}) {
  const { t } = useTranslation();
  // Nothing was judged: one neutral line, and nothing a verdict would carry,
  // so no mark, no reserved seat, no prose and no rows.
  if (!judged(verified))
    return (
      <div className="ai-verify">
        <p className="ai-lede">
          {t(`dock.verify.unjudged.${verified.unjudged}`)}
        </p>
      </div>
    );
  const mark = VERDICT_MARK[verified.verdict];
  return (
    <>
      <div className="ai-verify">
        <p className="ai-lede ai-verdict">
          <Icon
            name={mark.icon}
            size={12}
            className={`ai-mark is-${mark.degree}`}
            aria-hidden="true"
          />
          {/* The visible word is the accessible word: the mark says nothing
              the word does not. */}
          <strong>{t(`dock.verify.verdict.${verified.verdict}`)}</strong>
        </p>
        {wikipediaLimited(verified, records) ? (
          <p className="dock-hint">{t("dock.verify.wikipediaLimit")}</p>
        ) : null}
      </div>
      {reading}
      <AiWebSources cited={cited} quotes={quotesOf(verified, records, cited)} />
      {verified.fix ? (
        <div className="ai-findings">
          <div className="ai-finding">
            <span className="ai-finding-head">{t("dock.verify.fix")}</span>
            <p className="ai-finding-body">{verified.fix}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
