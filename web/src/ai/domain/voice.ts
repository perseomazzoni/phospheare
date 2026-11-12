// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { lensesFor } from "./craft";
import {
  OBSESSIONS,
  domainName,
  obsessionById,
  type Obsession,
  type ObsessionCatalogue,
} from "./obsessions";
import { presetFor } from "./personas";
import { aiSkills, autonomousSkills, type AiSkill } from "./skills";
import type { ChatKind, PersonaDefinition, PersonaPreset } from "./types";

// A persona, composed for one room. The persona file is a voice: a paragraph
// of temperament. What turns the voice into a professional is composed
// around it here, per chat: the obsessions its chosen preset holds, what it
// leaves to colleagues and to whom, and the craft lenses behind its
// obsessions. The room's job and form are the kind's (`policy.ts`), and a
// persona never overrides them.
//
// Composed per room because the same obsession is a different sentence in a
// different room. The reporting rooms carry what the persona notices; the
// rooms that ask (drafting, where the writer is mid-scene, and alpha, the
// friend who asks about intent) carry the same obsession as the question it
// makes the persona ask.

/** The rooms that carry an obsession as a question rather than a notice. */
const ASKING: readonly ChatKind[] = ["drafting", "alpha-reader"];
const READING: readonly ChatKind[] = ["alpha-reader", "beta-reader"];

export interface ComposedVoice {
  readonly preset: PersonaPreset;
  readonly obsessions: readonly Obsession[];
  /** The whole persona block for the system instructions. */
  readonly instructions: string;
}

/**
 * What a persona's paragraph is. The writer should feel distinct people, while
 * what they say rests on the other parameters. The voice is the sound
 * (register, address, sentence shape, what it opens and closes with) and
 * nothing else: the room's rules above it decide the job, the form and the
 * questions, and a voice that loosened any of them would make the persona the
 * one choice that changes what the writer gets. It is said once here rather
 * than in every persona file, so a new voice cannot forget it.
 */
const VOICE_FRAME = `Your persona. It decides how you sound — your register, how you address the writer, the shape of your sentences — in every language you answer in, and never what you do: the room's rules above decide the job, the form of the answer and what you may ask. Your obsessions below decide only what you look at first and whose department the rest is; they never make you decline a request the room allows, and a referral is said beside the answer, never instead of it. When the layers seem to pull two ways, the order is: the room's rules, then the request, then your obsessions, then your voice. Keep this voice from your first word to your last.`;

/**
 * The reporting rooms' focus, held. A voice set to continuity, asked where
 * the book is weak, must lead with continuity rather than answer about a
 * colleague's department and leave the continuity fault to voices not
 * looking for it. The referral line says whose department a thing is; this
 * says what to do first.
 */
const THROUGH_YOURS = `Whatever the writer asks, answer all of it that the room allows, and lead with what these show in this book: that is your contribution. Where the question reaches beyond them, still answer what you can see and name whose department that part is, so the writer knows whom to ask for the rest; a referral is an addition, never a refusal.`;

/**
 * The persona block for one chat: voice, obsessions, referrals, lenses.
 * `personas` resolves a referral's colleague to the name the writer knows. A
 * colleague that cannot work in this room is still named: "that is Spark's
 * department" is true in any room, and the writer can open a chat with Spark
 * where Spark works.
 */
export function composeVoice(
  persona: PersonaDefinition,
  kind: ChatKind,
  presetId: string | undefined,
  personas: readonly PersonaDefinition[],
  catalogue: ObsessionCatalogue = OBSESSIONS,
): ComposedVoice {
  const preset = presetFor(persona, kind, presetId);
  const obsessions = preset.obsessions.map((id) =>
    obsessionById(catalogue, id),
  );
  const asking = ASKING.includes(kind);
  const reading = READING.includes(kind);

  const lines = obsessions.map((one) => `- ${asking ? one.asks : one.notices}`);
  const focus = reading
    ? `As you read, these are what you notice first, most important first:\n${lines.join("\n")}`
    : asking
      ? `The questions you keep asking in this room, most important first:\n${lines.join("\n")}`
      : `Your obsessions — what you notice before anything else, most important first:\n${lines.join("\n")}\n\n${THROUGH_YOURS}`;

  const referrals = referralLine(persona, personas, catalogue);
  const skills = skillsLine(obsessions, kind);
  const lenses = lensesFor(obsessions.map((one) => one.lens));
  const craft = lenses.length
    ? `Craft notes behind your obsessions${reading ? " (for your own understanding — never use their vocabulary with the writer)" : ""}:\n\n${lenses
        .map((lens) => `### ${lens.title}\n${lens.body}`)
        .join("\n\n")}`
    : "";

  return {
    preset,
    obsessions,
    instructions: [
      VOICE_FRAME,
      persona.instructions,
      focus,
      referrals,
      skills,
      craft,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/**
 * The skills this voice's obsessions lead to, in this chat: the
 * room's methods whose lenses share a domain with the preset, the ones that
 * serve the most of its obsessions first. A persona knows when a skill is its
 * own and picks it up itself: the catalogue and the rule for when a skill
 * must be used ride on the `use_skill` tool, and this names the few that are
 * this voice's own. Silent when none is.
 */
function skillsLine(obsessions: readonly Obsession[], kind: ChatKind): string {
  const served = (lenses: readonly string[]) =>
    obsessions.filter((one) => lenses.includes(one.domain)).length;
  const ranked = (skills: readonly AiSkill[]) =>
    skills
      .map((skill) => ({ skill, served: served(skill.lenses) }))
      .filter((one) => one.served > 0)
      .sort((a, b) => b.served - a.served)
      .map((one) => one.skill);
  const mine = ranked(autonomousSkills(kind));
  // The methods closest to this voice that live in another chat. A
  // continuity preset in a drafting chat has no method of its own there, as
  // the continuity check is an editorial command, and would otherwise reach
  // for the nearest method offered and answer a continuity question with
  // line notes. Told where its method lives, it can do the check by hand and
  // say so. Never in a reader's chat: a reader is a reader, not a studio
  // pointing elsewhere.
  const reader = kind === "alpha-reader" || kind === "beta-reader";
  const elsewhere = ranked(
    aiSkills.filter(
      (skill) =>
        !reader &&
        skill.workflow === undefined &&
        !skill.chats.includes(kind) &&
        !mine.includes(skill),
    ),
  ).slice(0, 2);
  const lines: string[] = [];
  if (mine.length > 0)
    lines.push(
      `Your skills in this chat, the studio's methods closest to your obsessions: ${mine.map((one) => `/${one.command}`).join(", ")}. When a request touches one and use_skill is among your tools, pick it up and follow its method rather than improvising your own.`,
    );
  if (elsewhere.length > 0)
    lines.push(
      `Closest to your obsessions but run in another kind of chat: ${elsewhere.map((one) => `/${one.command} (${one.chats.join(", ")})`).join(", ")}. When the writer asks for that check here, do it as well as you can by reading, never through a skill made for another task, and say in one line where the full method runs.`,
    );
  return lines.join(" ");
}

function referralLine(
  persona: PersonaDefinition,
  personas: readonly PersonaDefinition[],
  catalogue: ObsessionCatalogue,
): string {
  if (persona.ignores.length === 0) return "";
  const byColleague = new Map<string, string[]>();
  for (const referral of persona.ignores) {
    const colleague = personas.find((one) => one.id === referral.personaId);
    if (!colleague) continue;
    const domains = byColleague.get(colleague.name) ?? [];
    domains.push(domainName(catalogue, referral.domain).toLowerCase());
    byColleague.set(colleague.name, domains);
  }
  if (byColleague.size === 0) return "";
  const parts = [...byColleague].map(
    ([name, domains]) => `${domains.join(", ")} (${name})`,
  );
  return `Not your department: ${parts.join("; ")}. When the writer needs one of these, say plainly whose department it is and carry on with your own.`;
}
