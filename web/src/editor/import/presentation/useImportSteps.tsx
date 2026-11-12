// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { detect } from "../application/detect";
import { buildDraft, unitsOf, unitWords } from "../application/draft";
import {
  hasScenes,
  retitle,
  sceneMarks,
  splitScenes,
  unsplitScenes,
} from "../application/edits";
import { detectLanguage } from "../application/language";
import { losses } from "../application/losses";
import { deriveFacts, goalFor } from "../application/meta";
import { prepare, type PreparedBook } from "../application/prepare";
import { admit, mergeSources, type FileResult } from "../application/readFiles";
import type { Draft } from "../domain/draft";
import { naturalSort } from "../domain/naturalSort";
import type { ImportOptions, ImportPlan, RuleId } from "../domain/plan";
import type {
  InputFile,
  ManuscriptWriter,
  ProjectRules,
  TitleWords,
} from "../ports";
import ChaptersStep from "./ChaptersStep";
import ChooseStep, { type FileRow } from "./ChooseStep";

// ── The import's own questions ───────────────────────────────────────────────
//
// An imported project is asked what a blank one is asked, by the creation
// wizard itself (`CreateProjectDialog`, given these as its `lead`): where it
// lives, its language, type and goal, its genre, what it is called. A second
// copy of those fields would drift from the first. What the import adds is
// asked first, and is all this hook holds:
//   1. Which files. Each is read the moment it is chosen, and answers on its
//      own card: read, or refused with a sentence that says what to do
//      instead. Several files are a book in pieces, in the order the cards
//      show (natural-sorted to begin with; the writer moves them).
//   2. Where the manuscript divides: the detected rows and what the writer
//      can do to each (`ChaptersStep`), over the plan this hook holds.
//
// Then the wizard's own questions, opened on what the file proposes: its
// title, its author (or the signed-in writer), the language its text is in,
// the type its length suggests and a goal no smaller than it already is.
//
// A hook and not a window, because the wizard is the window: the steps are
// bodies the wizard draws inside its own form, and the draft is built when
// the wizard commits, in the language the writer settled on. The presentation
// layer may not name the web application, so the composition root
// (`ImportWizard`) hands these to the wizard, which matches them by shape.

export interface ImportServices {
  /**
   * Sniffs, caps and reads one file (the reader registry and zip probe bound
   * in). The signal is set when the window closes; the reader stops at its
   * next yield instead of reading a large book nobody will see.
   */
  read(file: InputFile, signal: AbortSignal): Promise<FileResult>;
  writer: ManuscriptWriter;
  rules: ProjectRules;
  /** The words the import writes into the book, in the book's language. */
  titleWords(language: string): TitleWords;
}

/** One of the import's questions, as the wizard draws a step. */
export interface ImportStep {
  title: string;
  lede?: string;
  ready: boolean;
  body: ReactNode;
}

/** What the file proposes for the wizard's own questions. */
export interface ImportProposal {
  title: string;
  author: string;
  language: string;
  type: string;
  goalFor(type: string): number;
}

export interface ImportSteps {
  label: string;
  making: string;
  confirm: string;
  steps: readonly ImportStep[];
  /** Null until the files are read. */
  proposal: ImportProposal | null;
  /** The book as the project will hold it, made-up titles in `language`. */
  draftFor(language: string): Draft | null;
}

export interface ImportStepsOptions {
  services: ImportServices;
  /** Files handed over by the action that opened the window, read at once. */
  initialFiles?: readonly File[];
  /** The document languages a book may be in. */
  languages: readonly string[];
  /** The interface's language: the book's, when nothing says otherwise. */
  uiLanguage: string;
  /** The signed-in writer's name: the author when the file names none. */
  accountName: string | null;
}

/** A browser `File`, as the port's `InputFile`. */
const asInput = (file: File): InputFile => ({
  name: file.name,
  size: file.size,
  bytes: async () => new Uint8Array(await file.arrayBuffer()),
});

let nextRow = 0;

export function useImportSteps({
  services,
  initialFiles,
  languages,
  uiLanguage,
  accountName,
}: ImportStepsOptions): ImportSteps {
  const { t } = useTranslation();

  // ── 1. The files ───────────────────────────────────────────────────────────
  const [rows, setRows] = useState<FileRow[]>([]);
  // A closed window stops reading: the read in progress is aborted at the
  // reader's next yield, and the rows a late read would write are gone.
  const reads = useRef(new AbortController());
  useEffect(() => {
    if (reads.current.signal.aborted) reads.current = new AbortController();
    const controller = reads.current;
    return () => controller.abort();
  }, []);

  const add = async (files: readonly File[]) => {
    const added = naturalSort([...files], (file) => file.name).map((file) => ({
      id: `f${nextRow++}`,
      file,
      name: file.name,
      size: file.size,
      result: null,
    }));
    setRows((current) => [...current, ...added]);
    // One at a time: a reader holds a whole file in memory, and two large
    // packages at once is twice that for no gain the writer can see.
    const { signal } = reads.current;
    for (const row of added) {
      const result = await services.read(asInput(row.file), signal);
      if (signal.aborted) return;
      setRows((current) =>
        current.map((r) => (r.id === row.id ? { ...r, result } : r)),
      );
    }
  };

  // The handed-over files, once.
  const handed = useRef(false);
  useEffect(() => {
    if (handed.current || !initialFiles?.length) return;
    handed.current = true;
    void add(initialFiles);
    // `add` reads the latest services through its own closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  const reading = rows.some((row) => row.result === null);
  const admitted = useMemo(
    () =>
      reading
        ? []
        : admit(rows.flatMap((row) => (row.result ? [row.result] : []))),
    [rows, reading],
  );
  const source = useMemo(() => mergeSources(admitted), [admitted]);

  // ── 2. Where it divides ────────────────────────────────────────────────────
  const [rule, setRule] = useState<RuleId | "auto">("auto");
  const [separator, setSeparator] = useState("");

  const prepared = useMemo(
    () => source && prepare(source, services.writer, services.rules),
    [source, services],
  );

  // The book's language: what the source says, a clear vote, else the
  // interface's. The wizard's Language step proposes it; the titles this
  // step shows are named in it.
  const language = useMemo(
    () =>
      prepared && source
        ? detectLanguage(source.meta.language, prepared, languages, uiLanguage)
        : uiLanguage,
    [prepared, source, languages, uiLanguage],
  );
  const words = useMemo(
    () => services.titleWords(language),
    [services, language],
  );

  // Detection is derived; the writer's changes ride on top of the detection
  // they were made to, and fall away by themselves when it changes (another
  // way of splitting, another file). They are kept by what they were made
  // to (the book, the way and the line), so going back to that way brings
  // them back, and so does the Undo the window offers.
  const options: ImportOptions = useMemo(() => ({ separator }), [separator]);
  const detection = useMemo(
    () => (prepared ? detect(prepared, rule, options, words) : null),
    // The words only name made-up titles, and `retitle` renames those; the
    // book's language must not reset the writer's ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prepared, rule, options],
  );
  const [edited, setEdited] = useState<Edited | null>(null);
  const current =
    edited &&
    edited.book === prepared &&
    edited.rule === rule &&
    edited.separator === separator
      ? edited
      : null;
  const basePlan = current ? current.plan : detection?.plan;
  const plan = useMemo(
    () => (basePlan ? retitle(basePlan, words) : null),
    [basePlan, words],
  );
  // What a change of way undid, until the writer edits again.
  const [undone, setUndone] = useState<Edited | null>(null);
  const edit = (next: (plan: ImportPlan) => ImportPlan) => {
    if (!basePlan || !prepared) return;
    setEdited({
      book: prepared,
      rule,
      separator,
      plan: next(basePlan),
      count: (current?.count ?? 0) + 1,
    });
    setUndone(null);
  };
  /** Another way, or another line: the list starts again. */
  const reshape = (change: () => void) => {
    if (current?.count) setUndone(current);
    change();
  };
  const undo = () => {
    if (!undone) return;
    setRule(undone.rule);
    setSeparator(undone.separator);
    setEdited(undone);
    setUndone(null);
  };
  // Underlining as italic, the manuscript convention, unless the writer
  // unticks it: a choice about the text, not the division, so no change of
  // way touches it.
  const [underlineItalic, setUnderlineItalic] = useState(true);
  // The file's comments into the margin, unless the writer unticks it: like
  // the underline, a choice about what comes, not how the book is divided.
  const [keepComments, setKeepComments] = useState(true);

  const units = useMemo(
    () => (plan ? unitsOf(plan, words) : []),
    [plan, words],
  );
  const keptWords = useMemo(
    () =>
      prepared
        ? units.reduce((sum, unit) => sum + unitWords(prepared, unit), 0)
        : 0,
    [units, prepared],
  );

  // ── What the file proposes ─────────────────────────────────────────────────
  const firstName = rows.find((row) => row.result?.status === "ok")?.name ?? "";
  const proposal = useMemo<ImportProposal | null>(() => {
    if (!source) return null;
    const facts = deriveFacts(
      source.meta,
      detection?.bookTitle,
      firstName,
      keptWords,
      services.rules,
    );
    return {
      title: facts.title,
      author: facts.author || accountName || "",
      language,
      type: facts.type,
      goalFor: (type) => goalFor(type, keptWords, services.rules),
    };
  }, [
    source,
    detection,
    firstName,
    keptWords,
    services,
    accountName,
    language,
  ]);

  const steps: ImportStep[] = [
    {
      title: t("import.step.choose"),
      lede: t("import.lede"),
      ready: !reading && !!source,
      body: (
        <ChooseStep
          rows={rows}
          admitted={reading ? null : admitted}
          onAdd={(files) => void add(files)}
          onSwap={(id, withId) =>
            setRows((current) => {
              const from = current.findIndex((row) => row.id === id);
              const to = current.findIndex((row) => row.id === withId);
              if (from < 0 || to < 0) return current;
              const next = [...current];
              [next[from], next[to]] = [next[to], next[from]];
              return next;
            })
          }
          onRemove={(id) =>
            setRows((current) => current.filter((row) => row.id !== id))
          }
        />
      ),
    },
    {
      title: t("import.step.chapters"),
      ready: units.length > 0,
      body: plan && prepared && source && (
        <ChaptersStep
          plan={plan}
          book={prepared}
          words={words}
          losses={losses(source.report)}
          rule={rule}
          separator={separator}
          onRule={(next) => reshape(() => setRule(next))}
          onSeparator={(text) => reshape(() => setSeparator(text))}
          onEdit={edit}
          undone={undone && !current ? undone.count : 0}
          onUndo={undo}
          scenes={basePlan ? sceneMarks(basePlan, prepared) : null}
          scenesOn={!!basePlan && hasScenes(basePlan)}
          onScenes={(on) =>
            edit((p) =>
              on ? splitScenes(p, prepared, words) : unsplitScenes(p),
            )
          }
          underlined={source.report.underline ?? 0}
          underlineItalic={underlineItalic}
          onUnderline={() => setUnderlineItalic((on) => !on)}
          commented={prepared.comments.length}
          keepComments={keepComments}
          onComments={() => setKeepComments((on) => !on)}
        />
      ),
    },
  ];

  return {
    label: t("import.heading"),
    making: t("import.making"),
    confirm: t("import.confirm"),
    steps,
    proposal,
    draftFor: (bookLanguage) => {
      if (!basePlan || !prepared) return null;
      const named = services.titleWords(bookLanguage);
      return buildDraft(prepared, retitle(basePlan, named), named, {
        underlineItalic,
        comments: keepComments,
      });
    },
  };
}

/** The writer's changes, and what they were made to. */
interface Edited {
  book: PreparedBook;
  rule: RuleId | "auto";
  separator: string;
  plan: ImportPlan;
  /** How many changes: the Undo line says so. */
  count: number;
}
