// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import {
  sectionDescriptionKey,
  sectionIdOf,
  sectionIdsOf,
  sectionLabelKey,
  type SectionGroupId,
} from "../../project/referenceSections";

// The section picker: the bottom half of the reference face, where the
// reader normally sits. It lists the sections of a compiled group that do
// not exist yet, each with the one line that says what it is for. A compiled
// section is not drawn: the card already lists it.
//
// Every entry is a row, not a menu item: the dock is narrow and a catalogue
// can hold fifteen sections; a floating menu would hide the descriptions.

export interface SectionPickerProps {
  group: SectionGroupId;
  fileNames: readonly string[];
  onPick: (id: string) => void;
  onClose: () => void;
}

export default function SectionPicker({
  group,
  fileNames,
  onPick,
  onClose,
}: SectionPickerProps) {
  const { t } = useTranslation();
  const ids = sectionIdsOf(group);

  // The catalogue ids already on disk. Any one file claims its section — a
  // case-only duplicate can only exist on a case-sensitive filesystem, and
  // none of them is offered again.
  const created = useMemo(() => {
    const set = new Set<string>();
    for (const fileName of fileNames) {
      const id = sectionIdOf(group, fileName);
      if (id !== null) set.add(id);
    }
    return set;
  }, [group, fileNames]);

  const missing = ids.filter((id) => !created.has(id));

  // Focus lands on the first row, so Escape and Enter work without a trip to
  // the pointer — the picker was opened from a button, and the next intent is
  // "choose something".
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, [group]);

  return (
    <div
      className="dock-face ref-picker"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="ref-picker-head">
        <p className="ref-picker-title">
          {t("reference.pickerTitle", { group: t(`reference.group.${group}`) })}
        </p>
        <button
          type="button"
          className="ref-picker-close"
          aria-label={t("reference.pickerClose")}
          title={t("reference.pickerClose")}
          onClick={onClose}
        >
          <Icon name={appIcons.close} size={12} />
        </button>
      </div>
      <p className="ref-picker-count">
        {t("reference.pickerRemaining", {
          count: missing.length,
          total: ids.length,
        })}
      </p>

      <div className="ref-picker-list">
        {missing.map((id, index) => (
          <button
            key={id}
            ref={index === 0 ? firstRef : undefined}
            type="button"
            className="ref-picker-row"
            onClick={() => onPick(id)}
          >
            <span className="ref-picker-mark" aria-hidden="true">
              <Icon name={appIcons.add} size={11} />
            </span>
            <span className="ref-picker-body">
              <span className="ref-picker-label">
                {t(sectionLabelKey(group, id))}
              </span>
              <span className="ref-picker-desc">
                {t(sectionDescriptionKey(group, id))}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
