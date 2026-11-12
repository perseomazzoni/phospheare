// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A persona as its file defines it: voice, presets and referrals.

import type { ChatKind, ReadRef } from "./vocabulary";

/**
 * One focus a persona can work with: a named, ranked handful of obsessions
 * from `obsessions.md`, chosen per chat. The writer picks a preset, never a
 * trait: presets are prompts that have been run, and an arbitrary
 * combination is one nobody has run.
 */
export interface PersonaPreset {
  /** `line`, `skeptic`: unique across every persona; the i18n key's tail. */
  id: string;
  /** The rooms it works in: the persona's own, unless the file narrows it. */
  chats: ChatKind[];
  /** Obsession ids, most important first. Never more than five. */
  obsessions: string[];
  /** The reference documents this focus reads besides the room's. */
  reads: ReadRef[];
}

/** A domain a persona leaves to a colleague, and the colleague. */
export interface PersonaReferral {
  /** The obsession domain letter, `B`. */
  domain: string;
  /** The colleague's persona id. */
  personaId: string;
}

/**
 * One voice the assistant can answer in.
 *
 * Every field but `instructions` comes from the file that defines it, `id`
 * from its name and the rest from its frontmatter, so there is no persona
 * this application did not ship.
 *
 * There is no `revision`. A persona file is free to change; nothing
 * pins which wording of it answered.
 */
export interface PersonaDefinition {
  id: string;
  name: string;
  description: string;
  compatibleWith: ChatKind[];
  /**
   * The persona's voice: the body of its file, and nothing else. Its
   * obsessions, its referrals and its lenses are composed around this per
   * chat (`domain/voice.ts`); the room's form is the room's.
   */
  instructions: string;
  /** In file order; the first a kind allows is that kind's default. */
  presets: PersonaPreset[];
  /** What it leaves to colleagues, in file order. */
  ignores: PersonaReferral[];
  /**
   * The bundled URL of the voice's face, the `.png` beside its markdown.
   *
   * Not optional: every persona has a face, checked at module load by the
   * same folder-coherence guard that checks the ids, so no surface has to
   * draw a hole. It is a build artefact, not anything the writer's account
   * holds.
   */
  avatar: string;
  /**
   * The background colour of the face, as `#rrggbb`: the persona's colour
   * wherever it is counted or marked without its face. Read from the persona
   * file, so a new voice brings its own.
   */
  color: string;
}
