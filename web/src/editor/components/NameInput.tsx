// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { titleProblem } from "../../project/naming";
import type { NodeKind } from "../../project/types";

// The inline name field, which both creates a node and renames one. Inline
// rather than modal: a writer naming a chapter sees it in the document, at
// the depth it will live at, not floating over a dimmed panel.
//
// Validation runs on every keystroke and reports the first problem only,
// and Enter is ignored while one is showing. Titles are free: a name
// another node carries, or one with a colon in it, is the writer's to
// choose, because the file name carries the node's id and its slug strips
// whatever a platform would object to.

interface Props {
  kind: NodeKind;
  depth: number;
  /** Prefilled for a rename, empty for a new node. */
  initial?: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}

export default function NameInput({
  kind,
  depth,
  initial = "",
  onCommit,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  // A blur caused by committing must not also fire the cancel path.
  const settled = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const problem = useMemo(() => titleProblem(value), [value]);
  const canCommit = problem === null;

  const commit = () => {
    if (!canCommit || settled.current) return;
    settled.current = true;
    onCommit(value.trim());
  };

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  // A row of the structure panel's treegrid, its field and its error one
  // cell, which lays out as though it were not there (`.dt-cell`).
  return (
    <div
      className="dt-name-row"
      role="row"
      aria-level={depth + 1}
      style={{ paddingLeft: `${10 + depth * 13}px` }}
    >
      <span className="dt-cell" role="gridcell">
        <input
          ref={inputRef}
          className={`dt-name-input${problem && problem.code !== "empty" ? " invalid" : ""}`}
          value={value}
          placeholder={t(
            kind === "part" ? "tree.partName" : "tree.sectionName",
          )}
          aria-label={t(kind === "part" ? "tree.partName" : "tree.sectionName")}
          aria-invalid={!canCommit}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
            // The panel listens for Escape to cancel a drag, and rows listen
            // for typing; neither should see what is meant for this field.
            e.stopPropagation();
          }}
          // Clicking away keeps a good name and discards a bad one, as a
          // writer who has stopped looking at this field expects either way.
          onBlur={() => (canCommit ? commit() : cancel())}
        />
        {problem && problem.code !== "empty" && (
          <p className="dt-name-error" role="alert">
            {t(`name.${problem.code}`, problem.values)}
          </p>
        )}
      </span>
    </div>
  );
}
