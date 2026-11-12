// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { AlertDialog } from "../../ui";
import { evidenceFor } from "./cardEvidence";
import type { ProjectCard as Card } from "./useProjects";

interface Props {
  card: Card | null;
  /**
   * Whether the card is Local+Synced, whose body explains the per-side choice.
   */
  isSynced: boolean;
  onConfirm: (card: Card) => void;
  onCancel: () => void;
}

/**
 * The irreversible branch of the confirm ladder: the AlertDialog is the
 * protection and no Undo toast follows. The way back is Drive's own bin,
 * which the dialog names.
 *
 * Always mounted: AlertDialog's exit transition matters, and unmounting it on
 * confirm would cut that short.
 */
export default function DeleteFolderDialog({
  card,
  isSynced,
  onConfirm,
  onCancel,
}: Props) {
  const { t, i18n } = useTranslation();
  return (
    <AlertDialog
      open={!!card}
      title={t("library.deleteFolderTitle")}
      body={t(
        card && isSynced
          ? "library.deleteFolderBodySynced"
          : "library.deleteFolderBody",
      )}
      evidence={card ? evidenceFor(card, t, i18n.language) : undefined}
      confirmLabel={t("library.deleteFolderConfirm")}
      cancelLabel={t("library.deleteFolderCancel")}
      onConfirm={() => {
        if (card) onConfirm(card);
      }}
      onCancel={onCancel}
    />
  );
}
