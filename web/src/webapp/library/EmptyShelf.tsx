// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { Button, Reason } from "../../ui";
import { VENDORS } from "../../legal/domain/facts";
import type { EmptyState } from "./emptyState";

// A shelf showing no projects, and why. Each state names its own place and
// offers the one thing that would fill it. `emptyState.ts` decides which
// state applies.

export default function EmptyShelf({
  state,
  query,
  total,
  onClear,
  onChooseLocalFolder,
  onFindLocalProjects,
  onConnectDrive,
  onFindInDrive,
  onImport,
}: {
  state: EmptyState;
  query: string;
  /** Every card on the shelf, which a search looked through. */
  total: number;
  onClear: () => void;
  /** Absent where the File System Access API is not available. */
  onChooseLocalFolder?: () => void;
  /** The local sweep; absent until a root is mapped. */
  onFindLocalProjects?: () => void;
  /** Absent when the writer has no Google account. */
  onConnectDrive?: () => void;
  onFindInDrive: () => void;
  /**
   * Brings in a manuscript, offered where a place is ready and holds nothing.
   * Absent when no project could be made anywhere.
   */
  onImport?: () => void;
}) {
  const { t } = useTranslation();
  const importButton = onImport && (
    <Button variant="outline" onClick={onImport}>
      {t("import.heading")}
    </Button>
  );

  if (state === "driveDisconnected" && !onConnectDrive) {
    // A writer without Google has no remedy to offer: the place and why.
    return (
      <div className="lib-empty">
        <h2>{t("library.driveOffTitle")}</h2>
        <p>
          <Reason>
            {t("library.driveNeedsAccount", { identity: VENDORS.identity })}
          </Reason>
        </p>
      </div>
    );
  }

  if (state === "driveDisconnected") {
    // Primary, alone: the shelf is not empty but unseen, and connecting is
    // the one remedy.
    return (
      <div className="lib-empty">
        <h2>{t("library.driveOffTitle")}</h2>
        <p>{t("library.driveOffBody")}</p>
        <div className="lib-empty-row">
          <Button variant="primary" onClick={onConnectDrive}>
            {t("library.connectDrive")}
          </Button>
        </div>
      </div>
    );
  }

  if (state === "driveEmpty") {
    return (
      <div className="lib-empty">
        <h2>{t("library.driveEmptyTitle")}</h2>
        <p>{t("library.driveEmptyBody")}</p>
        <div className="lib-empty-row">
          <Button variant="outline" onClick={onFindInDrive}>
            {t("library.findDrive")}
          </Button>
          {importButton}
        </div>
      </div>
    );
  }

  if (state === "localEmpty") {
    return (
      <div className="lib-empty">
        <h2>{t("library.localEmptyTitle")}</h2>
        <p>{t("library.localEmptyBody")}</p>
        {/* No row on a browser that cannot read folders: a button that can
            only fail is worse than the sentence alone. */}
        {onChooseLocalFolder && (
          <div className="lib-empty-row">
            <Button variant="outline" onClick={onChooseLocalFolder}>
              {t("library.chooseLocalFolder")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (state === "localScannedEmpty") {
    return (
      <div className="lib-empty">
        <h2>{t("library.localScannedEmptyTitle")}</h2>
        <p>{t("library.localScannedEmptyBody")}</p>
        {/* The root is chosen and nothing is discovered: the sweep is the
            way in, as on the shelf row and the first-run panel.
            Remapping is Forget in Settings, then Choose. */}
        {onFindLocalProjects && (
          <div className="lib-empty-row">
            <Button variant="outline" onClick={onFindLocalProjects}>
              {t("library.findLocal")}
            </Button>
            {importButton}
          </div>
        )}
      </div>
    );
  }

  // The heading names the search, so the fix beside it reads as undoing it.
  const typed = query.trim();
  return (
    <div className="lib-empty">
      <h2>
        {typed
          ? t("library.noMatchQueryTitle", { query: typed })
          : t("library.noMatchTitle")}
      </h2>
      <p>
        {typed
          ? t("library.noMatchSearched", { count: total })
          : t("library.noMatchHere")}
      </p>
      <div className="lib-empty-row">
        <Button variant="outline" onClick={onClear}>
          {t("library.clearFilters")}
        </Button>
      </div>
    </div>
  );
}
