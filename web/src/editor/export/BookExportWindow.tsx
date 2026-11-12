// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { setProjectAuthor } from "../../project/author";
import { asAuthor } from "../../project/properties";
import type { ProjectRef } from "../../storage/types";
import { Dialog, Dots } from "../../ui";
import { bookExport, doneMessageKey, fileLanguage } from "./host/bookExport";
import { openExportBook, type ExportBook } from "./host/openBook";
import ExportDialog from "./presentation/ExportDialog";

// The export window as the Library opens it, and the export's composition
// root. It opens the book with `openExportBook`, the editor's own reading
// including the working copy. The Library reaches it only through the lazy
// loader in `editorChunk.ts`, so the writers, the engine's codec and pdfmake
// never ride along with the shelf.
//
// Two languages meet here. The window speaks the app's, because it is
// talking to the writer; the file speaks the book's (`fileLanguage`).
//
// The author is the one thing written back to the book, and only after the
// export lands. It is normalised once (`asAuthor`), so the name in the file
// and the name saved are the same string.

export interface BookExportWindowProps {
  project: ProjectRef;
  projectId: string;
  /** The signed-in writer's name: the author when the book has none yet. */
  accountName: string | null;
  /** Posts a line to the shelf's toasts: how the export went, or why not. */
  onMessage: (text: string) => void;
  onClose: () => void;
}

export default function BookExportWindow({
  project,
  projectId,
  accountName,
  onMessage,
  onClose,
}: BookExportWindowProps) {
  const { t, i18n } = useTranslation();
  const [book, setBook] = useState<ExportBook | null>(null);
  // The author is saved as the window closes; the working copy it is written
  // through must outlive that write, or the save meets a disposed store.
  const saving = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let live = true;
    let opened: ExportBook | null = null;
    openExportBook(project, projectId).then(
      (result) => {
        if (!live) {
          result.dispose();
          return;
        }
        opened = result;
        setBook(result);
      },
      () => {
        if (!live) return;
        onMessage(t("export.openFailed"));
        onClose();
      },
    );
    return () => {
      live = false;
      const closing = opened;
      void saving.current.finally(() => closing?.dispose());
    };
    // Opens once per window: the props that name the book do not change
    // under an open window, and the two callbacks are read when they fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, projectId]);

  const exporter = useMemo(() => {
    if (!book) return null;
    const language = fileLanguage(
      book.properties.document.language,
      Object.keys(i18n.options.resources ?? {}),
    );
    return bookExport({
      storage: book.storage,
      ref: project,
      structure: () => book.structure,
      properties: () => book.properties,
      t: i18n.getFixedT(language),
      language,
    });
  }, [book, project, i18n]);

  // What the window shows is read once, when the book opens, so a Part
  // renamed in another tab mid-choice does not reshuffle the ticks under the
  // pointer.
  const view = useMemo(
    () =>
      exporter
        ? {
            book: exporter.source.book(),
            manuscript: exporter.source.manuscript(),
          }
        : null,
    [exporter],
  );

  if (!book || !exporter || !view)
    return (
      <Dialog
        open
        title={t("export.title")}
        confirmLabel={t("create.continue")}
        confirmDisabled
        cancelLabel={t("confirm.cancel")}
        onConfirm={() => {}}
        onCancel={onClose}
        className="ui-dialog--wizard"
      >
        <p className="ui-input-note">
          <Dots label={t("export.opening")} />
        </p>
      </Dialog>
    );

  return (
    <ExportDialog
      book={view.book}
      manuscript={view.manuscript}
      loadReferences={exporter.source.references}
      accountName={accountName}
      locale={i18n.language}
      onExport={(request, name) =>
        exporter.run({ ...request, author: asAuthor(request.author) }, name)
      }
      onAuthor={(author) => {
        const clean = asAuthor(author);
        if (clean === book.properties.document.author) return;
        // Best effort, after the fact: the file is already out under this
        // name, and a book that cannot take the note keeps its old one.
        saving.current = setProjectAuthor(book.storage, project, clean).catch(
          () => {},
        );
      }}
      onDone={(outcome) => onMessage(t(doneMessageKey(outcome)))}
      onClose={onClose}
    />
  );
}
