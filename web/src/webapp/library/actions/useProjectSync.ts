// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { folderNameFor, PROPERTIES_FILE } from "../../../project/naming";
import { copyProject } from "../../../project/transfer";
import {
  parseProperties,
  serializeProperties,
} from "../../../project/properties";
import { pair } from "../../../project/sync/pairing";
import { baselinesForUpload } from "../../../project/sync/apply";
import { projectIdFor } from "../../../project/projectId";
import { refForLog } from "../../../project/logRef";
import {
  createDriveProject,
  driveProvider,
  getProvider,
  projectsFolderId,
  type ProjectRef,
} from "../../../storage";
import type { ActionFailure } from "./useActionError";
import type { CopyJob } from "./useCopyJob";
import {
  actionFailure,
  type LibraryAction,
  type LibraryCardsApi,
  type ShelfToasts,
} from "./shelfActions";
import { appLog, describeError } from "../../../log";

export interface ProjectSyncInput extends Pick<
  LibraryCardsApi,
  "checkNow" | "markSynced" | "revalidate" | "unpair"
> {
  toasts: ShelfToasts;
  failure: ActionFailure;
  copyJob: CopyJob;
}

/**
 * A book's pairing with Remote Storage: starting it behind a confirmation,
 * checking it on demand, ending it, and starting it again when the remote
 * copy is gone.
 */
export function useProjectSync({
  checkNow,
  markSynced,
  revalidate,
  unpair: unpairCard,
  toasts,
  failure,
  copyJob,
}: ProjectSyncInput) {
  const { t } = useTranslation();
  const { post } = toasts;
  const { clear: clearFailure, fail } = failure;
  const { start: startCopy, progress, finish } = copyJob;

  /** The book the Sync confirmation is open on. */
  const [pending, setPending] = useState<ProjectRef | null>(null);
  const request = useCallback((ref: ProjectRef) => setPending(ref), []);
  const cancel = useCallback(() => setPending(null), []);

  /**
   * Pairs a project on this device with a new Remote Storage folder:
   * Local+Synced. The local project stays canonical and nothing navigates away:
   * a paired project's `ProjectRef` does not change (`storage/mirrored.ts`), so
   * the writer sees the same card, now with a Synced badge.
   *
   * Runs straight from the menu click: reading a local folder needs the
   * permission a gesture carries.
   */
  const start = useCallback(
    async (ref: ProjectRef) => {
      const source = getProvider(ref.providerId);
      if (!source) return;
      clearFailure();

      const signal = startCopy(ref.name, "sync");
      const began = Date.now();
      const about = refForLog(ref);
      appLog.info("sync", "A first upload started.", about);

      try {
        const target = await createDriveProject(
          folderNameFor(ref.name),
          await projectsFolderId(),
        );
        const sent = new Map<string, string>();
        const result = await copyProject(
          { provider: source, ref },
          { provider: driveProvider, ref: target },
          {
            signal,
            onProgress: progress,
            onCopied: (path, content) => sent.set(path, content),
          },
        );

        if (result.cancelled) {
          appLog.info("sync", "A first upload finished.", {
            ...about,
            copied: result.copied,
            cancelled: true,
            ms: Date.now() - began,
          });
          // States what reached Remote Storage, because the writer will find
          // those files. Nothing is paired, so they stay an untracked copy
          // rather than a half-set-up sync.
          post(
            t("library.copyCancelled", {
              done: result.copied,
              total: result.total,
              name: ref.name,
            }),
          );
          return;
        }

        // The pairing is a fact about the book. This flow started from the
        // project's card, so the mirror can answer. A null means the row left
        // the shelf mid-copy (a remove on another device): the copy stays in
        // Remote Storage, nothing is paired to it, and no hint is written,
        // since a hint would claim a pairing that does not exist and the next
        // device to re-pick this folder would trust it. The toast says the copy
        // landed and the sync never started.
        const projectId = projectIdFor(ref);
        if (!projectId) {
          post(t("library.syncRowLost", { name: ref.name }));
          return;
        }
        // The copy left both sides holding the same bytes, and the manifest
        // starts by saying so. With no baselines, the first edit's push would
        // meet a remote file the manifest has never seen and stop as an edit
        // made elsewhere.
        await pair(
          projectId,
          { providerId: target.providerId, key: target.key },
          await baselinesForUpload(
            { provider: source, ref },
            { provider: driveProvider, ref: target },
            sent,
          ),
        );
        markSynced(projectId);
        // The hint (the `sync` field in `properties.ts`) lets another device
        // recover the pairing after re-picking this folder. Written last,
        // once the copy and the pairing are real, so no reader sees a hint
        // pointing at a folder that is not there yet.
        const props = parseProperties(
          await source.readFile(ref, PROPERTIES_FILE),
          ref.name,
        );
        props.sync = {
          remote: { providerId: target.providerId, key: target.key },
        };
        await source.writeFile(
          ref,
          PROPERTIES_FILE,
          serializeProperties(props),
        );

        appLog.info("sync", "A first upload finished.", {
          ...about,
          copied: result.copied,
          cancelled: false,
          ms: Date.now() - began,
        });
        post(t("library.syncStarted", { name: ref.name }));
        void revalidate(ref);
      } catch (err) {
        fail(actionFailure(err, t, "start-sync"));
      } finally {
        finish();
      }
    },
    [
      post,
      t,
      revalidate,
      markSynced,
      clearFailure,
      fail,
      startCopy,
      progress,
      finish,
    ],
  );

  /** Starts the sync the confirmation asked about, and closes it. */
  const confirm = useCallback(
    (ref: ProjectRef) => {
      const job = start(ref);
      setPending(null);
      return job;
    },
    [start],
  );

  /**
   * The manual Sync now: the check the shelf runs quietly on every listing,
   * on demand. A conflict shows as the usual banner; any other outcome gets a
   * toast, since the writer asked.
   */
  const syncNow = useCallback(
    async (ref: ProjectRef) => {
      clearFailure();
      try {
        const result = await checkNow(ref);
        appLog.info("sync", "Sync now ended.", {
          ...refForLog(ref),
          toPull: result?.verdict.toPull.length ?? null,
          toPush: result?.verdict.toPush.length ?? null,
          conflict: result?.verdict.conflict ?? null,
        });
        if (!result || result.verdict.conflict) return;
        const name = ref.name;
        post(
          result.uploading
            ? t("sync.stillUploading", { name })
            : result.verdict.toPull.length > 0
              ? t("sync.pulled", { name })
              : t("sync.upToDate", { name }),
        );
      } catch (err) {
        fail(actionFailure(err, t, "sync-now"));
      }
    },
    [checkNow, post, t, clearFailure, fail],
  );

  /** Disables Sync: a toggle, not a deletion. Both copies survive. */
  const unpair = useCallback(
    async (ref: ProjectRef) => {
      clearFailure();
      try {
        const about = refForLog(ref);
        const began = Date.now();
        await unpairCard(ref);
        appLog.info("library", "A Library action succeeded.", {
          action: "unpair" satisfies LibraryAction,
          ...about,
          ms: Date.now() - began,
        });
        post(t("library.unpaired", { name: ref.name }));
      } catch (err) {
        fail(actionFailure(err, t, "unpair"));
      }
    },
    [unpairCard, post, t, clearFailure, fail],
  );

  /** The book whose Upload again is running, by project id, or null. */
  const [uploadingAgain, setUploadingAgain] = useState<string | null>(null);

  /**
   * Upload again, for a project whose Remote Storage copy is gone: the old
   * pairing and the ops owed to the vanished folder are dropped first, then
   * the device's copy goes up as a new remote project and pairs with it. The
   * key held while it runs keeps a second press from starting a second copy.
   */
  const uploadAgain = useCallback(
    async (projectId: string, ref: ProjectRef) => {
      setUploadingAgain(projectId);
      try {
        await unpairCard(ref);
      } catch (err) {
        appLog.error("sync", "Upload again could not drop the old pairing.", {
          project: projectId,
          ...describeError(err),
        });
        post(t("sync.uploadAgainFailed", { name: ref.name }));
        return;
      } finally {
        setUploadingAgain(null);
      }
      await start(ref);
    },
    [unpairCard, start, post, t],
  );

  return {
    pending,
    request,
    cancel,
    confirm,
    start,
    syncNow,
    unpair,
    uploadingAgain,
    uploadAgain,
  };
}
