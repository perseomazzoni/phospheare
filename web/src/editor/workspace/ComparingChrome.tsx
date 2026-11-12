// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import type { DiffDirection, DiffGranularity } from "../engine";
import type { EditorEngine } from "../views/engine";

/**
 * The snapshot comparison's chrome: the two lenses at the command bar's
 * horizon, and the legend card below them. The shell mounts it only while a
 * snapshot comparison is up.
 */
export function ComparingChrome({ engine }: { engine: EditorEngine }) {
  const { t } = useTranslation();
  return (
    <>
      {/* The lenses sit above the legend card, never inside it: the
        card is the legend, the lenses are instruments. Their labels are
        the controls' selected text. */}
      <div className="comparing-lenses">
        <select
          className="comparing-select"
          aria-label={t("snapshots.direction")}
          value={engine.diffDirection}
          onChange={(e) =>
            engine.setDiffDirection(e.target.value as DiffDirection)
          }
        >
          <option value="adoptedWithSelected">
            {t("snapshots.directionAdoptedFirst")}
          </option>
          <option value="selectedWithAdopted">
            {t("snapshots.directionSelectedFirst")}
          </option>
        </select>
        <select
          className="comparing-select"
          aria-label={t("snapshots.granularity")}
          value={engine.diffGranularity}
          onChange={(e) =>
            engine.setDiffGranularity(e.target.value as DiffGranularity)
          }
        >
          <option value="paragraph">
            {t("snapshots.granularityParagraph")}
          </option>
          <option value="sentence">{t("snapshots.granularitySentence")}</option>
          <option value="word">{t("snapshots.granularityWord")}</option>
        </select>
        {/* The way out belongs to the instruments, not the legend, so
          it sits beside the grain lens. */}
        <span className="comparing-exit">{t("snapshots.escHint")}</span>
      </div>

      {/* The legend card: the question names what the lens shows, and
        the two entries key the marks, the direction deciding which side
        each speaks for. With every hunk accepted the legend would
        describe marks that are gone, so it collapses to the completion
        line; that slot is `role="status"`, so the swap is announced. */}
      <div className="comparing-bar">
        <div className="comparing-legend-stack">
          {engine.diffHunks.length === 0 && engine.acceptsThisComparison > 0 ? (
            <p className="comparing-question" role="status">
              {t("snapshots.allAccepted")}
            </p>
          ) : (
            <>
              <p className="comparing-question">
                {engine.diffDirection === "adoptedWithSelected"
                  ? t("snapshots.questionAdoptedFirst")
                  : t("snapshots.questionSelectedFirst")}
              </p>
              <p className="comparing-legend">
                <span
                  className="comparing-swatch comparing-swatch-del"
                  aria-hidden="true"
                />
                <span>
                  {engine.diffDirection === "adoptedWithSelected"
                    ? t("snapshots.removedAdoptedFirst")
                    : t("snapshots.removedSelectedFirst")}
                </span>
              </p>
              <p className="comparing-legend">
                <span
                  className="comparing-swatch comparing-swatch-add"
                  aria-hidden="true"
                />
                <span>
                  {engine.diffDirection === "adoptedWithSelected"
                    ? t("snapshots.addedAdoptedFirst")
                    : t("snapshots.addedSelectedFirst")}
                </span>
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
