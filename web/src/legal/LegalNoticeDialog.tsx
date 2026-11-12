// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { Dialog } from "../ui";
import { LEGAL_NOTICE } from "./compose";
import LegalText from "./LegalText";

// The disclaimer as a popup. It takes the tall form's width, so the body
// scrolls and the close button stays in view.

export default function LegalNoticeDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      title={t(`legal.${LEGAL_NOTICE.text}.title`)}
      lede={t(`legal.${LEGAL_NOTICE.text}.lede`)}
      className="ui-dialog--wizard"
      confirmLabel={t("legal.close")}
      cancelHidden
      onConfirm={onClose}
      onCancel={onClose}
    >
      <LegalText document={LEGAL_NOTICE} level={3} />
    </Dialog>
  );
}
