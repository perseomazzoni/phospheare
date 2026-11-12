// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { forwardRef, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input, Select, type SelectOption } from "../ui";
import {
  AGE_CATEGORIES,
  GENRE_IDS,
  TROPE_LIMIT,
  TROPE_MAX,
  parseTropes,
  type AgeCategory,
  type GenreId,
} from "../project/genres";

// The genre declaration as fields, shared by the create wizard's Genre step
// and the Library's Properties window. A genre is changeable after
// creation, because a writer often finds out what they are writing by
// writing it.
//
// Every field opens on "not said". A preselected genre would guess at the
// book before its title exists, as a preselected structure would, and the
// assistant would read the book against a promise nobody made.
//
// Selects, not chips: the genres and readerships are short closed lists, and
// the platform's own control is the one every writer can keyboard.
//
// The tropes are the one open field: the writer's own words, separated by
// commas. The text stays as typed, since a trailing comma is a trope about to
// be named, and the list is what the text declares.

/** The value of a select that says nothing: an unset genre or readership. */
const UNSAID = "";

export interface GenreValue {
  genres: GenreId[];
  ageCategory: AgeCategory | null;
  tropes: string[];
}

interface Props {
  value: GenreValue;
  onChange: (next: GenreValue) => void;
}

const GenreFields = forwardRef<HTMLSelectElement, Props>(function GenreFields(
  { value, onChange },
  ref,
) {
  const { t } = useTranslation();
  const [lead, blend] = value.genres;
  const [tropesText, setTropesText] = useState(() => value.tropes.join(", "));

  const genres: SelectOption<GenreId | typeof UNSAID>[] = useMemo(
    () => [
      { value: UNSAID, label: t("genre.unsaid") },
      ...GENRE_IDS.map((id) => ({ value: id, label: t(`genre.name.${id}`) })),
    ],
    [t],
  );
  // The blend never offers the lead again: "fantasy with elements of
  // fantasy" is not a second promise.
  const blends = useMemo(
    () =>
      genres
        .filter((option) => option.value !== lead)
        .map((option) =>
          option.value === UNSAID
            ? { ...option, label: t("genre.noBlend") }
            : option,
        ),
    [genres, lead, t],
  );
  const ages: SelectOption<AgeCategory | typeof UNSAID>[] = useMemo(
    () => [
      { value: UNSAID, label: t("genre.unsaid") },
      ...AGE_CATEGORIES.map((id) => ({
        value: id,
        label: t(`genre.age.${id}`),
      })),
    ],
    [t],
  );

  const setGenres = (next: (GenreId | typeof UNSAID | undefined)[]) =>
    onChange({
      ...value,
      genres: next.filter((id): id is GenreId => !!id),
    });

  return (
    <div className="create-grid">
      <Select
        ref={ref}
        label={t("genre.label")}
        options={genres}
        value={lead ?? UNSAID}
        // Clearing the lead clears the blend, which would otherwise become
        // the lead without the writer choosing it.
        onChange={(next) => setGenres(next ? [next, blend] : [])}
        note={t("genre.note")}
      />
      {lead && (
        <Select
          label={t("genre.blendLabel")}
          options={blends}
          value={blend ?? UNSAID}
          onChange={(next) => setGenres([lead, next])}
        />
      )}
      {/* Beside the lead when there is no blend; across the row when the
          blend takes the lead's other half, since alone in a half row it
          reads as a field missing beside it. */}
      <div className={lead ? "create-wide" : undefined}>
        <Select
          label={t("genre.ageLabel")}
          options={ages}
          value={value.ageCategory ?? UNSAID}
          onChange={(next) => onChange({ ...value, ageCategory: next || null })}
        />
      </div>
      <div className="create-wide">
        <Input
          label={t("genre.tropesLabel")}
          value={tropesText}
          maxLength={TROPE_LIMIT * (TROPE_MAX + 2)}
          placeholder={t("genre.tropesPlaceholder")}
          // The list the text declares, as the readers will be asked about
          // it, so the writer sees where the commas cut and where the list
          // stops.
          evidence={value.tropes.length ? value.tropes.join(" · ") : undefined}
          onChange={(event) => {
            setTropesText(event.target.value);
            onChange({ ...value, tropes: parseTropes(event.target.value) });
          }}
        />
      </div>
    </div>
  );
});

export default GenreFields;
