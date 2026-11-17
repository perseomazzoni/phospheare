// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { REFERENCE_DIR } from "../../project/naming";
import {
  referenceGroupOf,
  type ReferenceGroupId,
} from "../../project/reference";
import {
  isSectionGroup,
  sectionFileName,
} from "../../project/referenceSections";
import type { ProjectRef, StorageProvider } from "../../storage";
import { appLog, describeError } from "../../log";
import { sectionTemplate } from "./referenceTemplates";

// The one write seam for reference documents: a file inside `reference/`
// through the port, the template already resolved by the caller. The caller
// decides what a `false` return means for its own field or picker.

export async function writeReference(
  provider: StorageProvider,
  projectRef: ProjectRef | null,
  fileName: string,
  template: string,
): Promise<boolean> {
  if (!projectRef) return false;
  try {
    // Creation only, never overwrite. The listing-time duplicate check cannot
    // see a file another tab wrote a moment ago, and the port's write
    // truncates, so the port's own existence probe is the last guard before
    // a just-seeded file is replaced by its template.
    if (await provider.exists(projectRef, `${REFERENCE_DIR}/${fileName}`)) {
      return false;
    }
    await provider.writeFile(
      projectRef,
      `${REFERENCE_DIR}/${fileName}`,
      template,
    );
    return true;
  } catch (err) {
    appLog.warn("reference", "A reference document could not be created.", {
      group: referenceGroupOf(fileName) ?? "none",
      ...describeError(err),
    });
    return false;
  }
}

/** A document opened to be written, and whether it exists yet. */
export interface SectionDraft {
  fileName: string;
  /** What the editor opens on: the file's text, or its template. */
  text: string;
  /** Not on disk: the first save that says something creates it. */
  unborn: boolean;
}

/**
 * The document a chat asked the writer for, opened to be written. A section
 * that exists opens on its own text. One that does not opens on its template
 * and is not created: a file made on the press and then abandoned is an
 * empty document the chat stops asking for by name, and one the writer never
 * chose to keep. The save that first carries something the writer wrote
 * creates it (`hasWriting`). `null` for anything that is not a catalogue
 * section, since a shelf (`characters`) has no one file to open, and for a
 * failed probe or read: a template opened over an unreadable file would be a
 * draft whose save replaces the writer's text.
 */
export async function sectionDraft(
  provider: StorageProvider,
  projectRef: ProjectRef | null,
  reference: { group: string; sectionId?: string },
  language: string | null,
): Promise<SectionDraft | null> {
  const group = reference.group as ReferenceGroupId;
  if (!projectRef || !reference.sectionId || !isSectionGroup(group))
    return null;
  const fileName = sectionFileName(group, reference.sectionId);
  const path = `${REFERENCE_DIR}/${fileName}`;
  try {
    if (await provider.exists(projectRef, path))
      return {
        fileName,
        text: await provider.readFile(projectRef, path),
        unborn: false,
      };
  } catch (err) {
    appLog.warn(
      "reference",
      "A reference document could not be read to open it for writing.",
      { group, ...describeError(err) },
    );
    return null;
  }
  return {
    fileName,
    text: sectionTemplate(group, reference.sectionId, language),
    unborn: true,
  };
}

/**
 * A new document opened to be written: a character or an arc the Reference
 * panel's add controls name, under the same rule as the chat's "Write X".
 * Its template, unborn: nothing is on disk until a save carries something
 * the writer wrote. `null` when the name is taken or the probe fails:
 * creation only, as `writeReference` is, since a template opened over a file
 * another tab just wrote would be a draft whose save replaces it.
 */
export async function newDraft(
  provider: StorageProvider,
  projectRef: ProjectRef | null,
  fileName: string,
  template: string,
): Promise<SectionDraft | null> {
  if (!projectRef) return null;
  try {
    if (await provider.exists(projectRef, `${REFERENCE_DIR}/${fileName}`))
      return null;
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code !== "not-found")
      appLog.warn(
        "reference",
        "A new reference document could not be checked for a taken name.",
        { ...describeError(err) },
      );
    return null;
  }
  return { fileName, text: template, unborn: true };
}
