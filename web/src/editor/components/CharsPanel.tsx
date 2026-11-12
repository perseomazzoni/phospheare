// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Tip } from "../../ui";
import type { EditorEngine } from "../views/engine";
import { formatShortcut, type ShortcutId } from "../views/shortcuts";

// Special characters, drawn as keys because every one is also a shortcut and
// the panel is where a writer learns that.
//
// The grouping follows typography, not the alphabet: guillemets together, the
// two double quotes together, the dashes with the ellipsis they are confused
// with. So this is a hand-written table rather than a filter over the
// shortcut list.

interface CharKey {
  char: string;
  /** An i18n key, or the character itself where the character is the name. */
  label: string;
  shortcut: ShortcutId;
}

const CHAR_GROUPS: CharKey[][] = [
  [
    { char: "«", label: "chars.leftGuillemet", shortcut: "leftGuillemet" },
    { char: "»", label: "chars.rightGuillemet", shortcut: "rightGuillemet" },
  ],
  [
    { char: "“", label: "chars.openDoubleQuote", shortcut: "openDoubleQuote" },
    {
      char: "”",
      label: "chars.closeDoubleQuote",
      shortcut: "closeDoubleQuote",
    },
  ],
  [{ char: "’", label: "chars.apostrophe", shortcut: "apostrophe" }],
  [
    { char: "—", label: "chars.emDash", shortcut: "emDash" },
    { char: "–", label: "chars.enDash", shortcut: "enDash" },
    { char: "…", label: "chars.ellipsis", shortcut: "ellipsis" },
  ],
  [
    { char: "À", label: "À", shortcut: "À" },
    { char: "È", label: "È", shortcut: "È" },
    { char: "É", label: "É", shortcut: "É" },
    { char: "Ì", label: "Ì", shortcut: "Ì" },
    { char: "Ò", label: "Ò", shortcut: "Ò" },
    { char: "Ù", label: "Ù", shortcut: "Ù" },
  ],
  [
    { char: "Â", label: "Â", shortcut: "Â" },
    { char: "Ê", label: "Ê", shortcut: "Ê" },
    { char: "Î", label: "Î", shortcut: "Î" },
    { char: "Ô", label: "Ô", shortcut: "Ô" },
    { char: "Û", label: "Û", shortcut: "Û" },
    { char: "Ë", label: "Ë", shortcut: "Ë" },
    { char: "Ï", label: "Ï", shortcut: "Ï" },
    { char: "Ü", label: "Ü", shortcut: "Ü" },
  ],
];

function CharsPanel({ engine }: { engine: EditorEngine }) {
  const { t } = useTranslation();

  return (
    <div className="ed-card">
      <div
        className="chars"
        role="group"
        aria-label={t("toolbar.specialChars")}
      >
        {CHAR_GROUPS.map((group, index) => (
          <div className="chars-group" key={index}>
            {group.map(({ char, label, shortcut }) => {
              // The accented capitals are their own name, with nothing to
              // translate.
              const name = label.includes(".") ? t(label) : label;
              return (
                <button
                  key={char}
                  type="button"
                  className="char-key"
                  aria-label={name}
                  data-tip=""
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => engine.type(char)}
                >
                  {char}
                  <Tip label={name} shortcut={formatShortcut(shortcut)} />
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// Memoised: it stays mounted inside a closed drop and its one prop never
// changes, so a shell redraw, several per save, has nothing to tell it.
export default memo(CharsPanel);
