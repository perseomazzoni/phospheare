// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "../../../ui";
import { DEMO_PATH } from "./content";

/**
 * The sample-project path, with the account path and the way in without an
 * account beside it when their handlers are given, and the price and the
 * paths' terms on one line beneath. The note's last term is the Google
 * sign-in's, so it is left out when `withGoogle` is false. The demo site
 * gives the program's download in place of the account paths.
 */
export default function EntryActions({
  withGoogle,
  onStart,
  onWithoutAccount,
  downloadUrl,
}: {
  withGoogle: boolean;
  onStart?: () => void;
  onWithoutAccount?: () => void;
  downloadUrl?: string;
}) {
  const { t } = useTranslation();
  const terms = t("landing.hero.note").split(" · ");
  if (!withGoogle) terms.pop();
  return (
    <div className="landing-cta">
      <div className="landing-cta-buttons">
        {onStart && (
          <Button variant="primary" onClick={onStart}>
            {t("landing.hero.start")}
          </Button>
        )}
        {downloadUrl && (
          <a
            className="ui-btn ui-btn-primary"
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("landing.download")}
          </a>
        )}
        <Link className="ui-btn ui-btn-outline" to={DEMO_PATH}>
          {t("landing.hero.try")}
        </Link>
        {onWithoutAccount && (
          <Button variant="ghost" onClick={onWithoutAccount}>
            {t("landing.withoutAccount")}
          </Button>
        )}
      </div>
      {/* A narrow screen breaks the line between its terms first. A term
          wider than the screen then wraps inside its own box. */}
      <p className="landing-cta-note">
        {terms.map((term, index) => (
          <span key={term}>
            {index > 0 && " "}
            <span className="landing-cta-term">
              {index < terms.length - 1 ? `${term} ·` : term}
            </span>
          </span>
        ))}
      </p>
    </div>
  );
}
