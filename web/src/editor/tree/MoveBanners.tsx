// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { canMoveSelection } from "../../project/moveTargets";
import { findNode } from "../../project/structure";
import type { DocumentStructure, NodeKind } from "../../project/types";
import { Button } from "../../ui";
import type { Placing } from "./useMovePlacement";

/** The line over the tree while a Move… runs, and its "nowhere" note. */
export function MovingLine({
  placing,
  structure,
  nowhere,
  onCancel,
}: {
  placing: Placing;
  structure: DocumentStructure;
  /** The move has no landing anywhere in the book. */
  nowhere: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* While a move is running, one line saying what is in the air
      and one way out of it. Escape does the same, but a phone has no
      Escape, so this keeps the mode from being a trap. Above the
      tree, not over it: nothing may cover a landing. */}
      <div className="dt-moving" role="status">
        <span className="dt-moving-what">
          {placing.from === "bin"
            ? t("tree.movingNow", { title: placing.node.title })
            : placing.ids.length === 1
              ? t("tree.movingNow", {
                  title: findNode(structure, placing.ids[0])?.title ?? "",
                })
              : t(
                  findNode(structure, placing.ids[0])?.kind === "part"
                    ? "tree.movingParts"
                    : "tree.movingSections",
                  { count: placing.ids.length },
                )}
        </span>
        <Button variant="link" className="dt-moving-stop" onClick={onCancel}>
          {t("confirm.cancel")}
        </Button>
      </div>

      {/* A lone Section in a one-Part document has nowhere else to
      be, and a removed node whose name has been taken cannot come
      back. A mode with no targets says so, or the tree would look
      unresponsive. */}
      {nowhere && (
        <p className="dt-moving-none">
          {placing.from === "bin"
            ? t("bin.restoreRefused")
            : placing.ids.length === 1
              ? t("tree.moveNowhere")
              : t("tree.moveNowhereMany")}
        </p>
      )}
    </>
  );
}

/** The line under the tree that counts the ticked rows. */
export function SelectedLine({
  structure,
  selected,
  selectKind,
  onMove,
  onClear,
}: {
  structure: DocumentStructure;
  selected: readonly string[];
  selectKind: NodeKind | null;
  onMove: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* Under the tree: a line appearing above the rows on the first
      tick would move every row under the pointer. Escape clears too;
      on a phone, Clear is the way out. */}
      <div className="dt-moving dt-selecting" role="status">
        <span className="dt-moving-what">
          {t(
            selectKind === "part"
              ? "tree.selectedParts"
              : "tree.selectedSections",
            { count: selected.length },
          )}
        </span>
        {canMoveSelection(structure, selected) && (
          <Button variant="link" className="dt-moving-stop" onClick={onMove}>
            {t("tree.move")}
          </Button>
        )}
        <Button variant="link" className="dt-moving-stop" onClick={onClear}>
          {t("tree.clearSelection")}
        </Button>
      </div>
    </>
  );
}
