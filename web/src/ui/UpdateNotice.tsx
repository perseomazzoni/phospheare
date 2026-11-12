// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import StatusNotice from "./StatusNotice";
import Button from "./Button";

// "A newer version is ready": the build this tab runs was replaced, and a
// piece of it failed to load. It never reloads by itself, since the
// tab may hold unsaved work, so it carries its own Reload.
//
// `attention`: nothing is lost and the app keeps working with what it has.
// Nothing withdraws it but the reload.

export default function UpdateNotice({
  shown,
  onReload,
}: {
  shown: boolean;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  if (!shown) return null;

  return (
    <StatusNotice
      tone="attention"
      className="update-notice"
      action={
        <Button
          variant="link"
          className="status-notice-action"
          onClick={onReload}
        >
          {t("fault.updateNoticeAction")}
        </Button>
      }
    >
      {t("fault.updateNotice")}
    </StatusNotice>
  );
}
