// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { documentTypeLabel, type DocumentMeta } from "../../project/types";
import { languageLabel } from "../../locales/languages";

/**
 * Structure, language, type and genre as `document-properties.json`
 * records them: tags, not controls. The goal is absent; it belongs to
 * the shelf card, where progress gives it meaning.
 *
 * The editor cannot edit them; they change only from the Library card's
 * Properties window.
 */
export default function ProjectFacts({ document }: { document: DocumentMeta }) {
  const { t } = useTranslation();
  return (
    <div className="dt-meta">
      <span className="dt-tag">
        <span className="dt-tag-k">{t("tree.structure")}</span>
        <span className="dt-tag-v">
          {document.structure
            ? t(`create.shape.${document.structure}`)
            : t("create.shape.empty")}
        </span>
      </span>
      <span className="dt-tag">
        <span className="dt-tag-k">{t("settings.language")}</span>
        <span className="dt-tag-v">{languageLabel(document.language)}</span>
      </span>
      <span className="dt-tag">
        <span className="dt-tag-k">{t("create.typeLabel")}</span>
        <span className="dt-tag-v">{documentTypeLabel(document.type, t)}</span>
      </span>
      <span className="dt-tag">
        <span className="dt-tag-k">{t("genre.label")}</span>
        <span className="dt-tag-v">
          {document.genres.length
            ? document.genres.map((id) => t(`genre.name.${id}`)).join(" + ")
            : t("genre.unsaid")}
        </span>
      </span>
    </div>
  );
}
