// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { REFERENCE_DIR } from "../../project/naming";
import type { ProjectRef, StorageProvider } from "../../storage";
import { writeReference } from "../reference/referenceWrite";
import { appLog, describeError } from "../../log";
import type { EditSession } from "./domain/referenceGuard";

// The writes of a reference edit session, and the draft the page's exits
// wrote without the writer's Save. The session stays dirty against the text
// it opened on, so Cancel and every discard still mean "throw it away": when
// the session ends unsaved, the file gets back the text it held when editing
// began, or, for a document an exit created, goes away. A tab killed while
// hidden keeps the draft.

/** Where the session's file lives. */
export interface DraftTarget {
  provider: StorageProvider;
  projectRef: ProjectRef;
}

/** A reference draft one of the page's exits wrote, and how to undo it. */
export interface KeptDraft {
  fileName: string;
  /** The text the file held when editing began. */
  savedText: string;
  /** The file did not exist when editing began. */
  unborn: boolean;
  /** Whether the file now holds a draft of this session. */
  landed: Promise<boolean>;
}

export interface DraftKeeper {
  /**
   * Writes a dirty draft and keeps its session open: the page going away
   * may come back, with the writer still in the editor. The first write of
   * a document not yet on disk goes through `writeReference`, whose probe
   * never overwrites a file another tab made; a later one overwrites the
   * file that write made. Resolves to whether this draft landed. The kept
   * draft's `landed` answers a different question, whether the file holds
   * any draft of this session: an earlier write that landed still needs
   * undoing, and still makes the file this session's own, when a later one
   * fails.
   */
  persist(target: DraftTarget, edit: EditSession): Promise<boolean>;
  /**
   * The writer's Save. A draft an exit already put on disk makes the file
   * this session's own, so the save overwrites it rather than probing for
   * it. Resolves to whether the save landed; a landed save forgets the kept
   * draft, so the session's end restores nothing.
   */
  save(target: DraftTarget, edit: EditSession): Promise<boolean>;
  /** Puts the file back as it stood before the session's exit writes. */
  restore(target: DraftTarget, kept: KeptDraft): Promise<void>;
  /** Hands over the kept draft unless it belongs to `fileName`. */
  takeUnless(fileName: string | null): KeptDraft | null;
  /** Drops the kept draft of a file that is gone: nothing to restore. */
  forget(fileName: string): void;
}

/**
 * The keeper for one workspace. `onFolderChanged` runs after a write that
 * changes what the reference folder lists or holds, so every reader of it
 * re-reads.
 */
export function createDraftKeeper(onFolderChanged: () => void): DraftKeeper {
  let kept: KeptDraft | null = null;
  const pathOf = (fileName: string) => `${REFERENCE_DIR}/${fileName}`;
  const landedFor = (fileName: string) =>
    kept?.fileName === fileName ? kept.landed : Promise.resolve(false);

  return {
    persist({ provider, projectRef }, edit) {
      const write = landedFor(edit.fileName).then(async (ours) => {
        if (edit.unborn && !ours) {
          const created = await writeReference(
            provider,
            projectRef,
            edit.fileName,
            edit.draft,
          );
          if (created) onFolderChanged();
          return { ours: created, written: created };
        }
        const written = await provider
          .writeFile(projectRef, pathOf(edit.fileName), edit.draft)
          .then(
            () => true,
            () => false,
          );
        return { ours: ours || written, written };
      });
      kept = {
        fileName: edit.fileName,
        savedText: edit.savedText,
        unborn: edit.unborn === true,
        landed: write.then((done) => done.ours),
      };
      return write.then((done) => done.written);
    },

    async save({ provider, projectRef }, edit) {
      const ours = await landedFor(edit.fileName);
      // A new document's first save is a creation, through the seam that
      // probes first: a file another tab made meanwhile is not overwritten.
      // The save fails instead and the draft stays on screen.
      if (edit.unborn && !ours) {
        const created = await writeReference(
          provider,
          projectRef,
          edit.fileName,
          edit.draft,
        );
        if (!created) return false;
        // A new file changes the folder: the shelf lists it, and the chat
        // stops asking for it.
        onFolderChanged();
        kept = null;
        return true;
      }
      try {
        await provider.writeFile(projectRef, pathOf(edit.fileName), edit.draft);
        kept = null;
        return true;
      } catch (err) {
        appLog.warn("editor", "A reference draft could not be written.", {
          ...describeError(err),
        });
        return false;
      }
    },

    async restore({ provider, projectRef }, draft) {
      if (!(await draft.landed)) return;
      const path = pathOf(draft.fileName);
      try {
        if (draft.unborn) await provider.removeFile(projectRef, path);
        else await provider.writeFile(projectRef, path, draft.savedText);
      } catch (err) {
        // Best effort: the draft stays on disk, as a killed tab leaves it.
        appLog.warn("editor", "A reference draft could not be put back.", {
          unborn: Boolean(draft.unborn),
          ...describeError(err),
        });
      }
      // The reader re-reads on the folder's revision, so read mode shows
      // the restored text rather than the draft it may have read first.
      onFolderChanged();
    },

    takeUnless(fileName) {
      if (!kept || kept.fileName === fileName) return null;
      const taken = kept;
      kept = null;
      return taken;
    },

    forget(fileName) {
      if (kept?.fileName === fileName) kept = null;
    },
  };
}
