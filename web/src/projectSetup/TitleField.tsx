// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "../ui";
import {
  titleProblem,
  validateProjectName,
  type NameProblem,
} from "../project/naming";

// A book's title as a field, shared by the creation wizard's last step, the
// duplicate dialog and the Library's Properties window, so the rule a
// title is held to and the line about its folder cannot drift.
//
// The rule depends on what the title is about to do, which only the caller
// knows:
//
//   "folder"  a folder takes the title's name: a new book, a duplicate, a
//             Remote Storage book whose title changed. The title must make a
//             legal folder name no other book has.
//   "title"   the title changes and the folder does not: a book on this
//             device, since the File System Access API cannot rename a
//             directory (`retitle.ts`). Folder rules would refuse a name no
//             folder will carry.
//   "none"    the title is the one stored. It is not checked, so it cannot
//             block a save of the other facts.

export type TitleCheck = "folder" | "title" | "none";

interface TitleReading {
  problem: NameProblem | null;
  /** Something is there, and nothing stops it. */
  ready: boolean;
}

export function readTitle(
  value: string,
  check: TitleCheck,
  taken: Set<string>,
): TitleReading {
  // An empty field shows no problem while it is being filled, but it is
  // never ready.
  const problem = !value.trim()
    ? null
    : check === "folder"
      ? validateProjectName(value, taken)
      : check === "title"
        ? titleProblem(value)
        : null;
  return { problem, ready: value.trim().length > 0 && !problem };
}

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The reading `readTitle` gave the caller, which gates on it too. */
  reading: TitleReading;
  /**
   * What becomes of the folder, shown under the field: the leading words
   * ("Creates", "Folder becomes", "Folder stays") and the folder's name. An
   * empty name shows the stub. Absent when there is nothing true to say.
   */
  folderLine?: { lead: string; folder: string };
}

const TitleField = forwardRef<HTMLInputElement, Props>(function TitleField(
  { label, value, onChange, reading, folderLine },
  ref,
) {
  const { t } = useTranslation();
  const { problem } = reading;
  return (
    <Input
      ref={ref}
      label={label}
      placeholder={t("create.namePlaceholder")}
      autoComplete="off"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      problem={problem ? t(`name.${problem.code}`, problem.values) : null}
      evidence={
        folderLine ? (
          <>
            {folderLine.lead}{" "}
            <strong>
              {folderLine.folder
                ? `${folderLine.folder}/`
                : t("create.folderStub")}
            </strong>
          </>
        ) : undefined
      }
    />
  );
});

export default TitleField;
