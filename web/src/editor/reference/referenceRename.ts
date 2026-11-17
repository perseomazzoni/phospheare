// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { REFERENCE_DIR, referenceFileName } from "../../project/naming";
import {
  arcFileNameForCharacter,
  referenceGroupOf,
  referencePrefixOf,
  type ReferenceGroupId,
} from "../../project/reference";
import type { ProjectRef, StorageProvider } from "../../storage";
import { appLog, describeError } from "../../log";

// Renaming a reference document renames its file: the title is the file
// name.
//
// Only notes and characters may be renamed. A catalogue section is named by
// its catalogue id, a generated summary by the node it summarises and an arc
// by its character, so a rename would orphan any of them. `renameReference`
// fails closed for any other group, and the panels draw the control only on
// the Characters card and the notes table. Do not add an exported predicate
// that nothing calls.
//
// A character brings its arc, bound by the stem. The character goes first,
// so a failed second rename leaves a renamed character and a visible orphaned
// arc, rather than an arc pointing at a character that does not exist.

function renameTargetName(group: ReferenceGroupId, title: string): string {
  return referenceFileName(referencePrefixOf(group), title);
}

/**
 * Rename a note or a character. Resolves the new file name on success and
 * `null` on refusal or failure, so the caller can keep its field open for a
 * retry, as with `writeReference`.
 */
export async function renameReference(
  provider: StorageProvider,
  projectRef: ProjectRef | null,
  fileName: string,
  title: string,
): Promise<string | null> {
  if (!projectRef) return null;
  const group = referenceGroupOf(fileName);
  if (group !== "notes" && group !== "characters") return null;
  const next = renameTargetName(group, title);
  if (next === fileName) return fileName;
  try {
    // The listing-time duplicate check cannot see a file another tab just
    // wrote, and a rename onto an existing name silently overwrites on some
    // backends. The port's own probe is the last check, as on the create path.
    if (await provider.exists(projectRef, `${REFERENCE_DIR}/${next}`))
      return null;
    const arc = arcFileNameForCharacter(fileName);
    const nextArc = arcFileNameForCharacter(next);
    // The arc moves with the character, so its new name gets the same probe.
    // A file there is an arc bound to no character, and the move would
    // replace its text.
    if (
      group === "characters" &&
      (await provider.exists(projectRef, `${REFERENCE_DIR}/${arc}`)) &&
      (await provider.exists(projectRef, `${REFERENCE_DIR}/${nextArc}`))
    )
      return null;
    await provider.renameFile(projectRef, `${REFERENCE_DIR}/${fileName}`, next);
    if (group === "characters") {
      try {
        await provider.renameFile(
          projectRef,
          `${REFERENCE_DIR}/${arc}`,
          nextArc,
        );
      } catch (err) {
        // No arc, or the arc's rename failed. The character is renamed either
        // way, so reporting failure would misstate the file that moved, and
        // the orphaned arc is visible on the card. A missing arc is the
        // common case and not a failure.
        if ((err as { code?: unknown } | null)?.code !== "not-found")
          appLog.warn(
            "reference",
            "The arc of a renamed character could not be renamed.",
            { ...describeError(err) },
          );
      }
    }
    return next;
  } catch (err) {
    appLog.warn("reference", "A reference document could not be renamed.", {
      group,
      ...describeError(err),
    });
    return null;
  }
}
