// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { LENSES } from "./craft";
import RAW from "./obsessions.md?raw";
import { DETECTOR_IDS } from "./signals/detect";
import type { AiSkill } from "./skills";

// The obsession catalogue: the one list of what a persona cannot stop
// noticing, in one Markdown file beside the personas, read at build time
// like every other asset folder here: an entry is a few `key: value` lines
// under a `### <id>` heading, grouped by `## <letter> — <domain>`.
//
// A persona never carries its obsessions as prose of its own. It names ids in
// its presets, and the prompt is rendered from this file, so a notice is
// worded once and a better wording reaches every voice that holds it.
//
// The reader is strict, as `frontmatter.ts`'s is: an entry that says
// something this app cannot use (an unknown key, a severity nobody reads, a
// lens with no file) throws at module load, naming itself.

/** How much a finding of this kind costs the book. */
export const SEVERITIES = ["craft", "clarity", "contract"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Obsession {
  /** `B.causality` — the domain letter, a dot, a kebab-case name. */
  readonly id: string;
  /** The domain letter the id opens with, `B`. */
  readonly domain: string;
  /** One line: what the persona sees, as a reporting room's prompt carries. */
  readonly notices: string;
  /** The same thing as a question, for the rooms that ask (drafting, alpha). */
  readonly asks: string;
  /** What it looks like on the page. */
  readonly signals?: string;
  /** When it is a choice, not a fault. */
  readonly exceptions?: string;
  readonly severity: Severity;
  /** The craft lens that explains it in depth (`craft/<lens>.md`). */
  readonly lens?: string;
  /** The deterministic pre-pass that finds candidates for it (`signals/`). */
  readonly detector?: string;
}

export interface ObsessionDomain {
  /** `B`. */
  readonly letter: string;
  /** `Structure` — English, like every instruction the model reads. */
  readonly name: string;
}

export interface ObsessionCatalogue {
  readonly domains: readonly ObsessionDomain[];
  readonly obsessions: readonly Obsession[];
}

const ID = /^([A-Z])\.[a-z]+(?:-[a-z]+)*$/;
const DOMAIN = /^##\s+([A-Z])\s+—\s+(.+)$/;
const ENTRY = /^###\s+(\S+)\s*$/;
const KEYS = new Set([
  "notices",
  "asks",
  "signals",
  "exceptions",
  "severity",
  "lens",
  "detector",
]);

/**
 * Read the catalogue. `lenses` and `detectors` are the ids that exist, passed
 * in so the reader stays a pure function of its text and every guard can be
 * fired from a test with a catalogue it invents.
 *
 * Anything before the first domain heading is the file's own preamble, for
 * whoever opens it, and is not read.
 */
export function parseObsessions(
  text: string,
  lenses: ReadonlySet<string>,
  detectors: ReadonlySet<string>,
): ObsessionCatalogue {
  const domains: ObsessionDomain[] = [];
  const obsessions: Obsession[] = [];
  const seen = new Set<string>();
  let domain: ObsessionDomain | null = null;
  let entry: { id: string; fields: Map<string, string> } | null = null;

  const close = () => {
    if (!entry) return;
    obsessions.push(finish(entry.id, entry.fields, lenses, detectors));
    entry = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = DOMAIN.exec(line);
    if (heading) {
      close();
      const [, letter, name] = heading;
      if (domains.some((one) => one.letter === letter))
        throw new Error(`obsessions: domain ${letter} declared twice`);
      domain = { letter, name: name.trim() };
      domains.push(domain);
      continue;
    }
    const opened = ENTRY.exec(line);
    if (opened) {
      close();
      const id = opened[1];
      const match = ID.exec(id);
      if (!match) throw new Error(`obsessions: "${id}" is not <letter>.<name>`);
      if (!domain || match[1] !== domain.letter)
        throw new Error(`obsessions: ${id} is outside its domain`);
      if (seen.has(id)) throw new Error(`obsessions: ${id} declared twice`);
      seen.add(id);
      entry = { id, fields: new Map() };
      continue;
    }
    if (!entry || !line) continue;
    const at = line.indexOf(":");
    if (at === -1)
      throw new Error(`obsessions: ${entry.id}: bad line "${line}"`);
    const key = line.slice(0, at).trim();
    if (!KEYS.has(key))
      throw new Error(`obsessions: ${entry.id}: unknown key "${key}"`);
    if (entry.fields.has(key))
      throw new Error(`obsessions: ${entry.id}: ${key} declared twice`);
    entry.fields.set(key, line.slice(at + 1).trim());
  }
  close();
  if (obsessions.length === 0) throw new Error("obsessions: none declared");
  return { domains, obsessions };
}

function finish(
  id: string,
  fields: ReadonlyMap<string, string>,
  lenses: ReadonlySet<string>,
  detectors: ReadonlySet<string>,
): Obsession {
  const need = (key: string) => {
    const value = fields.get(key);
    if (!value) throw new Error(`obsessions: ${id}: missing ${key}`);
    return value;
  };
  const severity = need("severity");
  if (!(SEVERITIES as readonly string[]).includes(severity))
    throw new Error(`obsessions: ${id}: unknown severity "${severity}"`);
  const lens = fields.get("lens");
  if (lens !== undefined && !lenses.has(lens))
    throw new Error(`obsessions: ${id}: no lens "${lens}"`);
  const detector = fields.get("detector");
  if (detector !== undefined && !detectors.has(detector))
    throw new Error(`obsessions: ${id}: no detector "${detector}"`);
  const optional = (key: string) => {
    const value = fields.get(key);
    return value ? { [key]: value } : {};
  };
  return {
    id,
    domain: id.slice(0, 1),
    notices: need("notices"),
    asks: need("asks"),
    ...optional("signals"),
    ...optional("exceptions"),
    severity: severity as Severity,
    ...(lens ? { lens } : {}),
    ...(detector ? { detector } : {}),
  };
}

/**
 * The shipped catalogue. Its lenses and detectors are checked against the
 * lens folder and the detector registry, so this module imports those two,
 * and neither of them may import this one.
 */
export const OBSESSIONS: ObsessionCatalogue = parseObsessions(
  RAW,
  new Set(LENSES.keys()),
  DETECTOR_IDS,
);

/** An obsession by id, or a throw naming it: a preset names only real ones. */
export function obsessionById(
  catalogue: ObsessionCatalogue,
  id: string,
): Obsession {
  const found = catalogue.obsessions.find((one) => one.id === id);
  if (!found) throw new Error(`obsessions: no ${id}`);
  return found;
}

/** A domain's name by its letter, or a throw. */
export function domainName(
  catalogue: ObsessionCatalogue,
  letter: string,
): string {
  const found = catalogue.domains.find((one) => one.letter === letter);
  if (!found) throw new Error(`obsessions: no domain ${letter}`);
  return found.name;
}

/**
 * `obsessions` and, after them, one obsession for each detector the skill's
 * lenses reach that none of them already runs. A voice whose own
 * obsessions have no detectors would otherwise leave the pre-pass silent
 * under a skill. Once a skill is the task, its domains' word lists are on
 * topic, which is the one reason the pre-pass otherwise keeps to the voice's
 * own (`signals/briefing.ts`).
 */
export function withSkillDetectors(
  obsessions: readonly Obsession[],
  skill: AiSkill,
): Obsession[] {
  const running = new Set(obsessions.map((one) => one.detector));
  const added = OBSESSIONS.obsessions.filter((one) => {
    if (!one.detector || !skill.lenses.includes(one.domain)) return false;
    if (running.has(one.detector)) return false;
    running.add(one.detector);
    return true;
  });
  return [...obsessions, ...added];
}
