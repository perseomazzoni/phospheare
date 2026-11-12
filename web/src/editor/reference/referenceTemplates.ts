// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { nameFieldsOf, type NameFields } from "../../project/referenceNames";
import type { SectionGroupId } from "../../project/referenceSections";
import { PRODUCT } from "../../product";

// ── The section assets ───────────────────────────────────────────────────────
//
// One Markdown file per catalogue id (`project/referenceSections`).
//
// `{{title}}` is the one token: the create seam substitutes the writer's name
// for the kinds named by hand (characters and their arcs), so a file never
// carries a second, hidden name that can disagree with its own.
//
// ── The language dimension ───────────────────────────────────────────────────
//
// The assets are keyed by the project's own `document.language`, never by
// the UI's `i18n.language`: a template becomes part of a manuscript written
// in one language. A project cannot change its language, and a file already
// written is the writer's the moment it lands.
//
// A language with no folder falls back to English rather than writing an
// empty file, which reads as a broken app.

// Every template file under `md-templates/<language>/…`, read at build time;
// a locale is a directory. A misnamed file, or a catalogue id with no file
// behind it, fails the completeness test.
const RAW = import.meta.glob<string>("./md-templates/*/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** `…/md-templates/it/world/economy.md` → `["it", "world/economy"]`. */
function splitAssetPath(path: string): [string, string] {
  const after = path.slice(
    path.indexOf("/md-templates/") + "/md-templates/".length,
  );
  const slash = after.indexOf("/");
  return [after.slice(0, slash), after.slice(slash + 1).replace(/\.md$/, "")];
}

/** One language's complete asset set. */
interface TemplateLocale {
  sections: Record<SectionGroupId, Record<string, string>>;
  character: string;
  arc: string;
}

/**
 * The languages that have their own assets. English is the fallback, so it
 * is the one entry that must always exist.
 */
const LOCALES: Partial<Record<string, TemplateLocale>> = {};

for (const [path, raw] of Object.entries(RAW)) {
  const [locale, id] = splitAssetPath(path);
  // A template that names the product says `{{product}}`: the file is
  // written into the writer's folder, so it carries the public name from
  // `product.json`, filled in here, where templates are read.
  const text = raw.split("{{product}}").join(PRODUCT.name);
  const set = (LOCALES[locale] ??= {
    sections: { guidebook: {}, world: {} },
    character: "",
    arc: "",
  });
  if (id === "character") set.character = text;
  else if (id === "arc") set.arc = text;
  else {
    const [group, section] = id.split("/") as [SectionGroupId, string];
    set.sections[group][section] = text;
  }
}

const EN = LOCALES.en as TemplateLocale;

/** Every registered language, for the tests that must cover all of them. */
export const TEMPLATE_LOCALE_IDS = Object.keys(LOCALES).sort();

/** One language's assets, for the tests that lint the whole set. */
export function templateLocale(id: string): TemplateLocale | undefined {
  return LOCALES[id];
}

export const SECTION_TEMPLATES: Record<
  SectionGroupId,
  Record<string, string>
> = EN.sections;

/**
 * The assets for a project's language, falling back to English.
 *
 * `"en-GB"` and `"en"` are the same set of templates, so only the primary
 * subtag is consulted: a region is a spelling preference, and a writer who
 * picked British English must not get no templates at all.
 */
function localeFor(language: string | null | undefined): TemplateLocale {
  const primary = (language ?? "").toLowerCase().split("-")[0];
  // `hasOwnProperty.call`, not `?? EN`: a plain lookup answers inherited
  // names (`constructor`, `__proto__`, `toString`) with truthy
  // non-templates, and `document.language` is a hand-editable string from
  // the properties file, so the fallback fails closed. The lib
  // target predates `Object.hasOwn`.
  return Object.prototype.hasOwnProperty.call(LOCALES, primary)
    ? (LOCALES[primary] ?? EN)
    : EN;
}

/** The template for a catalogue section; empty when the pair has drifted. */
export function sectionTemplate(
  group: SectionGroupId,
  id: string,
  language?: string | null,
): string {
  return localeFor(language).sections[group][id] ?? "";
}

/** A character's sheet, with the writer's name in the title. */
export function characterTemplateFor(language?: string | null): string {
  return localeFor(language).character;
}

/** A character's arc, with the writer's name in the title and the heading. */
export function arcTemplateFor(language?: string | null): string {
  return localeFor(language).arc;
}

/**
 * Which fields hold the names `/where` reads, as every shipped language
 * spells them: a writer's sheets may have started from another language's
 * template.
 */
export const NAME_FIELDS: NameFields = (() => {
  const all = TEMPLATE_LOCALE_IDS.map((id) => {
    const locale = LOCALES[id] as TemplateLocale;
    return nameFieldsOf(
      locale.character,
      locale.sections.world.locations ?? "",
    );
  });
  return {
    sheet: [...new Set(all.flatMap((one) => one.sheet))],
    place: [...new Set(all.flatMap((one) => one.place))],
    placeholders: [...new Set(all.flatMap((one) => one.placeholders))],
  };
})();

/** Replace the one token a hand-named kind carries. */
export function substituteTitle(template: string, title: string): string {
  return template.split("{{title}}").join(title.trim());
}
