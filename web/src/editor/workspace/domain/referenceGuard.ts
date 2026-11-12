// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Which of the workspace's exits must ask before they drop a reference
// draft (`useReferenceSession` holds the session). Each exit asks the same
// questions: is the draft at stake, and does this exit end it.

import { hasWriting } from "../../../project/referenceAnswers";
import { NOTES_PREFIX } from "../../../project/naming";
import { sameReaderFace } from "../../../project/reference";

/** A reference or note being edited, as the guards read it. */
export interface EditSession {
  fileName: string;
  /** The file's text when editing began: the clean state to compare against. */
  savedText: string;
  draft: string;
  /** Not on disk yet: the first save that carries writing creates it. */
  unborn?: boolean;
}

/** The dock's faces that hold a reader, and the ones that do not. */
export type ReaderFace = "reference" | "notes";

/**
 * Whether a save may write this session: any document already on disk, and
 * a new one only once it says something the writer wrote.
 */
export function worthWriting(session: EditSession): boolean {
  return !session.unborn || hasWriting(session.draft);
}

/**
 * Whether the session has something at stake. "Dirty" is a comparison, not a
 * flag: a draft equal to the saved text has nothing to lose, and a new
 * document is at stake only once it holds writing.
 */
export function isDirty(session: EditSession | null): boolean {
  return (
    session !== null &&
    session.draft !== session.savedText &&
    worthWriting(session)
  );
}

/** The reader face a reference folder file opens on. */
export function faceOf(fileName: string): ReaderFace {
  return fileName.startsWith(NOTES_PREFIX) ? "notes" : "reference";
}

/**
 * Whether opening `fileName` must ask first. Each reader face holds one
 * document, so only another file of the session's own face replaces it; a
 * note half-edited is not at stake when a reference document opens.
 */
export function openAsks(session: EditSession | null, fileName: string) {
  return (
    session !== null &&
    isDirty(session) &&
    session.fileName !== fileName &&
    sameReaderFace(session.fileName, fileName)
  );
}

/**
 * Whether starting an edit of `fileName` must ask first. The shell holds one
 * session, so editing another file ends a dirty draft on either face.
 */
export function editAsks(session: EditSession | null, fileName: string) {
  return session !== null && isDirty(session) && session.fileName !== fileName;
}

/**
 * Whether `face` holds a reader. Moving the dock to any other face, the Ask
 * and snapshot faces included, leaves a dirty draft, so it asks first.
 */
export function isReaderFace(face: string): face is ReaderFace {
  return face === "reference" || face === "notes";
}
