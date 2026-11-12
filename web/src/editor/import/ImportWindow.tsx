// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DOCUMENT_LANGUAGES } from "../../locales/languages";
import type { ProjectSeed } from "../../project/scaffold";
import CreateProjectDialog, {
  type CreateProgress,
  type CreateRequest,
} from "../../projectSetup/CreateProjectDialog";
import { manuscriptText } from "./adapters/manuscriptText";
import { loadReader } from "./adapters/readers";
import { probeZip } from "./adapters/zip";
import { readFile } from "./application/readFiles";
import { projectRules, titleWords } from "./host/projectRules";
import { seedFrom } from "./host/seed";
import {
  useImportSteps,
  type ImportServices,
} from "./presentation/useImportSteps";

// The import window, as the Library opens it: the import's composition root,
// the one file that knows the readers, the host and the wizard at once. The
// Library reaches it only through the lazy loader in `editorChunk.ts`
// (`loadImport`), so the readers and the engine's codec never ride along with
// the shelf.
//
// The window is the creation wizard (`CreateProjectDialog`), handed the
// import's two questions as its lead, so an imported project is asked where
// it lives, its language, type, goal, genre and title by the same code that
// asks a blank one.
//
// The window speaks the app's language; the words written into the book
// ("Senza titolo" for a piece that had no title) speak the book's, the one
// the writer settled on in the wizard's Language step.
//
// The Library makes the project (`onImport` → `createFrom`, the path a blank
// project takes); this window hands over a `ProjectSeed` and shows the job
// the Library reports back.

export interface ImportWindowProps {
  /** Files handed over by the action that opened the window. */
  initialFiles?: readonly File[];
  /** What the creation wizard is told about the places a project can live. */
  driveConnected: boolean;
  email: string;
  localAvailable: boolean;
  localRootReady: boolean;
  remoteAvailable: boolean;
  /** Folder names already on the shelf, so a clash is caught before writing. */
  taken: Set<string>;
  /** The signed-in writer's name: the author when the file names none. */
  accountName: string | null;
  /** The Library's creation job, while it runs. */
  progress: CreateProgress | null;
  /** The last attempt's failure, worded by the Library. */
  error: string | null;
  /** Makes the project. The Library navigates into it when it is made. */
  onImport: (seed: ProjectSeed) => void;
  onClose: () => void;
}

const read: ImportServices["read"] = (file, signal) =>
  readFile(
    file,
    { load: loadReader, probe: probeZip },
    // A frame back to the page between files and every few thousand
    // paragraphs, so the window's dots keep moving through a long read; and
    // the window's signal, so closing it stops the read at that frame.
    { yield: () => new Promise((resolve) => setTimeout(resolve, 0)), signal },
  );

const LANGUAGES = DOCUMENT_LANGUAGES.map(({ value }) => value);

export default function ImportWindow(props: ImportWindowProps) {
  const { i18n } = useTranslation();
  const services = useMemo<ImportServices>(
    () => ({
      read,
      writer: manuscriptText,
      rules: projectRules,
      titleWords: (language) => titleWords(i18n.getFixedT(language)),
    }),
    [i18n],
  );
  return <ImportWizard {...props} services={services} />;
}

/**
 * The window with its services handed in: the real readers from
 * `ImportWindow`, a test's own from a test.
 */
export function ImportWizard({
  services,
  initialFiles,
  accountName,
  progress,
  error,
  onImport,
  onClose,
  ...places
}: ImportWindowProps & { services: ImportServices }) {
  const { i18n } = useTranslation();
  const uiBase = i18n.language.split("-")[0];
  const { draftFor, ...lead } = useImportSteps({
    services,
    initialFiles,
    languages: LANGUAGES,
    uiLanguage: LANGUAGES.includes(uiBase) ? uiBase : LANGUAGES[0],
    accountName,
  });

  const create = async (request: CreateRequest) => {
    const draft = draftFor(request.language);
    if (!draft) return;
    const seed = await seedFrom(
      draft,
      {
        title: request.title,
        author: request.author ?? "",
        language: request.language,
        type: request.type,
        goal: request.goal,
        genres: request.genres,
        ageCategory: request.ageCategory,
        tropes: request.tropes,
      },
      request.destination,
      request.folderName,
      services.writer,
      services.rules,
    );
    onImport(seed);
  };

  return (
    <CreateProjectDialog
      open
      {...places}
      lead={lead}
      onCreate={(request) => void create(request)}
      onCancel={onClose}
      progress={progress}
      createError={error}
    />
  );
}
