// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Kbd, Sheet } from "../../ui";
import {
  SHORTCUTS,
  formatShortcut,
  type ShortcutGroup,
  type ShortcutId,
} from "../views/shortcuts";

// The shortcut sheet, generated from `SHORTCUTS` itself rather than written
// out, so it cannot drift from what the keyboard does. A hand-maintained
// list of shortcuts goes wrong in the worst direction: it promises a binding
// that does not exist.
//
// It is also what makes the bar's hover menus safe. The bar folds two
// four-way choices behind a hover, which is only safe if every one of them
// is reachable another way, and the sheet documents every binding, including
// those on no button at all.

const GROUP_ORDER: ShortcutGroup[] = [
  "format",
  "block",
  "align",
  "edit",
  "file",
];

/** The typographic inserts, which are a table of their own. */
const INSERTS = "chars" as const;

/**
 * Each binding's name in the writer's language: the string the bar, the
 * context menu or the characters panel already shows for the same command.
 * The accented capitals have no entry, since their name is the letter itself.
 */
export const SHORTCUT_NAMES: Partial<Record<ShortcutId, string>> = {
  bold: "toolbar.bold",
  italic: "toolbar.italic",
  monospaceInline: "toolbar.monospace",
  setNormalText: "toolbar.normalText",
  toggleCase: "toolbar.toggleCase",
  pageBreak: "toolbar.pageBreak",
  setTitle: "toolbar.title",
  setSubtitle: "toolbar.subtitle",
  setBody: "toolbar.body",
  alignLeft: "toolbar.alignLeft",
  alignCenter: "toolbar.alignCenter",
  alignRight: "toolbar.alignRight",
  alignJustify: "toolbar.justify",
  undo: "toolbar.undo",
  redo: "toolbar.redo",
  rail: "toolbar.history",
  snapshot: "toolbar.snapshot",
  cut: "toolbar.cut",
  copy: "toolbar.copy",
  paste: "toolbar.paste",
  pastePlain: "toolbar.pastePlain",
  selectAll: "toolbar.selectAll",
  save: "toolbar.save",
  find: "toolbar.search",
  apostrophe: "chars.apostrophe",
  emDash: "chars.emDash",
  ellipsis: "chars.ellipsis",
  leftGuillemet: "chars.leftGuillemet",
  rightGuillemet: "chars.rightGuillemet",
  openDoubleQuote: "chars.openDoubleQuote",
  closeDoubleQuote: "chars.closeDoubleQuote",
  enDash: "chars.enDash",
};

function ShortcutSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = Object.keys(SHORTCUTS) as ShortcutId[];

  const groups: { id: ShortcutGroup | typeof INSERTS; ids: ShortcutId[] }[] = [
    ...GROUP_ORDER.map((group) => ({
      id: group,
      ids: ids.filter((id) => SHORTCUTS[id].group === group),
    })),
    // Everything with no group is an insert: the accented capitals and the
    // punctuation. They are the one set large enough that listing them by
    // hand would be the thing that goes stale.
    { id: INSERTS, ids: ids.filter((id) => !SHORTCUTS[id].group) },
  ];

  return (
    <Sheet open={open} title={t("shortcuts.title")} onClose={onClose}>
      <div className="keys">
        {groups
          .filter((group) => group.ids.length > 0)
          .map((group) => (
            <section className="keys-group" key={group.id}>
              <h3>{t(`shortcuts.group.${group.id}`)}</h3>
              {group.ids.map((id) => (
                <div className="keys-row" key={id}>
                  <span>
                    {SHORTCUTS[id].action ?? ""}{" "}
                    {SHORTCUT_NAMES[id]
                      ? t(SHORTCUT_NAMES[id])
                      : SHORTCUTS[id].label}
                  </span>
                  <Kbd>{formatShortcut(id)}</Kbd>
                </div>
              ))}
            </section>
          ))}
      </div>
    </Sheet>
  );
}

// Memoised because it mounts closed beside the prose and the shell redraws
// around it several times per save, each a full rebuild of every table below
// for nothing. Its props are a flag and a stable callback.
export default memo(ShortcutSheet);
