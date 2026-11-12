// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, Dots, Input, Select, type SelectOption } from "../../ui";
import type { ProjectFacts } from "../../project/facts";
import { folderNameFor } from "../../project/naming";
import { NO_STRUCTURE, type ShapeId } from "../../project/startingShape";
import { DOCUMENT_LANGUAGES } from "../../locales/languages";
import GenreFields, { type GenreValue } from "../../projectSetup/GenreFields";
import TitleField, {
  readTitle,
  type TitleCheck,
} from "../../projectSetup/TitleField";
import TypeGoalFields, {
  readTypeGoal,
  typeGoalFor,
  type TypeGoalValue,
} from "../../projectSetup/TypeGoalFields";
import { shapeOptions } from "../../projectSetup/projectOptions";

// A project's properties, changed after creation: every question the
// creation wizard asked about a book, on one page opened from the Library
// card. The editor shows the facts as tags and opens nothing. The export
// window may also correct the author on the way out (`author.ts`); both write
// through `withFacts`, the facts' one guarded write.
//
// The fields are the wizard's own (`TitleField`, `TypeGoalFields`,
// `GenreFields`, the structure list), in its pairs and order, so a writer
// recognises them and the two homes cannot drift. Two differences:
//
// - The goal never follows the type. The stored goal is already the writer's,
//   and a book stored with no goal may stay without one.
// - The title is checked only for what it is about to do (`TitleField`): an
//   unchanged title not at all, a device book's new title as a title (its
//   folder keeps its name), and a title whose folder follows by folder rules.
//   A book whose title spells another book's folder can still change genre.
//
// The answers are held locally until Save, so Cancel, Escape and the backdrop
// leave the book as it was. Save keeps the window open and busy until the
// write lands, so a failure shows here with every answer still in the fields.
//
// The structure is a label: changing it changes what the book declares, which
// the assistant reads, and leaves the writer's Parts where they are. The note
// under it says so.

interface Props {
  /** What the book says today; `null` while it is being read. */
  facts: ProjectFacts | null;
  /** The book could not be read: the window says so and can only be closed. */
  failed: boolean;
  /** A save is being written: the window waits, busy, and cannot be left. */
  saving: boolean;
  /** The last save's failure, shown inside the window. */
  saveError: string | null;
  /** Whether the backend renames a book's folder when its title changes. */
  folderFollowsTitle: boolean;
  /** The folder's name today, which a folder that does not follow keeps. */
  folder: string;
  /** Folder names already on the shelf, minus this project's own. */
  taken: Set<string>;
  onSave: (next: ProjectFacts) => void;
  onCancel: () => void;
}

/** The window's answers, as the fields hold them. */
interface Draft {
  title: string;
  author: string;
  typeGoal: TypeGoalValue;
  language: string;
  structure: ShapeId;
  genre: GenreValue;
}

function draftOf(facts: ProjectFacts): Draft {
  return {
    title: facts.title,
    author: facts.author,
    typeGoal: typeGoalFor(facts.type, facts.goal),
    language: facts.language,
    // The file keeps "No structure" as null (`asStructureId`), and only a
    // known id survives the read, so anything stored is a ShapeId.
    structure: (facts.structure ?? NO_STRUCTURE) as ShapeId,
    genre: {
      genres: facts.genres,
      ageCategory: facts.ageCategory,
      tropes: facts.tropes,
    },
  };
}

export default function ProjectPropertiesDialog({
  facts,
  failed,
  saving,
  saveError,
  folderFollowsTitle,
  folder,
  taken,
  onSave,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft | null>(() =>
    facts ? draftOf(facts) : null,
  );
  // The facts arrive after the window opens. The draft takes them once, on
  // arrival, or a re-render would discard what the writer typed.
  if (facts && !draft) setDraft(draftOf(facts));

  const [customTouched, setCustomTouched] = useState(false);
  const titleField = useRef<HTMLInputElement>(null);
  const goalField = useRef<HTMLInputElement>(null);
  const customField = useRef<HTMLInputElement>(null);

  // `initialFocus` runs on open, before the fields exist, so focus would fall
  // to Cancel and a reflexive Enter would leave. The title takes focus,
  // selected, when the fields arrive, because renaming is the commonest
  // reason to come here.
  const focused = useRef(false);
  const hasDraft = draft !== null;
  useEffect(() => {
    if (!hasDraft || focused.current) return;
    focused.current = true;
    titleField.current?.focus();
    titleField.current?.select();
  }, [hasDraft]);

  const shapes: SelectOption<ShapeId>[] = useMemo(() => shapeOptions(t), [t]);
  // A language the list lacks (the file is hand-editable) is still the
  // book's, so it is offered as itself rather than shown as another.
  const storedLanguage = facts?.language;
  const languages = useMemo(
    () =>
      storedLanguage &&
      !DOCUMENT_LANGUAGES.some((option) => option.value === storedLanguage)
        ? [
            ...DOCUMENT_LANGUAGES,
            { value: storedLanguage, label: storedLanguage },
          ]
        : DOCUMENT_LANGUAGES,
    [storedLanguage],
  );

  const title = draft?.title ?? "";
  const titleChanged = !!facts && title.trim() !== facts.title.trim();
  const check: TitleCheck = !titleChanged
    ? "none"
    : folderFollowsTitle
      ? "folder"
      : "title";
  const titleReading = readTitle(title, check, taken);
  const typeGoal = draft
    ? readTypeGoal(draft.typeGoal, { goalOptional: facts?.goal === null })
    : null;
  const ready = !!typeGoal?.ready && titleReading.ready;

  const change = (next: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));
  const changeTypeGoal = (next: Partial<TypeGoalValue>) =>
    setDraft((current) =>
      current
        ? { ...current, typeGoal: { ...current.typeGoal, ...next } }
        : current,
    );

  const save = () => {
    if (!draft || !typeGoal || saving) return;
    if (!ready) {
      // A gated press answers with the reason and the field, never silence.
      if (typeGoal.otherNeedsText) {
        setCustomTouched(true);
        customField.current?.focus();
      } else if (!typeGoal.ready) goalField.current?.focus();
      else titleField.current?.focus();
      return;
    }
    // As the fields hold them; `withFacts` trims and guards on the way in.
    onSave({
      title: draft.title,
      author: draft.author,
      type: typeGoal.stored,
      goal: typeGoal.goal,
      language: draft.language,
      structure: draft.structure === NO_STRUCTURE ? null : draft.structure,
      genres: draft.genre.genres,
      ageCategory: draft.genre.ageCategory,
      tropes: draft.genre.tropes,
    });
  };

  // An unread book leaves nothing to save or cancel: the window says why and
  // offers the one way out.
  if (failed) {
    return (
      <Dialog
        open
        title={t("library.propertiesTitle")}
        confirmLabel={t("library.propertiesClose")}
        cancelHidden
        className="ui-dialog--wizard"
        onConfirm={onCancel}
        onCancel={onCancel}
      >
        <p className="ui-input-note ui-input-note-bad" role="alert">
          {t("library.unreadable")}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      title={t("library.propertiesTitle")}
      confirmLabel={t("library.propertiesSave")}
      confirmDisabled={!ready || saving}
      confirmBusy={saving}
      cancelDisabled={saving}
      dismissible={!saving}
      className="ui-dialog--wizard"
      initialFocus={() => titleField.current}
      onConfirm={save}
      onCancel={onCancel}
    >
      {!draft || !typeGoal ? (
        // The export window's face while its book opens: the same signal
        // for the same wait.
        <p className="ui-input-note">
          <Dots label={t("library.propertiesReading")} />
        </p>
      ) : (
        <form
          className="ui-step"
          onSubmit={(event) => {
            // Enter in any field saves, through the same gate as the button.
            event.preventDefault();
            save();
          }}
        >
          <div className="create-grid">
            <TitleField
              ref={titleField}
              label={t("library.titleLabel")}
              value={draft.title}
              onChange={(value) => change({ title: value })}
              reading={titleReading}
              // The folder after the save: renamed only when the title
              // changes on a backend that can rename it; otherwise as today.
              folderLine={
                titleChanged && folderFollowsTitle
                  ? {
                      lead: t("library.folderBecomes"),
                      folder: folderNameFor(draft.title),
                    }
                  : { lead: t("library.folderKeeps"), folder }
              }
            />
            <Input
              label={t("create.authorLabel")}
              autoComplete="off"
              value={draft.author}
              onChange={(event) => change({ author: event.target.value })}
            />
          </div>
          <TypeGoalFields
            value={draft.typeGoal}
            reading={typeGoal}
            onType={(type) => changeTypeGoal({ type })}
            onCustomType={(customType) => changeTypeGoal({ customType })}
            onGoal={(goalText) => changeTypeGoal({ goalText })}
            customTouched={customTouched}
            onCustomTouched={() => setCustomTouched(true)}
            goalRef={goalField}
            customRef={customField}
          />
          <div className="create-grid">
            <Select
              label={t("create.structureLabel")}
              options={shapes}
              value={draft.structure}
              onChange={(structure) => change({ structure })}
              note={t("library.structureNote")}
            />
            <Select
              label={t("create.languageLabel")}
              options={languages}
              value={draft.language}
              onChange={(language) => change({ language })}
              note={t("create.languageNote")}
            />
          </div>
          <GenreFields
            value={draft.genre}
            onChange={(genre) => change({ genre })}
          />
          {saveError && (
            <p className="ui-input-note ui-input-note-bad" role="alert">
              {saveError}
            </p>
          )}
          {/* A visually hidden submit button, so implicit submission on
              Enter is the browser's own. */}
          <button
            type="submit"
            className="ui-visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
          />
        </form>
      )}
    </Dialog>
  );
}
