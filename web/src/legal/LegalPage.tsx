// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { LEGAL_SET } from "./compose";
import type { LegalDocument } from "./domain/documents";
import { legalVariables } from "./domain/facts";
import { LEGAL_PATHS } from "./domain/paths";
import LegalText from "./LegalText";

// A legal text as a public page, on the plain page shell, readable signed in
// or not. The build's other texts are linked at its foot.

export default function LegalPage({ document }: { document: LegalDocument }) {
  const { t, i18n } = useTranslation();
  const values = legalVariables(i18n.language);
  const others = LEGAL_SET.filter((other) => other.id !== document.id);
  return (
    <div className="page">
      <article className="page-inner legal-page">
        <a className="ui-text-link" href="/">
          {t("auth.backHome")}
        </a>
        <h1 className="page-title">{t(`legal.${document.text}.title`)}</h1>
        <p className="page-hint">
          {t(`legal.${document.text}.lede`, values)}{" "}
          {t("legal.page.updated", values)}
        </p>
        <LegalText document={document} level={2} />
        <nav className="page-hint" aria-label={t("legal.links.label")}>
          {others.map((other, index) => (
            <span key={other.id}>
              {index > 0 && <span aria-hidden="true"> · </span>}
              <Link to={LEGAL_PATHS[other.id]}>
                {t(`legal.links.${other.id}`)}
              </Link>
            </span>
          ))}
        </nav>
      </article>
    </div>
  );
}
