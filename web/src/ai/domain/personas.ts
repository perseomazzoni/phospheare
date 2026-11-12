// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  chatKindsField,
  parseFrontmatter,
  readsField,
  requireField,
  type Frontmatter,
} from "./frontmatter";
import { OBSESSIONS, type ObsessionCatalogue } from "./obsessions";
import type {
  ChatKind,
  PersonaDefinition,
  PersonaPreset,
  PersonaReferral,
} from "./types";

// ── The personas ─────────────────────────────────────────────────────────────
//
// One markdown file per persona, under `personas/`, read at build time. The
// folder is the whole list: dropping a file in is the entire act of adding a
// voice, and there is no second table of names to keep in step.
//
// No persona's name or id appears in this repository's source. A name in
// source can drift from the file that defines it, and has to be changed in
// two places to be changed at all.
//
// The personas are application assets, not the writer's documents: they ship
// inside the bundle, and no surface offers to edit them or add one. A voice
// the writer can rewrite in place is not one the product can reason about,
// and "why does this one answer differently now" would have no answer.
//
// ── Identity from the file name ──────────────────────────────────────────────
//
// `<id>-<name>[.default].md`, and each part carries meaning:
//
//   id      the digits before the first hyphen. Stored chats and stored turns
//           name it, and it is the sort key, so the pickers show the order of
//           the folder listing.
//   name    the rest of the stem, for whoever opens the folder; matched, then
//           discarded. The display name is a frontmatter field, because a
//           name is prose and may carry an accent, an inner capital or a
//           space, none of which belong in a file name.
//   default exactly one file carries it. That persona is the one a new chat
//           opens with and the one a chat falls back to, so a file name, not
//           a literal in the application, says which voice is the default.
//
// Beside each markdown file sits a `<id>-<name>.png`, the voice's face. The
// stem the two files share is what says they are one voice, so a rename that
// touches only one of them fails the build rather than drawing the wrong
// face. `.default` is not part of that stem, because which voice opens a new
// chat is a fact about the prose, and recording it must not require
// re-exporting a picture.
//
// A file may be reworded freely and nothing records that it was: a
// version number on a prompt is a promise to keep old wordings around, and
// this repository keeps none.
//
// Every guard on the folder's shape throws at module load, which is build
// time for the bundle and the first import in a test. Each guard takes the
// folder's contents as arguments and is exported, so `personas.test.ts` fires
// it against a folder it invents; the shipped folder fires none.

/** Every persona file, keyed by its path. */
const RAW = import.meta.glob<string>("./personas/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * Every persona's face, keyed by its path.
 *
 * `?url` is explicit rather than left to the default export: the bundler's
 * answer for a `.png` is its URL, but a build-config change could make it an
 * inlined data URI. These are 130KB each and must never be embedded in the
 * JavaScript the editor chunk parses before it can draw anything.
 */
const FACES = import.meta.glob<string>("./personas/*.png", {
  query: "?url",
  import: "default",
  eager: true,
});

/** `10-mary-ann.default.md` → `{ id: "10", isDefault: true }`. */
const STEM = /^(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*(\.default)?$/;

/**
 * Reads the identity a persona file's name declares. The slug between the id
 * and the marker is matched, so a file cannot be called anything at all, and
 * then discarded.
 */
export function parsePersonaName(path: string): {
  id: string;
  isDefault: boolean;
} {
  const stem = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  const match = STEM.exec(stem);
  if (!match) throw new Error(`${stem}.md: name is not <id>-<name>[.default]`);
  const [, id, marker] = match;
  return { id, isDefault: marker !== undefined };
}

/**
 * The part of a file name the markdown and the picture share.
 *
 * `./personas/10-phos.default.md` and `./personas/10-phos.png` both answer
 * `10-phos`. The id alone would pair them but is the wrong key:
 * `10-anything.png` would then satisfy `10-phos.default.md`, and one careless
 * rename would give a voice another's face with nothing failing.
 */
export function voiceStem(path: string): string {
  return path
    .slice(path.lastIndexOf("/") + 1)
    .replace(/\.(md|png)$/, "")
    .replace(/\.default$/, "");
}

/**
 * The face beside a persona file, or a refusal.
 *
 * It throws because a missing picture has no sensible drawing. A placeholder
 * would ship a voice with a hole where its face goes and tell nobody who
 * could fix it, and `avatar: string | null` would push that silence into both
 * pickers and every test that builds a persona.
 */
export function resolveFace(
  path: string,
  faces: Record<string, string>,
): string {
  const stem = voiceStem(path);
  const found = Object.entries(faces).find(
    ([at]) => voiceStem(at) === stem,
  )?.[1];
  if (!found) throw new Error(`personas: ${stem}.md has no ${stem}.png`);
  return found;
}

/**
 * A persona file is its name, a frontmatter block and a paragraph. The
 * frontmatter carries what a file name holds badly: the display name, what
 * the voice is for, and which chats may use it.
 *
 * The face arrives as an argument because it is not in the text: it is a
 * sibling file, resolved by `resolveFace` from the folder listing.
 */
export function parsePersona(
  path: string,
  text: string,
  avatar: string,
): PersonaDefinition {
  const { id } = parsePersonaName(path);
  const parsed = parseFrontmatter(path, text);
  // A persona must declare a block, though `parseFrontmatter` allows a file
  // without one for skills. The check comes before the first `requireField`,
  // because "missing name" would send the author looking for a line to fix in
  // a file that has no block to put it in.
  if (parsed.fields.size === 0) throw new Error(`${path}: no frontmatter`);
  const need = (key: string) => requireField(path, parsed, key);
  const compatibleWith = chatKindsField(path, parsed, "compatibleWith");
  const color = need("color");
  if (!/^#[0-9a-fA-F]{6}$/.test(color))
    throw new Error(`${path}: color must be #rrggbb, not ${color}`);
  return {
    id,
    name: need("name"),
    description: need("description"),
    compatibleWith,
    instructions: parsed.body,
    presets: presetsOf(path, parsed, compatibleWith),
    ignores: referralsOf(path, parsed),
    avatar,
    color,
  };
}

// ── Presets and referrals ────────────────────────────────────────────────────
//
// Flat lines, like every other key here, so a preset is three of them:
//
//   preset.line: F.rhythm, F.echo, F.economy     the obsessions, ranked
//   preset.line.chats: editorial                 optional; the persona's own
//   preset.line.reads: guidebook:prose-style     optional; a skill's `reads:` grammar
//
// The order of the `preset.<id>` lines is the order the picker shows, and the
// first a room allows is that room's default, as the folder's order decides
// which voice a new chat opens with. Only the shape is checked here;
// `checkVoices`, which has the catalogue and every persona in hand, checks
// that each obsession exists.

const PRESET_KEY = /^preset\.([a-z]+(?:-[a-z]+)*)(?:\.(chats|reads))?$/;
/** The most obsessions one preset holds: a model's attention is finite. */
export const PRESET_OBSESSIONS_MAX = 5;

function presetsOf(
  path: string,
  parsed: Frontmatter,
  compatibleWith: readonly ChatKind[],
): PersonaPreset[] {
  const presets: PersonaPreset[] = [];
  for (const key of parsed.fields.keys()) {
    if (!key.startsWith("preset")) continue;
    const match = PRESET_KEY.exec(key);
    if (!match) throw new Error(`${path}: "${key}" is not a preset line`);
    const [, id, part] = match;
    if (part !== undefined) {
      if (!parsed.fields.has(`preset.${id}`))
        throw new Error(`${path}: ${key} names no preset`);
      continue;
    }
    const obsessions = requireField(path, parsed, key)
      .split(",")
      .map((one) => one.trim());
    if (obsessions.length > PRESET_OBSESSIONS_MAX)
      throw new Error(
        `${path}: preset ${id} holds more than ${PRESET_OBSESSIONS_MAX} obsessions`,
      );
    if (new Set(obsessions).size !== obsessions.length)
      throw new Error(`${path}: preset ${id} names an obsession twice`);
    const chats = parsed.fields.has(`${key}.chats`)
      ? chatKindsField(path, parsed, `${key}.chats`)
      : [...compatibleWith];
    for (const kind of chats)
      if (!compatibleWith.includes(kind))
        throw new Error(
          `${path}: preset ${id} works in ${kind}, the persona does not`,
        );
    presets.push({
      id,
      chats,
      obsessions,
      reads: parsed.fields.has(`${key}.reads`)
        ? readsField(path, parsed, `${key}.reads`)
        : [],
    });
  }
  // Every room the persona works in has a focus to open with: a room with
  // none would compose a voice with no obsessions and say nothing about it.
  for (const kind of compatibleWith)
    if (!presets.some((preset) => preset.chats.includes(kind)))
      throw new Error(`${path}: no preset for ${kind}`);
  return presets;
}

function referralsOf(path: string, parsed: Frontmatter): PersonaReferral[] {
  const raw = parsed.fields.get("ignores");
  if (raw === undefined) return [];
  return raw.split(",").map((pair) => {
    const match = /^\s*([A-Z])\s*>\s*(\d+)\s*$/.exec(pair);
    if (!match)
      throw new Error(
        `${path}: "${pair.trim()}" in ignores is not <domain> > <id>`,
      );
    return { domain: match[1], personaId: match[2] };
  });
}

/**
 * The folder and the catalogue, checked against each other once: every
 * obsession a preset names exists, every preset id is unique across the whole
 * folder (it is an i18n key's tail and a stored preference), and every
 * referral names a real domain and a real colleague who is not the persona
 * itself.
 */
export function checkVoices(
  personas: readonly PersonaDefinition[],
  catalogue: ObsessionCatalogue,
): void {
  const presetIds = new Set<string>();
  const known = new Set(catalogue.obsessions.map((one) => one.id));
  const domains = new Set(catalogue.domains.map((one) => one.letter));
  for (const persona of personas) {
    for (const preset of persona.presets) {
      if (presetIds.has(preset.id))
        throw new Error(`personas: preset ${preset.id} declared twice`);
      presetIds.add(preset.id);
      for (const id of preset.obsessions)
        if (!known.has(id))
          throw new Error(
            `personas: ${persona.name}'s ${preset.id} names no obsession ${id}`,
          );
    }
    for (const referral of persona.ignores) {
      if (!domains.has(referral.domain))
        throw new Error(
          `personas: ${persona.name} ignores no domain ${referral.domain}`,
        );
      if (
        referral.personaId === persona.id ||
        !personas.some((one) => one.id === referral.personaId)
      )
        throw new Error(
          `personas: ${persona.name} refers ${referral.domain} to no colleague ${referral.personaId}`,
        );
      // A referral lands with a colleague who does that work. A colleague who
      // refers the same domain onward would tell the writer the opposite of
      // what the referring persona said, so the pair is refused.
      const colleague = personas.find((one) => one.id === referral.personaId);
      if (colleague?.ignores.some((one) => one.domain === referral.domain))
        throw new Error(
          `personas: ${persona.name} refers ${referral.domain} to ${colleague.name}, who refers it on`,
        );
    }
  }
}

/**
 * Every persona, in the order of the ids on the files.
 *
 * The glob's keys are sorted rather than trusted, because a bundler owes no
 * particular order.
 */
export const PERSONAS: readonly PersonaDefinition[] = Object.entries(RAW)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, text]) => parsePersona(path, text, resolveFace(path, FACES)));

/**
 * The folder's own coherence, checked once, plus the persona it declares
 * default, the single file whose name ends `.default`.
 *
 * Each refusal is a state the application cannot run in and none announces
 * itself later: two files claiming one id make `personaById` answer by sort
 * order, a folder with no default leaves every new chat pointing at nothing,
 * and a folder with two makes the default depend on an order nobody wrote
 * down.
 */
export function resolveDefault(
  personas: readonly PersonaDefinition[],
  defaultIds: readonly string[],
): PersonaDefinition {
  const seen = new Set<string>();
  for (const persona of personas) {
    if (seen.has(persona.id))
      throw new Error(`personas: duplicate id ${persona.id}`);
    seen.add(persona.id);
  }
  if (defaultIds.length !== 1)
    throw new Error(
      `personas: expected exactly one *.default.md, found ${defaultIds.length}`,
    );
  const found = personas.find((one) => one.id === defaultIds[0]);
  if (!found)
    throw new Error(`personas: default ${defaultIds[0]} did not parse`);
  return found;
}

export const DEFAULT_PERSONA: PersonaDefinition = resolveDefault(
  PERSONAS,
  Object.keys(RAW)
    .sort()
    .map(parsePersonaName)
    .filter((one) => one.isDefault)
    .map((one) => one.id),
);

checkVoices(PERSONAS, OBSESSIONS);

/**
 * The persona's focus in a room: the stored one when the persona offers it
 * there, else the room's first. Never `null`, because `presetsOf` refuses a
 * persona with a room and no preset for it, so a chat always composes a voice
 * with obsessions in it.
 */
export function presetFor(
  persona: PersonaDefinition,
  kind: ChatKind,
  presetId?: string,
): PersonaPreset {
  const offered = persona.presets.filter((one) => one.chats.includes(kind));
  return (
    offered.find((one) => one.id === presetId) ??
    offered[0] ??
    // A persona asked for a room it does not work in is `personaById`'s
    // refusal, not this one's.
    persona.presets[0]
  );
}

/** The presets a persona offers in a room, in file order. */
export function presetsFor(
  persona: PersonaDefinition,
  kind: ChatKind,
): PersonaPreset[] {
  return persona.presets.filter((one) => one.chats.includes(kind));
}

export function personasFor(kind: ChatKind): PersonaDefinition[] {
  return PERSONAS.filter((one) => one.compatibleWith.includes(kind));
}

export function personaById(
  id: string,
  kind: ChatKind,
): PersonaDefinition | null {
  return personasFor(kind).find((one) => one.id === id) ?? null;
}
