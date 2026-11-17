// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { libraryRows, syncProfile } from "../../profile/profileSync";
import { appLog, describeError } from "../../log";
import type { StorageSearchView } from "./StorageSearchDialog";
import type { SweepWatch } from "./useProjects";

// The three searches `StorageSearchDialog` shows:
//   - Connecting Remote Storage merges the account's settings and Library
//     from it, then repaints the shelf when the membership changed.
//   - "Find projects in Remote Storage" lists the folder and reads each new
//     project, with a counter.
//   - "Find projects on this device" is near instant, so it shows only its
//     result, and nothing when no sweep ran (no folder, a picker dismissed).
//
// One search owns the window at a time. A newer search, or the window
// closed, orphans the older one: it runs to its end, but what it would show
// is dropped, so a search left running behind the window never pops back.
//
// Only a change from disconnected to connected for the same account counts
// as connecting; a connection already there at mount is the landing's to
// reconcile (`useLibraryReveal`), not news.

/** How long the restore waits for the rescan's gather before it reports. */
const RESCAN_WAIT_MS = 10_000;

/** How many added projects the result names before "and N more". */
const NAMED = 5;

interface Options {
  userId: string;
  driveConnected: boolean;
  /** `useProjects`'s gather accounting, as `useLibraryReveal` reads it. */
  gatherStarts: number;
  gatherSettles: number;
  rescan: () => void;
  refreshContent: () => void;
  reconcileUI: () => void;
  scanDrive: (watch?: SweepWatch) => Promise<number>;
  scanLocal: (watch?: SweepWatch) => Promise<number>;
}

export interface StorageSearch {
  view: StorageSearchView | null;
  /** Closes the window; a search still running goes on unseen. */
  close: () => void;
  findInDrive: () => Promise<void>;
  findOnDevice: () => Promise<void>;
}

export function useStorageSearch(options: Options): StorageSearch {
  const { t } = useTranslation();
  const [view, setView] = useState<StorageSearchView | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const job = useRef(0);
  // The rescan's own gather settle, awaited by the restore: settle number
  // starts + 1, as `useLibraryReveal` waits for it.
  const settle = useRef<{ from: number; resolve: () => void } | null>(null);
  const driveSeen = useRef<{ userId: string; connected: boolean } | null>(null);

  const begin = () => ++job.current;
  const show = (token: number, next: StorageSearchView | null) => {
    if (job.current === token) setView(next);
  };
  const close = useCallback(() => {
    job.current++;
    setView(null);
  }, []);

  useEffect(() => {
    const waiting = settle.current;
    if (!waiting || options.gatherSettles < waiting.from) return;
    settle.current = null;
    waiting.resolve();
  }, [options.gatherSettles]);

  const rescanAndWait = () =>
    new Promise<void>((resolve) => {
      const waiting = { from: latest.current.gatherStarts + 1, resolve };
      settle.current = waiting;
      setTimeout(() => {
        if (settle.current !== waiting) return;
        settle.current = null;
        resolve();
      }, RESCAN_WAIT_MS);
      latest.current.rescan();
    });

  const named = (titles: readonly string[]) => ({
    items: titles.slice(0, NAMED),
    after:
      titles.length > NAMED
        ? [t("library.search.more", { count: titles.length - NAMED })]
        : [],
  });

  const restore = async (userId: string) => {
    const token = begin();
    const steps = [
      t("library.restore.stepSearch"),
      t("library.restore.stepLibrary"),
    ];
    const working = (current: number): StorageSearchView => ({
      kind: "working",
      title: t("library.restore.title"),
      lede: t("library.restore.note"),
      steps,
      current,
    });
    show(token, working(0));
    const result = await syncProfile(userId).catch(() => null);
    if (result && !result.librarySettled) return show(token, null);
    if (result?.librarySettled) {
      latest.current.reconcileUI();
      if (result.membershipChanged) {
        show(token, working(1));
        await rescanAndWait();
      } else latest.current.refreshContent();
    }
    const remote = result?.remote ?? "unreachable";
    if (remote === "off") return show(token, null);
    if (remote === "unreachable")
      return show(token, {
        kind: "result",
        title: t("library.search.unreachableTitle"),
        lead: t("library.restore.unreachable"),
      });
    if (remote === "none")
      return show(token, {
        kind: "result",
        title: t("library.restore.noneTitle"),
        lead: t("library.restore.none"),
      });
    show(token, {
      kind: "result",
      title: t("library.restore.foundTitle"),
      lead: t("library.restore.foundLead"),
      items: [
        t("accountData.settings"),
        t("library.restore.library", { count: libraryRows(userId).length }),
      ],
    });
  };

  useEffect(() => {
    const { userId, driveConnected } = options;
    const seen = driveSeen.current;
    driveSeen.current = { userId, connected: driveConnected };
    if (!userId || !driveConnected || !seen) return;
    if (seen.userId !== userId || seen.connected) return;
    void restore(userId);
    // `restore` reads the latest options through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.userId, options.driveConnected]);

  const findInDrive = useCallback(async () => {
    const token = begin();
    const title = t("library.findDriveTitle");
    const steps = [
      t("library.findDriveStepList"),
      t("library.findDriveStepAdd"),
    ];
    const added: string[] = [];
    show(token, { kind: "working", title, steps, current: 0 });
    try {
      await latest.current.scanDrive({
        step: (progress) =>
          show(token, {
            kind: "working",
            title,
            steps,
            current: progress.phase === "listing" ? 0 : 1,
            detail:
              progress.phase === "reading" && progress.total > 0
                ? t("library.search.count", {
                    done: progress.done,
                    total: progress.total,
                  })
                : undefined,
          }),
        added: (name) => added.push(name),
      });
    } catch (err) {
      appLog.warn("library", "Remote Storage could not be searched.", {
        ...describeError(err),
      });
      show(token, {
        kind: "result",
        title: t("library.search.unreachableTitle"),
        lead: t("library.findDriveFailed"),
        retry: () => void findInDrive(),
      });
      return;
    }
    show(
      token,
      added.length > 0
        ? {
            kind: "result",
            title: t("library.search.foundTitle"),
            lead: t("library.search.added"),
            ...named(added),
          }
        : {
            kind: "result",
            title: t("library.search.noneTitle"),
            lead: t("library.findDriveNone"),
          },
    );
    // `begin`, `show` and `named` read only refs and `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const findOnDevice = useCallback(async () => {
    const token = begin();
    let swept = false;
    const added: string[] = [];
    await latest.current
      .scanLocal({
        step: () => {
          swept = true;
        },
        added: (name) => added.push(name),
      })
      .catch((err: unknown) => {
        appLog.warn("library", "Local Storage could not be searched.", {
          ...describeError(err),
        });
        return 0;
      });
    if (!swept) return;
    show(
      token,
      added.length > 0
        ? {
            kind: "result",
            title: t("library.search.foundTitle"),
            lead: t("library.search.added"),
            ...named(added),
          }
        : {
            kind: "result",
            title: t("library.search.noneTitle"),
            lead: t("library.findLocalNone"),
          },
    );
    // `begin`, `show` and `named` read only refs and `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  return { view, close, findInDrive, findOnDevice };
}
