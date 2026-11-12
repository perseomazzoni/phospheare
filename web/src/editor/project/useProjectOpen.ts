// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import type { ProjectRef, StorageProvider } from "../../storage";
import type { EditorEngine } from "../views/engine";
import type { ProjectStatus } from "../ProjectContext";
import type { EditorServices } from "../services/port";
import { findNode, nodeOfFile } from "../../project/structure";
import type { StructureError } from "../../project/types";
import type { MetadataLanes } from "./application/metadataLanes";
import { readProject, verifySnapshotHashes } from "./application/projectOpener";
import type { StatsKeeper } from "./application/statsKeeper";
import type { MetadataStore } from "./application/stores";
import { providerReader } from "./storageStores";

/**
 * The open: one sequence with one token, from the access check to the
 * backfills started behind it, and every state it sets is its own. A
 * reconnect and a reload start it again; an open overtaken by a newer one
 * sets nothing more.
 */
export function useProjectOpen({
  provider,
  isSupported,
  projectKey,
  lanes,
  engine,
  stats,
  metadata,
  message,
  setError,
  t,
  connectionFor,
  pullUnfinished,
  openInto,
  letGoOfBuffer,
  bufferFileRef,
  dismissUndo,
}: {
  provider: StorageProvider;
  isSupported: boolean;
  projectKey: string;
  lanes: MetadataLanes<ProjectRef>;
  engine: EditorEngine;
  stats: StatsKeeper<ProjectRef>;
  metadata: MetadataStore<ProjectRef>;
  /** The writer's words for a storage failure. */
  message: (err: unknown) => string;
  setError: (error: string | null) => void;
  t: TFunction;
  connectionFor: EditorServices["connectionFor"];
  pullUnfinished: EditorServices["pullUnfinished"];
  /** The buffer's open, which names the open file once it lands. */
  openInto: (
    target: ProjectRef,
    providerFor: StorageProvider,
    fileName: string,
    content: string,
    opts?: { caret?: "start" | "end" },
    wanted?: () => boolean,
  ) => Promise<boolean>;
  letGoOfBuffer: () => void;
  /** The file the engine's buffer was opened from. */
  bufferFileRef: React.RefObject<string | null>;
  /** A new open clears the undo toast. */
  dismissUndo: () => void;
}) {
  const [outOfBand, setOutOfBand] = useState<Set<string>>(new Set());
  const [ref, setRef] = useState<ProjectRef | null>(null);
  const [status, setStatus] = useState<ProjectStatus>("idle");
  const [validation, setValidation] = useState<StructureError[]>([]);
  const [pendingRef, setPendingRef] = useState<ProjectRef | null>(null);

  // A mirror of `pendingRef` for `reconnect`, which stays stable by reading
  // the latest here.
  const pendingRefRef = useRef<ProjectRef | null>(null);
  pendingRefRef.current = pendingRef;

  // The last folder an open was attempted on, whether or not it worked. A
  // refused folder clears `ref`, since it is not an open project, but "Try
  // again" must know which folder to retry, and retrying is the fix for a
  // folder caught mid-sync. `restore` is the file a reload brings back: a
  // reload empties the buffer first, so a refused one keeps the file here for
  // the next try.
  const attempted = useRef<{
    target: ProjectRef;
    provider: StorageProvider;
    restore: string | null;
  } | null>(null);
  /** Bumped on every load, so background work can tell it is still wanted. */
  const loadSeq = useRef(0);
  /**
   * The `${providerId}/${projectKey}` this provider has opened, by the mount's
   * access check or by a reconnect. The open effect re-runs whenever its
   * callbacks change identity, a language change among them, and only an
   * unrecorded key opens again.
   */
  const openedKey = useRef<string | null>(null);

  // The open: `readProject` gives the verdict, and this applies it. `restore`
  // is set by reload, which has already dealt with unsaved changes and wants
  // that file open again afterwards.
  const loadProject = useCallback(
    async (
      target: ProjectRef,
      targetProvider: StorageProvider,
      restore: string | null = null,
    ) => {
      const token = (loadSeq.current += 1);
      // Another open started since this one: a key change, a reload or a
      // reconnect. Its reads can finish first, so this one checks after each
      // of its own and sets nothing once overtaken.
      const overtaken = () => loadSeq.current !== token;
      attempted.current = { target, provider: targetProvider, restore };
      setStatus("loading");
      setError(null);
      setValidation([]);
      dismissUndo();
      setOutOfBand(new Set());

      // A refused folder is not the open project, so a lane job still queued
      // for it writes nothing more into it.
      const refuse = (errors: StructureError[]) => {
        lanes.refuse();
        setRef(null);
        setValidation(errors);
        setStatus("invalid");
      };

      const reader = providerReader(targetProvider, pullUnfinished);
      try {
        const verdict = await readProject(
          reader,
          target,
          target.name,
          () => !overtaken(),
        );
        if (!verdict || overtaken()) return;
        if (!verdict.ok) {
          refuse(verdict.errors);
          return;
        }
        const {
          structure: loaded,
          properties: parsedProps,
          catalogue: parsedCatalogue,
        } = verdict;

        // A project reached by URL alone has only its key for a name. With the
        // properties read, the document's title replaces the opaque id.
        const named =
          target.name === projectKey && parsedProps.document.title
            ? { ...target, name: parsedProps.document.title }
            : target;

        setRef(named);
        // Before the render: the stats backfill starts at the end of this
        // open and its lane jobs build on the open project's properties, and
        // a job queued for the previous project must find it replaced.
        lanes.open(named, loaded, parsedProps, parsedCatalogue);
        setPendingRef(null);
        setStatus("ready");

        // On a reload (`restore`) the open file stays open, because the
        // writer never left it. A fresh open lands on the Desk, where
        // `ui.lastOpened` is offered to resume rather than silently reopened:
        // arriving mid-paragraph wastes the moment when context is cheapest
        // to give. `ui.lastOpened` holds the node's id, stable across renames
        // and adoptions, and the node resolves to its adopted snapshot. On a
        // reload the wanted value is the open file, so the lookup accepts
        // both an id and a file name.
        const node = restore
          ? (findNode(loaded, restore) ?? nodeOfFile(loaded, restore))
          : null;
        if (node) {
          const restored = node.adopted;
          const content = await reader.snapshot(target, restored);
          if (overtaken()) return;
          const opened = await openInto(
            target,
            targetProvider,
            restored,
            content ?? "",
            undefined,
            () => !overtaken(),
          );
          if (!opened) return;
        } else {
          letGoOfBuffer();
        }
        // The restore has landed; the next reload takes the buffer's file.
        attempted.current = { target, provider: targetProvider, restore: null };

        // Out-of-band edit detection, warn-only and fire-and-forget, after the
        // restore. Status is already "ready" and `EditorBoot` drops the
        // skeleton on it, so awaiting a read and digest of every snapshot
        // here would mount the workspace over an empty engine.
        void verifySnapshotHashes(reader, target, loaded)
          .then(({ mismatched }) => {
            if (loadSeq.current !== token) return;
            setOutOfBand(mismatched);
          })
          .catch(() => {
            // Best-effort: hashing never refuses the open.
          });

        // Counts and hashes the block does not already hold, gathered behind
        // the open. The load's own token, not the open project, stops them:
        // the same project reloaded keeps its keys.
        const stillHere = () => !overtaken();
        void stats.backfillCounts(
          metadata,
          reader,
          named,
          loaded,
          parsedProps,
          stillHere,
        );
        void stats.backfillHashes(metadata, reader, named, loaded, stillHere);
      } catch (err) {
        if (overtaken()) return;
        setStatus("error");
        setError(message(err));
      }
    },
    [
      lanes,
      projectKey,
      stats,
      metadata,
      message,
      openInto,
      letGoOfBuffer,
      pullUnfinished,
      dismissUndo,
      setError,
    ],
  );

  /**
   * Reconnects a lapsed grant; must run inside a click. The provider's own
   * connection owns the mechanics; the editor only maps the three outcomes
   * to its copy.
   *
   * The re-read goes through the `provider` the route handed down, never a
   * fresh `getProvider(target.providerId)`: a decorator keeps the base
   * provider's `id`, so a lookup by id returns the base and strips the
   * route's composition. On the offline-recovery path that read would bypass
   * the working copy, and `attempted.current` would keep the bare provider
   * for every later `reload()`. `target` is built from this provider, so its
   * `providerId` is always this provider's id.
   */
  const reconnect = useCallback(async () => {
    const target = pendingRefRef.current;
    if (!target) return;
    const conn = connectionFor(target.providerId);
    const outcome = conn
      ? await conn.reconnect(target)
      : (await provider.reopenProject(target))
        ? "granted"
        : "unavailable";
    if (outcome === "granted") {
      // Recorded before the load, as the mount's open does, so the effect's
      // next run cannot reopen the project over the writer's buffer.
      openedKey.current = `${provider.id}/${projectKey}`;
      await loadProject(target, provider);
      return;
    }
    // "cancelled": the writer closed the picker, nothing changed, and the
    // affordance stays. "unavailable": the project cannot be reached
    // even after trying, which the writer is told.
    if (outcome === "unavailable") setError(t("storage.permissionStill"));
  }, [provider, projectKey, loadProject, t, connectionFor, setError]);

  /**
   * Re-reads everything from storage. The caller warns about unsaved editor
   * changes first; here they are discarded.
   */
  const reload = useCallback(async () => {
    const last = attempted.current;
    if (!last) return;
    const restore = bufferFileRef.current ?? last.restore;
    engine.open("");
    bufferFileRef.current = null;
    await loadProject(last.target, last.provider, restore);
  }, [engine, loadProject, bufferFileRef]);

  // A save records a fresh hash, which clears the node's out-of-band mark.
  const clearOutOfBand = useCallback((nodeId: string) => {
    setOutOfBand((prev) => {
      if (!prev.has(nodeId)) return prev;
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  }, []);
  // Closing with no buffer lets go of the file a refused reload would bring
  // back.
  const forgetRestore = useCallback(() => {
    if (attempted.current) attempted.current.restore = null;
  }, []);

  // Opens whatever the URL names. When permission has not survived a reload,
  // the panel shows a reconnect affordance rather than a picker the writer did
  // not ask for.
  //
  // The mount only queries access (`canAccess`) and never requests it.
  // A `requestPermission` without a user gesture pops an
  // unbidden bubble over the booting editor; a writer who blocks it trains
  // the browser to deny the app silently, and every later Connect click
  // resolves "denied" without prompting. A non-"granted" answer settles into
  // the `pendingRef` affordance, and the asking happens inside the writer's
  // click on Reconnect or Connect.
  //
  // The provider can change identity without the project changing, since the
  // Remote Storage mirror is rebuilt whenever the connection state flips.
  // Re-running the open would replace the writer's buffer with the disk copy
  // mid-edit, so once a project is open only a different URL re-opens it.
  useEffect(() => {
    if (!isSupported) return;
    const key = `${provider.id}/${projectKey}`;
    if (openedKey.current === key) return;
    let cancelled = false;

    // The URL is only a provider and a key; the display name comes from the
    // folder's properties file once it is read. The demo document needs no
    // picker and no permission.
    const target: ProjectRef = {
      providerId: provider.id,
      key: projectKey,
      name: projectKey,
      openedAt: new Date().toISOString(),
    };

    void provider
      .canAccess(target)
      .then((access) => {
        if (cancelled) return;
        if (access === "granted") {
          openedKey.current = key;
          void loadProject(target, provider);
        } else setPendingRef(target);
      })
      // An unreachable answer means to the writer what a lapsed grant does:
      // the document is there and cannot be reached yet. Otherwise a provider
      // that throws from a query leaves the panel empty with nothing to
      // click, which reads as a lost project.
      .catch(() => {
        if (!cancelled) setPendingRef(target);
      });
    return () => {
      cancelled = true;
    };
  }, [isSupported, provider, projectKey, loadProject]);

  return {
    ref,
    status,
    validation,
    pendingRef,
    outOfBand,
    reconnect,
    reload,
    clearOutOfBand,
    forgetRestore,
  };
}
