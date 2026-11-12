// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { appIcons } from "../../ui/appIcons";
import type { BoardCommand } from "../components/CommandBoard";
import type { EditorEngine } from "../views/engine";

/** The places the palette opens, and the facts that name or hide them. */
export interface EditorCommandTargets {
  onFind: () => void;
  onChars: () => void;
  onShortcuts: () => void;
  onSave: () => void;
  canSave: boolean;
  /** Absent with no Assistant, and so is the entry. */
  onAsk?: () => void;
  /** A search waits on the writer: the entry's name says so. */
  askWaiting?: boolean;
  onSnapshots: () => void;
  /** Absent where there is no margin, and so is the entry. */
  onComments?: () => void;
  commentsHidden?: boolean;
  /** Absent with no comment on a passage to walk to, and so are both. */
  onPreviousComment?: () => void;
  onNextComment?: () => void;
  onHistory: () => void;
  onNotes: () => void;
  onReference: () => void;
}

/**
 * Every command in the bar, as a palette list. Built here because the palette
 * is shared with the Library and knows no engine, and from the shortcut
 * table's own labels, so a command and its binding cannot disagree.
 */
export function useEditorCommands(
  engine: EditorEngine,
  on: EditorCommandTargets,
): BoardCommand[] {
  const { t } = useTranslation();
  return useMemo(() => {
    const format = t("shortcuts.group.format");
    const block = t("shortcuts.group.block");
    const align = t("shortcuts.group.align");
    const edit = t("shortcuts.group.edit");
    const file = t("shortcuts.group.file");
    // Not a shortcut group, since none has a binding, but the same
    // vocabulary, so the palette reads as one list.
    const places = t("shortcuts.group.places");

    return [
      {
        id: "bold",
        label: t("toolbar.bold"),
        group: format,
        icon: appIcons.bold,
        run: () => engine.toggleBold(),
      },
      {
        id: "italic",
        label: t("toolbar.italic"),
        group: format,
        icon: appIcons.italic,
        run: () => engine.toggleItalic(),
      },
      {
        id: "mono",
        label: t("toolbar.monospace"),
        group: format,
        icon: appIcons.monospace,
        run: () => engine.toggleMonospace(),
      },
      {
        id: "normal",
        label: t("toolbar.normalText"),
        group: format,
        icon: appIcons.normalText,
        run: () => engine.setNormalText(),
      },
      {
        id: "case",
        label: t("toolbar.toggleCase"),
        group: format,
        icon: appIcons.changeCase,
        run: () => engine.toggleCase(),
      },

      {
        id: "h1",
        label: t("toolbar.title"),
        group: block,
        icon: appIcons.title,
        run: () => engine.setBlockType("h1"),
      },
      {
        id: "h2",
        label: t("toolbar.subtitle"),
        group: block,
        icon: appIcons.subtitle,
        run: () => engine.setBlockType("h2"),
      },
      {
        id: "p",
        label: t("toolbar.body"),
        group: block,
        icon: appIcons.body,
        run: () => engine.setBlockType("paragraph"),
      },
      {
        id: "break",
        label: t("toolbar.pageBreak"),
        group: block,
        icon: appIcons.pageBreak,
        run: () => engine.insertPageBreak(),
      },

      {
        id: "align-left",
        label: t("toolbar.alignLeft"),
        group: align,
        icon: appIcons.alignLeft,
        run: () => engine.align("left"),
      },
      {
        id: "align-center",
        label: t("toolbar.alignCenter"),
        group: align,
        icon: appIcons.alignCenter,
        run: () => engine.align("center"),
      },
      {
        id: "align-right",
        label: t("toolbar.alignRight"),
        group: align,
        icon: appIcons.alignRight,
        run: () => engine.align("right"),
      },
      {
        id: "align-justify",
        label: t("toolbar.justify"),
        group: align,
        icon: appIcons.alignJustify,
        run: () => engine.align("justify"),
      },

      {
        id: "undo",
        label: t("toolbar.undo"),
        group: edit,
        icon: appIcons.undo,
        run: () => engine.undo(),
      },
      {
        id: "redo",
        label: t("toolbar.redo"),
        group: edit,
        icon: appIcons.redo,
        run: () => engine.redo(),
      },
      {
        id: "chars",
        label: t("toolbar.specialChars"),
        group: edit,
        icon: appIcons.edit,
        run: on.onChars,
      },

      {
        id: "find",
        label: t("toolbar.search"),
        group: file,
        icon: appIcons.search,
        run: on.onFind,
      },
      ...(on.canSave
        ? [
            {
              id: "save",
              label: t("toolbar.save"),
              group: file,
              icon: appIcons.save,
              run: on.onSave,
            },
          ]
        : []),
      {
        id: "shortcuts",
        label: t("shortcuts.title"),
        group: file,
        icon: appIcons.settings,
        run: on.onShortcuts,
      },

      // ── The places ─────────────────────────────────────────────────────────
      //
      // Their own group, because they open a place rather than change the
      // prose. On a desk the bar offers them all and this is a second way in;
      // on a phone the bar offers none, and this is the only way in.
      ...(on.onAsk
        ? [
            {
              id: "ask",
              label: t(
                on.askWaiting
                  ? "toolbar.assistantWaiting"
                  : "toolbar.assistant",
              ),
              group: places,
              icon: appIcons.assistant,
              run: on.onAsk,
            },
          ]
        : []),
      {
        id: "reference",
        label: t("dock.reference"),
        group: places,
        icon: appIcons.section,
        run: on.onReference,
      },
      {
        id: "notes",
        label: t("dock.notes"),
        group: places,
        icon: appIcons.edit,
        run: on.onNotes,
      },
      {
        id: "snapshots",
        label: t("toolbar.snapshot"),
        group: places,
        icon: appIcons.snapshot,
        run: on.onSnapshots,
      },
      {
        id: "history",
        label: t("toolbar.history"),
        group: places,
        icon: appIcons.history,
        run: on.onHistory,
      },
      // Named for what it will do, as a palette entry reads. The phone's bar
      // has no slot for the toggle, so this is its way in.
      ...(on.onComments
        ? [
            {
              id: "comments",
              label: t(
                on.commentsHidden
                  ? "toolbar.showComments"
                  : "toolbar.hideComments",
              ),
              group: places,
              icon: appIcons.comment,
              run: on.onComments,
            },
          ]
        : []),
      ...(on.onPreviousComment && on.onNextComment
        ? [
            {
              id: "previousComment",
              label: t("toolbar.previousComment"),
              group: places,
              icon: appIcons.previousComment,
              run: on.onPreviousComment,
            },
            {
              id: "nextComment",
              label: t("toolbar.nextComment"),
              group: places,
              icon: appIcons.nextComment,
              run: on.onNextComment,
            },
          ]
        : []),
    ];
  }, [
    engine,
    t,
    on.onChars,
    on.onFind,
    on.onSave,
    on.onShortcuts,
    on.canSave,
    on.onAsk,
    on.askWaiting,
    on.onSnapshots,
    on.onComments,
    on.commentsHidden,
    on.onPreviousComment,
    on.onNextComment,
    on.onHistory,
    on.onNotes,
    on.onReference,
  ]);
}
