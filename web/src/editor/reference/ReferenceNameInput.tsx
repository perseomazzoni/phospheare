// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { validateReferenceName } from "../../project/naming";

// The inline name field for reference files. Enter commits, Esc cancels, and
// blur keeps a good name and drops a bad one.
//
// The duplicate error names the file, not the group: the taken set spans the
// whole reference folder, which every group shares.

export default function ReferenceNameInput({
  prefix,
  group,
  taken,
  initial = "",
  onCommit,
  onCancel,
  rowClassName,
}: {
  prefix: string;
  group: string;
  taken: Set<string>;
  /**
   * The name already on the document, for a rename. Empty, the default, for
   * a create.
   */
  initial?: string;
  onCommit: (title: string) => boolean | Promise<boolean>;
  onCancel: () => void;
  /** The row wrapper's class; each face owns its grid. */
  rowClassName: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const problem = useMemo(
    () => validateReferenceName(value, prefix, taken),
    [value, prefix, taken],
  );
  const canCommit = problem === null;

  const commit = () => {
    if (!canCommit || settled.current) return;
    settled.current = true;
    // A `false` answer (the write did not land) re-arms the field: the caller
    // keeps it open for the retry, and a field whose Enter, Esc and blur are
    // all dead cannot be retried. A rejected promise is a commit
    // that did not succeed, so it re-arms too.
    void Promise.resolve(onCommit(value.trim())).then(
      (ok) => {
        if (!ok) settled.current = false;
      },
      () => {
        settled.current = false;
      },
    );
  };

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  return (
    <div className={rowClassName}>
      <input
        ref={inputRef}
        className={`dt-name-input${problem && problem.code !== "empty" ? " invalid" : ""}`}
        value={value}
        placeholder={t("reference.namePlaceholder")}
        aria-label={t("reference.namePlaceholder")}
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
          // The panel listens for Escape to cancel a drag, and rows listen for
          // typing; neither should see what is meant for this field.
          e.stopPropagation();
        }}
        onBlur={() => (canCommit ? commit() : cancel())}
      />
      {problem && problem.code !== "empty" && (
        <p className="dt-name-error" role="alert">
          {problem.code === "duplicate"
            ? t("reference.duplicate", problem.values)
            : t(`name.${problem.code}`, {
                ...problem.values,
                // The noun is the group's for every problem except the
                // folder-wide duplicate.
                kind: group,
              })}
        </p>
      )}
    </div>
  );
}
