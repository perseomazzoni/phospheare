// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { walk } from "../../../project/structure";
import { useDeferredDispose } from "../../useDeferredDispose";
import type { DocumentStructure } from "../../../project/types";
import type { ProjectRef, StorageProvider } from "../../../storage/types";
import { projectCommentStore } from "./projectStore";
import { CommentsService, type NodeComments } from "../application/comments";
import { countsOf, type CommentCounts } from "../domain/counts";

// The comments, wired to the open project. The host is the one layer that
// knows the project: it builds the service on the project's own provider,
// loads the files of the live nodes whenever the structure changes, and hands
// the service down by context. It draws nothing.

const CommentsContext = createContext<CommentsService | null>(null);

export function CommentsProvider({
  service,
  children,
}: {
  service: CommentsService | null;
  children: ReactNode;
}) {
  return (
    <CommentsContext.Provider value={service}>
      {children}
    </CommentsContext.Provider>
  );
}

/** The open project's comments, or null where there are none (a harness). */
export function useCommentsService(): CommentsService | null {
  return useContext(CommentsContext);
}

const NOTHING: ReadonlyMap<string, NodeComments> = new Map();
const noSubscription = () => () => undefined;

/** Every loaded node's comments, re-rendering on any change. */
export function useAllComments(): ReadonlyMap<string, NodeComments> {
  const service = useCommentsService();
  return useSyncExternalStore(
    service?.subscribe ?? noSubscription,
    service?.snapshot ?? (() => NOTHING),
  );
}

/** One node's comments as the screen should show them. */
export function useNodeComments(
  nodeId: string | null,
): NodeComments | undefined {
  const all = useAllComments();
  return nodeId ? all.get(nodeId) : undefined;
}

/** What each node's row counts. */
export function useCommentCounts(): ReadonlyMap<string, CommentCounts> {
  const all = useAllComments();
  return useMemo(() => {
    const counts = new Map<string, CommentCounts>();
    for (const [id, state] of all)
      if (state.status === "ready") counts.set(id, countsOf(state.file));
    return counts;
  }, [all]);
}

function randomId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `c${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The service for this project, built on its provider and dropped with it.
 * Loads the comments of every live node, and of any node that becomes live.
 */
export function useProjectComments(
  provider: StorageProvider,
  ref: ProjectRef | null,
  structure: DocumentStructure | null,
): CommentsService | null {
  const service = useMemo(
    () =>
      ref
        ? new CommentsService({
            store: projectCommentStore(provider, ref),
            now: () => new Date().toISOString(),
            newId: randomId,
          })
        : null,
    [provider, ref],
  );
  // Deferred, so StrictMode's mount, cleanup and mount again in development
  // never kills the instance the second mount still renders.
  useDeferredDispose(service);
  useEffect(() => {
    if (!service || !structure) return;
    const ids: string[] = [];
    walk(structure.children, (node) => ids.push(node.id));
    void service.load(ids);
  }, [service, structure]);
  return service;
}
