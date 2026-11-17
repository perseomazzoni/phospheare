// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { scaffoldProject, type ProjectSeed } from "../../../project/scaffold";
import { createStepIndex } from "../../../project/createSteps";
import { refForLog } from "../../../project/logRef";
import {
  createDriveProject,
  createLocalProject,
  driveProvider,
  getProvider,
  projectsFolderId,
} from "../../../storage";
import { storageErrorMessage } from "../../../storage/messages";
import type {
  CreateProgress,
  CreateRequest,
} from "../../../projectSetup/CreateProjectDialog";
import type { ActionFailure } from "./useActionError";
import {
  goToAdopted,
  type LibraryCardsApi,
  type ShelfUser,
} from "./shelfActions";
import { appLog, describeError } from "../../../log";

export interface CreateProjectInput {
  user: ShelfUser;
  navigate: (to: string) => void;
  adopt: LibraryCardsApi["adopt"];
  failure: ActionFailure;
}

/**
 * New project and Import: the creation wizard, the import window, and the
 * one job behind both, which makes the folder, writes the book into it and
 * opens it. The job's progress and failure show inside whichever window is
 * open.
 */
export function useCreateProject({
  user,
  navigate,
  adopt,
  failure,
}: CreateProjectInput) {
  const { t } = useTranslation();
  const { clear: clearFailure } = failure;

  const [creating, setCreating] = useState(false);
  // The import window, open or not. Its job is `createFrom`, so it shares the
  // creation wizard's progress and failure; opening either closes the other, so
  // the two are never open at once.
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<CreateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The shelf's banner while the book is written, and the reason New project
  // is held until it lands.
  const [busy, setBusy] = useState<string | null>(null);

  // One creation in flight. The dialog stays open through the job, so this gate
  // is the double-submit barrier: a second press on Create is refused until the
  // first job lands. Without it a double press makes two Remote Storage folders
  // and two cards.
  const inFlight = useRef(false);

  /**
   * Makes the folder, writes the seed's files into it, and opens it: the one
   * path every new project takes, blank or imported.
   *
   * No branch opens a picker: Remote Storage's folder is created by the API,
   * and the local root is mapped beforehand. A missing local root throws
   * here and surfaces as a failure pointing at Settings.
   *
   * Resolves `true` when the project was made and opened, `false` when it
   * was refused or failed (the error is in `error`), so a caller such as the
   * import knows whether to close.
   */
  const createFrom = useCallback(
    async (seed: ProjectSeed): Promise<boolean> => {
      if (!user || inFlight.current) return false;
      inFlight.current = true;
      clearFailure();
      setError(null);
      const began = Date.now();
      try {
        // The job face is up from the first await: creating the folder is
        // the slowest single call (a Remote Storage round-trip), and an idle
        // bar would look broken. Every later slot is named by the scaffold's
        // `onStep`, which fires only after its write resolves.
        setProgress({ index: createStepIndex("folder") });
        const ref =
          seed.destination === "drive"
            ? await createDriveProject(
                seed.folderName,
                await projectsFolderId(),
              )
            : await createLocalProject(seed.folderName);
        const documents = createStepIndex("documents");
        setProgress({ index: documents });

        setBusy(t("library.creating"));
        await scaffoldProject(
          getProvider(ref.providerId) ?? driveProvider,
          ref,
          seed.init,
          (id) => setProgress({ index: createStepIndex(id) }),
          (done, total) =>
            setProgress({ index: documents, detail: { done, total } }),
        );
        setProgress({ index: createStepIndex("adopt") });
        await adopt(ref);
        appLog.info("library", "A project was created.", {
          ...refForLog(ref),
          destination: seed.destination,
          // Only an import arrives with word counts.
          imported: seed.init.stats !== undefined,
          documents: seed.init.shape?.files.length ?? 0,
          ms: Date.now() - began,
        });
        setProgress(null);
        setCreating(false);
        setImporting(false);
        goToAdopted(user.id, ref, navigate);
        return true;
      } catch (err) {
        // The wizard keeps its own values, and the failure shows as a
        // create-context line inside it. A non-storage failure reads "could
        // not be created", never "could not be opened".
        appLog.error("library", "A project could not be created.", {
          destination: seed.destination,
          ...describeError(err),
        });
        setProgress(null);
        setError(storageErrorMessage(err, t, t("create.failed")));
        return false;
      } finally {
        setBusy(null);
        inFlight.current = false;
      }
    },
    [user, navigate, t, adopt, clearFailure],
  );

  /**
   * The creation wizard's answers as a seed, the title included.
   */
  const create = useCallback(
    async (request: CreateRequest) => {
      await createFrom({
        destination: request.destination,
        folderName: request.folderName,
        init: {
          shape: request.shape,
          // `empty` persists as null: no structure was chosen. Every other
          // field is stored as the dialog gave it.
          document: {
            title: request.title.trim(),
            type: request.type,
            language: request.language,
            goal: request.goal,
            structure:
              request.structureId === "empty" ? null : request.structureId,
            genres: request.genres,
            ageCategory: request.ageCategory,
            tropes: request.tropes,
          },
        },
      });
    },
    [createFrom],
  );

  const request = useCallback(() => setCreating(true), []);
  const cancel = useCallback(() => {
    setCreating(false);
    setProgress(null);
    setError(null);
  }, []);
  const requestImport = useCallback(() => {
    setCreating(false);
    setError(null);
    setImporting(true);
  }, []);
  const cancelImport = useCallback(() => {
    setImporting(false);
    setProgress(null);
    setError(null);
  }, []);

  return {
    creating,
    importing,
    progress,
    error,
    busy,
    request,
    cancel,
    requestImport,
    cancelImport,
    create,
    createFrom,
  };
}
