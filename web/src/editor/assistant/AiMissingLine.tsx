// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import type { ReadRef } from "../../ai/domain/types";
import { referenceName } from "./commandReferences";

/**
 * What the chat relies on that the writer has not written, as one quiet
 * line: each document named once, a link where it can be written from here.
 */
export default function AiMissingLine({
  missing,
  onWriteReference,
}: {
  missing: readonly ReadRef[];
  onWriteReference: ((reference: ReadRef) => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <p className="dock-hint ai-missing">
      {/* Each document is named once. Where they can be written
          from here, the links are the list and the sentence only
          leads into them; a shelf, which has no one file to open,
          stands among them as its plain name. */}
      {onWriteReference ? (
        <>
          <span>{t("dock.missingLead", { count: missing.length })}</span>{" "}
          <span className="ai-write-links">
            {missing.map((need) =>
              need.sectionId !== undefined ? (
                <button
                  key={`${need.group}:${need.sectionId}`}
                  type="button"
                  className="ui-text-link"
                  onClick={() => onWriteReference(need)}
                >
                  {t("dock.writeReference", {
                    name: referenceName(t, need),
                  })}
                </button>
              ) : (
                <span key={need.group}>{referenceName(t, need)}</span>
              ),
            )}
          </span>
        </>
      ) : (
        <span>
          {t("dock.missingReferences", {
            names: missing.map((need) => referenceName(t, need)).join(", "),
            count: missing.length,
          })}
        </span>
      )}
    </p>
  );
}
