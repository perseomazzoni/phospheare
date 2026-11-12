// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatRecord } from "../../ai/domain/types";
import { offersWorkflow } from "../../ai/domain/skills";
import { NO_WEB_CITATIONS, webCitations } from "../../ai/domain/webCitations";
import { chatTitleShown } from "./chatTitleShown";
import type { LiveStructure } from "./mapAnswer";
import { turnAsText } from "./turnText";

/**
 * A failed save's row: it names the chat, offers Retry, and offers the last
 * answer as text. The app never holds work only in memory without saying so.
 */
export default function AiSaveFoot({
  failedChat,
  activeChatId,
  titles,
  live,
  onRetry,
}: {
  /** The chat whose save failed, resolved against the live list. */
  failedChat: ChatRecord;
  activeChatId: string | undefined;
  titles: ReadonlyMap<string, string>;
  live: LiveStructure | undefined;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  /**
   * Save-failure recovery: a chat's last answer, as plain text, to the
   * clipboard, in the words the answer's own Copy writes (`turnAsText`).
   * Only the last answer with words, and nothing when that is a `/where`
   * answer: an older one under "Copy the answer" would copy an answer the
   * writer is not looking at.
   *
   * Memoized on the failed record, never built in render: the foot stays up
   * while the open chat streams, and a render per token would re-walk and
   * re-parse an unchanged chat. The record is replaced, never written in
   * place, whenever the chat changes, so with the titles, the live Structure
   * and `t` it is the whole key.
   */
  const failedAnswer = useMemo(() => {
    const turn = [...(failedChat?.turns ?? [])]
      .reverse()
      .find((one) => one.role === "assistant" && one.text);
    return turn && failedChat
      ? turnAsText(turn, {
          titles,
          web:
            webCitations(
              failedChat.turns,
              undefined,
              undefined,
              failedChat.searchedBefore,
            ).get(turn.id) ?? NO_WEB_CITATIONS,
          t,
          live,
          offersMap: offersWorkflow(failedChat.kind, "map"),
        })
      : null;
  }, [failedChat, titles, t, live]);
  const copyAnswer = () => {
    if (failedAnswer) void navigator.clipboard?.writeText(failedAnswer);
  };
  return (
    <p className="dock-foot is-failed">
      {failedChat.id === activeChatId
        ? t("dock.saveFailed")
        : t("dock.saveFailedNamed", {
            title: chatTitleShown(t, failedChat),
          })}{" "}
      <button type="button" className="ai-text-button" onClick={onRetry}>
        {t("dock.retrySave")}
      </button>
      {failedAnswer ? (
        <button type="button" className="ai-text-button" onClick={copyAnswer}>
          {t("dock.copyAnswer")}
        </button>
      ) : null}
    </p>
  );
}
