// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { Dialog } from "../../ui";
import type { ProjectRef } from "../../storage";

interface Props {
  card: ProjectRef | null;
  onConfirm: (ref: ProjectRef) => void;
  onCancel: () => void;
}

/**
 * The Sync to Remote Storage heads-up, a warning `Dialog` like Move to Remote
 * Storage's. Nothing destructive happens, but a writer's first conflict banner
 * must not be the first they hear that conflicts exist.
 */
export default function SyncConfirmDialog({
  card,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={!!card}
      title={t("library.syncConfirmTitle")}
      lede={t("library.syncConfirmLede")}
      confirmLabel={t("library.syncConfirmConfirm")}
      cancelLabel={t("confirm.cancel")}
      onConfirm={() => card && onConfirm(card)}
      onCancel={onCancel}
    >
      {card && <p className="ui-alert-evidence">{card.name}/</p>}
    </Dialog>
  );
}
