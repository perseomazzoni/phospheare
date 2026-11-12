// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The demo site's ways in: the demo itself, and the program's download. The
// site has no accounts, so nothing signs in and nothing redirects.

import { useTranslation } from "react-i18next";
import { QUICKSTART_URL } from "./content";
import type { LandingEntry } from "./entry";

export function useDownloadEntry(): LandingEntry {
  const { t } = useTranslation();
  return {
    redirect: null,
    withGoogle: false,
    head: (
      // One way in, so it keeps its full words down to the narrowest header.
      <a
        className="ui-btn ui-btn-primary ui-btn-sm"
        href={QUICKSTART_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("landing.download")}
      >
        <span className="landing-head-last-long">{t("landing.download")}</span>
        <span className="landing-head-last-short">
          {t("landing.head.download")}
        </span>
      </a>
    ),
    downloadUrl: QUICKSTART_URL,
    dialogs: null,
  };
}
