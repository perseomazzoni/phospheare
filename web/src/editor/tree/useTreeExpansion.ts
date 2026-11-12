// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useProjectActions, useProjectState } from "../ProjectContext";
import { allIds, findParent, nodeOfFile } from "../../project/structure";
import type { SearchArrival } from "../searchArrival";

/**
 * The structure panel's open Parts: restored from the project, unfolded by
 * the chevrons, the drag and an arrival, and saved by the chevrons alone.
 */
export function useTreeExpansion({
  arrival,
  panelRef,
  onRestore,
}: {
  /** Where the writing surface last arrived; its Part unfolds. */
  arrival: SearchArrival | null;
  /** The panel, scrolled to an arrival's row. */
  panelRef: React.RefObject<HTMLElement | null>;
  /** The open Parts were restored: a new project, or a reload reached ready. */
  onRestore: () => void;
}) {
  const { structure, props, status, ref: projectRef } = useProjectState();
  const { saveUi } = useProjectActions();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const propsRef = useRef(props);
  propsRef.current = props;
  // `structure` is read through a ref, as `props` is, so it stays out of the
  // restore effect's dependencies; listing it would re-run the reset on every
  // move.
  const structureRef = useRef(structure);
  structureRef.current = structure;

  // Restore the shape the writer left the document in. Keyed on the project
  // and on reaching 'ready', so an ordinary move, which replaces the structure
  // but not the status, never collapses the tree under them.
  //
  // A layout effect, so the restored shape commits with the rows that first
  // draw the tree and the tree never paints folded first. As a passive effect,
  // a chevron clicked in the gap would build on the empty set, and the later
  // update would either fold the click back or save a wiped set.
  useLayoutEffect(() => {
    const current = structureRef.current;
    if (status !== "ready" || !current) return;
    // `ui.expanded` holds node ids, stable across renames, so the writer's
    // open Parts survive one.
    const valid = new Set(allIds(current));
    const remembered = (propsRef.current?.ui.expanded ?? []).filter((n) =>
      valid.has(n),
    );
    setExpanded(
      new Set(
        remembered.length > 0
          ? remembered
          : current.children.filter((c) => c.kind === "part").map((c) => c.id),
      ),
    );
    onRestore();
  }, [projectRef?.key, status, onRestore]);

  // The chevron flips and persists; the drag hover-expands and collapses on
  // drop, transiently. Descendants keep their own state, so a re-opened Part
  // restores its prior shape. `expandedRef` mirrors the state so `toggle` can
  // persist without computing the next set in the updater.
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const setExpandedFor = useCallback((fileName: string, want: boolean) => {
    setExpanded((prev) => {
      if (prev.has(fileName) === want) return prev;
      const next = new Set(prev);
      if (want) next.add(fileName);
      else next.delete(fileName);
      return next;
    });
  }, []);

  const expand = useCallback(
    (fileName: string) => setExpandedFor(fileName, true),
    [setExpandedFor],
  );

  const collapse = useCallback(
    (fileName: string) => setExpandedFor(fileName, false),
    [setExpandedFor],
  );

  // An arrival unfolds the Parts above its row, so the active mark is not
  // hidden inside a folded Part.
  //
  // Through `expand`, never `toggle`: the tree is following the page, not
  // being reshaped, so it is not saved. The scroll waits a frame for the
  // unfolded rows to exist. Focus stays where the writer left it, usually the
  // chat composer, because an arrival is something to look at.
  //
  // Keyed on the arrival object, so a second passage in the same Section
  // follows again.
  useEffect(() => {
    const current = structureRef.current;
    if (!arrival || status !== "ready" || !current) return;
    const node = nodeOfFile(current, arrival.file);
    if (!node) return;
    for (
      let part = findParent(current, node.id);
      part;
      part = findParent(current, part.id)
    )
      expand(part.id);
    const frame = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector(`[data-row="${node.id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [arrival, status, expand, panelRef]);

  const toggle = useCallback(
    (fileName: string) => {
      const next = new Set(expandedRef.current);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      setExpanded(next);
      saveUi([...next]);
    },
    [saveUi],
  );

  return { expanded, expand, collapse, toggle };
}
