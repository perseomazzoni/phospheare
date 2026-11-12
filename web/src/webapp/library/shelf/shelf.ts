// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { PROPERTIES_FILE, STRUCTURE_FILE } from "../../../project/naming";
import {
  parseProperties,
  validateProperties,
} from "../../../project/properties";
import { parseStructure } from "../../../project/structure";
import { pooled } from "../../../project/pool";
import { openProjectStorage } from "../../../project/projectStorage";
import { refIdentity } from "../../../project/refIdentity";
import {
  libraryCard,
  libraryIdForRef,
  libraryRowFor,
} from "../../../profile/library";
import {
  addToLibrary,
  libraryRows,
  rememberCard,
  rememberedCard,
  removeFromLibrary,
} from "../../../profile/profileSync";
import {
  connectionFor,
  getProvider,
  isRemoteRef,
  listDriveProjects,
  listLocalProjects,
  localProvider,
  type Connections,
  type ProjectRef,
  type StorageError,
  type StorageProvider,
} from "../../../storage";
import {
  adoptableId,
  initialCards,
  insertLoadingCard,
  mergeMirror,
  paintCards,
  readPatch,
  readsNow,
  relocateCard,
  removeCard,
  rowHoldsBook,
  updateCard,
  type Place,
  type ProjectCard,
  type Reach,
  type ReadOutcome,
  type ReadResult,
} from "./domain/cards";
import { outcomeForAccess, outcomeForError } from "./domain/readOutcome";
import type { SyncMarks } from "./syncMarks";

// The shelf's cards: derived from the library mirror and live reads.
//
// The library in the account's profile is the shelf's source of truth, read
// synchronously for the first paint and written on every add and remove. One
// row per project holds both membership and card content, on both backends;
// `rememberCard` writes what a read learned back onto it.
//
// Nothing is scanned on start: a plain reload must not restore a project the
// writer removed, and the membership tombstone is the removal. Discovery is
// the explicit sweep, `scanDrive` or `scanLocal`; the map and remap flow also
// runs `scanLocal` so a newly mapped root imports its books.
//
// A cached card whose folder left the root settles to `gone`. A folder whose
// content is not a project is dropped silently.
//
// Nothing here prompts except `reconnect` and `scanLocal`, which open the
// folder picker from inside a click; one pick of the root covers every local
// card.
//
// Reads are capped at four at a time: Remote Storage with twenty projects is
// two files each on top of the listing, a burst the API may throttle.

const CONCURRENCY = 4;

/** How far a sweep has got: listing the root, then reading each candidate. */
export type SweepProgress =
  { phase: "listing" } | { phase: "reading"; done: number; total: number };

/**
 * Follows a sweep for a window that shows it. `step` fires once the sweep
 * really starts, so a sweep that never ran (no root, a picker dismissed)
 * reports nothing; `added` names each project as it joins the library.
 */
export interface SweepWatch {
  step(progress: SweepProgress): void;
  added(title: string): void;
}

export interface ShelfState {
  cards: ProjectCard[];
  /** True until the candidate lists are settled, not until every card is read. */
  listing: boolean;
  /** Gather accounting; see `ProjectsShelf` in `useProjects.ts`. */
  gatherStarts: number;
  gatherSettles: number;
}

/** What the shelf learns from the React side on every commit. */
export interface ShelfInputs {
  reach: Reach;
  connections: Connections;
  /** An `unreadable` card's reason, in the writer's language. */
  describe: (err: StorageError) => string;
}

function placeOf(ref: ProjectRef): Place {
  if (isRemoteRef(ref)) return "remote";
  return ref.providerId === localProvider.id ? "local" : "other";
}

/**
 * One account's shelf. React reads it through `subscribe` and `snapshot`; the
 * state changes only through the methods here.
 *
 * The gather is the one long job: it paints every library row as a card,
 * reads the cards four at a time, then has the sync marks check each paired
 * book. `start` runs the first one, `rescan` runs another, and `stop` ends
 * the current one. Nothing else starts a gather, except the local root's
 * latch: the handle store's first answer comes moments after the start, when
 * the start may already have stopped for want of it.
 */
export class Shelf {
  private state: ShelfState;
  private readonly listeners = new Set<() => void>();
  private inputs: ShelfInputs;

  /**
   * A read that lands after the writer signed out, reconnected Remote
   * Storage or left the shelf must not write itself into the current shelf.
   */
  private run = 0;
  /** Stops the current gather's pooled reads and checks from starting more. */
  private controller: AbortController | null = null;
  private started = false;

  /**
   * One gather at a time: React's `<StrictMode>` start, stop and start again
   * alone makes two. A gather arriving while one runs is parked, and the
   * newest parked one runs next. `alive()` keeps a superseded gather's
   * results from landing; this saves its network calls.
   */
  private readonly flight: {
    running: boolean;
    pending: (() => Promise<void>) | null;
  } = { running: false, pending: null };

  constructor(
    private readonly userId: string,
    private readonly marks: SyncMarks,
    inputs: ShelfInputs,
  ) {
    this.inputs = inputs;
    // The first paint carries the projects the writer already had, or the
    // shelf shows empty for a frame and then shifts under them.
    this.state = {
      cards: initialCards(libraryRows(userId)),
      listing: true,
      gatherStarts: 0,
      gatherSettles: 0,
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): ShelfState => this.state;

  private set(patch: Partial<ShelfState>): void {
    const next = { ...this.state, ...patch };
    if (
      (Object.keys(patch) as (keyof ShelfState)[]).every(
        (key) => next[key] === this.state[key],
      )
    )
      return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private setCards(change: (cards: ProjectCard[]) => ProjectCard[]): void {
    this.set({ cards: change(this.state.cards) });
  }

  /**
   * Takes the newest facts. The gather reads them when it starts, so a fact
   * that changes starts nothing, except the local root latch's first `true`.
   */
  setInputs(inputs: ShelfInputs): void {
    const wasResolved = this.inputs.reach.rootResolved;
    this.inputs = inputs;
    if (this.started && inputs.reach.rootResolved && !wasResolved)
      this.gather();
  }

  /** Runs the first gather. Safe to call again after `stop`. */
  start(): void {
    this.started = true;
    this.gather();
  }

  /** Ends the current gather: its results no longer land. */
  stop(): void {
    this.started = false;
    this.run += 1;
    this.controller?.abort();
    this.controller = null;
  }

  /** Re-runs the whole gather, the last step of choosing the local root. */
  readonly rescan = (): void => {
    this.gather();
  };

  private async runGather(gather: () => Promise<void>): Promise<void> {
    if (this.flight.running) {
      this.flight.pending = gather;
      return;
    }
    this.flight.running = true;
    try {
      await gather();
    } finally {
      this.flight.running = false;
      const next = this.flight.pending;
      if (next) {
        this.flight.pending = null;
        void this.runGather(next);
      }
    }
  }

  private gather(): void {
    this.controller?.abort();
    const token = (this.run += 1);
    const alive = () => this.run === token;
    const controller = new AbortController();
    this.controller = controller;

    // Taken once, so one run paints with one set of facts. The guard ignores
    // the remote latch: `SessionGate` blocks until auth resolves, so it is
    // true by now, and gating on it would hold local cards on Remote
    // Storage's answer.
    const { remoteConnected, remoteResolved, rootResolved } = this.inputs.reach;
    if (!rootResolved) return;

    // A start is counted here, before the single-flight slot can defer the
    // work: the settle accounting keys on this order.
    this.set({
      listing: true,
      gatherStarts: this.state.gatherStarts + 1,
    });

    const work = async () => {
      try {
        // Local, so it runs whether or not a remote is connected: being
        // Local+Synced is a property of the project, not of this session.
        const pairings = await this.marks.readPairings(alive);
        if (!alive()) return;

        // The membership mirror decides who is on the shelf: every project
        // the library holds, with this device's offline adds and removes
        // applied write-ahead. The row's card content decorates each card
        // and never decides membership, because a card that cannot be read
        // now is still a card.
        const rows = libraryRows(this.userId);
        // The root fact is read now, from the connection's settled state:
        // the flows that change the root settle the connection before they
        // rescan, so the paint never races a sweep's adoption.
        const reach: Reach = {
          remoteConnected,
          remoteResolved,
          rootReady: this.inputs.reach.rootReady,
          rootResolved,
        };
        this.set({
          cards: paintCards(this.state.cards, rows, placeOf, reach),
          listing: false,
        });

        try {
          await pooled(
            this.state.cards.filter((card) =>
              readsNow(placeOf(card.ref), reach),
            ),
            CONCURRENCY,
            (card) => this.readThrough(card.ref, card.id),
            (result, card) => {
              if (alive()) this.applyRead(card.ref, result);
            },
            controller.signal,
          );

          // The checks run after the reads, so they do not compete with the
          // reads the writer is watching for the per-host connection budget.
          if (!alive() || !remoteConnected || !pairings || pairings.size === 0)
            return;
          await this.marks.checkAll(rows, pairings, alive, controller.signal);
        } catch {
          // Both pools reject only through `controller.signal`, since every
          // task catches its own failure: a superseded gather stopping
          // partway is not an error.
        }
      } finally {
        this.set({ gatherSettles: this.state.gatherSettles + 1 });
      }
    };

    void this.runGather(work);
  }

  // ── Reading one card ──────────────────────────────────────────────────────

  private async read(
    provider: StorageProvider,
    ref: ProjectRef,
  ): Promise<ReadOutcome> {
    const remembered = libraryCard(libraryRows(this.userId), ref);
    try {
      const settled = outcomeForAccess(
        await provider.canAccess(ref),
        remembered,
      );
      if (settled) return settled;

      const rawProps = await provider.readFile(ref, PROPERTIES_FILE);
      if (validateProperties(rawProps).length > 0)
        return { state: "not-a-project" };
      const props = parseProperties(rawProps, ref.name);

      const shape = parseStructure(
        await provider.readFile(ref, STRUCTURE_FILE),
      );
      if (!shape.ok) return { state: "not-a-project" };

      // Persisted only when the row here holds this book. The content still
      // returns, because a relocate proves its copy by this read before the
      // row moves, but `rememberedCard` builds it with nothing written.
      return {
        content: rowHoldsBook(libraryRows(this.userId), ref, props.document.id)
          ? rememberCard(this.userId, props, shape.structure)
          : rememberedCard(props, shape.structure),
        state: "ready",
        problem: null,
      };
    } catch (err) {
      return outcomeForError(err, remembered, this.inputs.describe);
    }
  }

  /**
   * Reads a shelved book through the storage the editor would hold
   * (`openProjectStorage`): a book with a remote is read from its working
   * copy, so saves the queue has not delivered yet are what the card shows
   * and what `rememberCard` writes back. A bare remote read would paint the
   * card from before those saves and push that stale card to the profile.
   *
   * A card with no id, or storage that cannot be opened, is read bare.
   */
  private async readThrough(
    ref: ProjectRef,
    id: string | null,
  ): Promise<ReadOutcome> {
    const opened = id
      ? await openProjectStorage(ref, id).catch(() => null)
      : null;
    try {
      const provider = opened?.storage ?? getProvider(ref.providerId);
      if (!provider) return { content: null, state: "gone", problem: null };
      return await this.read(provider, ref);
    } finally {
      opened?.dispose();
    }
  }

  /**
   * The one place a read's outcome lands on the shelf. A `not-a-project`
   * outcome drops the card and its membership row, which keeps the folder out
   * of the library on every other device too.
   */
  private applyRead(ref: ProjectRef, outcome: ReadOutcome): void {
    if (outcome.state === "not-a-project") {
      this.drop(ref);
      return;
    }
    this.setCards((cards) => updateCard(cards, ref, readPatch(outcome)));
  }

  // ── Card actions ──────────────────────────────────────────────────────────

  /**
   * Reconnects a lapsed grant and re-reads every card of that provider in
   * place: local's verb is the pick, which grants the root's whole subtree;
   * Remote Storage's is the re-verify. Runs straight from a click, because
   * the picker needs the gesture. Cancelling changes nothing.
   */
  readonly reconnect = async (ref: ProjectRef): Promise<void> => {
    const conn = connectionFor(ref.providerId);
    if (!conn) return;

    this.setCards((cards) => updateCard(cards, ref, { state: "loading" }));
    const outcome = await conn
      .reconnect(ref)
      .catch(() => "unavailable" as const);
    if (outcome !== "granted") {
      const remembered = libraryCard(libraryRows(this.userId), ref);
      this.setCards((cards) =>
        updateCard(cards, ref, { state: "blocked", content: remembered }),
      );
      return;
    }
    await pooled(
      this.state.cards.filter((card) => card.ref.providerId === ref.providerId),
      CONCURRENCY,
      (card) => this.readThrough(card.ref, card.id),
      (result, card) => this.applyRead(card.ref, result),
    );
  };

  /**
   * Re-reads a project already permitted: `reconnect` without the asking,
   * for after a rename, when the folder is reachable and only its contents
   * changed. It never prompts, so it is safe outside a user gesture.
   *
   * The ref is written back as well as read. A Remote Storage rename changes
   * the folder's name but not its id, so the card keeps its identity and gains
   * a new label, because `refIdentity` ignores `name`.
   *
   * `through` is the storage a write went through when it was not the
   * book's own: the Properties window writes a book with a remote into its
   * working copy, and the card is read where the write landed.
   */
  readonly revalidate = async (
    ref: ProjectRef,
    through?: StorageProvider,
  ): Promise<void> => {
    if (!through && !getProvider(ref.providerId)) return;

    this.setCards((cards) => updateCard(cards, ref, { ref, state: "loading" }));
    const result = through
      ? await this.read(through, ref)
      : await this.readThrough(
          ref,
          libraryIdForRef(libraryRows(this.userId), ref),
        );
    this.applyRead(ref, result);
  };

  /**
   * Puts a new project on the shelf: the mirror of `forget`, and the end of a
   * create or a duplicate. Re-running the whole gather instead would repaint
   * every card and place the new one wherever the sort put it.
   *
   * The loading card goes in before the read, so the writer sees the project
   * land at once and a gather's paint still finds it; the membership write
   * waits for the read, because the row is keyed by the id inside the folder.
   * A folder that cannot be read is not adopted.
   */
  readonly adopt = async (ref: ProjectRef): Promise<void> => {
    const provider = getProvider(ref.providerId);
    if (!provider) return;

    this.setCards((cards) => insertLoadingCard(cards, ref));

    const result = await this.read(provider, ref);
    if (result.state !== "not-a-project" && result.content) {
      addToLibrary(
        this.userId,
        {
          id: result.content.id,
          provider: ref.providerId,
          key: ref.key,
          name: ref.name,
        },
        result.content,
      );
      // The card now has its row, so it carries the row's id: Properties and
      // Export open a book by it.
      const id = result.content.id;
      this.setCards((cards) =>
        updateCard(cards, ref, { ...readPatch(result), id }),
      );
      return;
    }
    this.applyRead(ref, result);
  };

  /**
   * The same book somewhere else, the end of a move to another backend.
   *
   * Not `drop(from)` and `adopt(to)`: a move copies the folder, uuid and all,
   * so a tombstone plus a fresh row would lose its `openedAt` history over a
   * storage decision. The book keeps the row it had.
   *
   * Nothing moves until the copy reads, so the caller may destroy the old
   * copy afterwards. `false` means nothing changed.
   */
  readonly relocate = async (
    from: ProjectRef,
    to: ProjectRef,
  ): Promise<boolean> => {
    const provider = getProvider(to.providerId);
    if (!provider) return false;

    const result = await this.read(provider, to);
    if (result.state === "not-a-project" || !result.content) return false;

    // The old row's id, so this updates that row.
    addToLibrary(
      this.userId,
      {
        id: result.content.id,
        provider: to.providerId,
        key: to.key,
        name: to.name,
      },
      result.content,
    );
    this.setCards((cards) => relocateCard(cards, from, to, result));
    return true;
  };

  /**
   * The project is gone from storage, so the card goes with it. Unlike
   * `forget`, no restore: putting the card back would not put the folder
   * back, and the undo is the storage's own bin.
   */
  readonly drop = (ref: ProjectRef): void => {
    const id = libraryIdForRef(libraryRows(this.userId), ref);
    if (id) removeFromLibrary(this.userId, id);
    this.setCards((cards) => removeCard(cards, ref));
  };

  /**
   * Takes a project off the shelf, returning the function that restores it.
   * Reversible, so it happens now and offers Undo, with no dialog.
   *
   * Removing the row tombstones the project in the profile, so no other
   * device restores it. The tombstone nulls the card in the profile, so the
   * undo re-adds the row with the remembered content, and a forgotten blocked
   * project does not come back without its title.
   */
  readonly forget = (ref: ProjectRef): (() => void) => {
    // Read before the removal, because the row holds the identity. The undo
    // re-adds the same book, not merely something at the same address.
    const id = libraryIdForRef(libraryRows(this.userId), ref);
    if (id) removeFromLibrary(this.userId, id);
    const key = refIdentity(ref);
    const removed = this.state.cards.find(
      (card) => refIdentity(card.ref) === key,
    );
    this.setCards((cards) => removeCard(cards, ref));

    return () => {
      if (!id) return;
      addToLibrary(
        this.userId,
        { id, provider: ref.providerId, key: ref.key, name: ref.name },
        removed?.content ?? undefined,
      );
      this.setCards((cards) =>
        removed && !cards.some((card) => refIdentity(card.ref) === key)
          ? [...cards, removed]
          : cards,
      );
    };
  };

  /**
   * Re-applies the mirror's card content without a provider read, after a
   * settled pull: content changes touch no membership and no file this device
   * would read differently. Idempotent.
   */
  readonly refreshContent = (): void => {
    const rows = libraryRows(this.userId);
    this.setCards((cards) => mergeMirror(cards, rows));
  };

  // ── Sweeps ────────────────────────────────────────────────────────────────

  /**
   * The adoption tail both sweeps share: the membership write, the loading
   * card, the paint. Returns whether the adoption happened, because it can
   * decline, and a sweep must not count a project it did not add.
   */
  private adoptSwept(ref: ProjectRef, result: ReadResult): boolean {
    const id = adoptableId(libraryRows(this.userId), ref, result);
    if (!id) return false;
    addToLibrary(
      this.userId,
      { id, provider: ref.providerId, key: ref.key, name: ref.name },
      result.content ?? undefined,
    );
    this.setCards((cards) =>
      updateCard(insertLoadingCard(cards, ref), ref, {
        ...readPatch(result),
        id,
      }),
    );
    return true;
  }

  /**
   * The tail both sweeps share: diff the scan against the membership mirror,
   * read the candidates in a pool, and adopt the real books. The membership
   * mirror is the known set, not the content cache: a project added but never
   * readable has no content row, and diffing against content would re-add it
   * forever. One predicate decides what is adoptable, `ready` or `blocked`,
   * so a new card state cannot be learned by one sweep and missed by the
   * other.
   */
  private async sweepCandidates(
    scanned: ProjectRef[],
    watch?: SweepWatch,
  ): Promise<number> {
    const known = libraryRows(this.userId);
    const candidates = scanned.filter((ref) => !libraryRowFor(known, ref));
    let added = 0;
    let done = 0;
    watch?.step({ phase: "reading", done, total: candidates.length });
    // `added` is safe to increment in the result callback: it fires once per
    // landed result, never overlapping another.
    await pooled(
      candidates,
      CONCURRENCY,
      async (ref) => {
        const provider = getProvider(ref.providerId);
        if (!provider) return null;
        return this.read(provider, ref);
      },
      (result, ref) => {
        done++;
        watch?.step({ phase: "reading", done, total: candidates.length });
        if (!result) return;
        if (result.state === "ready" || result.state === "blocked") {
          if (this.adoptSwept(ref, result)) {
            added++;
            watch?.added(result.content?.title || ref.name);
          }
        }
      },
    );
    return added;
  }

  /**
   * Scans Remote Storage for new projects and adds them; resolves the count
   * added. Rejects when Remote Storage could not be listed.
   */
  readonly scanDrive = async (watch?: SweepWatch): Promise<number> => {
    if (!this.inputs.reach.remoteConnected) return 0;
    watch?.step({ phase: "listing" });
    const scanned = await listDriveProjects();
    return this.sweepCandidates(scanned, watch);
  };

  /**
   * Scans the mapped local root and adds any project not in the library.
   * Re-grants a lapsed root permission, since every caller runs inside a
   * click. Resolves the number added.
   */
  readonly scanLocal = async (watch?: SweepWatch): Promise<number> => {
    const local = this.inputs.connections.local;
    // The root verdict must be fresh, not the last commit's: a pick in the
    // same click settled the connection moments ago. `refresh()` re-settles
    // and returns the verdict; its re-render lands after the sweep's
    // adoption, and the gather that follows paints the new books.
    const state = await local.refresh();
    if (state === "unset" || state === "unavailable") return 0;
    // A lapsed grant: the pick re-grants it. After the map flow's pick this
    // is a no-op.
    if (state !== "connected") {
      const picked = await local.connect().catch(() => false);
      if (!picked) return 0;
    }

    watch?.step({ phase: "listing" });
    const scanned = await listLocalProjects().catch(() => []);
    return this.sweepCandidates(scanned, watch);
  };
}
