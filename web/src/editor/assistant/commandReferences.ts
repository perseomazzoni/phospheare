// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { normaliseTyped } from "../../ai/domain/scope";
import type { NamedReference } from "../../ai/domain/skills";
import { declaredSources } from "../../ai/domain/sourceView";
import type { TFunction } from "i18next";
import type { ReadRef, SourceDescriptor } from "../../ai/domain/types";

// The names a command checks against, as in `/canon Marta`.
//
// The parse matches a name and a refusal lists the names, and both read this
// one producer, so the list a refused line shows is the set the parse would
// have taken. It is built in the editor, because the names a writer sees are
// the editor's: a Guidebook or World section is named by its label in the
// interface's language, never by the English file stem the AI layer holds
// (`sectionId`).

export interface ReferenceNames {
  /** What the parse matches: every spelling it takes, each with its set. */
  readonly accepted: readonly NamedReference[];
  /**
   * What a refused line lists: one name per reference, the interface's own,
   * in the shelf's order, and only a name the parse would take, so a name two
   * references share is shown for neither.
   */
  readonly shown: readonly string[];
}

/**
 * Every reference `reads` can name in `catalogue`, by what the writer calls
 * it:
 * - a character by their title, standing for the sheet and the arc of that
 *   title together; an arc with no sheet is still that character;
 * - a Guidebook or World section by `labelsOf`: the interface's label first,
 *   then the other language's, both taken;
 * - anything else, a note above all, by its title.
 *
 * Candidates come through `declaredSources`, the matcher the run uses, so a
 * barred document (absent from the catalogue) and a summary (never
 * declared) cannot be named. `catalogue` is what this chat may read: the
 * run checks the ids again against its own scope.
 */
export function referenceNames(
  catalogue: readonly SourceDescriptor[],
  reads: readonly ReadRef[],
  labelsOf: (source: SourceDescriptor) => readonly string[],
): ReferenceNames {
  const nameable = new Set(
    declaredSources(
      catalogue,
      new Set(catalogue.map((source) => source.id)),
      reads,
    ).map((source) => source.id),
  );
  const entries: { names: string[]; ids: string[] }[] = [];
  const people = new Map<string, { names: string[]; ids: string[] }>();
  // The shelf's order, not the reads': the list reads like the panel.
  for (const source of catalogue) {
    if (!nameable.has(source.id)) continue;
    if (source.group === "characters" || source.group === "arcs") {
      const key = normaliseTyped(source.title);
      const person = people.get(key);
      if (person) person.ids.push(source.id);
      else {
        const entry = { names: [source.title], ids: [source.id] };
        people.set(key, entry);
        entries.push(entry);
      }
      continue;
    }
    entries.push({
      names: source.sectionId ? [...labelsOf(source)] : [source.title],
      ids: [source.id],
    });
  }

  // One entry per spelling. The same spelling for the same set is one name
  // (a label both languages share); for two sets it names neither, as the
  // parse says (`referenceOf`), and so it is not shown either.
  const accepted: NamedReference[] = [];
  const byName = new Map<string, Set<string>>();
  for (const entry of entries)
    for (const name of entry.names) {
      const key = normaliseTyped(name);
      if (!key) continue;
      const set = entry.ids.join("\n");
      const seen = byName.get(key);
      if (seen?.has(set)) continue;
      byName.set(key, (seen ?? new Set()).add(set));
      accepted.push({ name, ids: entry.ids });
    }
  const shown = entries.flatMap((entry) => {
    const name = entry.names[0];
    return name && byName.get(normaliseTyped(name))?.size === 1 ? [name] : [];
  });
  return { accepted, shown };
}

/** A reference as the writer's interface names it: its section or shelf. */
export function referenceName(t: TFunction, reference: ReadRef): string {
  return reference.sectionId
    ? t(`reference.section.${reference.group}.${reference.sectionId}`)
    : t(`reference.group.${reference.group}`);
}
