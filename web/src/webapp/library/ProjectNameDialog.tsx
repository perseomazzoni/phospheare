// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../ui";
import { folderNameFor } from "../../project/naming";
import TitleField, { readTitle } from "../../projectSetup/TitleField";

// Names the copy of a project with the creation wizard's own `TitleField`, so
// a writer who has named a project once recognises it. A duplicate is always a
// new folder under the title's name (`useDuplicateProject`), so
// the title is held to folder rules and the line under it names the folder.
// Renaming belongs to the Properties window.

interface Props {
  open: boolean;
  title: string;
  lede?: string;
  confirmLabel: string;
  /** Prefilled, and selected on open, so the common case is type-over. */
  initialValue: string;
  /** Folder names already on the shelf. */
  taken: Set<string>;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}

export default function ProjectNameDialog({
  open,
  title,
  lede,
  confirmLabel,
  initialValue,
  taken,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const field = useRef<HTMLInputElement>(null);

  // The dialog can be mounted before it opens, so the prefill applies on
  // opening, not at first render, or a second duplicate would arrive holding
  // the first one's name.
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const reading = readTitle(value, "folder", taken);

  return (
    <Dialog
      open={open}
      title={title}
      lede={lede}
      confirmLabel={confirmLabel}
      confirmDisabled={!reading.ready}
      initialFocus={() => {
        field.current?.select();
        return field.current;
      }}
      onConfirm={() => onConfirm(value.trim())}
      onCancel={onCancel}
    >
      <TitleField
        ref={field}
        label={t("create.nameLabel")}
        value={value}
        onChange={setValue}
        reading={reading}
        folderLine={{
          lead: t("library.folderBecomes"),
          folder: folderNameFor(value),
        }}
      />
    </Dialog>
  );
}
