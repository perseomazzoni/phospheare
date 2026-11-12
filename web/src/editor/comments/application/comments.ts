// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  cleanBody,
  cleanSearched,
  clipNote,
  readComments,
  writeComments,
} from "../domain/codec";
import { REPLY_BODY_MAX } from "../domain/limits";
import {
  addEntry,
  EMPTY_FILE,
  keep,
  openThread,
  reanchor,
  remove,
  reopen,
  resolve,
  type Author,
  type CommentAnchor,
  type CommentsFile,
  type Entry,
  type Searched,
  type ThreadState,
  type Weight,
} from "../domain/model";
import { admit, type Admission, type Proposal } from "../domain/proposals";

// What the service needs from outside: one entry point, the file of one node,
// read and written whole. The service decides what goes in it; the store
// only knows where it lives.

/** What reading a node's comments file found. */
export type StoredComments =
  { kind: "missing" } | { kind: "text"; text: string };

export interface CommentStore {
  /**
   * The node's file, or `missing` when it has none. Throws when the file
   * could not be reached at all (a lapsed grant, a network down), which is
   * not the same as having no comments and must never be written over.
   */
  read(nodeId: string): Promise<StoredComments>;
  write(nodeId: string, text: string): Promise<void>;
}

// Comments as the app changes them. One service per open project. It holds
// what it last read of each node's file for the screen, and changes a file
// only by reading it afresh, applying one pure change from the domain and
// writing it back, in one lane per file, so two changes landing together (the
// writer resolving a thread while a persona's reply arrives) each see the
// other's write.
//
// A file that could not be read is never written: a damaged one (its shape is
// wrong) stays for the writer to look at, and an unavailable one (the storage
// did not answer) is not the same as an empty one. Both refuse every change.
//
// A thread found again somewhere new after an edit (`noteMoved`) is not worth
// a write of its own on every keystroke: the move is held and folded into the
// file's next write, whoever makes it.

export type NodeComments =
  | { status: "loading" }
  | { status: "ready"; file: CommentsFile }
  | { status: "damaged" }
  | { status: "unavailable" };

export class CommentsRefused extends Error {
  constructor(readonly reason: "damaged" | "unavailable") {
    super(`comments-${reason}`);
  }
}

export interface CommentsServiceDeps {
  store: CommentStore;
  /** ISO time now. */
  now: () => string;
  /** A fresh id for a thread or an entry. */
  newId: () => string;
}

export interface NewComment {
  anchor: CommentAnchor | null;
  author: Author;
  body: string;
  state?: ThreadState;
  weight?: Weight;
}

export class CommentsService {
  private nodes = new Map<string, NodeComments>();
  private view: ReadonlyMap<string, NodeComments> = new Map();
  private readonly lanes = new Map<string, Promise<unknown>>();
  private readonly moved = new Map<string, Map<string, CommentAnchor>>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(private readonly deps: CommentsServiceDeps) {}

  /** For `useSyncExternalStore`: a new map on each change, the same between. */
  readonly snapshot = (): ReadonlyMap<string, NodeComments> => this.view;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** No more reads land and no more listeners hear, once the project closes. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  /** What the screen last saw of a node's comments. */
  stateOf(nodeId: string): NodeComments | undefined {
    return this.nodes.get(nodeId);
  }

  /** The node's file when it is ready, or null. */
  fileOf(nodeId: string): CommentsFile | null {
    const state = this.nodes.get(nodeId);
    return state?.status === "ready" ? state.file : null;
  }

  /**
   * Read the files of these nodes, the ones not read yet. The caller passes
   * the live nodes of the structure: the folder is never listed, so a binned
   * node's file is never asked for.
   *
   * The batch is published twice, loading and then everything it read, never
   * once per file. Each publish re-renders the whole editor shell and every
   * row of the structure panel, and the reads land one task apart, so React
   * cannot fold them together: a book of 128 nodes would open as 128 renders
   * back to back and hold the page for a quarter of a minute.
   */
  async load(nodeIds: readonly string[]): Promise<void> {
    const fresh = nodeIds.filter((id) => !this.nodes.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) this.nodes.set(id, { status: "loading" });
    this.publish();
    await Promise.all(fresh.map((id) => this.readInto(id, false)));
    this.publish();
  }

  /**
   * Read one node's file again, as it is now, in the file's lane after any
   * change already queued for it, so a read that started before a write
   * landed can never publish the file as it was.
   */
  async reload(nodeId: string): Promise<void> {
    const run = (this.lanes.get(nodeId) ?? Promise.resolve()).then(() =>
      this.readInto(nodeId),
    );
    this.lanes.set(nodeId, run);
    await run;
  }

  /** A new thread; its id. */
  async open(nodeId: string, comment: NewComment): Promise<string> {
    const id = this.deps.newId();
    await this.change(nodeId, (file) =>
      openThread(file, {
        id,
        anchor: comment.anchor,
        entry: this.entry(comment.author, comment.body),
        ...(comment.state ? { state: comment.state } : {}),
        ...(comment.weight ? { weight: comment.weight } : {}),
      }),
    );
    return id;
  }

  /**
   * An entry added to a thread; the entry. A persona's may carry the web
   * searches its reply made, cleaned as the file keeps them.
   */
  async reply(
    nodeId: string,
    threadId: string,
    author: Author,
    body: string,
    searches: readonly Searched[] = [],
  ): Promise<Entry> {
    const made = this.entry(
      author,
      author.kind === "persona" ? clipNote(body, REPLY_BODY_MAX) : body,
    );
    const kept = author.kind === "persona" ? cleanSearched(searches) : null;
    const entry: Entry = kept ? { ...made, searched: kept } : made;
    await this.change(nodeId, (file) => addEntry(file, threadId, entry));
    return entry;
  }

  keep(nodeId: string, threadId: string): Promise<void> {
    return this.change(nodeId, (file) => keep(file, threadId));
  }

  resolve(nodeId: string, threadId: string): Promise<void> {
    return this.change(nodeId, (file) => resolve(file, threadId));
  }

  reopen(nodeId: string, threadId: string): Promise<void> {
    return this.change(nodeId, (file) => reopen(file, threadId));
  }

  reanchor(
    nodeId: string,
    threadId: string,
    anchor: CommentAnchor | null,
  ): Promise<void> {
    this.moved.get(nodeId)?.delete(threadId);
    return this.change(nodeId, (file) => reanchor(file, threadId, anchor));
  }

  /** Dismiss a ghost comment or remove a thread (`model.remove`). */
  remove(nodeId: string, threadId: string): Promise<void> {
    return this.change(nodeId, (file) =>
      remove(file, threadId, this.deps.now()),
    );
  }

  /**
   * A persona's proposals: what the file takes becomes ghost comments, and
   * the rest come back with the reason they were turned away.
   */
  async propose(
    nodeId: string,
    persona: string,
    proposals: readonly Proposal[],
  ): Promise<Admission> {
    let admission: Admission = { admitted: [], refused: [] };
    await this.change(nodeId, (file) => {
      admission = admit(file, persona, proposals);
      let next = file;
      for (const proposal of admission.admitted)
        next = openThread(next, {
          id: this.deps.newId(),
          anchor: proposal.anchor,
          entry: this.entry({ kind: "persona", id: persona }, proposal.body),
          state: "proposed",
          weight: proposal.weight,
        });
      return next;
    });
    return admission;
  }

  /**
   * A thread found somewhere new after an edit, held until the file is next
   * written. The screen already shows it where it is.
   */
  noteMoved(nodeId: string, threadId: string, anchor: CommentAnchor): void {
    let held = this.moved.get(nodeId);
    if (!held) {
      held = new Map();
      this.moved.set(nodeId, held);
    }
    held.set(threadId, anchor);
  }

  private entry(author: Author, body: string, max?: number): Entry {
    return {
      id: this.deps.newId(),
      author,
      at: this.deps.now(),
      body: cleanBody(body, max),
    };
  }

  /** Read-modify-write of one file, in that file's lane. */
  private change(
    nodeId: string,
    apply: (file: CommentsFile) => CommentsFile,
  ): Promise<void> {
    const job = async () => {
      const current = await this.readFresh(nodeId);
      let next = apply(current);
      const held = this.moved.get(nodeId);
      if (held && held.size > 0) {
        for (const [threadId, anchor] of held)
          next = reanchor(next, threadId, anchor);
        this.moved.delete(nodeId);
      }
      if (next === current) return;
      await this.deps.store.write(nodeId, writeComments(next));
      this.set(nodeId, { status: "ready", file: next });
    };
    const run = (this.lanes.get(nodeId) ?? Promise.resolve()).then(job);
    // A failed change never strands the ones queued behind it.
    this.lanes.set(
      nodeId,
      run.catch(() => undefined),
    );
    return run;
  }

  /**
   * The file as it is on storage now; refuses one that cannot be trusted.
   * `publish` false holds the news for a batch that publishes once (`load`).
   */
  private async readFresh(
    nodeId: string,
    publish = true,
  ): Promise<CommentsFile> {
    let stored;
    try {
      stored = await this.deps.store.read(nodeId);
    } catch {
      this.set(nodeId, { status: "unavailable" }, publish);
      throw new CommentsRefused("unavailable");
    }
    if (stored.kind === "missing") return EMPTY_FILE;
    const read = readComments(stored.text);
    if (!read.ok) {
      this.set(nodeId, { status: "damaged" }, publish);
      throw new CommentsRefused("damaged");
    }
    return read.file;
  }

  private async readInto(nodeId: string, publish = true): Promise<void> {
    try {
      const file = await this.readFresh(nodeId, publish);
      this.set(nodeId, { status: "ready", file }, publish);
    } catch {
      // `readFresh` has already said which.
    }
  }

  private set(nodeId: string, state: NodeComments, publish = true): void {
    if (this.disposed) return;
    this.nodes.set(nodeId, state);
    if (publish) this.publish();
  }

  private publish(): void {
    if (this.disposed) return;
    this.view = new Map(this.nodes);
    for (const listener of this.listeners) listener();
  }
}
