// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { notesOf, referenceCountOf } from "../../project/reference";
import { Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";

/**
 * Reference and Notes: two buttons into the dock's faces, not a switch.
 * Neither has a selected state, because the panel does not track the
 * dock's face. Reference comes first, the dock's own order.
 */
export default function DockButtons({
  referenceFiles,
  rail,
  onOpenReference,
  onOpenNotes,
}: {
  referenceFiles: readonly string[];
  rail: boolean;
  onOpenReference: () => void;
  onOpenNotes: () => void;
}) {
  const { t } = useTranslation();
  const notesCount = useMemo(
    () => notesOf(referenceFiles).length,
    [referenceFiles],
  );
  // The Reference button's badge sums the shelf's five cards. Notes have their
  // own button and count, so they are not in this number.
  const referenceCount = useMemo(
    () => referenceCountOf(referenceFiles),
    [referenceFiles],
  );
  return (
    <div className="dt-dock-buttons">
      <DockButton
        label={t("tree.reference")}
        count={referenceCount}
        glyph="R"
        rail={rail}
        onOpen={onOpenReference}
      />
      <DockButton
        label={t("reference.group.notes")}
        count={notesCount}
        glyph="N"
        rail={rail}
        onOpen={onOpenNotes}
      />
    </div>
  );
}

/**
 * One button into the dock, used by both faces so the two cannot drift
 * apart: wide, the word, the count and the chevron; in the rail, its letter
 * and the chevron.
 */
function DockButton({
  label,
  count,
  glyph,
  rail,
  onOpen,
}: {
  label: string;
  count: number;
  glyph: string;
  rail: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="dt-dock-button"
      onClick={onOpen}
      aria-label={label}
      title={label}
    >
      {rail ? (
        <span className="dt-dock-button-glyph" aria-hidden>
          {glyph}
        </span>
      ) : (
        <>
          <span className="dt-dock-button-label">{label}</span>
          <span className="dt-lead" aria-hidden />
          <span className="dt-dock-button-count">{count}</span>
        </>
      )}
      <Icon
        name={appIcons.expand}
        size={10}
        strokeWidth={2}
        className="dt-dock-button-chevron"
        aria-hidden
      />
    </button>
  );
}
