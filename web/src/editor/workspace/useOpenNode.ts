// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo } from "react";
import { nodeNumber, nodeOfFile } from "../../project/structure";
import type {
  DocumentProperties,
  DocumentStructure,
} from "../../project/types";
import type { OpenMark } from "./WorkspaceTitlebar";

/** The open node, as the crumb, the dock, the assistant and the bar name it. */
export interface OpenNode {
  /** The open node's id, title and kind, or null on the Desk. */
  activeNode: { id: string; title: string; kind: OpenMark["kind"] } | null;
  /**
   * When the open node was last written, from the project's stats rather
   * than this session's memory, so the bar can say "Saved · …" the moment a
   * section opens.
   */
  openedSavedAt: string | null;
  /** The crumb's mark for the open node, by the panel's own numbering. */
  openMark: OpenMark | null;
  /** The open node's title, the writer's words rather than a file name. */
  openTitle: string | null;
}

/**
 * Which node the open file belongs to, and what is said about it. Each value
 * keeps its identity until an input changes, so `Workspace`'s memo holds on a
 * properties write that touches neither.
 */
export function useOpenNode(
  structure: DocumentStructure | null,
  props: DocumentProperties | null,
  activeFile: string | null,
): OpenNode {
  // `stats.perNode` is keyed by node id and only a real write touches it
  // (`recordSave`, from `saveActiveFile`), so this is the node's last save
  // time, resolved from the open file through its node.
  const openedSavedAt = useMemo(() => {
    if (!activeFile || !props || !structure) return null;
    const owner = nodeOfFile(structure, activeFile);
    if (!owner) return null;
    return (
      props.stats.perNode.find((node) => node.nodeId === owner.id)?.updatedAt ??
      null
    );
  }, [activeFile, props, structure]);

  const activeNode = useMemo(() => {
    if (!activeFile || !structure) return null;
    const node = nodeOfFile(structure, activeFile);
    return node ? { id: node.id, title: node.title, kind: node.kind } : null;
  }, [activeFile, structure]);

  const openMark = useMemo<OpenMark | null>(
    () =>
      activeNode && structure
        ? {
            kind: activeNode.kind,
            number: nodeNumber(structure, activeNode.id),
          }
        : null,
    [activeNode, structure],
  );

  return {
    activeNode,
    openedSavedAt,
    openMark,
    openTitle: activeNode?.title ?? null,
  };
}
