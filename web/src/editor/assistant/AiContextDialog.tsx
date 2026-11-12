// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Scrim, Select, Tick } from "../../ui";
import type { Assistant } from "../../ai";
import type {
  ChatRecord,
  SourceDescriptor,
  SourceKind,
} from "../../ai/domain/types";
import { visibleSources } from "../../ai/domain/sourceView";

// What the model is allowed to read, per chat, in a dialog reached from the
// composer's `@` button. These are settings consulted occasionally, so they
// take no rows from the conversation. The source list loads on open.
//
// Each source has two states: pinned, it rides every turn; otherwise it is
// listed in the project index and reached with a tool call if the answer
// needs it. Barring a source from the assistant is a project rule
// (`AiBarToggle`), so it lives on the source's own row in the Reference and
// Notes panels, not in this per-chat dialog.
//
// The lede states the condition ("a model with agent tools"), not a promise
// that the assistant will find a source. A chat-only model cannot keep that
// promise: `assistant.ts` drops the tool array and publishes
// `model-capability-missing` instead.
//
// A reader's scope sits above the list, because it decides which rows the
// list may show. There is no foot: every control writes through on change.

/** The groups, in the order a writer reads them: their book first. */
const GROUPS: readonly SourceKind[] = [
  "manuscript",
  "reference",
  "note",
  "summary",
];

export interface AiContextDialogProps {
  open: boolean;
  onClose: () => void;
  assistant: Assistant;
  /** Preferences and kind; the reader rules are derived from the kind here. */
  chat: ChatRecord;
}

export default function AiContextDialog({
  open,
  onClose,
  assistant,
  chat,
}: AiContextDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [sources, setSources] = useState<SourceDescriptor[]>([]);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    void assistant.listSources().then((listed) => {
      if (live) setSources(listed);
    });
    return () => {
      live = false;
    };
  }, [open, assistant]);

  if (!open) return null;

  const readerKind =
    chat.kind === "alpha-reader" || chat.kind === "beta-reader";
  // A reader must not be shown a source it is not allowed to know about, so
  // every manuscript source past its horizon is dropped, not disabled, by the
  // same rule the pinned chips read (`visibleSources`).
  const scope = chat.preferences.readerScope;
  const visible = visibleSources(chat, sources);
  const groups = GROUPS.map((kind) => ({
    kind,
    rows: visible.filter((source) => source.kind === kind),
  })).filter((group) => group.rows.length > 0);

  const togglePin = (source: SourceDescriptor, pinned: boolean) => {
    const without = chat.preferences.pinnedSourceIds.filter(
      (id) => id !== source.id,
    );
    void assistant.chats.updatePreferences({
      pinnedSourceIds: pinned ? without : [...without, source.id],
    });
  };

  return (
    <Scrim
      open
      dismissible
      onClose={onClose}
      labelledBy={titleId}
      className="ui-dialog ai-context-dialog"
    >
      <header className="ui-dialog-head">
        <h2 id={titleId} className="ui-dialog-title">
          {t("dock.context")}
        </h2>
        <p className="ui-dialog-lede">{t("dock.contextHint")}</p>
      </header>

      <div className="ui-dialog-body">
        {readerKind ? (
          /* Three states, each with its own option: unset, the whole
             manuscript, or through one Section. An unset scope needs an
             option carrying `""`, or the select would show the first Section
             as chosen while the chat is refused. "Whole" is its own value,
             because pointing at the last node stops meaning the whole book
             when a chapter is added. The unset option is present only until
             a scope is chosen: a reader boundary cannot be un-chosen. */
          <Select
            label={t("dock.readerScope")}
            value={
              scope === undefined
                ? ""
                : scope.kind === "whole"
                  ? "whole"
                  : `through:${scope.nodeId}`
            }
            options={[
              ...(scope === undefined
                ? [{ value: "", label: t("dock.readerScopeUnset") }]
                : []),
              { value: "whole", label: t("dock.readerScopeWhole") },
              // Sections only. A horizon runs to a node in reading order and
              // a Part comes before its Sections, so a horizon at a Part
              // would mean its heading alone while reading as the whole
              // Part. A Part's text is read with its first Section's horizon.
              ...sources
                .filter(
                  (source) =>
                    source.kind === "manuscript" && source.nodeKind !== "part",
                )
                .map((source) => ({
                  value: `through:${source.nodeId}`,
                  label: t("dock.readerScopeThrough", { title: source.title }),
                })),
            ]}
            onChange={(next) => {
              if (!next) return;
              void assistant.chats.updatePreferences({
                readerScope:
                  next === "whole"
                    ? { kind: "whole" }
                    : {
                        kind: "through",
                        nodeId: next.slice("through:".length),
                      },
              });
            }}
          />
        ) : null}

        <div className="ai-source-list ui-scroll">
          {groups.map((group) => (
            <section key={group.kind} className="ai-source-group">
              <h3 className="ai-source-group-title">
                {t(`dock.sourceGroup.${group.kind}`)}
              </h3>
              {group.rows.map((source) => {
                const pinned = chat.preferences.pinnedSourceIds.includes(
                  source.id,
                );
                // The kit's tick row is a checkbox: pinning is a pick
                // from a list, not a button that stays down.
                return (
                  <Tick
                    key={source.id}
                    className="ai-source"
                    checked={pinned}
                    aria-label={`${source.title} ${t("dock.context")}`}
                    // Freshness only, where there is one; the group heading
                    // already names the kind.
                    note={source.freshness}
                    onToggle={() => togglePin(source, pinned)}
                  >
                    {source.title}
                  </Tick>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </Scrim>
  );
}
