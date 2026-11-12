// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { forwardRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import {
  referenceDisplayTitle,
  referenceGroupOf,
  type ReferenceGroupId,
} from "../../project/reference";
import type { DocNode } from "../../project/types";

// ── The recycle bin ──────────────────────────────────────────────────────────
//
// The bottom of the structure region: what the writer has unlinked from the
// project, listed flat. A removed Part keeps its children for restoration
// (the yaml's `removed:` list holds the whole subtree) but shows as one row.
//
// A drag onto the structure restores the subtree, whole, at the slot the
// writer aimed at. A tree node dragged onto the bin's body is deleted; the
// bin arms (`.armed`) while the pointer is over it.
//
// A row's own control opens the same list of destinations the tree's
// `Move…` uses (`restoreTargets`), so a restore never lands on a guess. It
// exists because the drag refuses a touch pointer.
//
//
// ── One bin, two kinds of row ────────────────────────────────────────────────
//
// Binned reference documents are listed here too: the project has one
// recycle bin, and `recyclebin/` holds both sets. A chapter comes back at a
// chosen slot, so it is dragged or given a list of destinations; a reference
// document has no slot, so it is one button.

/**
 * The groups the bin draws, in the shelf's own order. `summaries` is absent:
 * a generated summary is derived material, removed outright rather than
 * binned, so a Summaries heading here could only be empty.
 */
const REFERENCE_BIN_GROUPS: ReferenceGroupId[] = [
  "guidebook",
  "characters",
  "arcs",
  "world",
  "notes",
];

interface RecycleBinProps {
  /** The `removed:` subtrees, one row per top-level node. */
  items: DocNode[];
  /** Binned reference documents, by file name. */
  refItems?: readonly string[];
  /** Binned snapshots: the node they came from, and the writer's own title. */
  snapItems?: readonly { nodeId: string; file: string; title: string }[];
  onRestoreSnapshot?: (nodeId: string, file: string) => void;
  /** Put one back in the reference folder. One move, no slot to choose. */
  onRestoreRef?: (fileName: string) => void;
  /** The last reference restore the port refused, said once, not per row. */
  refRestoreFailed?: boolean;
  /** Pointer-down on a row: begin a restore-by-drag. */
  onDragStart: (event: React.PointerEvent, node: DocNode) => void;
  /** The row's own control: open the list of places it could go back to. */
  onRestore: (node: DocNode) => void;
  /** A tree drag is over the bin, which is a delete target while it is. */
  armed: boolean;
}

/**
 * The bin. Its forwarded ref is held by the drag gesture, which needs the
 * current element at drag time to aim at the delete target.
 */
const RecycleBin = forwardRef<HTMLElement, RecycleBinProps>(function RecycleBin(
  {
    items,
    refItems = [],
    snapItems = [],
    onRestoreSnapshot,
    onRestoreRef,
    refRestoreFailed = false,
    onDragStart,
    onRestore,
    armed,
  },
  ref,
) {
  const { t } = useTranslation();
  // Collapsed by default: the bin is the structure's footnote, and
  // accumulated removals should not take the panel's bottom on every load.
  const [open, setOpen] = useState(false);

  // An empty bin is not a toggle: nothing to expand, so no caret, and the
  // head is a label. The body stays open either way, because it is the drop
  // target for dragging a tree node in to delete it.
  const hasItems = items.length + refItems.length + snapItems.length > 0;
  const openNow = hasItems ? open : true;

  // Grouped by the prefix each file already carries, in the shelf's own
  // order, so the bin reads the way the Reference face does. Empty groups are
  // absent, since a heading promises a row.
  const refGroups = REFERENCE_BIN_GROUPS.map(
    (group) =>
      [group, refItems.filter((name) => referenceGroupOf(name) === group)] as [
        ReferenceGroupId,
        string[],
      ],
  ).filter(([, names]) => names.length > 0);

  const headContent = (
    <>
      <Icon name={appIcons.delete} size={11} className="dt-bin-glyph" />
      <span className="dt-bin-name">{t("bin.label")}</span>
      <span className="dt-bin-n">
        {items.length + snapItems.length + refItems.length}
      </span>
    </>
  );

  return (
    <section
      ref={ref}
      className={`dt-bin${armed ? " armed" : ""}`}
      data-open={openNow ? "1" : "0"}
      // Empty, it is only a place to drop on: a theme may keep it out of
      // sight until a drag is in the air.
      data-empty={hasItems ? undefined : "1"}
      data-bin
      aria-label={t("bin.label")}
    >
      {hasItems ? (
        <button
          type="button"
          className="dt-bin-head"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon
            name={appIcons.expand}
            size={10}
            strokeWidth={2}
            className="dt-bin-caret"
          />
          {headContent}
        </button>
      ) : (
        <div className="dt-bin-head dt-bin-head-flat">{headContent}</div>
      )}

      <div className="dt-bin-body">
        <div className="dt-bin-inner">
          {/* The manuscript's own group, always first: the shape of the
              project before the material written against it. */}
          {items.length > 0 ? (
            <p className="dt-bin-group">{t("bin.groupStructure")}</p>
          ) : null}
          {items.map((node) => (
            <div
              key={node.id}
              className="dt-bin-row"
              title={t("bin.restore", { title: node.title })}
              onPointerDown={(e) => onDragStart(e, node)}
            >
              <Icon
                name={node.kind === "part" ? appIcons.part : appIcons.section}
                size={13}
              />
              <span className="dt-bin-title">{node.title}</span>
              {/* One action, so a control rather than a one-item menu.
                  `onPointerDown` stops here, or the drag would arm under it.
                  The glyph, not the word, unlike the reference rows below:
                  this opens a list of landings, and a "Restore" label would
                  promise that one press restores. */}
              <button
                type="button"
                className="dt-more dt-bin-back"
                aria-label={t("bin.restore", { title: node.title })}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onRestore(node)}
              >
                <Icon name={appIcons.move} size={14} />
              </button>
            </div>
          ))}
          {/* Snapshots: prose the writer set aside, as losable as a chapter
              and binned by the same rule. Its own group, because a snapshot
              belongs to a node rather than to the shelf. */}
          {onRestoreSnapshot && snapItems.length > 0 ? (
            <div className="dt-bin-section">
              <p className="dt-bin-group">{t("bin.groupSnapshots")}</p>
              {snapItems.map((snap) => (
                <div key={snap.file} className="dt-bin-row">
                  <Icon name={appIcons.snapshot} size={13} />
                  <span className="dt-bin-title">{snap.title}</span>
                  <button
                    type="button"
                    className="dt-bin-restore"
                    onClick={() => onRestoreSnapshot(snap.nodeId, snap.file)}
                  >
                    {t("bin.restoreShort")}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {/* The reference half, grouped as the shelf groups it, so a deleted
              character is found under Characters. Storage stays one flat
              folder; these are headings, not places. */}
          {onRestoreRef &&
            refGroups.map(([group, names]) => (
              <div key={group} className="dt-bin-section">
                <p className="dt-bin-group">{t(`reference.group.${group}`)}</p>
                {names.map((fileName) => (
                  <div key={fileName} className="dt-bin-row">
                    <span className="dt-bin-title">
                      {referenceDisplayTitle(fileName, t)}
                    </span>
                    {/* The word, not the glyph: there is nowhere to aim this
                        one, so one press is the whole gesture. */}
                    <button
                      type="button"
                      className="dt-bin-restore"
                      onClick={() => onRestoreRef(fileName)}
                    >
                      {t("bin.restoreShort")}
                    </button>
                  </div>
                ))}
              </div>
            ))}
          {refRestoreFailed && (
            <p className="ref-write-error" role="alert">
              {t("reference.restoreFailed")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
});

export default RecycleBin;
