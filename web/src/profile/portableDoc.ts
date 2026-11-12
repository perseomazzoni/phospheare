// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { PrefEntry, PrefStore } from "./profileSync";
import { asCardContent } from "./library";
import type { CardContent, LibraryRow } from "./profileStore";
import { FOCUS_MODES } from "../project/properties";
import {
  AUTOSAVE_DELAY_PRESETS,
  HENOSIS_AFTER_PRESETS,
  HENOSIS_FADE_PRESETS,
  HENOSIS_PAUSE_PRESETS,
  PROSE_SIZES,
} from "../project/types";
import { APP_LANGUAGES } from "../locales/languages";
import { allFamilies } from "../theme/application/registry";
import { parseChoice } from "../theme/domain/choice";

// The writer's portable profile as one installation holds it: preferences
// and library membership with their clocks, removals as tombstones. Each
// installation writes only its own copy, and every copy merges the others
// with the same deterministic rules, so a concurrent change on two devices
// never erases an unrelated one:
//
// - a preference is the entry with the newest `updatedAt`; equal clocks go to
//   the larger installation id, the same answer on every device;
// - a project's membership is its newest event, an add (`at`) or a removal
//   (`removedAt`); a removal wins only when strictly newer than the add it
//   answers, so re-adding a forgotten book at the same instant keeps it;
// - a card is the newest `cachedAt` among live rows;
// - tombstones are kept, so an old device coming back cannot resurrect a
//   project the writer forgot;
// - another installation's entry stamped more than `CLOCK_SKEW_MS` ahead of
//   this device waits until this device's clock reaches it, so a device with
//   a fast clock cannot pin a value that no honest edit can overtake.
//
// Stamps are ordered as times, never as text: a valid stamp may carry from
// zero to three fraction digits, and text order disagrees with time order
// across those.
//
// A copy read from Remote Storage is untrusted: every entry passes the same
// domain checks a local write does, and anything else is dropped.

export interface PortableRow {
  id: string;
  provider: string;
  key: string;
  name: string;
  openedAt: string | null;
  /** The membership clock: the newest add or location change. */
  at: string;
  /** Set when the newest membership event is a removal. */
  removedAt: string | null;
  card: CardContent | null;
}

export interface PortableDoc {
  v: 1;
  installation: string;
  prefs: PrefStore;
  library: Record<string, PortableRow>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const TEXT_LIMIT = 255;
const MAX_ROWS = 5_000;
/** How far ahead of this device another installation's stamp may be. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

// ── Preference domain ────────────────────────────────────────────────────────
//
// The portable preferences and the values each may take. A key not listed
// here is never imported from another device: endpoints, folders and
// credentials are not preferences and have no entry. The value
// lists are the ones the app offers, so a new preset or theme syncs with no
// change here; a theme is checked against the registry when it is read.

const oneOf =
  (values: readonly unknown[]) =>
  (v: unknown): boolean =>
    values.includes(v);

function registeredTheme(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const choice = parseChoice(v);
  return (
    choice !== null &&
    allFamilies().some((family) => family.id === choice.family)
  );
}

const DOMAIN: Record<string, (value: unknown) => boolean> = {
  theme: registeredTheme,
  language: oneOf(APP_LANGUAGES.map((language) => language.value)),
  density: (v) => v === "grid" || v === "list",
  filter: (v) => v === "all" || v === "local" || v === "drive",
  focus: oneOf(FOCUS_MODES),
  proseSize: oneOf(PROSE_SIZES),
  autosaveDelay: oneOf(AUTOSAVE_DELAY_PRESETS),
  henosisAfter: oneOf(HENOSIS_AFTER_PRESETS),
  henosisFade: oneOf(HENOSIS_FADE_PRESETS),
  henosisPause: oneOf(HENOSIS_PAUSE_PRESETS),
  typewriter: (v) => typeof v === "boolean",
  smoothCaret: (v) => typeof v === "boolean",
  autosave: (v) => typeof v === "boolean",
  henosis: (v) => typeof v === "boolean",
  aiModels: validModels,
};

function validModels(v: unknown): boolean {
  if (!Array.isArray(v) || v.length > 24) return false;
  return v.every((item) => {
    if (!item || typeof item !== "object") return false;
    const keys = Object.keys(item);
    if (keys.length !== 2) return false;
    const { providerId, modelId } = item as Record<string, unknown>;
    return modelText(providerId) && modelText(modelId);
  });
}

function modelText(v: unknown): boolean {
  return (
    typeof v === "string" &&
    v !== "" &&
    new TextEncoder().encode(v).length <= 160 &&
    !/\p{Cc}/u.test(v)
  );
}

/** Whether `key` is a portable preference and `value` one of its values. */
export function validPref(key: string, value: unknown): boolean {
  const check = Object.prototype.hasOwnProperty.call(DOMAIN, key)
    ? DOMAIN[key]
    : undefined;
  return check !== undefined && check(value);
}

/** Every key `validPref` accepts. */
export const PORTABLE_PREFS: readonly string[] = Object.keys(DOMAIN);

// ── Shape checks ─────────────────────────────────────────────────────────────

function plainText(v: unknown, limit = TEXT_LIMIT): v is string {
  return (
    typeof v === "string" &&
    v.length <= limit &&
    !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(v)
  );
}

function stamp(v: unknown): v is string {
  return typeof v === "string" && STAMP.test(v) && !Number.isNaN(Date.parse(v));
}

/** A stamp as milliseconds; anything that is not a time orders first. */
function time(v: string): number {
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? -Infinity : ms;
}

function later(a: string, b: string): string {
  return time(a) >= time(b) ? a : b;
}

function asPortableRow(id: string, raw: unknown): PortableRow | null {
  if (!UUID.test(id) || !raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.provider !== "local" && r.provider !== "drive") return null;
  if (!plainText(r.key) || r.key === "" || !plainText(r.name)) return null;
  if (r.provider === "drive" && !/^[A-Za-z0-9_-]+$/.test(r.key)) return null;
  if (!stamp(r.at)) return null;
  const removedAt = stamp(r.removedAt) ? r.removedAt : null;
  const card = removedAt === null ? asCardContent(r.card) : null;
  return {
    id: id.toLowerCase(),
    provider: r.provider,
    key: r.key,
    name: r.name,
    openedAt: stamp(r.openedAt) ? r.openedAt : null,
    at: r.at,
    removedAt,
    card: card && card.id.toLowerCase() === id.toLowerCase() ? card : null,
  };
}

/** A copy read from storage or another device, reduced to what is valid. */
export function asPortableDoc(raw: unknown): PortableDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.v !== 1 || typeof d.installation !== "string") return null;
  const prefs: PrefStore = {};
  if (d.prefs && typeof d.prefs === "object" && !Array.isArray(d.prefs)) {
    for (const [key, entry] of Object.entries(d.prefs)) {
      if (!entry || typeof entry !== "object") continue;
      const { value, updatedAt } = entry as Record<string, unknown>;
      if (stamp(updatedAt) && validPref(key, value))
        prefs[key] = { value, updatedAt };
    }
  }
  const library: Record<string, PortableRow> = {};
  if (d.library && typeof d.library === "object" && !Array.isArray(d.library)) {
    let rows = 0;
    for (const [id, entry] of Object.entries(d.library)) {
      if (rows >= MAX_ROWS) break;
      const row = asPortableRow(id, entry);
      if (row) {
        library[row.id] = row;
        rows += 1;
      }
    }
  }
  return { v: 1, installation: d.installation, prefs, library };
}

/**
 * Whether `doc`, parsed from `raw`, kept every preference and row the copy
 * carried. A value this build does not know (a theme family added later,
 * say) is left out, and a later build may take it.
 */
export function keptWhole(raw: unknown, doc: PortableDoc): boolean {
  const d = raw as Record<string, unknown>;
  const count = (part: unknown) =>
    part && typeof part === "object" && !Array.isArray(part)
      ? Object.keys(part).length
      : 0;
  return (
    count(d.prefs) === Object.keys(doc.prefs).length &&
    count(d.library) === Object.keys(doc.library).length
  );
}

export function emptyDoc(installation: string): PortableDoc {
  return { v: 1, installation, prefs: {}, library: {} };
}

// ── Local edits ──────────────────────────────────────────────────────────────

/** Applies one preference write; an out-of-domain value changes nothing. */
export function applyPref(
  doc: PortableDoc,
  key: string,
  entry: PrefEntry,
): void {
  if (!validPref(key, entry.value) || !stamp(entry.updatedAt)) return;
  const held = doc.prefs[key];
  if (held && time(held.updatedAt) >= time(entry.updatedAt)) return;
  doc.prefs[key] = { value: entry.value, updatedAt: entry.updatedAt };
}

/**
 * Applies an add, a location change or a content push. A content push names
 * the membership stamp it was observed under (`seenAt`): it never creates or
 * revives a row, and it moves the row's name and location only when that
 * stamp is still the row's newest. A push that does move them also moves the
 * row's `at` to its own stamp, so the merge prefers the moved row over a copy
 * that never saw the change. A stale add loses to a newer removal and to a
 * newer add.
 */
export function applyAdd(
  doc: PortableDoc,
  add: {
    id: string;
    provider: string;
    key: string;
    name: string;
    at: string;
    seenAt?: string;
    card?: CardContent;
  },
): void {
  const id = add.id.toLowerCase();
  const held = doc.library[id];
  const live = held && held.removedAt === null ? held : null;
  let next: PortableRow | null;
  if (add.seenAt !== undefined) {
    if (!live) return;
    const moved =
      add.provider !== live.provider ||
      add.key !== live.key ||
      add.name !== live.name;
    next =
      time(add.seenAt) >= time(live.at)
        ? asPortableRow(id, {
            ...live,
            provider: add.provider,
            key: add.key,
            name: add.name,
            at: moved && stamp(add.at) ? later(add.at, live.at) : live.at,
          })
        : { ...live };
  } else if (
    held &&
    held.removedAt !== null &&
    time(add.at) < time(held.removedAt)
  ) {
    return;
  } else if (live && time(add.at) < time(live.at)) {
    next = { ...live };
  } else {
    next = asPortableRow(id, {
      provider: add.provider,
      key: add.key,
      name: add.name,
      at: add.at,
      openedAt: held?.openedAt ?? add.at,
      removedAt: null,
    });
    if (next && live) next.card = live.card;
  }
  if (!next) return;
  if (add.card) {
    const card = asCardContent(add.card);
    if (
      card &&
      card.id.toLowerCase() === id &&
      (!next.card || time(card.cachedAt) > time(next.card.cachedAt))
    )
      next.card = card;
  }
  doc.library[id] = next;
}

/** Applies a removal: a tombstone, newer than the add it answers. */
export function applyRemove(doc: PortableDoc, id: string, at: string): void {
  const key = id.toLowerCase();
  if (!UUID.test(key) || !stamp(at)) return;
  const held = doc.library[key];
  if (held) {
    if (time(at) <= time(held.removedAt ?? held.at)) return;
    doc.library[key] = { ...held, removedAt: at, card: null };
    return;
  }
  // A removal of a row this copy never saw is still kept, so a device that
  // has the add cannot bring it back after this one forgot it.
  doc.library[key] = {
    id: key,
    provider: "local",
    key: key,
    name: key,
    openedAt: null,
    at,
    removedAt: at,
    card: null,
  };
}

// ── Merging copies ───────────────────────────────────────────────────────────

function newerPref(
  a: PrefEntry,
  aFrom: string,
  b: PrefEntry,
  bFrom: string,
): boolean {
  if (time(a.updatedAt) !== time(b.updatedAt))
    return time(a.updatedAt) > time(b.updatedAt);
  return aFrom > bFrom;
}

function rowClock(row: PortableRow): string {
  return row.removedAt ?? row.at;
}

function rowDue(row: PortableRow, limit: number): boolean {
  return (
    time(row.at) <= limit &&
    (row.removedAt === null || time(row.removedAt) <= limit)
  );
}

/**
 * `doc` without the entries stamped after `limit`. The copy they came from
 * still holds them, so a later merge takes them once their time comes.
 */
function dueBy(doc: PortableDoc, limit: number): PortableDoc {
  const prefs: PrefStore = {};
  for (const [key, entry] of Object.entries(doc.prefs))
    if (time(entry.updatedAt) <= limit) prefs[key] = entry;
  const library: Record<string, PortableRow> = {};
  for (const row of Object.values(doc.library)) {
    if (!rowDue(row, limit)) continue;
    library[row.id] =
      row.card && time(row.card.cachedAt) > limit
        ? { ...row, card: null }
        : row;
  }
  return { ...doc, prefs, library };
}

/**
 * Whether `mergeDocs` at `now` leaves out any of another installation's
 * `doc`: a merge that skips an unchanged copy must not skip this one.
 *
 * @param now this device's clock, in milliseconds.
 */
export function holdsLater(
  doc: PortableDoc,
  now: number = Date.now(),
): boolean {
  const limit = now + CLOCK_SKEW_MS;
  return (
    Object.values(doc.prefs).some((entry) => time(entry.updatedAt) > limit) ||
    Object.values(doc.library).some(
      (row) =>
        !rowDue(row, limit) ||
        (row.card !== null && time(row.card.cachedAt) > limit),
    )
  );
}

/**
 * The merge of every installation's copy into `own`'s installation. The
 * result is the same whichever device computes it, once every device's clock
 * has passed the newest stamp; until then another installation's entry more
 * than `CLOCK_SKEW_MS` ahead of `now` is left out.
 *
 * @param now this device's clock, in milliseconds.
 */
export function mergeDocs(
  own: PortableDoc,
  others: PortableDoc[],
  now: number = Date.now(),
): PortableDoc {
  const limit = now + CLOCK_SKEW_MS;
  const all = [
    own,
    ...others.map((doc) =>
      doc.installation === own.installation ? doc : dueBy(doc, limit),
    ),
  ];
  const out = emptyDoc(own.installation);
  const prefFrom: Record<string, string> = {};
  for (const doc of all) {
    for (const [key, entry] of Object.entries(doc.prefs)) {
      const held = out.prefs[key];
      if (!held || newerPref(entry, doc.installation, held, prefFrom[key])) {
        out.prefs[key] = entry;
        prefFrom[key] = doc.installation;
      }
    }
  }
  const rowFrom: Record<string, string> = {};
  for (const doc of all) {
    for (const row of Object.values(doc.library)) {
      const held = out.library[row.id];
      if (!held) {
        out.library[row.id] = { ...row };
        rowFrom[row.id] = doc.installation;
        continue;
      }
      const a = time(rowClock(row));
      const b = time(rowClock(held));
      // At an equal clock an add beats a removal (`applyAdd`), and two of the
      // same kind go to the larger installation id.
      const wins =
        a > b ||
        (a === b &&
          ((row.removedAt === null && held.removedAt !== null) ||
            ((row.removedAt === null) === (held.removedAt === null) &&
              doc.installation > rowFrom[row.id])));
      const winner = wins ? { ...row } : held;
      if (wins) rowFrom[row.id] = doc.installation;
      const opened = [row.openedAt, held.openedAt]
        .filter((t): t is string => t !== null)
        .sort((x, y) => time(x) - time(y))[0];
      winner.openedAt = opened ?? null;
      out.library[row.id] = winner;
    }
  }
  // Cards: the newest observation of a live row, from any copy.
  for (const doc of all) {
    for (const row of Object.values(doc.library)) {
      const target = out.library[row.id];
      if (!target || target.removedAt !== null || !row.card) continue;
      if (!target.card || time(row.card.cachedAt) > time(target.card.cachedAt))
        target.card = row.card;
    }
  }
  for (const row of Object.values(out.library))
    if (row.removedAt !== null) row.card = null;
  return out;
}

/** Whether two copies hold the same profile, installation aside. */
export function sameContent(a: PortableDoc, b: PortableDoc): boolean {
  return (
    JSON.stringify(sorted(a.prefs)) === JSON.stringify(sorted(b.prefs)) &&
    JSON.stringify(sorted(a.library)) === JSON.stringify(sorted(b.library))
  );
}

function sorted<T>(record: Record<string, T>): [string, T][] {
  return Object.entries(record).sort(([x], [y]) =>
    x < y ? -1 : x > y ? 1 : 0,
  );
}

// ── What the shelf reads ─────────────────────────────────────────────────────

/** The live rows in the shelf's shape; tombstones stay in the copy. */
export function libraryOf(doc: PortableDoc): LibraryRow[] {
  return Object.values(doc.library)
    .filter((row) => row.removedAt === null)
    .map((row) => ({
      id: row.id,
      provider: row.provider,
      key: row.key,
      name: row.name,
      openedAt: row.openedAt,
      lastSeenAt: row.at,
      removedAt: null,
      card: row.card,
    }));
}
