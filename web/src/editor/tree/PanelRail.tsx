// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import type { DocNode } from "../../project/types";
import { Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";

/**
 * At 52px the panel is a different view, not the wide one squeezed:
 * a tree at that width is a column of identical glyphs. Numbers say
 * which Part the writer is in. Both views are mounted and the
 * stylesheet picks one, so nothing is measured or remounted on the
 * way in.
 */
export default function PanelRail({
  parts,
  currentPart,
  finding,
  rail,
  enterRail,
  onToggleCollapse,
  expand,
}: {
  /** The book's top-level Parts, numbered in order. */
  parts: readonly DocNode[];
  /** The Part the open node is in. */
  currentPart: string | null;
  /** The project find has the panel. */
  finding: boolean;
  /** The panel is folded to this rail. */
  rail: boolean;
  /** A mouse entering the rail opens the peek. */
  enterRail: (event: React.PointerEvent) => void;
  onToggleCollapse: () => void;
  /** Unfold a Part. */
  expand: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="dt-rail" aria-hidden={!rail} onPointerEnter={enterRail}>
      {/* The project search outlives the fold, and the wide face it
          left is the results, not the tree: Part numbers over a panel
          that opens onto results would promise the wrong face. */}
      {finding ? (
        <button
          type="button"
          className="dt-rail-find"
          // Named by its title alone, as the Part numbers are: the rail
          // is always mounted, and an `aria-label` would make a second
          // element answer to the find field's name.
          title={t("tree.findLabel")}
          onClick={onToggleCollapse}
        >
          <Icon name={appIcons.search} size={14} />
        </button>
      ) : (
        parts.map((part, i) => (
          <button
            key={part.id}
            type="button"
            title={part.title}
            aria-current={part.id === currentPart ? "true" : undefined}
            onClick={() => {
              onToggleCollapse();
              expand(part.id);
            }}
          >
            {String(i + 1).padStart(2, "0")}
          </button>
        ))
      )}
      {(finding || parts.length > 0) && <hr />}
    </div>
  );
}
