// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";

// The "never let the assistant read this" switch, on the row of the thing it
// is about: a reference document, a note, a generated summary. It writes a
// project rule, not a chat setting, so a chat opened later inherits it. A
// per-chat rule would let every new chat re-expose the document, and a
// privacy rule must not fail open.
//
// One button in two states. Barred, it shows the struck-through glyph and
// stays lit, so the state reads without hovering; allowed, it is the plain
// glyph at the row's weight. `aria-pressed` carries the state to a screen
// reader.
//
// The explanation uses the shared `data-tip` contract: a `.ui-tip` child that
// `:hover` and `:focus-visible` reveal after `--d-tip`. Not a `title`, which
// the keyboard cannot reach and which appears on the browser's own timing.
//
// Manuscript rows never render it. The manuscript is what the assistant reads
// to do its job, and a project-level switch hiding a chapter would break it
// while looking like a setting. Showing less of the book to a reader is a
// per-chat scope with a different lifetime.

export interface AiBarToggleProps {
  /** The AI source id for this row — `reference:<fileName>`. */
  sourceId: string;
  barred: boolean;
  onToggle: (sourceId: string, barred: boolean) => void;
}

export default function AiBarToggle({
  sourceId,
  barred,
  onToggle,
}: AiBarToggleProps) {
  const { t } = useTranslation();
  const label = barred ? t("reference.aiBarred") : t("reference.aiAllowed");
  return (
    <button
      type="button"
      className={`ref-row-ai${barred ? " barred" : ""}`}
      aria-pressed={barred}
      aria-label={label}
      data-tip=""
      onClick={() => onToggle(sourceId, !barred)}
    >
      <Icon
        name={barred ? appIcons.assistantOff : appIcons.assistant}
        size={10}
      />
      <span className="ui-tip" role="tooltip">
        {barred ? t("reference.aiBarredTip") : t("reference.aiAllowedTip")}
      </span>
    </button>
  );
}
