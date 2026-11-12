// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AreaInput,
  Dialog,
  Disclosure,
  Dots,
  Input,
  Pick,
  SegmentedControl,
  Select,
  StepRail,
  Tick,
} from "../../../ui";
import { useBackCloses } from "../../../ui/overlay/useBackCloses";
import type { ExportRequest, StorySeparator } from "../application/assemble";
import {
  EXPORT_EMPTY,
  EXPORT_NAME_EXHAUSTED,
  type ExportOutcome,
} from "../application/runExport";
import type { BookFacts, ManuscriptNode, ReferenceEntry } from "../domain/book";
import { defaultExportName, sanitizeFileName } from "../domain/filename";
import {
  FORMAT_IDS,
  FORMATS,
  tocRequired,
  type FormatId,
} from "../domain/formats";
import {
  LAYOUT_IDS,
  LAYOUTS,
  PAGE_SIZE_IDS,
  defaultPageSize,
  manuscriptVariant,
  runningHeaderFor,
  type LayoutId,
  type PageSizeId,
} from "../domain/layout";
import {
  manuscriptForest,
  notesForest,
  referenceForest,
  selectableIds,
  tickCount,
  tickState,
  toggleAll,
  type PickNode,
} from "../domain/selection";
import ExportPicker, { checkedOf } from "./ExportPicker";

// ── The export window ────────────────────────────────────────────────────────
//
// A wizard of the creation wizard's shape: one question a step, the
// rail above it, Continue until the last step and Export on it. The steps ask,
// in order, what kind of file, what goes in it, how its pages look, and who
// it is by and what it is called. The pages step exists only for a format
// that has pages, because a step whose every choice does nothing is not a
// step.
//
// Everything is decided here and handed to `runExport` as one request; the
// window never assembles, writes or saves. Nothing is remembered between
// exports, with one exception: the author, a fact about the book, is saved on
// it once the export has landed. The contact block is the writer's address,
// typed for each export and kept nowhere.
//
// Back, Escape and the platform's back gesture all step back one question,
// and leave only from the first. While the file is being written nothing
// leaves: the homes are already being written, and a window that vanished
// mid-write would leave the writer not knowing whether a file landed.

export interface ExportDialogProps {
  book: BookFacts;
  manuscript: readonly ManuscriptNode[];
  /** The reference shelf, read once when the window opens. */
  loadReferences: () => Promise<ReferenceEntry[]>;
  /** The signed-in writer's name: the author when the book has none yet. */
  accountName: string | null;
  /** The UI locale, for the paper a writer most likely has. */
  locale: string;
  /** The clock, injectable for tests. Read once, when the window opens. */
  now?: () => Date;
  /** Assemble, write, keep, download; rejects with the reason as message. */
  onExport: (request: ExportRequest, name: string) => Promise<ExportOutcome>;
  /** The export landed under an author the book did not have: save it. */
  onAuthor: (author: string) => void;
  onDone: (outcome: ExportOutcome) => void;
  onClose: () => void;
}

type StepId = "format" | "contents" | "pages" | "finish";

const EMPTY: ReadonlySet<string> = new Set();

export default function ExportDialog({
  book,
  manuscript,
  loadReferences,
  accountName,
  locale,
  now = () => new Date(),
  onExport,
  onAuthor,
  onDone,
  onClose,
}: ExportDialogProps) {
  const { t } = useTranslation();
  const ids = useId();
  const body = useRef<HTMLFormElement>(null);
  // The timestamp the proposed name carries is the moment the window opened,
  // not a clock that ticks in the field while the writer reads it.
  const [openedAt] = useState(now);

  const [format, setFormat] = useState<FormatId>("docx");
  const [layout, setLayout] = useState<LayoutId>("book");
  const [page, setPage] = useState<PageSizeId>(() => defaultPageSize(locale));

  // ── What goes in ───────────────────────────────────────────────────────────
  const manuscriptTree = useMemo(
    () => manuscriptForest(manuscript),
    [manuscript],
  );
  const [entries, setEntries] = useState<ReferenceEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    loadReferences()
      .then((loaded) => live && setEntries(loaded))
      // A shelf that cannot be read is an empty one here, so the manuscript
      // can still leave.
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [loadReferences]);
  // The shelf's own words for its groups, so the window says what the shelf
  // says.
  const referenceTree = useMemo(
    () =>
      referenceForest(entries ?? [], (group) => t(`reference.group.${group}`)),
    [entries, t],
  );
  const notesTree = useMemo(() => notesForest(entries ?? []), [entries]);

  // The manuscript starts whole; references and notes start out, because a
  // book is what most exports are for and the bible is a chosen addition.
  const [pickedManuscript, setPickedManuscript] = useState<ReadonlySet<string>>(
    () => selectableIds(manuscriptTree),
  );
  const [pickedReferences, setPickedReferences] =
    useState<ReadonlySet<string>>(EMPTY);
  const [pickedNotes, setPickedNotes] = useState<ReadonlySet<string>>(EMPTY);

  const included = {
    manuscript: pickedManuscript.size > 0,
    references: pickedReferences.size > 0,
    notes: pickedNotes.size > 0,
  };
  const anything = included.manuscript || included.references || included.notes;
  // A book with nothing to tick at all is told so, rather than told to tick
  // something there is not.
  const nothingToExport =
    entries !== null &&
    selectableIds(manuscriptTree).size +
      selectableIds(referenceTree).size +
      selectableIds(notesTree).size ===
      0;

  // ── Who wrote it ───────────────────────────────────────────────────────────
  const [author, setAuthor] = useState(() => book.author || accountName || "");
  const [header, setHeader] = useState<string | null>(null);
  const runningHeader = header ?? runningHeaderFor(author, book.title);
  const [contact, setContact] = useState("");
  const [separator, setSeparator] = useState<StorySeparator>("shunn");

  // Off by default: the tech page is a page about the file, which most
  // readers of a book do not want first.
  const [techPage, setTechPage] = useState(false);
  const [toc, setToc] = useState(false);

  // ── What it is called ──────────────────────────────────────────────────────
  // The proposal follows the ticks until the writer types; from then on the
  // name is theirs.
  const [typedName, setTypedName] = useState<string | null>(null);
  const proposed = defaultExportName(
    book.title || t("export.untitled"),
    included,
    {
      references: t("export.include.references"),
      notes: t("export.include.notes"),
    },
    openedAt,
  );
  const name = typedName ?? proposed;
  const fileName = sanitizeFileName(name);
  const extension = FORMATS[format].extension;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paged = FORMATS[format].paged;
  const manuscriptLayout = paged && LAYOUTS[layout].manuscript;
  const variant = manuscriptVariant(book.type);
  const tocLocked = tocRequired(format);

  // ── The steps ──────────────────────────────────────────────────────────────
  const steps: StepId[] = paged
    ? ["format", "contents", "pages", "finish"]
    : ["format", "contents", "finish"];
  const [step, setStep] = useState(0);
  const stepId = steps[step];
  const last = step === steps.length - 1;

  const stepReady = (id: StepId): boolean => {
    if (id === "contents") return anything;
    if (id === "finish") return fileName !== "";
    return true;
  };

  // A refusal is about what was asked. Once anything changes it does not
  // describe the window, and staying up would say it does.
  useEffect(() => {
    setError(null);
  }, [
    format,
    layout,
    page,
    pickedManuscript,
    pickedReferences,
    pickedNotes,
    author,
    header,
    contact,
    separator,
    techPage,
    toc,
    typedName,
  ]);

  // Focus follows the wizard, as in the creation wizard: every advance and
  // every Back lands the keyboard on the question just arrived at, the chosen
  // card on a choice of cards and the first field anywhere else.
  useEffect(() => {
    const form = body.current;
    if (!form) return;
    const target =
      form.querySelector<HTMLElement>(".pick input:checked") ??
      form.querySelector<HTMLElement>(
        "button:not(:disabled, [tabindex='-1']), input:not(:disabled), select, textarea",
      );
    target?.focus();
  }, [step]);

  const submit = async () => {
    if (busy || !anything || !fileName) return;
    setBusy(true);
    setError(null);
    const cleanAuthor = author.trim();
    const request: ExportRequest = {
      format,
      layout,
      page,
      techPage,
      toc: toc || tocLocked,
      selection: {
        manuscript: pickedManuscript,
        references: pickedReferences,
        notes: pickedNotes,
      },
      author: cleanAuthor,
      contact,
      runningHeader,
      storySeparator: separator,
    };
    try {
      const outcome = await onExport(request, fileName);
      // Saved once the file exists under it, and not before, because an
      // export that failed has not gone out under any name.
      if (cleanAuthor !== book.author) onAuthor(cleanAuthor);
      onDone(outcome);
      onClose();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      setError(
        t(
          message === EXPORT_EMPTY
            ? "export.error.empty"
            : message === EXPORT_NAME_EXHAUSTED
              ? "export.error.nameTaken"
              : "export.error.failed",
        ),
      );
      setBusy(false);
    }
  };

  /** Footer, Enter and the form share it: advance, or export on the last. */
  const handleSubmit = () => {
    if (busy) return;
    if (!stepReady(stepId)) return;
    if (!last) setStep(step + 1);
    else void submit();
  };

  /** Back one question; out only from the first; nothing while writing. */
  const dismiss = () => {
    if (busy) return;
    if (step === 0) onClose();
    else setStep(step - 1);
  };

  const recap = [
    t(`export.format.${format}.name`),
    ...(paged
      ? [t(`export.layout.${layout}.name`), t(`export.page.${page}`)]
      : []),
  ].join(" · ");

  return (
    <Dialog
      open
      title={t(`export.step.${stepId}`)}
      label={t("export.title")}
      lede={step === 0 ? t("export.lede") : undefined}
      confirmLabel={last ? t("export.confirm") : t("create.continue")}
      cancelLabel={step === 0 ? t("confirm.cancel") : t("create.back")}
      confirmDisabled={!stepReady(stepId)}
      confirmBusy={busy}
      cancelDisabled={busy}
      dismissible={!busy}
      onConfirm={handleSubmit}
      onCancel={dismiss}
      className="ui-dialog--wizard"
    >
      <BackGesture key={step} onBack={dismiss} />
      <StepRail count={steps.length} current={step} />
      <form
        ref={body}
        className="ui-step"
        onSubmit={(event) => {
          // Enter in any field advances, or exports on the last step, through
          // the footer's own gate; a real form, so the browser owns implicit
          // submission.
          event.preventDefault();
          handleSubmit();
        }}
      >
        {stepId === "format" && (
          <div
            className="picks picks-grid"
            role="radiogroup"
            aria-label={t("export.formatLabel")}
          >
            {FORMAT_IDS.map((id) => (
              <Pick
                key={id}
                group={`${ids}-format`}
                on={format === id}
                name={t(`export.format.${id}.name`)}
                sub={t(`export.format.${id}.sub`)}
                onChoose={() => setFormat(id)}
              />
            ))}
          </div>
        )}

        {stepId === "contents" && (
          <>
            <div className="ui-input-field">
              <div
                className="ui-ticks"
                role="group"
                aria-label={t("export.includeLabel")}
              >
                <Area
                  name={t("export.include.manuscript")}
                  choose={t("export.pick.manuscript")}
                  forest={manuscriptTree}
                  selected={pickedManuscript}
                  onChange={setPickedManuscript}
                />
                <Area
                  name={t("export.include.references")}
                  choose={t("export.pick.references")}
                  forest={referenceTree}
                  selected={pickedReferences}
                  onChange={setPickedReferences}
                  loading={entries === null}
                />
                <Area
                  name={t("export.include.notes")}
                  choose={t("export.pick.notes")}
                  forest={notesTree}
                  selected={pickedNotes}
                  onChange={setPickedNotes}
                  loading={entries === null}
                />
              </div>
              {!anything && entries !== null && (
                <p className="ui-input-note">
                  {t(nothingToExport ? "export.emptyBook" : "export.nothing")}
                </p>
              )}
            </div>
            <div className="ui-ticks">
              <Tick
                checked={techPage}
                onToggle={() => setTechPage((on) => !on)}
              >
                {t("export.techPage")}
              </Tick>
              <Tick
                checked={toc || tocLocked}
                locked={tocLocked}
                note={tocLocked ? t("export.tocLocked") : undefined}
                onToggle={() => setToc((on) => !on)}
              >
                {t("export.tocTick")}
              </Tick>
            </div>
          </>
        )}

        {stepId === "pages" && (
          <>
            <div className="ui-input-field">
              <div
                className="picks picks-grid"
                role="radiogroup"
                aria-label={t("export.layoutLabel")}
              >
                {LAYOUT_IDS.map((id) => (
                  <Pick
                    key={id}
                    group={`${ids}-layout`}
                    on={layout === id}
                    name={t(`export.layout.${id}.name`)}
                    sub={t(`export.layout.${id}.sub`)}
                    onChoose={() => setLayout(id)}
                  />
                ))}
              </div>
              {/* A fact, not a control: the manuscript shape follows from the
                  book's declared type, so it is said under the choice it
                  qualifies rather than offered. */}
              {manuscriptLayout && (
                <p className="ui-input-note">
                  {t(`export.variant.${variant}`, { type: book.type })}
                </p>
              )}
            </div>
            <Select
              label={t("export.pageLabel")}
              value={page}
              onChange={setPage}
              options={PAGE_SIZE_IDS.map((id) => ({
                value: id,
                label: t(`export.page.${id}`),
              }))}
            />
            {manuscriptLayout && (
              <>
                <AreaInput
                  label={t("export.contactLabel")}
                  value={contact}
                  rows={4}
                  evidence={t("export.contactNote")}
                  onChange={(event) => setContact(event.target.value)}
                />
                <Input
                  label={t("export.headerLabel")}
                  value={runningHeader}
                  evidence={t("export.headerNote", {
                    header: runningHeader || "…",
                  })}
                  onChange={(event) => setHeader(event.target.value)}
                />
                {variant === "story" && (
                  <div className="ui-input-field">
                    <span className="ui-input-label">
                      {t("export.separatorLabel")}
                    </span>
                    <SegmentedControl
                      label={t("export.separatorLabel")}
                      value={separator}
                      onChange={setSeparator}
                      options={[
                        { value: "shunn", label: t("export.separator.shunn") },
                        {
                          value: "pageBreak",
                          label: t("export.separator.pageBreak"),
                        },
                      ]}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}

        {stepId === "finish" && (
          <>
            <Input
              label={t("export.authorLabel")}
              value={author}
              evidence={t("export.authorNote")}
              onChange={(event) => setAuthor(event.target.value)}
            />
            <Input
              label={t("export.nameLabel")}
              value={name}
              problem={fileName ? null : t("export.nameEmpty")}
              evidence={`export/${fileName}.${extension}`}
              onChange={(event) => setTypedName(event.target.value)}
            />
            <p className="ui-recap">{recap}</p>
            {error && (
              <p className="ui-input-note ui-input-note-bad" role="alert">
                {error}
              </p>
            )}
          </>
        )}
        {/* The Enter path, as in the creation wizard: a real submit button,
            visually hidden, so implicit submission is the browser's own
            machinery. Never a tab stop. */}
        <button
          type="submit"
          className="ui-visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
        />
      </form>
    </Dialog>
  );
}

/**
 * The platform's back gesture, one history entry per step. Keyed by the step,
 * so each step mounts its own: going forward hands the entry over in the same
 * commit (`useBackCloses`' handoff), and a back press consumes the entry and
 * steps back, and the step arrived at pushes a fresh one. Back walks the
 * wizard question by question, and leaves it only from the first.
 */
function BackGesture({ onBack }: { onBack: () => void }) {
  useBackCloses(true, onBack);
  return null;
}

// ── One area of the book ─────────────────────────────────────────────────────
//
// A tick for all of it, and a tree for some.

function Area({
  name,
  choose,
  forest,
  selected,
  onChange,
  loading = false,
}: {
  name: string;
  choose: string;
  forest: readonly PickNode[];
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const state = tickState(forest, selected);
  const { on, all } = tickCount(forest, selected);
  const empty = !loading && all === 0;
  const note = loading ? (
    <Dots label={t("export.pick.loading")} />
  ) : empty ? (
    t("export.pick.none")
  ) : state === "mixed" ? (
    t("export.pick.count", { on, all })
  ) : null;
  return (
    <div className="export-area">
      <Tick
        checked={checkedOf(state)}
        disabled={loading || empty}
        note={note}
        onToggle={() => onChange(toggleAll(forest, selected))}
      >
        {name}
      </Tick>
      {all > 0 && (
        <Disclosure summary={choose} className="export-choose">
          <ExportPicker
            forest={forest}
            selected={selected}
            onChange={onChange}
            label={choose}
          />
        </Disclosure>
      )}
    </div>
  );
}
