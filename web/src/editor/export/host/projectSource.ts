// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The export's view of a book: the host side of the `ExportSource` port, and
// the one file that knows the project's folders and the structure. It reads
// through the same notes strip and template strip as the assistant's
// `ProjectAiAdapter`, so the export and the assistant cannot read two
// different books out of one folder.
//
// An export starts from the Library, never from an open editor, so no
// unsaved buffer exists to prefer: the book is what its files say. For a book
// with a remote it reads through the working copy, since the provider handed
// in is the one `openExportBook` built over it, so a queue not yet drained to
// Remote Storage still exports what the writer last wrote.

import type { TFunction } from "i18next";
import { languageLabel } from "../../../locales/languages";
import {
  charactersWithArcs,
  groupReference,
  referenceDisplayTitle,
  referenceGroupOf,
} from "../../../project/reference";
import { REFERENCE_DIR, filePath } from "../../../project/naming";
import { countWords } from "../../../project/stats";
import { findNode } from "../../../project/structure";
import type {
  DocNode,
  DocumentProperties,
  DocumentStructure,
} from "../../../project/types";
import type { ProjectRef, StorageProvider } from "../../../storage";
import { modelText, withoutAsides } from "../../assistant/sourceText";
import type { BookFacts, ManuscriptNode, ReferenceEntry } from "../domain/book";
import type { ExportSource } from "../ports";

export interface ProjectSourceOptions {
  /** The project's provider, over its working copy when it has one. */
  storage: StorageProvider;
  ref: ProjectRef;
  structure: () => DocumentStructure;
  properties: () => DocumentProperties;
  t: TFunction;
}

function nodesOf(nodes: readonly DocNode[]): ManuscriptNode[] {
  return nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    title: node.title,
    children: node.kind === "part" ? nodesOf(node.children) : [],
  }));
}

export function projectExportSource(
  options: ProjectSourceOptions,
): ExportSource {
  const { storage, ref, t } = options;

  return {
    book(): BookFacts {
      const doc = options.properties().document;
      return {
        id: doc.id,
        title: doc.title,
        author: doc.author,
        type: doc.type,
        language: doc.language,
        languageLabel: languageLabel(doc.language),
        genres: doc.genres.map((id) => t(`genre.name.${id}`)),
        ageCategory: doc.ageCategory ? t(`genre.age.${doc.ageCategory}`) : null,
        tropes: doc.tropes,
        structure: doc.structure ? t(`create.shape.${doc.structure}`) : null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    },

    manuscript: () => nodesOf(options.structure().children),

    async references(): Promise<ReferenceEntry[]> {
      let names: string[];
      try {
        names = (await storage.listDir(ref, REFERENCE_DIR))
          .filter((entry) => entry.kind === "file")
          .map((entry) => entry.name);
      } catch {
        // No reference folder yet: a book with nothing in it.
        return [];
      }
      const structure = options.structure();
      const title = (fileName: string) =>
        referenceDisplayTitle(fileName, t, structure);
      const groups = groupReference(names, structure);
      const docsOf = (id: string) =>
        groups.find((group) => group.id === id)?.docs ?? [];

      const entries: ReferenceEntry[] = [];
      for (const doc of docsOf("guidebook"))
        entries.push({
          fileName: doc.fileName,
          group: "guidebook",
          title: title(doc.fileName),
        });
      // Each character, then its arc, as the shelf folds the arc under its
      // character.
      for (const { character, arc } of charactersWithArcs(names)) {
        entries.push({
          fileName: character.fileName,
          group: "characters",
          title: character.title,
        });
        if (arc)
          entries.push({
            fileName: arc.fileName,
            group: "arcs",
            title: t("export.pick.arcOf", { name: character.title }),
          });
      }
      for (const group of ["world", "summaries", "notes"] as const)
        for (const doc of docsOf(group))
          entries.push({
            fileName: doc.fileName,
            group,
            title: title(doc.fileName),
          });
      return entries;
    },

    async readNode(id) {
      const node = findNode(options.structure(), id);
      if (!node) throw new Error("export-node-not-found");
      const raw = await storage.readFile(ref, filePath(node.adopted));
      // The count is the app's one rule (`stats.ts`) on the file as written,
      // which already discounts comments: the number the Library shows.
      return { text: withoutAsides(raw), words: countWords(raw) };
    },

    async readReference(fileName) {
      if (fileName.includes("/") || fileName.includes("\\"))
        throw new Error("export-reference-name");
      const raw = await storage.readFile(ref, `${REFERENCE_DIR}/${fileName}`);
      const group = referenceGroupOf(fileName);
      const kind =
        group === "summaries"
          ? "summary"
          : group === "notes"
            ? "note"
            : "reference";
      // What a reader of the export sees is what a reader of the reference
      // shelf sees: no template hints, no questions the writer left
      // unanswered, no summary metadata.
      return modelText(kind, withoutAsides(raw));
    },
  };
}
