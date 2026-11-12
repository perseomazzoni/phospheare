// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { CardContent, LibraryRow } from "../../../../profile/profileStore";
import {
  libraryCard,
  libraryRefs,
  libraryRowFor,
  sameCardContent,
} from "../../../../profile/library";
import { refIdentity } from "../../../../project/refIdentity";
import type { ProjectRef } from "../../../../storage/types";

/**
 * What the shelf knows about each project; the state is the reason. Cached
 * content rides on the card (`content`), not in the state. `unreadable` and
 * `gone` stay separate: a read failure carries its own problem text and no
 * shelf banner; a vanished folder shows slate and, for local, Remove.
 */
export type CardState =
  /** Probing or reading. Cached content shows meanwhile, never a skeleton. */
  | "loading"
  /** Read from the folder itself, this session. */
  | "ready"
  /**
   * Cannot open because access lapsed: a local folder grant, recovered by the
   * picker, or a Remote Storage connection, recovered by the banner. Cached
   * content shows dimmed with its age, never as current.
   */
  | "blocked"
  /** This browser has no way to reach it. */
  | "gone"
  /**
   * Reachable, but the read failed for another reason, such as a transient IO
   * failure. The card's problem text says which.
   */
  | "unreadable";

export interface ProjectCard {
  /**
   * The project's own id from its library row; the pairing, the
   * conflict map and the synced set key on it.
   *
   * `null` only for a card ahead of its row: the loading card `adopt`
   * inserts before the folder is read. Every consumer treats `null` as "not
   * that project", never as a wildcard.
   */
  id: string | null;
  ref: ProjectRef;
  state: CardState;
  /**
   * Everything the card draws, from a fresh read or the mirror row; `null` when
   * neither.
   */
  content: CardContent | null;
  /** Whether `content` was read this session; false means as last observed. */
  fresh: boolean;
  /** Why it could not be read, in the writer's language. */
  problem: string | null;
}

/**
 * The id this card opens at, or `null` when it does not open.
 *
 * One function answers both whether and where, so the two cannot disagree. A
 * card in trouble (blocked, unreadable, gone) offers no click, and a card just
 * inserted by an adopt has no id until its first read lands.
 */
export function openableId(
  card: Pick<ProjectCard, "state" | "content">,
): string | null {
  const settled = card.state === "ready" || card.state === "loading";
  return settled ? (card.content?.id ?? null) : null;
}

export interface ReadResult {
  content: CardContent | null;
  state: CardState;
  problem: string | null;
}

/**
 * The one result that is not a card: the folder is reachable and its content
 * is not a project (no valid properties or structure). The shelf never
 * paints it and drops it silently.
 */
export type NotAProject = { state: "not-a-project" };

export type ReadOutcome = ReadResult | NotAProject;

/** Which connection a card's provider needs. */
export type Place = "remote" | "local" | "other";

/**
 * The connection facts one gather paints with, taken once when it starts.
 * `…Resolved` is the latch: an unanswered verdict is not a lapsed one.
 */
export interface Reach {
  remoteConnected: boolean;
  remoteResolved: boolean;
  rootReady: boolean;
  rootResolved: boolean;
}

/** The cards the library rows draw before any read. */
export function initialCards(rows: readonly LibraryRow[]): ProjectCard[] {
  return rows.map((row) => ({
    id: row.id,
    ref: libraryRefs([row])[0],
    state: "loading" as const,
    content: row.card,
    fresh: false,
    problem: null,
  }));
}

/**
 * Paints every library row as a card. A card whose connection is out shows
 * `blocked`, or `loading` until that connection's verdict is in. A card
 * already `ready` this session that would paint `loading` keeps its state and
 * content rather than flashing back; the read that follows re-confirms it.
 */
export function paintCards(
  current: readonly ProjectCard[],
  rows: readonly LibraryRow[],
  place: (ref: ProjectRef) => Place,
  reach: Reach,
): ProjectCard[] {
  const existingByKey = new Map(
    current.map((card) => [refIdentity(card.ref), card]),
  );
  return libraryRefs(rows).map((ref, i) => {
    const where = place(ref);
    const state: CardState =
      where === "remote" && !reach.remoteConnected
        ? reach.remoteResolved
          ? "blocked"
          : "loading"
        : where === "local" && !reach.rootReady
          ? reach.rootResolved
            ? "blocked"
            : "loading"
          : "loading";
    const id = rows[i].id;
    const existing = existingByKey.get(refIdentity(ref));
    if (existing && existing.state === "ready" && state === "loading") {
      return { ...existing, id, ref };
    }
    return {
      id,
      ref,
      state,
      content: libraryCard(rows, ref),
      fresh: false,
      problem: null,
    };
  });
}

/**
 * Whether a gather reads this card now. With no root, settled or settling,
 * local reads wait: a read without a root would settle the card `gone` where
 * the paint and the banner say `blocked`.
 */
export function readsNow(where: Place, reach: Reach): boolean {
  return (
    (reach.remoteConnected || where !== "remote") &&
    (reach.rootReady || where !== "local")
  );
}

/**
 * Appends a loading placeholder card for `ref` unless one exists, before the
 * read that replaces it starts.
 */
export function insertLoadingCard(
  cards: ProjectCard[],
  ref: ProjectRef,
): ProjectCard[] {
  return cards.some((card) => refIdentity(card.ref) === refIdentity(ref))
    ? cards
    : [
        ...cards,
        {
          // Unknown until the read says which book the folder holds.
          id: null,
          ref,
          state: "loading" as const,
          content: null,
          fresh: false,
          problem: null,
        },
      ];
}

export function updateCard(
  cards: readonly ProjectCard[],
  ref: ProjectRef,
  patch: Partial<ProjectCard>,
): ProjectCard[] {
  const key = refIdentity(ref);
  return cards.map((card) =>
    refIdentity(card.ref) === key ? { ...card, ...patch } : card,
  );
}

export function removeCard(
  cards: readonly ProjectCard[],
  ref: ProjectRef,
): ProjectCard[] {
  const key = refIdentity(ref);
  return cards.filter((card) => refIdentity(card.ref) !== key);
}

/** The patch a read's result makes to its card. */
export function readPatch(result: ReadResult): Partial<ProjectCard> {
  return { ...result, fresh: result.state === "ready" };
}

/** The card at `from` now lives at `to`, with what the read there found. */
export function relocateCard(
  cards: readonly ProjectCard[],
  from: ProjectRef,
  to: ProjectRef,
  result: ReadResult,
): ProjectCard[] {
  const was = refIdentity(from);
  return cards.map((card) =>
    refIdentity(card.ref) === was
      ? { ...card, ref: to, ...readPatch(result) }
      : card,
  );
}

/**
 * Re-applies the mirror's card content without a read. A card whose row draws
 * the same keeps its reference; a card with new content takes it with
 * `fresh: false`. Returns `cards` itself when nothing changed, and leaves a
 * card whose row vanished as it is.
 */
export function mergeMirror(
  cards: ProjectCard[],
  rows: readonly LibraryRow[],
): ProjectCard[] {
  let changed = false;
  const next = cards.map((card) => {
    const rowCard = libraryCard(rows, card.ref);
    if (!rowCard) return card;
    if (card.content && sameCardContent(card.content, rowCard)) return card;
    changed = true;
    return { ...card, content: rowCard, fresh: false };
  });
  return changed ? next : cards;
}

/**
 * A read persists its observation only when the row at this address is the
 * book the folder claims to be. A folder holding a uuid shelved elsewhere is
 * a copy of that book, or its stale twin after a move made outside the app;
 * persisting would repaint the shelved row's card with the copy's bytes.
 */
export function rowHoldsBook(
  rows: readonly LibraryRow[],
  ref: ProjectRef,
  bookId: string,
): boolean {
  return libraryRowFor(rows, ref)?.id === bookId;
}

/**
 * The id a sweep adopts this folder under, or `null` when it does not adopt.
 *
 * No identity, no row: only a `ready` read says which book the folder holds.
 * A book the shelf already holds, found again in a second folder, is refused,
 * so two rows never carry one uuid. Nothing tells a move from a copy behind a
 * permission prompt or an offline backend; a writer who moved a folder
 * outside the app forgets the project and adds it again.
 */
export function adoptableId(
  rows: readonly LibraryRow[],
  ref: ProjectRef,
  result: ReadResult,
): string | null {
  const id = result.content?.id;
  if (!id) return null;
  const shelved = rows.find((row) => row.id === id);
  if (
    shelved &&
    (shelved.provider !== ref.providerId || shelved.key !== ref.key)
  )
    return null;
  return id;
}
