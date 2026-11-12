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
  onConfirm: (card: Card) => void;
  onCancel: () => void;
}

/**
 * Move to Local deletes the Remote Storage folder once the copy succeeds, so it
 * goes through `AlertDialog`.
 */
export default function MoveToLocalDialog({
  card,
  onConfirm,
  onCancel,
}: Props) {
  const { t, i18n } = useTranslation();
  return (
    <AlertDialog
      open={!!card}
      title={t("library.moveToLocalTitle")}
      body={t("library.moveToLocalBody")}
      evidence={card ? evidenceFor(card, t, i18n.language) : undefined}
      confirmLabel={t("library.moveToLocalConfirm")}
      cancelLabel={t("library.moveToLocalCancel")}
      onConfirm={() => card && onConfirm(card)}
      onCancel={onCancel}
    />
  );
}
