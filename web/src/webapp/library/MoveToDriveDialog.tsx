// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { Dialog } from "../../ui";
import type { ProjectCard as Card } from "./useProjects";

interface Props {
  card: Card | null;
  onConfirm: (card: Card) => void;
  onCancel: () => void;
}

/**
 * Move to Remote Storage leaves the local folder where it is and stops tracking
 * it. Nothing is destroyed, unlike Move to Local, so it uses a warning
 * `Dialog`, not `AlertDialog`.
 */
export default function MoveToDriveDialog({
  card,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={!!card}
      title={t("library.moveToDriveTitle")}
      lede={t("library.moveToDriveLede")}
      confirmLabel={t("library.moveToDriveConfirm")}
      cancelLabel={t("confirm.cancel")}
      onConfirm={() => card && onConfirm(card)}
      onCancel={onCancel}
    >
      {card && <p className="ui-alert-evidence">{card.ref.name}/</p>}
    </Dialog>
  );
}
