// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  Input,
  JobProgress,
  Pick,
  Select,
  StepRail,
  type SelectOption,
} from "../ui";
import { folderNameFor } from "../project/naming";
import {
  NO_STRUCTURE,
  partKeysFor,
  startingShape,
  type ShapeId,
  type StartingShape,
} from "../project/startingShape";
import {
  documentTypeLabel,
  DEFAULT_DOCUMENT_TYPE,
  TYPE_GOAL_DEFAULTS,
  OTHER_DOCUMENT_TYPE,
} from "../project/types";
import { DOCUMENT_LANGUAGES } from "../locales/languages";
import { CREATE_STEPS } from "../project/createSteps";
import { appIcons } from "../ui/appIcons";
import { useBackCloses } from "../ui/overlay/useBackCloses";
import type { AgeCategory, GenreId } from "../project/genres";
import GenreFields, { type GenreValue } from "./GenreFields";
import TypeGoalFields, { readTypeGoal } from "./TypeGoalFields";
import TitleField, { readTitle } from "./TitleField";
import { shapeOptions } from "./projectOptions";
import {
  defaultDestination,
  destinationHintKey,
  destinationOptions,
  destinationUsable,
  type Destination,
  type DestinationFacts,
} from "./destinations";

/**
 * The creation job as the dialog sees it: `index` is the `CREATE_STEPS` slot
 * being worked. The dialog draws one segment per catalogue row, so a new step
 * is one row there.
 */
export interface CreateProgress {
  index: number;
  /**
   * Files written of the shape's total while the documents segment runs; an
   * import of many chapters is a wait worth counting.
   */
  detail?: { done: number; total: number };
}

// The wizard that starts a project: five questions, one per step.
//
// 1. Where it lives. Real places only: Remote Storage when connected, Local
//    when the browser can write the disk and a root is mapped. Without a
//    mapped root the local destination shows disabled with its hint, because
//    the folder is a setup choice made in Settings, never asked by creation.
//    With no destination at all the step cannot advance, and a note points at
//    Settings.
// 2. Structure and language. Every shape on offer is Parts holding nothing
//    yet, so no choice breaks the Golden Rule. This step only chooses, and
//    shows the shape's description and the Parts it will write.
// 3. Type and goal, persisted to `document-properties.json` at creation. Other
//    stores what the writer typed, never the word "Other". The goal is a
//    required integer, because the spine is measured against it. It opens on
//    the type's top-of-range, and a goal the writer types is never
//    overwritten by a later type change.
// 4. Genre and readers: the promise the book makes, declared by the writer so
//    the assistant reads the book against it rather than an assumed genre.
//    Every field opens on "not said" and the step never gates.
// 5. The title, with the folder it produces under it. A mono recap restates
//    the earlier answers, which are off-screen at the moment of commit.
//
// When the Library can import, a first question asks how to start: Blank, the
// default, or From a manuscript, which closes this wizard and opens the import
// window. It is drawn only when `onImport` is given, because a step whose
// every choice does nothing is not a step.
//
// A window with its own questions hands them in as `lead` (for the import:
// which files, and where the manuscript divides). The wizard asks them first,
// on the same rail with the same Back, then its own, so an imported project
// and a blank one share the code. The source forces two differences: no
// structure to choose, so step 2 asks the language alone, and the last step
// names the author. The source's `proposal` (title, author, language, type,
// goal) stands until the writer changes it.
//
// The steps open on their defaults. A preselected scaffold would claim how the
// writer works before they typed a title, and a beginner accepts it. Every
// default present mirrors a choice the writer already made: the mapped root,
// the interface's language, the type's goal range.

export interface CreateRequest {
  title: string;
  folderName: string;
  destination: Destination;
  shape: StartingShape;
  /** Persisted verbatim into `document-properties.json`. */
  structureId: ShapeId;
  /**
   * The document type as stored: a named option, or the custom text for Other.
   */
  type: string;
  language: string;
  /** The word target, required: the type-and-goal step gates on it. */
  goal: number;
  /** The declared genres, lead first; empty when the writer said none. */
  genres: GenreId[];
  ageCategory: AgeCategory | null;
  /** The tropes the writer means to deliver; empty when they said none. */
  tropes: string[];
  /** Asked only of a project made from a source (`lead`). */
  author?: string;
}

/**
 * A question a source asks before the wizard's own. Its body is drawn inside
 * the wizard's form, so Enter advances through it like any other step.
 */
export interface LeadStep {
  title: string;
  lede?: string;
  ready: boolean;
  body: ReactNode;
}

/**
 * What the source suggests for the wizard's own questions. Each stands until
 * the writer changes it.
 */
export interface ProjectProposal {
  title: string;
  author: string;
  language: string;
  type: string;
  /** The goal to propose for a type, while the writer has typed none. */
  goalFor(type: string): number | undefined;
}

/** A project made from something: the source's own questions, first. */
export interface WizardLead {
  /** The dialog's name. */
  label: string;
  /** The heading while the project is made. */
  making: string;
  /** The last step's button. */
  confirm: string;
  steps: readonly LeadStep[];
  /** Null until the source has been read. */
  proposal: ProjectProposal | null;
}

interface Props {
  open: boolean;
  driveConnected: boolean;
  email: string;
  /**
   * Whether this browser can hold a local root at all. False on Firefox and
   * Safari, where the disk is not a destination.
   */
  localAvailable: boolean;
  /** Whether a local root has been chosen; decides the local row's hint. */
  localRootReady: boolean;
  /** Whether Remote Storage can be connected; false without Google. */
  remoteAvailable: boolean;
  /**
   * Folder names already in the library, so a clash is caught before the
   * picker.
   */
  taken: Set<string>;
  onCreate: (request: CreateRequest) => void;
  /**
   * Opens the import window instead. Given, the wizard starts by asking how.
   */
  onImport?: () => void;
  /**
   * Questions asked before the wizard's own, by the source a project is made
   * from. Given, there is no "How do you start?" and no structure.
   */
  lead?: WizardLead;
  onCancel: () => void;
  /**
   * The creation job in flight. Non-null turns the dialog into the job's
   * progress face: the rail and the fields unmount, the confirm becomes the
   * dots, and the dialog is not dismissible, because an interrupted create
   * leaves a half-made folder.
   */
  progress: CreateProgress | null;
  /**
   * The last attempt's failure, stated inside the dialog where the press was
   * made. The wizard keeps every choice, so retry is one press.
   */
  createError: string | null;
}

/** The five steps' questions, each in the dialog's own title slot. */
const STEP_TITLES = [
  "create.whereLabel",
  "create.stepStructure",
  "create.stepKind",
  "create.stepGenre",
  "create.nameLabel",
] as const;

/** The name step, which commits: every step before it advances. */
const LAST = STEP_TITLES.length - 1;

export default function CreateProjectDialog({
  open,
  driveConnected,
  email,
  localAvailable,
  localRootReady,
  remoteAvailable,
  taken,
  onCreate,
  onImport,
  lead,
  onCancel,
  progress,
  createError,
}: Props) {
  const { t, i18n } = useTranslation();

  // The step: 0 Where, 1 Structure and Language, 2 Type and Goal, 3 Genre and
  // Readers, 4 the title. All answer state lives beside it, so Back forgets
  // nothing and the final submit reads everything at once. -1 is "How do you
  // start?", asked only when the dialog offers an import. A source's own
  // questions take the negative steps instead, the first at minus their count.
  const leads = lead?.steps ?? [];
  const FIRST = lead ? -leads.length : onImport ? -1 : 0;
  const [step, setStep] = useState(FIRST);
  const leadStep = lead && step < 0 ? leads[step + leads.length] : null;
  const proposal = lead?.proposal ?? null;
  const [start, setStart] = useState<"blank" | "manuscript">("blank");

  // Every answer a source can propose is held as what the writer typed, null
  // until they do. The proposal shows until then, and a proposal that arrives
  // late, while the file is still being read, is not lost to a state
  // initialised before it.
  const [typedTitle, setTitle] = useState<string | null>(null);
  const title = typedTitle ?? proposal?.title ?? "";
  const [typedAuthor, setAuthor] = useState<string | null>(null);
  const author = typedAuthor ?? proposal?.author ?? "";
  // The local device leads whenever it is a real destination; Remote Storage
  // leads only when local is impossible.
  const facts: DestinationFacts = {
    driveConnected,
    email,
    localAvailable,
    localRootReady,
    remoteAvailable,
  };
  const [destination, setDestination] = useState<Destination>(() =>
    defaultDestination(facts),
  );
  const [shape, setShape] = useState<ShapeId>(NO_STRUCTURE);
  // The interface's language is the best guess for the project's when the
  // document language list contains it; otherwise English.
  const [chosenLanguage, setLanguage] = useState<string | null>(null);
  const uiBase = i18n.language.split("-")[0];
  const language =
    chosenLanguage ??
    proposal?.language ??
    (DOCUMENT_LANGUAGES.some((l) => l.value === uiBase)
      ? uiBase
      : DOCUMENT_LANGUAGES[0].value);
  // A named option verbatim, or Other, whose text is what is stored.
  const [chosenType, setType] = useState<string | null>(null);
  const type = chosenType ?? proposal?.type ?? DEFAULT_DOCUMENT_TYPE;
  const [customType, setCustomType] = useState("");
  // The Other field's refusal waits for a touch: selecting Other is not yet a
  // mistake, and the placeholder names what is wanted. The problem shows once
  // the writer leaves the field empty after typing or blurring, or presses
  // Continue with it empty; a gated press reveals and focuses.
  const [customTouched, setCustomTouched] = useState(false);
  // The goal opens on the type's top-of-range, or what the source proposes
  // for it, never less than its length, and follows the type until the writer
  // types their own. Other has no guidance, so no prefill.
  const [typedGoal, setTypedGoal] = useState<string | null>(null);
  const goalFor =
    proposal?.goalFor ?? ((named: string) => TYPE_GOAL_DEFAULTS[named]);
  const goalText =
    typedGoal ??
    (type === OTHER_DOCUMENT_TYPE ? "" : String(goalFor(type) ?? ""));
  const [genre, setGenre] = useState<GenreValue>({
    genres: [],
    ageCategory: null,
    tropes: [],
  });
  const name = useRef<HTMLInputElement>(null);
  const structure = useRef<HTMLSelectElement>(null);
  const typeField = useRef<HTMLSelectElement>(null);
  const goalField = useRef<HTMLInputElement>(null);
  const genreField = useRef<HTMLSelectElement>(null);
  const customField = useRef<HTMLInputElement>(null);
  const languageField = useRef<HTMLSelectElement>(null);
  const form = useRef<HTMLFormElement>(null);
  /** The field each of the wizard's own steps opens on, after Where. */
  const leading = () =>
    [lead ? languageField : structure, typeField, genreField, name][step - 1]
      ?.current ?? null;
  /** A source's step opens on its first field, whatever the source drew. */
  const leadField = () =>
    form.current?.querySelector<HTMLElement>(".pick input:checked") ??
    form.current?.querySelector<HTMLElement>(
      "input:not(:disabled, [type='file']), select, button:not(:disabled, [tabindex='-1'])",
    ) ??
    null;

  const folder = folderNameFor(title);
  // A folder takes the title's name, so the title is held to folder rules.
  const titleReading = readTitle(title, "folder", taken);

  const shapes: SelectOption<ShapeId>[] = useMemo(() => shapeOptions(t), [t]);

  /** The Parts this choice will write, in order. */
  const partTitles = useMemo(
    () => partKeysFor(shape).map((key) => t(key)),
    [shape, t],
  );

  const typeGoal = { type, customType, goalText };
  const typeGoalReading = readTypeGoal(typeGoal);
  const {
    stored: storedType,
    goal,
    goalEmpty,
    goalUnusable,
    otherNeedsText,
    ready: typeGoalReady,
  } = typeGoalReading;
  const titleReady = titleReading.ready;

  const destinationReady = destinationUsable(destination, facts);
  const destinations = destinationOptions(facts, t);
  const destinationHint = destinationHintKey(facts);

  /** Whether a step's answer lets its Continue and Enter advance. */
  const stepReady = (index: number): boolean => {
    if (index < 0) return lead ? leads[index + leads.length].ready : true;
    if (index === 0) return destinationReady;
    // No gate on the structure step: "No structure" is a real answer, and a
    // gate would force a scaffold on the writer.
    if (index === 1) return true;
    if (index === 2) return typeGoalReady;
    // No gate on the genre step, for the same reason.
    if (index === 3) return true;
    return titleReady && destinationReady;
  };

  const creating = progress !== null;

  // Focus follows the wizard: `initialFocus` fires only on open, and every
  // advance and Back lands the keyboard on the new step's question, the
  // first reachable destination on Where and the leading field on the rest.
  useEffect(() => {
    if (!open) return;
    if (leadStep) {
      leadField()?.focus();
      return;
    }
    if (step === -1) {
      document.querySelector<HTMLInputElement>(".pick input:checked")?.focus();
      return;
    }
    if (step === 0) {
      // The first reachable destination: the visually hidden radio under the
      // first enabled card. A disabled root is not a choice to land on.
      (
        document.querySelector(
          ".pick input:not(:disabled)",
        ) as HTMLInputElement | null
      )?.focus();
      return;
    }
    leading()?.focus();
    // The refs and the lead are read on arrival: focus moves when the step
    // does, not when a proposal lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, open]);

  // The recap of the earlier answers at the commit moment: the structure
  // label verbatim, including "No structure", the type as stored, the goal
  // only when set, the language by its own name. The destination is absent,
  // because its own step already stated it.
  const recap = useMemo(() => {
    // A project made from a source has no structure to restate, and its
    // length beside the goal would be two word counts in one line.
    const parts: string[] = proposal ? [] : [t(`create.shape.${shape}`)];
    parts.push(documentTypeLabel(storedType, t));
    if (goal !== null) {
      parts.push(t("create.recapGoal", { count: goal.toLocaleString() }));
    }
    // Only what was said: an undeclared genre is absent, not "no genre".
    if (genre.genres.length)
      parts.push(genre.genres.map((id) => t(`genre.name.${id}`)).join(" + "));
    const lang = DOCUMENT_LANGUAGES.find((l) => l.value === language);
    parts.push(lang?.label ?? language);
    return parts.join(" · ");
  }, [t, shape, proposal, storedType, goal, genre, language]);

  /**
   * The one path for the footer's primary and Enter: advance on every step
   * but the last, create on the last.
   */
  const handleSubmit = () => {
    if (creating) return;
    if (step === -1 && !lead) {
      if (start === "manuscript") onImport?.();
      else setStep(0);
      return;
    }
    if (step < LAST) {
      if (!stepReady(step)) return revealGate();
      setStep(step + 1);
      return;
    }
    if (!stepReady(LAST)) return;
    // Unreachable past the type-and-goal gate, but the request's type says
    // `number`.
    if (goal === null) return;
    onCreate({
      title: title.trim(),
      folderName: folder,
      destination,
      shape: startingShape(partTitles),
      structureId: shape,
      type: storedType,
      language,
      goal,
      genres: genre.genres,
      ageCategory: genre.ageCategory,
      tropes: genre.tropes,
      ...(lead ? { author: author.trim() } : {}),
    });
  };

  /** A gated press answers with the reason and the field, never silence. */
  const revealGate = () => {
    if (otherNeedsText) {
      setCustomTouched(true);
      customField.current?.focus();
    } else if (goalUnusable || goalEmpty) {
      goalField.current?.focus();
    }
  };

  // Escape and the backdrop go back one step, so the panic key never undoes
  // more than the last action, and cancel only on the first step. The
  // footer's left button runs the same handler.
  const dismiss = () => {
    if (creating) return;
    if (step === FIRST) onCancel();
    else setStep(step - 1);
  };

  return (
    <Dialog
      open={open}
      // The heading asks the step's question, except on the job face, where
      // it names the work being done. The heading also names the dialog for
      // a screen reader.
      title={
        creating
          ? (lead?.making ?? t("create.creating"))
          : leadStep
            ? leadStep.title
            : step === -1
              ? t("create.start.title")
              : step === 1 && lead
                ? t("create.stepLanguage")
                : t(STEP_TITLES[step])
      }
      lede={creating ? undefined : leadStep?.lede}
      // The accessible name follows the heading's question; this constant
      // is the label for a render with no title.
      label={lead?.label ?? t("create.title")}
      confirmLabel={
        step < LAST
          ? t("create.continue")
          : (lead?.confirm ?? t("create.confirm"))
      }
      confirmDisabled={creating || !stepReady(step)}
      confirmBusy={creating}
      cancelLabel={step === FIRST ? undefined : t("create.back")}
      className="ui-dialog--wizard"
      dismissible={!creating}
      // On open, the same landing the focus effect gives every step change.
      initialFocus={() => {
        if (leadStep) return leadField();
        if (step === -1)
          return document.querySelector<HTMLInputElement>(
            ".pick input:checked",
          );
        if (step === 0) {
          return document.querySelector<HTMLInputElement>(
            ".pick input:not(:disabled)",
          );
        }
        return leading();
      }}
      onConfirm={handleSubmit}
      onCancel={dismiss}
    >
      {creating && progress ? (
        <Fragment key="progress">
          <JobProgress
            steps={CREATE_STEPS.map((stepRow) => t(stepRow.labelKey))}
            current={progress.index}
            detail={
              progress.detail
                ? t("create.progressCount", {
                    done: progress.detail.done.toLocaleString(),
                    total: progress.detail.total.toLocaleString(),
                  })
                : undefined
            }
          />
        </Fragment>
      ) : (
        <Fragment key="wizard">
          <BackGesture key={step} onBack={dismiss} />
          <StepRail count={STEP_TITLES.length - FIRST} current={step - FIRST} />
          <form
            ref={form}
            className="ui-step"
            onSubmit={(event) => {
              // Enter in any field advances, or commits on the last step,
              // through the footer primary's gate. A real form leaves
              // implicit submission to the browser.
              event.preventDefault();
              handleSubmit();
            }}
          >
            {leadStep?.body}

            {step === -1 && !lead && (
              <div
                className="picks"
                role="radiogroup"
                aria-label={t("create.start.title")}
              >
                <Pick
                  group="create-start"
                  on={start === "blank"}
                  icon={appIcons.add}
                  name={t("create.start.blank")}
                  sub={t("create.start.blankSub")}
                  onChoose={() => setStart("blank")}
                />
                <Pick
                  group="create-start"
                  on={start === "manuscript"}
                  icon={appIcons.importFile}
                  name={t("create.start.manuscript")}
                  sub={t("create.start.manuscriptSub")}
                  onChoose={() => setStart("manuscript")}
                />
              </div>
            )}

            {step === 0 && (
              <div className="ui-input-field">
                {/* One place is a fact, not a choice: no radiogroup, and the
                    card stands checked when it is usable. */}
                <div
                  className="picks"
                  role={destinations.length > 1 ? "radiogroup" : undefined}
                  aria-label={
                    destinations.length > 1 ? t("create.whereLabel") : undefined
                  }
                >
                  {destinations.map((option) => (
                    <Pick
                      key={option.id}
                      group="create-destination"
                      on={
                        destinations.length === 1 || destination === option.id
                      }
                      disabled={option.disabled}
                      icon={option.icon}
                      name={option.name}
                      sub={option.sub}
                      onChoose={() => setDestination(option.id)}
                    />
                  ))}
                </div>
                {destinationHint && (
                  <p className="ui-input-note">{t(destinationHint)}</p>
                )}
              </div>
            )}

            {/* A source's manuscript has its structure already: the
                language is the step's one question. */}
            {step === 1 && lead && (
              <Select
                ref={languageField}
                label={t("create.languageLabel")}
                options={DOCUMENT_LANGUAGES}
                value={language}
                onChange={setLanguage}
                note={t("create.languageNote")}
              />
            )}

            {step === 1 && !lead && (
              <>
                <div className="create-grid">
                  <Select
                    ref={structure}
                    label={t("create.structureLabel")}
                    options={shapes}
                    value={shape}
                    onChange={setShape}
                  />
                  <Select
                    label={t("create.languageLabel")}
                    options={DOCUMENT_LANGUAGES}
                    value={language}
                    onChange={setLanguage}
                    note={t("create.languageNote")}
                  />
                </div>
                {/* The description and the Parts chips sit in the card, and
                    the structure select has no note, so the fact is stated
                    once, where the change shows. */}
                <div key={shape} className="create-card">
                  {/* Two strings, one paragraph. A shape's description is a
                      fact the assistant also reads; its fit is advice to
                      someone choosing, which the model must not read. One
                      split key serves both, with no second model-facing copy. */}
                  <p className="ui-input-note">
                    {`${t(`create.shapeDesc.${shape}`)} ${t(`create.shapeFit.${shape}`)}`}
                  </p>
                  {partTitles.length > 0 && (
                    <div className="create-chips">
                      {partTitles.map((title) => (
                        <span key={title} className="create-chip">
                          {title}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {step === 2 && (
              <TypeGoalFields
                value={typeGoal}
                reading={typeGoalReading}
                onType={setType}
                onCustomType={setCustomType}
                // Any manual edit, a typed value or a clear, stops the type's
                // prefill from following.
                onGoal={setTypedGoal}
                customTouched={customTouched}
                onCustomTouched={() => setCustomTouched(true)}
                typeRef={typeField}
                goalRef={goalField}
                customRef={customField}
              />
            )}

            {step === 3 && (
              <GenreFields ref={genreField} value={genre} onChange={setGenre} />
            )}

            {step === LAST && (
              <>
                <TitleField
                  ref={name}
                  label={t("create.nameLabel")}
                  value={title}
                  onChange={setTitle}
                  reading={titleReading}
                  folderLine={{ lead: t("create.creates"), folder }}
                />
                {lead && (
                  <Input
                    label={t("create.authorLabel")}
                    autoComplete="off"
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                  />
                )}
                <p className="ui-recap">{recap}</p>
              </>
            )}

            {/* A visually hidden submit button, so implicit submission on
                Enter is the browser's own. Never a tab stop. */}
            <button
              type="submit"
              className="ui-visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
            />
          </form>
        </Fragment>
      )}

      {/* A failed job answers inside the dialog, above the foot, where the
          writer is looking; other shelf failures go to the banner. An alert,
          so a screen reader announces it. */}
      {!creating && createError && (
        <p className="ui-input-note ui-input-note-bad" role="alert">
          {createError}
        </p>
      )}
    </Dialog>
  );
}

/**
 * The platform's back gesture, one history entry per step: it steps back as
 * Back does and leaves only from the first.
 */
function BackGesture({ onBack }: { onBack: () => void }) {
  useBackCloses(true, onBack);
  return null;
}
