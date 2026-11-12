// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { findNode } from "../../project/structure";
import type { DocumentStructure } from "../../project/types";
import type { DragGhost } from "./useTreeDrag";

/** How many titles a group drag's ghost names before it counts the rest. */
const GHOST_NAMES = 3;

/**
 * What a drag carries, under the pointer. Portalled to `<body>`, because the
 * panel clips with `overflow: hidden` and would cut it at its edge.
 */
export default function TreeGhost({
  ghost,
  draggingIds,
  structure,
}: {
  ghost: DragGhost | null;
  draggingIds: readonly string[];
  structure: DocumentStructure | null;
}) {
  const { t } = useTranslation();
  if (!ghost) return null;
  return createPortal(
    <div
      className="dt-ghost"
      style={{ left: `${ghost.x + 12}px`, top: `${ghost.y - 10}px` }}
      aria-hidden
    >
      {/* A group is named in book order, the order it will land in.
          Past `GHOST_NAMES` the rest are counted, so a large drag stays a
          label, not a column. */}
      {structure && draggingIds.length > 1 ? (
        <ul className="dt-ghost-list">
          {draggingIds.slice(0, GHOST_NAMES).map((id) => (
            <li key={id}>{findNode(structure, id)?.title ?? ""}</li>
          ))}
          {draggingIds.length > GHOST_NAMES && (
            <li className="dt-ghost-more">
              {t("tree.dragMore", {
                count: draggingIds.length - GHOST_NAMES,
              })}
            </li>
          )}
        </ul>
      ) : (
        ghost.title
      )}
    </div>,
    document.body,
  );
}
