// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Dots, Icon, Tip } from "../../../ui";
import type { FileResult } from "../application/readFiles";
import { ACCEPT } from "../domain/formats";
import { MAX_FILES } from "../domain/limits";

// Step 1, which files: one row of cards, the chosen files in their order,
// then the card that is both the picker and the drop target, a `<label>`
// around a visually hidden file input, so a press, Enter or Space opens the
// platform's own chooser and a file dropped on it is taken the same way.
//
// Several files are a book in pieces, read in the order of the row, and the
// next step cannot reorder them, so the order is set and shown here: each
// file that will be read carries its place (1, 2, 3…), and the note under the
// row says why. A file left out says so on its card, and why under the row.

export interface FileRow {
  id: string;
  file: File;
  name: string;
  size: number;
  /** Null while it is being read. */
  result: FileResult | null;
}

export interface ChooseStepProps {
  rows: readonly FileRow[];
  /**
   * The read results after the set's own rules (too many, an epub among
   * other files), in row order; null while any file is still being read.
   */
  admitted: readonly FileResult[] | null;
  onAdd: (files: readonly File[]) => void;
  /** Swaps two files' places in the book. */
  onSwap: (id: string, withId: string) => void;
  onRemove: (id: string) => void;
}

/** A size the writer reads at a glance: KB under a megabyte, MB above. */
function sizeLabel(bytes: number, locale: string): string {
  const mb = bytes >= 1024 * 1024;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: mb ? "megabyte" : "kilobyte",
    maximumFractionDigits: mb ? 1 : 0,
  }).format(Math.max(1, bytes / (mb ? 1024 * 1024 : 1024)));
}

export default function ChooseStep({
  rows,
  admitted,
  onAdd,
  onSwap,
  onRemove,
}: ChooseStepProps) {
  const { t, i18n } = useTranslation();
  const inputId = useId();
  const [over, setOver] = useState(false);

  // Row i's answer: the set's verdict once everything is read, else its own.
  let readIndex = 0;
  const verdicts = rows.map((row) => {
    if (!row.result) return null;
    const verdict = admitted?.[readIndex] ?? row.result;
    readIndex += 1;
    return verdict;
  });
  // Each file's place in the book: a refused one has none, since it will
  // not be read.
  let place = 0;
  const places = verdicts.map((verdict) =>
    verdict?.status === "refused" ? null : ++place,
  );
  // An order exists once two files will be read. The arrows move a file
  // past its nearest neighbour that will also be read, so every press
  // changes a number; a refused file is in no order and has none.
  const ordered = place > 1;
  const neighbour = (index: number, by: -1 | 1): FileRow | undefined => {
    for (let i = index + by; i >= 0 && i < rows.length; i += by)
      if (places[i] !== null) return rows[i];
    return undefined;
  };

  return (
    <>
      <ul
        className="import-files"
        aria-label={t("import.filesLabel")}
        // A card clips what hangs outside it, its controls' tips included.
        data-tips-out=""
      >
        {rows.map((row, index) => {
          const verdict = verdicts[index];
          const refused = verdict?.status === "refused" ? verdict : null;
          const earlier =
            ordered && !refused ? neighbour(index, -1) : undefined;
          const later = ordered && !refused ? neighbour(index, 1) : undefined;
          return (
            <li
              key={row.id}
              className="import-file"
              data-refused={refused ? "1" : "0"}
              title={row.name}
            >
              <button
                type="button"
                className="import-file-remove"
                aria-label={t("import.remove", { name: row.name })}
                data-tip=""
                onClick={() => onRemove(row.id)}
              >
                <Icon name="x" size={12} aria-hidden="true" />
                <Tip label={t("import.removeTip")} />
              </button>
              <span className="import-file-body">
                <span className="import-file-format" aria-hidden="true">
                  {verdict?.format?.toUpperCase() ?? " "}
                </span>
                <span className="import-file-name">{row.name}</span>
                <span className="import-file-meta">
                  {verdict === null ? (
                    <Dots label={t("import.reading")} />
                  ) : refused ? (
                    t("import.leftOut")
                  ) : (
                    sizeLabel(row.size, i18n.language)
                  )}
                </span>
              </span>
              {ordered && places[index] !== null && (
                <span className="import-file-actions">
                  {earlier ? (
                    <Button
                      variant="icon"
                      aria-label={t("import.earlier", { name: row.name })}
                      data-tip=""
                      onClick={() => onSwap(row.id, earlier.id)}
                    >
                      <Icon
                        name="chevron"
                        size={15}
                        className="import-earlier"
                        aria-hidden="true"
                      />
                      <Tip label={t("import.earlierTip")} />
                    </Button>
                  ) : (
                    <span />
                  )}
                  <span className="import-file-place" aria-hidden="true">
                    {places[index]}
                  </span>
                  {later ? (
                    <Button
                      variant="icon"
                      aria-label={t("import.later", { name: row.name })}
                      data-tip=""
                      onClick={() => onSwap(row.id, later.id)}
                    >
                      <Icon
                        name="chevron"
                        size={15}
                        className="import-later"
                        aria-hidden="true"
                      />
                      <Tip label={t("import.laterTip")} />
                    </Button>
                  ) : (
                    <span />
                  )}
                </span>
              )}
            </li>
          );
        })}
        <li className="import-files-add">
          <label
            htmlFor={inputId}
            className="import-drop"
            data-over={over ? "1" : "0"}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              const files = [...event.dataTransfer.files];
              if (files.length) onAdd(files);
            }}
          >
            <Icon name="plus" size={20} aria-hidden="true" />
            <span className="import-drop-title">
              {rows.length ? t("import.drop.more") : t("import.drop.title")}
            </span>
            <input
              id={inputId}
              type="file"
              multiple
              accept={ACCEPT}
              className="ui-visually-hidden"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                // Cleared, so choosing the same file again (after removing
                // it) is a change the input still reports.
                event.target.value = "";
                if (files.length) onAdd(files);
              }}
            />
          </label>
        </li>
      </ul>
      {/* Why a file is left out is a sentence, too long for its card (which
          says only that it is): each one is said under the row, naming its
          file. */}
      {rows.map((row, index) => {
        const verdict = verdicts[index];
        return verdict?.status === "refused" ? (
          <p key={row.id} className="import-file-why">
            <span className="import-file-why-name">{row.name}</span>{" "}
            {t(`import.refused.${verdict.reason}`, { max: MAX_FILES })}
          </p>
        ) : null;
      })}
      <p className="ui-input-note">
        {ordered ? t("import.several") : t("import.drop.sub")}
      </p>
    </>
  );
}
